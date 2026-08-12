/**
 * **손오공 「인수형」 탭을 우리 시트에 만든다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★손오공 구독은 한 줄에 두 값이 나란히 있다(실측 2026-08-12 · 「구독 상품 현황」).
 *     1행  … [11]인수형 … [17]반납형
 *     2행  … [11]보증금 [12]12개월 … [16]60개월 | [17]보증금 [18]12개월 … [22]60개월
 *   지금 ERP 에는 **반납형만** 들어와 있다 — 인수형은 한 대도 없다.
 *   한 탭에 두 요금을 같이 넣으면 영업이 어느 쪽을 부르는지 알 수 없다. 그래서 탭을 가른다.
 *
 * ★「재고」 탭과 **같은 열 규격**을 쓴다 — 파서가 같은 눈으로 읽어야 나중에 그대로 유입된다.
 *   다만 보증금은 인수형 것을 쓴다(반납형 보증금과 다르다).
 * ★값이 없는 차는 넣지 않는다 — 인수형 요금이 한 칸도 없으면 그 차는 인수형으로 안 파는 것이다.
 *
 *   npx tsx scripts/build-sonogong-buyout-tab.mts
 *   npx tsx scripts/build-sonogong-buyout-tab.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { canonSheetVehicleStatus } from '../lib/domain/sheet-import';
import { canonProductType } from '../lib/domain/product';
import {
  buildBaseFont, buildChipColors, buildColumns, buildNumberFormats, buildRowHeights,
  buildSectionBanding, buildTableRequest, buildTemplateFormat, buildTemplateValues, columnWidth,
  resetSheetRequests, tableWidth, yearOptions,
} from '../lib/domain/supplier-template-sheet';
import { HANDLED_MAKER_OPTIONS } from '../lib/domain/handled-makers';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const TAB = '인수형';
const CODE = 'RP012';
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const ROWS = 500;

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const gT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets'],
  subject: 'pyh@teamjpk.com' }).getAccessToken()).token;
const api = async (url: string, init?: RequestInit): Promise<Rec> => {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${gT}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const body = await res.json().catch(() => ({})) as Rec;
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
  return body;
};

// ── 손오공 원본에서 인수형 블록 읽기 ────────────────────────────────────────
const [t3, t4] = await Promise.all(['partners', 'v4/partners'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${dbT}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const partners: Record<string, Rec> = {};
for (const src of [t3, t4] as Rec[]) for (const [k, v] of Object.entries<Rec>(src)) if (v && typeof v === 'object') partners[k] = { ...(partners[k] || {}), ...v, _key: k };
const partner = Object.values<Rec>(partners).find((x) => !dead(x) && S(x.partner_code) === CODE && S(x.sheet_url));
const srcId = (S(partner?.sheet_url).match(/\/d\/([\w-]+)/) || [])[1];
if (!srcId) { console.log('■ 손오공 시트 주소를 못 찾았다\n'); process.exit(1); }

const grid = await api(`https://sheets.googleapis.com/v4/spreadsheets/${srcId}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`);
const read = readSupplierSheet(grid as never, partner as EntityRecord);
const sub = read.tabs.find((t) => /구독/.test(t.title));
if (!sub) { console.log(`■ 구독 탭을 못 찾았다 — 시트 ${srcId} · 읽은 탭 [${read.tabs.map((t) => t.title).join(' / ')}] · 실패 [${read.failures.map((f) => f.title).join(' / ')}]`); process.exit(1); }

/**
 * 1행에 「인수형」·「반납형」이 어느 칸에서 시작하는지 적혀 있다. 그 사이가 인수형 블록이다.
 * ⚠ 열 번호를 코드에 박지 않는다 — 손오공이 열을 하나 끼우면 그날로 엉뚱한 값이 들어온다.
 */
const raw = ((grid.sheets || []) as Rec[]).find((sh) => /구독/.test(S(sh.properties?.title)));
const rowData = (raw?.data?.[0]?.rowData || []) as Rec[];
const bandRow = ((rowData[0]?.values || []) as Rec[]).map((c) => S(c?.formattedValue));
const buyFrom = bandRow.findIndex((v) => /인수/.test(v));
const retFrom = bandRow.findIndex((v) => /반납/.test(v));
if (buyFrom < 0 || retFrom < 0) { console.log('■ 1행에서 인수형·반납형 구간을 못 찾았다\n'); process.exit(1); }
const hdr = sub.table[0].map(S);
console.log(`■ 손오공 인수형 탭 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  인수형 ${buyFrom}~${retFrom - 1}열 · 반납형 ${retFrom}열~`);
console.log(`  인수형 칸: ${hdr.slice(buyFrom, retFrom).join(' · ')}\n`);

