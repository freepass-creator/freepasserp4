/**
 * **공급사 한 곳의 새 규격 시트를 만든다.** 기본 dry-run, 반영은 `--apply`.
 *
 * 「<공급사> 프리패스 재고」 파일을 만들고 「재고」·「정책」 두 탭을 규격대로 찍은 뒤,
 * 그 공급사가 준 시트에서 차를 옮겨 담는다. 이미 있으면 만들지 않고 채우기만 한다.
 *
 * ★ERP 연결은 **건드리지 않는다.** 파트너의 `sheet_url` 은 그대로 둔다 —
 *   공급사가 새 시트를 쓰기 시작하면 그때 `switch-supplier-sheet` 로 넘긴다.
 *   여기서 연결까지 바꾸면, 공급사가 옛 시트에 적은 게 ERP 에 안 들어온다(2026-08-12 실측).
 *
 *   npx tsx scripts/create-supplier-sheet.mts --code=PT-0014 --name=렌트존 --from=<시트ID>
 *   … --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SHEET_GRID_FIELDS, readSupplierSheet } from '../lib/domain/supplier-sheet-read';
import { autoMapHeaders, canonSheetVehicleStatus, parsePriceColumns } from '../lib/domain/sheet-import';
import { canonProductType } from '../lib/domain/product';
import { HANDLED_MAKER_OPTIONS } from '../lib/domain/handled-makers';
import {
  POLICY_COLUMN_FIELDS, POLICY_TAB_NAME, buildBaseFont, buildChipColors, buildColumns,
  buildNumberFormats, buildPolicyTabFormat, buildPolicyTabValues, buildRowHeights, buildSectionBanding,
  buildTableRequest, buildTemplateFormat, buildTemplateValues, columnWidth, FREEPASS_STANDARD,
  POLICY_TAB_FIELD_ROWS, resetSheetRequests, tableWidth, yearOptions, supplierSheetName, SHEET_NAME_MATCH, supplierSheetLabel } from '../lib/domain/supplier-template-sheet';
import { POLICY_DEFAULTS } from '../lib/domain/policy-defaults';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '');
const APPLY = process.argv.includes('--apply');
const arg = (n: string) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3).trim();
const CODE = arg('code'); const NAME = arg('name'); const FROM = arg('from');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const ROWS = 500;
const VEHICLE_TAB = '재고';
/**
 * ★**빈 표준 한 장** — `--blank`(사장님 2026-08-15 — 「우리 기본 표준 시트 하나 만들어놔」).
 *   공급사 데이터를 안 옮기고 **규격만** 찍는다. 새 공급사가 생기면 이걸 복사해 주면 된다.
 * ⚠ 서식·드롭다운·정책 규격을 여기서 새로 짜지 않는다. 아래 코드를 그대로 탄다 —
 *   따로 짜면 표준과 실제 제공시트가 갈리고, 갈리는 순간 «어느 쪽이 표준인지» 알 수 없다.
 */
const BLANK = process.argv.includes('--blank');
if (!CODE || !NAME || (!FROM && !BLANK)) { console.log('■ --code= --name= --from= 이 모두 필요하다 (빈 표준은 --blank)\n'); process.exit(1); }

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const SA_EMAIL = S(sa.client_email);
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

// ── 공급사가 준 시트 읽기 ───────────────────────────────────────────────────
/** `--blank` 이면 원본을 안 읽는다 — 옮길 차가 없다. 규격만 찍는다. */
const read = BLANK
  ? { tabs: [] as ReturnType<typeof readSupplierSheet>['tabs'], failures: [] as ReturnType<typeof readSupplierSheet>['failures'] }
  : readSupplierSheet(
    await api(`https://sheets.googleapis.com/v4/spreadsheets/${FROM}?includeGridData=true&fields=${encodeURIComponent(SHEET_GRID_FIELDS)}`) as never,
    { partner_code: CODE } as EntityRecord,
  );
