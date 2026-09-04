/**
 * **신규 입점 채널에 «정산 예시» 탭을 붙인다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-03 「ys모빌리티는 8월 정산샘플 보여줘 / 신규입점 채널이니까」.
 *
 * ★★**왜 예시인가.** 신규 채널은 실적이 없어 정산 탭이 비어 있다. 그런데 계약을 붙이기 전에
 *   「내가 팔면 얼마가 어떻게 찍히나」를 봐야 움직인다. 빈 표는 아무 말도 못 한다.
 *
 * ★★★**남의 실적을 갖다 쓰지 않는다.** 다른 채널 8월 줄을 복사하면 그 채널 손님·차량이 새 나간다.
 *   ⇒ «수수료표 그대로» 세 줄을 지어 보인다 — 값이 어떻게 나오는지가 요점이지 실제 계약이 아니다.
 * ⚠ 탭 이름과 첫 줄에 «예시»를 박고 바탕을 옅은 주황으로 둔다. 진짜 정산으로 오해하면 그게 사고다.
 *
 *   npx tsx scripts/make-channel-sample.mts YS모빌리티 2026-08
 *   npx tsx scripts/make-channel-sample.mts YS모빌리티 2026-08 --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { CORP } from '../lib/domain/corporate-ci';
import { payDate, payDayOf } from '../lib/domain/settlement-cycle';
import { CHANNEL_SETTLE_HEAD, CHANNEL_SETTLE_WIDTH, NAVY, TINT } from '../lib/server/channel-sheet-tabs';

const S = (v: unknown) => String(v ?? '').trim();
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const APPLY = process.argv.includes('--apply');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const CH = S(args[0]);
const MONTH = S(args.find((a) => /^\d{4}-\d{2}$/.test(a))) || '2026-08';
if (!CH) { console.log('\n  채널 이름을 주세요 — npx tsx scripts/make-channel-sample.mts YS모빌리티 2026-08 [--apply]\n'); process.exit(1); }

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const tok = async () => (await jwt.getAccessToken()).token;

/** 예시 세 줄 — 재렌트 사다리 · 신차 선출고 · 오플구독. 세 갈래를 한 번에 보인다. */
const VAT = 0.1;
const mk = (net: number) => ({ net, vat: Math.round(net * VAT), tot: net + Math.round(net * VAT) });
const A = mk(800_000 * 48 * 0.025);           // 재렌트 48개월 · 월 80만
const B = mk(Math.round(40_000_000 * 0.03));  // 신차 선출고 · 차량가액 4,000만
const C = mk(800_000);                        // 오플구독 정액
const dayKo = (d: Date | null) => (d ? `${d.getFullYear()}. ${String(d.getMonth() + 1).padStart(2, '0')}. ${String(d.getDate()).padStart(2, '0')}` : '');
const H2 = CHANNEL_SETTLE_HEAD;
const iPay = H2.indexOf('지급 예정일');
const P0 = dayKo(payDate(MONTH));
const P1 = dayKo(payDate(MONTH, '오토플러스'));

/** ★줄은 «머리글 이름»으로 짓는다 — 칸이 늘어도 예시가 어긋나지 않는다. */
const rowOf = (m: Record<string, string | number | boolean>): (string | number | boolean)[] =>
  H2.map((h) => (m[h] === undefined ? '' : m[h]));
const SAMPLE: (string | number | boolean)[][] = [
  rowOf({ 'No.': 1, 차량번호: '00가0000', 접수일: `${MONTH}-05`, 인도일: `${MONTH}-12`, 공급사: '웰릭스', 모델명: '쏘렌토',
    임차인: '홍*동', 영업사: '김**', '상품 구분': '장기렌트', '계약 기간': 48, 렌탈료: 800_000, 보증금: 1_000_000, '납입 방식': '일시납',
    '수수료 산정 기준': '대여료 800,000 × 48개월 × 2.50%', 공급가액: A.net, 부가세: A.vat, 합계: A.tot, '지급 예정일': P0, 확인: false }),
  rowOf({ 'No.': 2, 차량번호: '00나1111', 접수일: `${MONTH}-11`, 인도일: `${MONTH}-20`, 공급사: '리더스', 모델명: 'G80',
    '차량 가격(신차)': 40_000_000, 임차인: '김*수', 영업사: '이**', '상품 구분': '선출고', '계약 기간': 36, 렌탈료: 1_100_000,
    보증금: 3_000_000, '납입 방식': '2회분납',
    '수수료 산정 기준': '차량가액 40,000,000 × 3.00%', 공급가액: B.net, 부가세: B.vat, 합계: B.tot, '지급 예정일': P0, 확인: false }),
  rowOf({ 'No.': 3, 차량번호: '00다2222', 접수일: `${MONTH}-18`, 인도일: `${MONTH}-27`, 공급사: '오토플러스', 모델명: 'GV70',
    임차인: '이*희', 영업사: '박**', '상품 구분': '오플구독', '계약 기간': 24, 렌탈료: 950_000, 보증금: 0, '납입 방식': '일시납',
    '수수료 산정 기준': '건당 800,000', 공급가액: C.net, 부가세: C.vat, 합계: C.tot, '지급 예정일': P1, 확인: false }),
];
const net = A.net + B.net + C.net;
const vat = A.vat + B.vat + C.vat;

const TAB = `${MONTH.slice(2, 4)}년${MONTH.slice(5)}월 정산 (예시)`;
console.log(`\n■ ${CH} — 「${TAB}」 ${APPLY ? '(반영)' : '(대조만)'}`);
console.log(`   예시 3줄 · 지급 ${won(net + vat)}  (재렌트 ${won(A.tot)} · 신차 ${won(B.tot)} · 오플구독 ${won(C.tot)})`);
console.log(`   지급 예정일 — ${P0} · 오토플러스만 ${P1}`);