// ── 우리 시트 열 규격에 맞춰 줄 만들기 ──────────────────────────────────────
/**
 * ★어댑터가 헤더에 꼬리표를 붙여 준다 — 「12개월 인수형」·「장기보증 인수형」.
 *   그래서 `^\d+개월$` 로는 한 칸도 못 잡는다(실측 2026-08-12 · 0대로 나왔다).
 *   꼬리표를 떼고 우리 열 이름으로 되돌린다.
 */
const bare = (h: string) => S(h).replace(/\s*인수형\s*$/, '');
const periods = hdr.slice(buyFrom, retFrom).map((h) => (bare(h).match(/^(\d+)개월$/) || [])[1]).filter(Boolean) as string[];
const cols = buildColumns(periods);
const names = cols.map((c) => c.name);
const at = (n: string) => names.indexOf(n);
const idx = (n: string) => hdr.indexOf(n);

const out: (string | number)[][] = [];
for (const r of sub.table.slice(1)) {
  const plate = norm(r[idx('차량번호')]);
  if (!plate) continue;
  const money = hdr.slice(buyFrom, retFrom).map((h, k) => ({ h, v: S(r[buyFrom + k]) })).filter((x) => x.v);
  if (!money.some((x) => /개월$/.test(bare(x.h)))) continue;      // 인수형 요금이 없으면 안 넣는다
  const row: (string | number)[] = Array(names.length).fill('');
  const put = (n: string, v: string | number) => { const i = at(n); if (i >= 0 && v !== '') row[i] = v; };
  const num = (v: unknown) => { const n = Number(S(v).replace(/[^\d.-]/g, '')); return Number.isFinite(n) && n > 0 ? n : ''; };
  put('차량번호', S(r[idx('차량번호')]));
  put('상태', canonSheetVehicleStatus(r[idx('배차상태')]));
  // 구독 탭이므로 분류는 구독으로 굳는다. 시트 「구분」이 「재구독」 같은 옛말이어도 규격 값으로 옮긴다.
  put('분류', S(canonProductType(r[idx('구분')])) || '중고구독');
  put('차명(트림)', S(r[idx('모델명(트림)')]) || S(r[idx('차종')]));
  put('옵션', S(r[idx('옵션')]));
  put('외부색상', S(r[idx('외장색')]));
  put('내부색상', S(r[idx('내장색')]));
  put('연료', S(r[idx('유종')]));
  put('주행거리', num(r[idx('주행거리')]));
  put('최초등록일', S(r[idx('최초등록일')]));
  for (const { h, v } of money) {
    const n = bare(h);
    if (/보증/.test(n)) { put('장기보증', num(v)); continue; }
    put(n, num(v));
  }
  out.push(row);
}
console.log(`  인수형으로 파는 차 ${out.length}대`);
if (out[0]) console.log(`  예: ${names.map((n, i) => (out[0][i] !== '' ? `${n}=${out[0][i]}` : '')).filter(Boolean).slice(0, 10).join(' · ')}`);