type Src = { plate: string; row: string[]; hdr: string[]; photo: string };
const src: Src[] = [];
for (const t of read.tabs) {
  const hdr = (t.table[0] || []).map(S);
  const prof = autoMapHeaders(hdr) as Record<string, number | undefined>;
  const pi = prof.car_number;
  if (typeof pi !== 'number') continue;
  for (const row of t.table.slice(1)) {
    const plate = norm(row[pi]);
    if (plate) src.push({ plate, row, hdr, photo: S(t.photoByPlate[plate]) });
  }
}
console.log(`■ ${NAME}(${CODE}) 새 규격 시트 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  공급사 시트에서 읽은 차 ${src.length}대${read.failures.length ? ` · 못 읽은 탭 ${read.failures.length}` : ''}`);

/** 그 공급사가 실제로 쓰는 기간 — 열 구성을 여기서 정한다. */
const periods = new Set<string>();
for (const s of src) for (const h of s.hdr) { const m = h.match(/^(\d+)개월/); if (m) periods.add(m[1]); }
const cols = buildColumns([...periods]);
const names = cols.map((c) => c.name);
console.log(`  기간 ${[...periods].sort((a, b) => Number(a) - Number(b)).join('·') || '(없음)'} → 열 ${names.length}`);

// ── 우리 규격으로 줄 만들기 ─────────────────────────────────────────────────
const at = (n: string) => names.indexOf(n);
const rows = src.map(({ row, hdr, photo }) => {
  const prof = autoMapHeaders(hdr) as Record<string, number | undefined>;
  const pick = (k: string) => { const i = prof[k]; return typeof i === 'number' && i >= 0 ? S(row[i]) : ''; };
  const out: (string | number)[] = Array(names.length).fill('');
  const put = (n: string, v: string | number) => { const i = at(n); if (i >= 0 && v !== '' && v != null) out[i] = v; };
  const num = (v: unknown) => { const n = Number(S(v).replace(/[^\d.-]/g, '')); return Number.isFinite(n) && n > 0 ? n : ''; };
  put('차량번호', pick('car_number'));
  put('상태', canonSheetVehicleStatus(pick('vehicle_status')));
  put('분류', S(canonProductType(pick('product_type'))) || pick('product_type'));
  put('제조사', pick('maker'));
  put('차명(트림)', [pick('sub_model') || pick('model'), pick('trim_name')].filter(Boolean).join(' ').trim());
  put('옵션', pick('options'));
  put('외부색상', pick('ext_color'));
  put('내부색상', pick('int_color'));
  put('연식', num(pick('year')));
  put('연료', pick('fuel_type'));
  put('주행거리', num(pick('mileage')));
  put('배기량', num(pick('engine_cc')));
  put('차량가격', num(pick('vehicle_price')));
  put('최초등록일', pick('first_registration_date'));
  put('사진링크', photo || pick('photo_link'));
  // 요금·보증금은 원본 파서에 맡긴다 — 보증금 블록 스코프를 우리가 다시 짜면 틀린다.
  const price = parsePriceColumns(hdr, row, {} as EntityRecord, '') || {};
  for (const [key, v] of Object.entries<Rec>(price)) {
    const m = key.match(/^(\d+)/); if (!m) continue;
    put(`${m[1]}개월`, Number(v?.rent) || '');
    const dep = Number(v?.deposit) || 0;
    if (dep) put(Number(m[1]) >= 24 ? '장기보증' : '단기보증', dep);
  }
  return out;
});
const withPrice = rows.filter((r) => names.some((n, i) => /개월$/.test(n) && r[i] !== '')).length;
console.log(`  옮길 차 ${rows.length}대 (대여료 있는 차 ${withPrice})`);
if (rows[0]) console.log(`  예: ${names.map((n, i) => (rows[0][i] !== '' ? `${n}=${rows[0][i]}` : '')).filter(Boolean).slice(0, 9).join(' · ')}`);

