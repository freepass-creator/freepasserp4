/**
 * **손오공 시트를 「렌트재고」·「구독재고」 두 탭으로 다시 찍는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜 나누나(사장님 확정 2026-08-12 — 「렌트재고 구독재고 이렇게 하고 각 상품에 맞게 표를 커스터마이징」)
 *   손오공은 렌트와 구독을 같이 판다. 한 표에 섞으면 어느 칸이 그 차에 해당하는지 알 수 없다.
 *     렌트   단기(1·12) + 장기(24~60) · 보증금은 **금액**
 *     구독   단기 없음 · **인수형/반납형 두 벌** · 반납형 보증금은 **연수 × 대여료**
 *   그래서 표를 두 벌로 만든다. 열 구성은 `supplier-template-sheet` 가 SSOT다
 *   (`buildColumns` = 렌트 · `buildSubscriptionColumns` = 구독).
 *
 * ★구독 탭은 **인수형이 왼쪽, 반납형이 오른쪽**이다. 같은 기간이 두 블록에 있으면 파서는
 *   «값이 있는 마지막 블록»을 쓰고, 실제로 게시하는 건 반납형이다. 순서를 뒤집으면 게시가가 바뀐다.
 * ★반납형 보증금 칸에는 「연수×대여료」라고 적는다 — 빈칸으로 두면 사람이 «보증금 없음»으로 읽는다.
 *   파서는 순수 숫자만 금액으로 보므로 이 글자는 계산을 바꾸지 않고 `deposit_rule` 이 계산한다.
 *
 * ⚠ 이 시트는 아직 정본이 아니다(정본은 손오공 자기 시트). 배포용 «만들어 주는» 시트를 손보는 것이다.
 * ⚠ 옛 「재고」·「인수형」 탭은 지운다 — 같은 차가 두 표에 있으면 어느 쪽이 맞는지 아무도 모른다.
 *
 *   npx tsx scripts/build-sonogong-tabs.mts
 *   npx tsx scripts/build-sonogong-tabs.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { canonSheetVehicleStatus } from '../lib/domain/sheet-import';
import { canonProductType } from '../lib/domain/product';
import {
  buildBaseFont, buildChipColors, buildColumns, buildNumberFormats, buildRowHeights,
  buildSectionBanding, buildSubscriptionColumns, buildTableRequest, buildTemplateFormat,
  buildTemplateValues, columnWidth, resetSheetRequests, tableWidth, yearOptions,
} from '../lib/domain/supplier-template-sheet';
import { HANDLED_MAKER_OPTIONS } from '../lib/domain/handled-makers';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const CODE = 'RP012';
const SHEET_NAME = '프리패스 재고 · 손오공';
const DEAD_TABS = ['재고', '인수형'];
const DEPOSIT_RULE_TEXT = '연수×대여료';
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
const rentTab = read.tabs.find((t) => /렌트/.test(t.title));
const subTab = read.tabs.find((t) => /구독/.test(t.title));
if (!rentTab || !subTab) {
  console.log(`■ 렌트·구독 탭을 못 찾았다 — 읽은 탭 [${read.tabs.map((t) => t.title).join(' / ')}]\n`);
  process.exit(1);
}
console.log(`■ 손오공 시트 렌트/구독 나누기 ${APPLY ? '(반영)' : '(dry-run)'}\n`);

/** 공급사 시트 공통 칸 → 우리 열. 두 탭이 같은 앞부분을 쓴다. */
const num = (v: unknown) => { const n = Number(S(v).replace(/[^\d.-]/g, '')); return Number.isFinite(n) && n > 0 ? n : ''; };
const frontOf = (hdr: string[], r: string[], kind: '렌트' | '구독') => {
  const at = (n: string) => { const i = hdr.indexOf(n); return i >= 0 ? S(r[i]) : ''; };
  return {
    차량번호: at('차량번호'),
    상태: canonSheetVehicleStatus(at('배차상태')),
    // 시트 「구분」이 「재렌트」·「재구독」 같은 옛말이어도 규격 값으로 옮긴다. 못 옮기면 탭이 말하는 대로 둔다.
    분류: S(canonProductType(at('구분'))) || (kind === '렌트' ? '중고렌트' : '중고구독'),
    '차명(트림)': at('모델명(트림)') || at('차종'),
    옵션: at('옵션'),
    외부색상: at('외장색'),
    내부색상: at('내장색'),
    연료: at('유종'),
    주행거리: num(at('주행거리')),
    차량가격: num(at('소비자가격')),
    최초등록일: at('최초등록일'),
  } as Record<string, string | number>;
};