// ── 우리 시트에 탭 만들기 ───────────────────────────────────────────────────
const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners and trashed=false and name = '프리패스 재고 · 손오공'");
const mine = ((await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`)).files || []) as Rec[];
if (!mine[0]) { console.log('\n  ✗ 「프리패스 재고 · 손오공」 시트를 못 찾았다\n'); process.exit(1); }
const sheetId = S(mine[0].id);
const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(sheetId,title))`);
let gid = ((meta.sheets || []) as Rec[]).find((s) => S(s.properties?.title) === TAB)?.properties?.sheetId as number | undefined;
console.log(`\n  넣을 곳 「프리패스 재고 · 손오공」 / ${TAB} 탭 ${gid == null ? '(새로 만듦)' : '(있음 — 다시 찍음)'}`);
if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

if (gid == null) {
  const made = await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB } } }] }),
  });
  gid = Number(((made.replies || []) as Rec[])[0]?.addSheet?.properties?.sheetId ?? 0);
}
/**
 * 다시 찍을 때는 **옛 표·줄무늬·조건부서식을 먼저 지운다.**
 * 남아 있으면 「이미 교차되는 배경 색상이 있는 범위」로 표 변환이 거부된다(실측 2026-08-12).
 * 조건부서식을 표보다 먼저 지운다 — 표를 지우면 번호가 밀린다.
 */
{
  const cur = await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(sheetId),tables(tableId),bandedRanges(bandedRangeId),conditionalFormats)`);
  const mine2 = ((cur.sheets || []) as Rec[]).find((x) => Number(x.properties?.sheetId) === gid);
  const cf = ((mine2?.conditionalFormats || []) as Rec[]).length;
  const wipe: Rec[] = [
    ...Array.from({ length: cf }, (_, k) => ({ deleteConditionalFormatRule: { sheetId: gid, index: cf - 1 - k } })),
    ...((mine2?.tables || []) as Rec[]).map((x) => ({ deleteTable: { tableId: S(x.tableId) } })),
  ];
  if (wipe.length) await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: wipe }) });
  const left = await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(sheetId),bandedRanges(bandedRangeId))`);
  const b = ((((left.sheets || []) as Rec[]).find((x) => Number(x.properties?.sheetId) === gid)?.bandedRanges || []) as Rec[])
    .map((x) => ({ deleteBanding: { bandedRangeId: Number(x.bandedRangeId) } }));
  if (b.length) await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: b }) });
}
await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
  method: 'POST', body: JSON.stringify({ requests: resetSheetRequests(gid!) }),
});
await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`${TAB}!A1`)}?valueInputOption=USER_ENTERED`, {
  method: 'PUT', body: JSON.stringify({ values: [...buildTemplateValues(cols), ...out] }),
});
/**
 * 서식 → 표 → 줄무늬 순으로 **나눠 보낸다**.
 * 한 배치에 몰면 구글이 「Internal error」로 통째로 거절한다(실측 2026-08-12).
 */
const extras = { 제조사: HANDLED_MAKER_OPTIONS, 연식: yearOptions(new Date().getFullYear()) };
await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({
    requests: [
      ...buildBaseFont(gid!, cols.length, ROWS),
      ...buildTemplateFormat(gid!, cols, extras, { asTable: true }),
      ...buildChipColors(gid!, cols, HANDLED_MAKER_OPTIONS, ROWS),
      ...buildNumberFormats(gid!, cols, ROWS),
      ...buildRowHeights(gid!, ROWS),
      ...cols.map((c, i) => ({
        updateDimensionProperties: {
          range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
          properties: { pixelSize: columnWidth(c.name) }, fields: 'pixelSize',
        },
      })),
    ],
  }),
});
await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
  method: 'POST', body: JSON.stringify({ requests: [buildTableRequest(gid!, cols, extras, ROWS, TAB)] }),
}).catch((e) => console.log(`  △ 표 변환 — ${String((e as Error).message).slice(0, 60)}`));
/**
 * 줄무늬는 **겹치면 거부된다**. 표가 자기 구간을 칠하고, 남은 옛 줄무늬가 있으면 그것도 걸린다.
 * 그래서 표 밖에 남은 것만 지우고 새로 붙인다.
 */
const after = await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(sheetId),bandedRanges(bandedRangeId,range))`);
const mySheet = ((after.sheets || []) as Rec[]).find((x) => Number(x.properties?.sheetId) === gid);
const stale = ((mySheet?.bandedRanges || []) as Rec[])
  .filter((b) => Number(b.range?.startColumnIndex ?? 0) >= tableWidth(cols))
  .map((b) => ({ deleteBanding: { bandedRangeId: Number(b.bandedRangeId) } }));
await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
  method: 'POST', body: JSON.stringify({ requests: [...stale, ...buildSectionBanding(gid!, cols, ROWS, tableWidth(cols))] }),
}).catch((e) => console.log(`  △ 줄무늬 — ${String((e as Error).message).slice(0, 60)}`));
console.log(`\n  「${TAB}」 탭 ${out.length}대 — https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${gid}\n`);
