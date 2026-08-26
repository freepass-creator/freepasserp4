/**
 * **정산원장에 「차량대장」 탭을 놓고, 접수 탭이 그것을 끌어 쓰게 한다.**
 *
 * ★사장님 2026-08-26
 *   「정산시트에 미리 누적으로 차량번호를 갖고 오고」
 *   「차량번호 쓰면 공급사 모델명 끌고오게」
 *   「시트를 먼저 써보고 erp를 그에 맞게 할거니까」 — **시트가 먼저다.**
 *
 * ─────────────────────────────────────────────────────────────────────
 * ★★**하는 일 셋**
 * ```
 * ① 「차량대장」 탭   v4/plate_registry 를 통째로 내려 적는다 (차번·모델·세부모델·세부트림·공급사)
 * ② 유효성 걷어내기   차량번호 칸의 옛 드롭다운을 지운다 — 「잘못됨」이 안 뜨게
 * ③ 공급사·모델명 수식 차번을 적으면 대장에서 끌어온다
 * ```
 *
 * ★★★**수식은 «비었을 때만» 채우게 짠다.**
 *   `IF(칸이 비었으면 대장에서 찾기, 적힌 값 그대로)` — 사람이 손으로 적은 값이 이겨야 한다.
 *   대장에 없는 차(재고에 없던 차)도 접수해야 하기 때문이다. 못 찾으면 **빈칸으로 둔다** —
 *   `#N/A` 를 남기면 그 글자가 그대로 청구서까지 간다.
 *
 * ⚠ **접수 탭에만 건다.** 실적 탭들은 이미 값이 박힌 곳이라 수식을 얹으면 원장이 흔들린다.
 * ⚠ 대장 탭은 «기계가 쓰는 곳»이라 통째로 지우고 다시 쓴다. 사람이 여기 적지 않는다.
 *
 *   npx tsx scripts/publish-plate-registry-tab.mts            무엇을 할지만 본다
 *   npx tsx scripts/publish-plate-registry-tab.mts --apply    실제로 놓는다
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import type { PlateEntry } from '../lib/domain/plate-registry';

const APPLY = process.argv.includes('--apply');
const TAB = '차량대장';
const INTAKE = '접수';
const S = (v: unknown) => String(v ?? '').trim();
const a1 = (t: string) => `'${t.replace(/'/g, "''")}'`;
const colA1 = (i: number) => { let t = ''; let n = i + 1; while (n > 0) { const r = (n - 1) % 26; t = String.fromCharCode(65 + r) + t; n = Math.floor((n - 1) / 26); } return t; };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) {
  initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
}
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const SH = 'https://sheets.googleapis.com/v4/spreadsheets';
const api = async (path: string, init?: RequestInit) => {
  const t = (await jwt.getAccessToken()).token;
  const r = await fetch(`${SH}/${path}`, { ...init, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const x = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${x.slice(0, 300)}`);
  return x ? JSON.parse(x) : {};
};

// ── 대장 읽기 ──────────────────────────────────────────────
const snap = await getDatabase().ref('v4/plate_registry').get();
const reg = Object.values((snap.val() || {}) as Record<string, PlateEntry>)
  .filter((e) => S(e.plate))
  .sort((a, b) => S(a.plate).localeCompare(S(b.plate), 'ko'));

console.log(`\n■ 차량대장 → 정산원장 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`   대장 ${reg.length}대`);
if (!reg.length) { console.log('\n   대장이 비어 있다 — build-plate-registry 를 먼저 돌려라.\n'); process.exit(1); }

const HEAD = ['차량번호', '모델', '세부모델', '세부트림', '공급사', '처음 본 날', '마지막 본 날'];
const BODY = reg.map((e) => [S(e.plate), S(e.model), S(e.subModel), S(e.trim), S(e.supplier), S(e.firstSeen), S(e.lastSeen)]);

// ── 시트 구조 ──────────────────────────────────────────────
const meta = await api(`${LEDGER}?fields=sheets.properties(sheetId,title,index,gridProperties.rowCount)`) as
  { sheets: { properties: { sheetId: number; title: string; index: number; gridProperties?: { rowCount?: number } } }[] };
const props = meta.sheets.map((s) => s.properties);
const intake = props.find((p) => S(p.title) === INTAKE);
if (!intake) { console.log(`   ✕ 「${INTAKE}」 탭이 없다`); process.exit(1); }

// 접수 탭 — 머리글과 «어느 줄이 비어 있나»를 같이 읽는다
const got = await api(`${LEDGER}/values/${encodeURIComponent(`${a1(INTAKE)}!A1:BZ800`)}`) as { values?: unknown[][] };
const rows3 = ((got.values || []) as unknown[][]).map((r) => (r || []).map(S));
const hi = rows3.findIndex((r) => r.includes('차량번호'));
if (hi < 0) { console.log('   ✕ 접수 탭 머리글을 못 찾았다'); process.exit(1); }
const head = rows3[hi];
const iPlate = head.indexOf('차량번호');
const iSup = head.indexOf('공급사');
const iModel = head.indexOf('모델명');
const first = hi + 2;   // 값이 시작하는 «시트 행번호»

/**
 * ★★★**이미 차번이 적힌 줄은 건드리지 않는다.**
 *   그 줄의 공급사·모델명은 «그때 그 값»이다. 수식으로 덮으면 지금 대장 값으로 바뀌어
 *   **원장이 조용히 달라진다** — 이름이 정제되며 바뀌었을 수도, 공급사가 옮겨졌을 수도 있다.
 *   ⇒ 수식은 «아직 안 쓴 빈 줄»에만 건다. 사람이 차번을 적는 순간 거기서 따라온다.
 */