// ── 렌트재고 ────────────────────────────────────────────────────────────────
const rentHdr = rentTab.table[0].map(S);
const rentPeriods = rentHdr.map((h) => (h.match(/^(\d+)개월$/) || [])[1]).filter(Boolean) as string[];
const rentCols = buildColumns(rentPeriods);
const rentNames = rentCols.map((c) => c.name);
const rentRows: (string | number)[][] = [];
for (const r of rentTab.table.slice(1)) {
  if (!norm(r[rentHdr.indexOf('차량번호')])) continue;
  const row: (string | number)[] = Array(rentNames.length).fill('');
  const put = (n: string, v: string | number) => { const i = rentNames.indexOf(n); if (i >= 0 && v !== '') row[i] = v; };
  for (const [k, v] of Object.entries(frontOf(rentHdr, r, '렌트'))) put(k, v);
  rentHdr.forEach((h, i) => {
    if (/^\d+개월$/.test(h)) put(h, num(r[i]));
    // 렌트 보증금은 «금액»이다. 손오공 렌트 탭은 보증 칸이 하나뿐이라 장기·단기를 같이 채운다.
    else if (/보증/.test(h)) { put('장기보증', num(r[i])); put('단기보증', num(r[i])); }
  });
  rentRows.push(row);
}

// ── 구독재고 ────────────────────────────────────────────────────────────────
/**
 * 1행에 「인수형」·「반납형」이 어느 칸에서 시작하는지 적혀 있다.
 * ⚠ 열 번호를 코드에 박지 않는다 — 손오공이 열을 하나 끼우면 그날로 엉뚱한 값이 들어온다.
 */
const rawSub = ((grid.sheets || []) as Rec[]).find((sh) => /구독/.test(S(sh.properties?.title)));
const bandRow = ((((rawSub?.data?.[0]?.rowData || []) as Rec[])[0]?.values || []) as Rec[]).map((c) => S(c?.formattedValue));
const buyFrom = bandRow.findIndex((v) => /인수/.test(v));
const retFrom = bandRow.findIndex((v) => /반납/.test(v));
if (buyFrom < 0 || retFrom < 0) { console.log('■ 1행에서 인수형·반납형 구간을 못 찾았다\n'); process.exit(1); }
const subHdr = subTab.table[0].map(S);
/** 어댑터가 인수형 블록 헤더에 꼬리표를 붙여 준다 — 「12개월 인수형」. 기간을 읽을 땐 떼고 본다. */
const bare = (h: string) => S(h).replace(/\s*인수형\s*$/, '');
const subPeriods = subHdr.slice(buyFrom, retFrom).map((h) => (bare(h).match(/^(\d+)개월$/) || [])[1]).filter(Boolean) as string[];
const subCols = buildSubscriptionColumns(subPeriods);
const subNames = subCols.map((c) => c.name);
const subRows: (string | number)[][] = [];
for (const r of subTab.table.slice(1)) {
  if (!norm(r[subHdr.indexOf('차량번호')])) continue;
  const row: (string | number)[] = Array(subNames.length).fill('');
  const put = (n: string, v: string | number) => { const i = subNames.indexOf(n); if (i >= 0 && v !== '') row[i] = v; };
  for (const [k, v] of Object.entries(frontOf(subHdr, r, '구독'))) put(k, v);
  const block = (from: number, to: number, suffix: '인수형' | '반납형') => {
    let any = false;
    subHdr.slice(from, to).forEach((h, k) => {
      const v = S(r[from + k]);
      const n = bare(h);
      if (/^\d+개월$/.test(n)) { if (v) { put(`${n} ${suffix}`, num(v)); any = true; } }
      else if (/보증/.test(n) && v) put(`보증금 ${suffix}`, num(v));
    });
    return any;
  };
  const hasBuy = block(buyFrom, retFrom, '인수형');
  const hasRet = block(retFrom, subHdr.length, '반납형');
  if (!hasBuy && !hasRet) continue;                    // 양쪽 다 요금이 없으면 아직 상품이 아니다
  // 반납형은 보증금 칸이 비어 있다 — 규칙(연수×대여료)으로 받는다는 뜻이다. 그걸 글자로 적어 둔다.
  if (hasRet && !S(row[subNames.indexOf('보증금 반납형')])) put('보증금 반납형', DEPOSIT_RULE_TEXT);
  subRows.push(row);
}

const PLAN = [
  { tab: '렌트재고', cols: rentCols, rows: rentRows, note: '렌트 — 단기(1·12) + 장기(24~60) · 보증금은 금액' },
  { tab: '구독재고', cols: subCols, rows: subRows, note: '구독 — 인수형/반납형 두 벌 · 반납형 보증금은 연수×대여료' },
];
for (const p of PLAN) console.log(`  「${p.tab}」 ${p.rows.length}대 · ${p.cols.length}열 — ${p.note}`);
console.log(`\n  지울 옛 탭: ${DEAD_TABS.join(' · ')}`);
if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