const q = `name contains '${CH} 프리패스 정산' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
const found = (((await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  { headers: { Authorization: `Bearer ${await tok()}` } })).json()) as { files?: { id: string; name: string }[] }).files || [])
  .filter((f) => !/구버전|폐기|백업/.test(S(f.name)));
if (found.length !== 1) { console.log(`\n  ✕ 시트를 «하나»로 못 맞췄습니다(${found.length}개)\n`); process.exit(1); }
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 붙였습니다. --apply 로 붙입니다.\n'); process.exit(0); }
const bookId = found[0].id;

const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}?fields=sheets.properties(sheetId,title)`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as {
  sheets?: { properties: { sheetId: number; title: string } }[] };
const all = meta.sheets || [];
let id = all.find((s) => s.properties.title === TAB)?.properties.sheetId;
if (id === undefined) {
  const add = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, {
    method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, index: all.length, gridProperties: { rowCount: 40, columnCount: H2.length } } } }] }),
  })).json() as { replies?: { addSheet?: { properties?: { sheetId?: number } } }[] };
  id = add.replies?.[0]?.addSheet?.properties?.sheetId;
}
if (id === undefined) { console.log('   ✕ 탭을 못 만들었습니다'); process.exit(1); }

const pad = (n: number) => Array.from({ length: n }, () => '');
const iM = H2.indexOf('공급가액');
const values: (string | number | boolean)[][] = [
  [`${MONTH.slice(0, 4)}년 ${Number(MONTH.slice(5))}월 정산서   ·   ${CH} 귀중   ·   ★이것은 «예시»입니다 — 실제 계약이 아닙니다`, ...pad(H2.length - 1)],
  [...pad(iM), '공급가액', '부가세', '지급 금액', ...pad(H2.length - iM - 3)],
  [...pad(iM), net, vat, net + vat, ...pad(H2.length - iM - 3)],
  H2,
  ...SAMPLE,
  ['', '합계', '3건', ...pad(iM - 3), net, vat, net + vat, ...pad(H2.length - iM - 3)],
  [],
  [`실제 정산은 ${CH} 계약이 잡히는 달부터 «옆 탭»에 이렇게 찍힙니다.`, ...pad(H2.length - 1)],
  [`${CORP.staff} · ${S(CORP.staffPhone) || CORP.phone} · ${CORP.email}`, ...pad(H2.length - 1)],
];
await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}/values/${encodeURIComponent(`'${TAB}'!A1:${String.fromCharCode(64 + H2.length)}${values.length}`)}?valueInputOption=RAW`, {
  method: 'PUT', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ values }) });

const r0 = 3;
const last = r0 + 1 + SAMPLE.length;
const row = (a: number, b: number) => ({ sheetId: id, startRowIndex: a, endRowIndex: b, startColumnIndex: 0, endColumnIndex: H2.length });
/** ★예시 탭은 «옅은 주황» 바탕 — 옆 탭(진짜 정산)과 눈으로 갈려야 한다. */
const SAMPLE_BG = { red: 1, green: 0.97, blue: 0.90 };
await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${bookId}:batchUpdate`, {
  method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ requests: [
    { unmergeCells: { range: { sheetId: id } } },
    { repeatCell: { range: row(r0 + 1, last), cell: { userEnteredFormat: { backgroundColor: SAMPLE_BG } }, fields: 'userEnteredFormat.backgroundColor' } },
    { mergeCells: { range: row(0, 1), mergeType: 'MERGE_ALL' } },
    { repeatCell: { range: row(0, 1), cell: { userEnteredFormat: { backgroundColor: { red: 0.72, green: 0.35, blue: 0.06 }, textFormat: { bold: true, fontSize: 12, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: 'MIDDLE', padding: { left: 10, right: 10, top: 2, bottom: 2 } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,padding)' } },
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } },
    ...[1, r0].map((r) => ({ repeatCell: { range: row(r, r + 1),
      cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: r === 1 ? 'RIGHT' : 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)' } })),
    ...[2, last].map((r) => ({ repeatCell: { range: row(r, r + 1), cell: { userEnteredFormat: { backgroundColor: TINT, textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } })),
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: r0, endIndex: r0 + 1 }, properties: { pixelSize: 40 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: r0 + 1, endIndex: last + 1 }, properties: { pixelSize: 24 }, fields: 'pixelSize' } },
    ...['렌탈료', '보증금', '차량 가격(신차)', '공급가액', '부가세', '합계', '정정금액'].map((h) => ({ repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: last + 1, startColumnIndex: H2.indexOf(h), endColumnIndex: H2.indexOf(h) + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } })),
    { repeatCell: { range: { sheetId: id, startRowIndex: r0 + 1, endRowIndex: last, startColumnIndex: H2.indexOf('계약 기간'), endColumnIndex: H2.indexOf('계약 기간') + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '0"개월"' }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } },
    ...CHANNEL_SETTLE_WIDTH.map((w, c) => ({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, properties: { pixelSize: w }, fields: 'pixelSize' } })),
    { repeatCell: { range: { sheetId: id }, cell: { userEnteredFormat: { textFormat: { fontFamily: 'Roboto' } } }, fields: 'userEnteredFormat.textFormat.fontFamily' } },
    { updateSheetProperties: { properties: { sheetId: id, gridProperties: { frozenRowCount: 4, frozenColumnCount: 0 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
  ] }) });

console.log(`   ✓ 붙였습니다\n\n   https://docs.google.com/spreadsheets/d/${bookId}\n`);
process.exit(0);