/**
 * ★★**시트에 «있는 줄»까지만 쓴다.**
 *   ⚠ 없는 줄에 쓰면 `INVALID_ARGUMENT` 로 통째로 실패한다(2026-08-26 그렇게 걸렸다).
 *     구글은 «넘치면 늘려 주지» 않는다 — 격자 밖은 그냥 없는 자리다.
 */
const gridRows = intake.gridProperties?.rowCount ?? first;
const lastRow = Math.min(first + 400, gridRows);

const taken = new Set<number>();
for (let i = hi + 1; i < rows3.length; i++) if (S(rows3[i]?.[iPlate])) taken.add(i + 1);
console.log(`   접수 탭 — 차량번호 ${colA1(iPlate)}열 · 공급사 ${iSup >= 0 ? colA1(iSup) : '없음'}열 · 모델명 ${iModel >= 0 ? colA1(iModel) : '없음'}열 · 값 ${first}행부터`);

if (!APPLY) {
  console.log(`\n   할 일 — ① 「${TAB}」 탭에 ${reg.length}줄 · ② 차량번호 유효성 걷어내기 · ③ 공급사·모델명 자동 채움`);
  console.log('\n   --apply 를 붙이면 놓습니다.\n');
  process.exit(0);
}

// ── ① 대장 탭 ─────────────────────────────────────────────
let gid = props.find((p) => S(p.title) === TAB)?.sheetId;
if (gid === undefined) {
  const made = await api(`${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
    { addSheet: { properties: { title: TAB, index: props.length, gridProperties: { rowCount: BODY.length + 50, columnCount: HEAD.length, frozenRowCount: 2 } } } },
  ] }) }) as { replies: { addSheet: { properties: { sheetId: number } } }[] };
  gid = made.replies[0].addSheet.properties.sheetId;
  console.log(`   ✓ 「${TAB}」 탭 새로 만듦`);
}

await api(`${LEDGER}/values/${encodeURIComponent(`${a1(TAB)}!A1:Z5000`)}:clear`, { method: 'POST', body: '{}' });
await api(`${LEDGER}/values/${encodeURIComponent(`${a1(TAB)}!A1`)}?valueInputOption=RAW`, {
  method: 'PUT',
  body: JSON.stringify({ values: [
    [TAB, '기계가 채웁니다 — 상품리스트가 발행될 때마다 차량번호·차명·공급사만 여기에 쌓입니다. 접수 탭에서 차량번호를 고르면 공급사·모델명이 여기서 따라옵니다. 손으로 적지 마세요.'],
    HEAD,
    ...BODY,
  ] }),
});

// 서식 — 집 규격(공지 10pt 흰 글씨 · 남색 #0b5394 / 필드헤더 #efefef 9pt)
await api(`${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
  { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: 'Noto Sans KR', fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } }, backgroundColor: { red: 11 / 255, green: 83 / 255, blue: 148 / 255 }, horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', padding: { left: 12, right: 16, top: 6, bottom: 6 } } }, fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,padding)' } },
  { repeatCell: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { fontFamily: 'Noto Sans KR', fontSize: 14, bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(textFormat,horizontalAlignment)' } },
  { mergeCells: { range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: HEAD.length }, mergeType: 'MERGE_ROWS' } },
  { updateDimensionProperties: { range: { sheetId: gid, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 56 }, fields: 'pixelSize' } },
  { repeatCell: { range: { sheetId: gid, startRowIndex: 1, endRowIndex: 2 }, cell: { userEnteredFormat: { textFormat: { fontFamily: 'Noto Sans KR', fontSize: 9, bold: true, foregroundColor: { red: 95 / 255, green: 99 / 255, blue: 104 / 255 } }, backgroundColor: { red: 239 / 255, green: 239 / 255, blue: 239 / 255 }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,horizontalAlignment)' } },
  { updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 2 } }, fields: 'gridProperties.frozenRowCount' } },
] }) });
console.log(`   ✓ 「${TAB}」 ${BODY.length}줄`);