// ── 우리 시트에 찍기 ────────────────────────────────────────────────────────
const q = encodeURIComponent(`mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners and trashed=false and name = '${SHEET_NAME}'`);
const mine = ((await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`)).files || []) as Rec[];
if (!mine[0]) { console.log(`\n  ✗ 「${SHEET_NAME}」 시트를 못 찾았다\n`); process.exit(1); }
const sheetId = S(mine[0].id);
const extras = { 제조사: HANDLED_MAKER_OPTIONS, 연식: yearOptions(new Date().getFullYear()) };

for (const p of PLAN) {
  const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(sheetId,title))`);
  let gid = ((meta.sheets || []) as Rec[]).find((s) => S(s.properties?.title) === p.tab)?.properties?.sheetId as number | undefined;
  if (gid == null) {
    const made = await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: p.tab } } }] }),
    });
    gid = Number(((made.replies || []) as Rec[])[0]?.addSheet?.properties?.sheetId ?? 0);
  }
  /**
   * 다시 찍을 때는 **옛 표·줄무늬·조건부서식을 먼저 지운다.**
   * 남아 있으면 「이미 교차되는 배경 색상이 있는 범위」로 표 변환이 거부된다.
   * 조건부서식을 표보다 먼저 지운다 — 표를 지우면 번호가 밀린다.
   */
  const cur = await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(sheetId),tables(tableId),bandedRanges(bandedRangeId),conditionalFormats)`);
  const mySheet = ((cur.sheets || []) as Rec[]).find((x) => Number(x.properties?.sheetId) === gid);
  const cf = ((mySheet?.conditionalFormats || []) as Rec[]).length;
  const wipe: Rec[] = [
    ...Array.from({ length: cf }, (_, k) => ({ deleteConditionalFormatRule: { sheetId: gid, index: cf - 1 - k } })),
    ...((mySheet?.tables || []) as Rec[]).map((x) => ({ deleteTable: { tableId: S(x.tableId) } })),
  ];
  if (wipe.length) await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: wipe }) });
  const left = await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(sheetId),bandedRanges(bandedRangeId))`);
  const b = ((((left.sheets || []) as Rec[]).find((x) => Number(x.properties?.sheetId) === gid)?.bandedRanges || []) as Rec[])
    .map((x) => ({ deleteBanding: { bandedRangeId: Number(x.bandedRangeId) } }));
  if (b.length) await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: b }) });

  await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ requests: resetSheetRequests(gid!) }),
  });
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`${p.tab}!A1`)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT', body: JSON.stringify({ values: [...buildTemplateValues(p.cols), ...p.rows] }),
  });
  // 서식 → 표 → 줄무늬 순으로 **나눠 보낸다**. 한 배치에 몰면 구글이 「Internal error」로 통째로 거절한다.
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        ...buildBaseFont(gid!, p.cols.length, ROWS),
        ...buildTemplateFormat(gid!, p.cols, extras, { asTable: true }),
        ...buildChipColors(gid!, p.cols, HANDLED_MAKER_OPTIONS, ROWS),
        ...buildNumberFormats(gid!, p.cols, ROWS),
        ...buildRowHeights(gid!, ROWS),
        ...p.cols.map((c, i) => ({
          updateDimensionProperties: {
            range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
            properties: { pixelSize: columnWidth(c.name) }, fields: 'pixelSize',
          },
        })),
      ],
    }),
  });
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ requests: [buildTableRequest(gid!, p.cols, extras, ROWS, p.tab)] }),
  }).catch((e) => console.log(`  △ ${p.tab} 표 변환 — ${String((e as Error).message).slice(0, 60)}`));
  const after = await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(sheetId),bandedRanges(bandedRangeId,range))`);
  const stale = (((((after.sheets || []) as Rec[]).find((x) => Number(x.properties?.sheetId) === gid)?.bandedRanges) || []) as Rec[])
    .filter((x) => Number(x.range?.startColumnIndex ?? 0) >= tableWidth(p.cols))
    .map((x) => ({ deleteBanding: { bandedRangeId: Number(x.bandedRangeId) } }));
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ requests: [...stale, ...buildSectionBanding(gid!, p.cols, ROWS, tableWidth(p.cols))] }),
  }).catch((e) => console.log(`  △ ${p.tab} 줄무늬 — ${String((e as Error).message).slice(0, 60)}`));
  console.log(`  「${p.tab}」 ${p.rows.length}대 — https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=${gid}`);
}

/** 옛 탭은 **맨 마지막에** 지운다 — 새 탭이 다 서고 나서 지워야 실패했을 때 원본이 남는다. */
const fin = await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(sheetId,title))`);
const drop = ((fin.sheets || []) as Rec[])
  .filter((s) => DEAD_TABS.includes(S(s.properties?.title)))
  .map((s) => ({ deleteSheet: { sheetId: Number(s.properties?.sheetId) } }));
if (drop.length) {
  await api(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: drop }) });
  console.log(`  옛 탭 ${drop.length}개 지움 — ${DEAD_TABS.join(' · ')}`);
}
console.log('');