// ── 정책 열 — 프리패스 기본 한 열 ───────────────────────────────────────────
const byKey = new Map(POLICY_DEFAULTS.map((d) => [d.key, d]));
const fieldOf = new Map(POLICY_COLUMN_FIELDS.map((c) => [c.name, c.field]));
const stdCol: Record<string, string> = { 정책코드: '(프리패스 기본)', 정책명: '프리패스 표준' };
for (const r of POLICY_TAB_FIELD_ROWS) {
  if (r.name === '정책명') continue;
  const d = byKey.get(S(fieldOf.get(r.name)));
  stdCol[r.name] = d && d.value != null ? String(d.value) : S(FREEPASS_STANDARD[r.name]);
}

/**
 * 문서 이름. 기본은 「<공급사> 프리패스 재고」 — 이름 규칙은 규격 모듈이 SSOT.
 * ⚠ **빈 표준은 이름을 달리 줘야 한다**(`--title=`). 우리 도구들은 이름에 「프리패스 재고」가
 *   든 문서를 **공급사 시트로 찾는다** — 표준을 같은 이름으로 두면 공급사 하나가 더 생긴 것처럼
 *   세어지고, 정제칸 채우기·코드 박기가 빈 표준에까지 들어간다.
 */
/**
 * ★이름 규격은 「MMDD 공급사 프리패스 재고 [제공]」(2026-08-18, `supplierSheetName`). 날짜는 만든 날(배포일).
 *   찾을 때는 이름 전체가 아니라 «라벨이 같은 프리패스 재고 시트»로 찾는다 — 날짜·표식이 붙어 있어도 같은 시트다(중복 생성 방지).
 */
const kst = (d = new Date()) => { const x = new Date(d.getTime() + 9 * 3600 * 1000); return `${String(x.getUTCMonth() + 1).padStart(2, '0')}${String(x.getUTCDate()).padStart(2, '0')}`; };
const title = arg('title') || supplierSheetName(NAME, { kind: '제공', date: kst() });
const q = encodeURIComponent(`mimeType='application/vnd.google-apps.spreadsheet' and 'me' in owners and trashed=false and name contains '${arg('title') ? title : SHEET_NAME_MATCH}'`);
const found = (((await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=100`)).files || []) as Rec[])
  .filter((f) => (arg('title') ? S(f.name) === title : supplierSheetLabel(S(f.name)) === S(NAME)));
console.log(`\n  대상 「${title}」 ${found[0] ? '(이미 있음 — 다시 찍음)' : '(새로 만듦)'}`);
if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

let fileId = S(found[0]?.id);
if (!fileId) {
  const made = await api('https://sheets.googleapis.com/v4/spreadsheets?fields=spreadsheetId', {
    method: 'POST', body: JSON.stringify({ properties: { title }, sheets: [{ properties: { title: VEHICLE_TAB } }, { properties: { title: POLICY_TAB_NAME } }] }),
  });
  fileId = S(made.spreadsheetId);
}
const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}?fields=sheets(properties(sheetId,title))`);
const sheets = ((meta.sheets || []) as Rec[]).map((s) => ({ gid: Number(s.properties?.sheetId ?? 0), title: S(s.properties?.title) }));
let gid = sheets.find((s) => s.title === VEHICLE_TAB)?.gid;
let polGid = sheets.find((s) => s.title === POLICY_TAB_NAME)?.gid;
const add: Rec[] = [];
if (gid == null) add.push({ addSheet: { properties: { title: VEHICLE_TAB } } });
if (polGid == null) add.push({ addSheet: { properties: { title: POLICY_TAB_NAME } } });
if (add.length) {
  const made = await api(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: add }) });
  for (const rep of ((made.replies || []) as Rec[])) {
    const t = S(rep?.addSheet?.properties?.title); const g = Number(rep?.addSheet?.properties?.sheetId ?? 0);
    if (t === VEHICLE_TAB) gid = g; if (t === POLICY_TAB_NAME) polGid = g;
  }
}