// ── ② 차량번호 — 유효성 검사를 «걷어낸다» ──────────────────
/**
 * ★★★**드롭다운을 걸지 않는다.**
 *   사장님 2026-08-26 「잘못됨 좀 안 나오게 해주라」.
 *
 *   한때 대장을 목록(`ONE_OF_RANGE`)으로 걸었다. 그러자 **대장에 없는 차번마다 「잘못됨」**이 붙었다
 *   — 실측: 접수 36줄 중 **27줄**. `strict:false` 로 막지는 않지만 «빨간 표시»는 그대로 남는다.
 *
 * ★★그건 규칙이 데이터와 안 맞아서 생긴 것이다 —
 *   대장은 «지금 상품시트»만 담고(465대), 접수는 «이미 팔린 차»를 받는다(옛 차 375대).
 *   **없는 게 정상인 자리**에 「있어야 한다」는 검사를 걸었으니 27줄이 붉어진 것이다.
 *   ⇒ 애초 요청은 「차번 쓰면 공급사·모델명 끌고오게」였다. 그건 ③ 수식이 한다.
 *   ⚠ 대장이 옛 차까지 다 담게 되면 그때 다시 생각한다. 지금은 걸지 않는다.
 */
await api(`${LEDGER}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [
  { setDataValidation: {
    range: { sheetId: intake.sheetId, startRowIndex: first - 1, endRowIndex: gridRows, startColumnIndex: iPlate, endColumnIndex: iPlate + 1 },
    // rule 을 빼면 «지운다»는 뜻이다
  } },
] }) });
console.log('   ✓ 차량번호 유효성 검사 걷어냄 — 「잘못됨」이 안 뜬다');

// ── ③ 공급사·모델명 자동 채움 ──────────────────────────────
/**
 * ★`IFERROR(...,"")` — 못 찾으면 **빈칸**이다. `#N/A` 를 남기면 그 글자가 청구서까지 간다.
 * ★차명은 «세부모델 + 세부트림». 세부모델이 비면 모델로 떨어진다(집 규격).
 */
const pl = (r: number) => `$${colA1(iPlate)}${r}`;
const look = (r: number, col: number) => `IFERROR(VLOOKUP(${pl(r)},${a1(TAB)}!$A$3:$E,${col},FALSE),"")`;
const put = async (colIdx: number, make: (r: number) => string, label: string) => {
  if (colIdx < 0) { console.log(`   · ${label} 칸이 없다 — 건너뜀`); return; }
  // ★차번이 있는 줄은 건너뛴다 — 적힌 값을 지키려고 «한 칸씩» 나눠 쓴다.
  const data = [] as { range: string; values: string[][] }[];
  for (let r = first; r <= lastRow; r++) {
    if (taken.has(r)) continue;
    data.push({ range: `${a1(INTAKE)}!${colA1(colIdx)}${r}`, values: [[make(r)]] });
  }
  if (!data.length) { console.log(`   · ${label} — 빈 줄이 없다`); return; }
  // ★한 번에 보낸다 — 칸마다 부르면 분당 쓰기 한도(60)에 바로 걸린다(2026-08-26 실측).
  await api(`${LEDGER}/values:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
  });
  console.log(`   ✓ ${label} 자동 채움 — 빈 줄 ${data.length}개 (이미 적힌 ${taken.size}줄은 그대로)`);
};

await put(iSup, (r) => `=IF(${pl(r)}="","",${look(r, 5)})`, '공급사');
await put(iModel, (r) => `=IF(${pl(r)}="","",IFERROR(IF(${look(r, 3)}="",${look(r, 2)},${look(r, 3)})&IF(${look(r, 4)}=""," "," ")&${look(r, 4)},""))`, '모델명');

console.log(`\n   https://docs.google.com/spreadsheets/d/${LEDGER}/edit\n`);
process.exit(0);