// 옛 표·줄무늬·조건부서식을 먼저 지운다 — 남아 있으면 표 변환이 거부된다.
const cur = await api(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}?fields=sheets(properties(sheetId),tables(tableId),bandedRanges(bandedRangeId),conditionalFormats)`);
const mine = ((cur.sheets || []) as Rec[]).find((x) => Number(x.properties?.sheetId) === gid);
const cf = ((mine?.conditionalFormats || []) as Rec[]).length;
/**
 * ★조건부서식 → 표 → **다시 읽어** 남은 줄무늬 순으로 지운다.
 *   표를 지우면 그 표의 줄무늬도 함께 사라진다 — 미리 읽어 둔 번호로 또 지우면
 *   「No BandedRange with id」 로 배치가 통째로 죽는다(실측 2026-08-12).
 */
const wipe: Rec[] = [
  ...Array.from({ length: cf }, (_, k) => ({ deleteConditionalFormatRule: { sheetId: gid, index: cf - 1 - k } })),
  ...((mine?.tables || []) as Rec[]).map((x) => ({ deleteTable: { tableId: S(x.tableId) } })),
];
if (wipe.length) await api(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: wipe }) });
{
  const left = await api(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}?fields=sheets(properties(sheetId),bandedRanges(bandedRangeId))`);
  const b = ((((left.sheets || []) as Rec[]).find((x) => Number(x.properties?.sheetId) === gid)?.bandedRanges || []) as Rec[])
    .map((x) => ({ deleteBanding: { bandedRangeId: Number(x.bandedRangeId) } }));
  if (b.length) await api(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: b }) });
}
await api(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}:batchUpdate`, {
  method: 'POST', body: JSON.stringify({ requests: [...resetSheetRequests(gid!), ...resetSheetRequests(polGid!)] }),
});
await api(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values:batchUpdate`, {
  method: 'POST',
  body: JSON.stringify({
    valueInputOption: 'USER_ENTERED',
    data: [
      { range: `${VEHICLE_TAB}!A1`, values: [...buildTemplateValues(cols), ...rows] },
      { range: `${POLICY_TAB_NAME}!A1`, values: buildPolicyTabValues([stdCol]) },
    ],
  }),
});
const extras = { 제조사: HANDLED_MAKER_OPTIONS, 연식: yearOptions(new Date().getFullYear()) };
await api(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}:batchUpdate`, {
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
      ...buildBaseFont(polGid!, 8, 40),
      ...buildPolicyTabFormat(polGid!, 1),
      ...buildRowHeights(polGid!, 40),
    ],
  }),
});
await api(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}:batchUpdate`, {
  method: 'POST', body: JSON.stringify({ requests: [buildTableRequest(gid!, cols, extras, ROWS, VEHICLE_TAB)] }),
}).catch((e) => console.log(`  △ 표 변환 — ${String((e as Error).message).slice(0, 50)}`));
await api(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}:batchUpdate`, {
  method: 'POST', body: JSON.stringify({ requests: buildSectionBanding(gid!, cols, ROWS, tableWidth(cols)) }),
}).catch((e) => console.log(`  △ 줄무늬 — ${String((e as Error).message).slice(0, 50)}`));

// 공유 — 서비스계정 읽기 + 링크 가진 사람 수정(다른 공급사 시트와 같은 규격)
for (const body of [{ type: 'user', role: 'reader', emailAddress: SA_EMAIL }, { type: 'anyone', role: 'writer' }]) {
  await api(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=false&supportsAllDrives=true`, {
    method: 'POST', body: JSON.stringify(body),
  }).catch(() => {});
}
console.log(`\n  만듦 — https://docs.google.com/spreadsheets/d/${fileId}/edit\n`);
