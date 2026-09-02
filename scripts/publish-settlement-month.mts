/**
 * **그 달 청구·지급 내용을 신규 정산원장 월 탭에 찍는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-01 「우리 정산시트 신규에 8월 청구서 내용 틀리지 않게 들어가게 작업해줘봐
 *   태윤이한테 검토시킬거야 / 기 청구해서 이미 수금된거 우리캐피탈거는 수금됐다고 표시해주면 돼」
 *
 * ★★**원본은 파이어베이스 원자다** — `atomize-settlement-month` 로 부은 값(수식X 우선·필터 반영).
 *   시트를 다시 읽지 않는다. 두 군데서 세면 어느 숫자도 못 믿는다.
 *
 * ★**사람이 읽는 표다.** 태윤 매니저가 한 줄씩 보고 「맞다/아니다」를 찍을 수 있어야 한다 —
 *   그래서 «왜 이 금액인지»(정산대상·비율·메모)를 금액 옆에 같이 세운다.
 *
 * ★**청구·수금은 체크박스**다. 우리캐피탈은 이미 받았으므로 켜서 올린다.
 *
 *   npx tsx scripts/publish-settlement-month.mts 2026-08
 *   npx tsx scripts/publish-settlement-month.mts 2026-08 --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';

const APPLY = process.argv.includes('--apply');
const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '').trim();
if (!MONTH) { console.log('\n  달을 적어 주세요 — npx tsx scripts/publish-settlement-month.mts 2026-08 [--apply]\n'); process.exit(1); }
const TAB = `${MONTH.slice(2, 4)}년${MONTH.slice(5)}월`;
const VAT = 0.1;
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원₩]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
/**
 * ★**날짜는 «숫자»로 쓰고 서식으로 보여 준다.** 글자로 쓰면 정렬·필터가 안 먹고,
 *   `USER_ENTERED` 로 맡기면 구글이 지역 설정대로 제멋대로 읽는다(매뉴얼 §14 「구글 날짜는 숫자」).
 *   ⇒ 1899-12-30 기준 serial 로 넣고 `DATE yyyy-mm-dd` 를 씌운다.
 */
const SERIAL0 = Date.UTC(1899, 11, 30);
const serial = (ymd: string): number | '' => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(S(ymd));
  if (!m) return '';
  return Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - SERIAL0) / 86_400_000);
};

/** ★이미 수금이 끝난 공급사 — 사람이 확인해 준 것만 여기 적는다. 기계가 짐작하지 않는다. */
const COLLECTED: Record<string, string[]> = { '2026-08': ['우리캐피탈'] };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;

console.log(`\n■ ${MONTH} → 정산원장 「${TAB}」 ${APPLY ? '(반영)' : '(대조만)'}\n`);

type Row = Record<string, unknown>;
const rows = Object.values((await db.ref('v4/settlement_rows').get()).val() || {}) as Row[];
const claws = Object.values((await db.ref('v4/settlement_clawbacks').get()).val() || {}) as Row[];
const mine = rows.filter((r) => S(r.billMonth) === MONTH);
const myClaws = claws.filter((c) => S(c.month) === MONTH);
if (!mine.length) { console.log(`   ✕ ${MONTH} 원자가 없다 — 먼저 atomize-settlement-month 를 돌리세요`); process.exit(1); }

const collectedSup = new Set(COLLECTED[MONTH] || []);
type Line = {
  plate: string; model: string; cust: string; sup: string; ch: string; agent: string;
  product: string; term: number; rent: number; recv: string; deliv: string;
  supRate: number; agRate: number; claim: number; pay: number;
  target: string; ratio: number; why: string; billed: boolean; collected: boolean; kind: string;
};
const lines: Line[] = [];
for (const r of mine) {
  const target = S(r.settleTarget) || '양쪽';
  const ratio = N(r.settleRatio) || 1;
  const hold = r.billHold === true; const excl = r.settleExclude === true;
  const claim = excl || target === '영업사만' || hold ? 0 : Math.round(N(r.claimWritten) * ratio);
  const pay = excl || target === '공급사만' ? 0 : Math.round(N(r.payWritten) * ratio);
  lines.push({
    plate: S(r.plate) || '(차번없음)', model: S(r.model), cust: S(r.customer), sup: S(r.supplier) || '(미기재)',
    ch: S(r.channel) || '(미기재)', agent: S(r.agent), product: S(r.product), term: N(r.term), rent: N(r.rent),
    recv: S(r.receivedAt), deliv: S(r.deliveredAt), supRate: N(r.supplierRate), agRate: N(r.agentRate),
    claim, pay, target, ratio,
    why: [target !== '양쪽' ? target : '', ratio !== 1 ? `비율 ${ratio}` : '', hold ? '청구보류' : '',
      excl ? '정산제외' : '', r.settledAlready === true ? '정산완료' : '', r.vatIncluded === true ? '부가세포함' : '',
      S(r.settleNote) || S(r.note)].filter(Boolean).join(' · '),
    billed: claim !== 0, collected: collectedSup.has(S(r.supplier)), kind: '청구',
  });
}
for (const c of myClaws) {
  lines.push({
    plate: S(c.plate), model: '', cust: '', sup: S(c.supplier) || '(미기재)', ch: S(c.channel) || '(미기재)', agent: '',
    product: '', term: 0, rent: 0, recv: '', deliv: S(c.at), supRate: 0, agRate: 0,
    claim: -Math.round(N(c.supplierAmt)), pay: -Math.round(N(c.agentAmt)),
    target: '양쪽', ratio: 1, why: `환수 — ${S(c.reason) || '사유 미기재'}`, billed: false, collected: false, kind: '환수',
  });
}
lines.sort((a, b) => (a.sup === b.sup ? a.plate.localeCompare(b.plate) : a.sup.localeCompare(b.sup)));

const tc = lines.reduce((a, b) => a + b.claim, 0); const tp = lines.reduce((a, b) => a + b.pay, 0);
console.log(`   ${lines.length}줄 (청구 ${lines.filter((l) => l.kind === '청구').length} · 환수 ${myClaws.length})`);
console.log(`   청구 ${won(tc)} (VAT포함 ${won(tc + Math.round(tc * VAT))}) · 지급 ${won(tp)} (VAT포함 ${won(tp + Math.round(tp * VAT))}) · 이익 ${won(tc - tp)}`);
const col = new Set(lines.filter((l) => l.collected).map((l) => l.sup));
console.log(`   ★수금완료 표시 — ${[...col].join(' · ') || '없음'} (${lines.filter((l) => l.collected).length}줄)`);

const HEAD = ['접수일', '차량번호', '모델명', '고객명', '공급사', '영업채널', '영업담당자', '상품구분', '계약기간', '렌탈료',
  '인도일', '구분', '공급사요율', '청구액', '청구부가세', '청구합계', '영업자요율', '지급액', '지급부가세', '지급합계',
  '이익', '이익률', '정산대상', '정산비율', '청구', '수금', '비고'];
const body = lines.map((l) => {
  const cv = Math.round(l.claim * VAT); const pv = Math.round(l.pay * VAT);
  return [serial(l.recv), l.plate, l.model, l.cust, l.sup, l.ch, l.agent, l.product, l.term || '', l.rent || '',
    serial(l.deliv), l.kind, l.supRate || '', l.claim, cv, l.claim + cv, l.agRate || '', l.pay, pv, l.pay + pv,
    l.claim - l.pay, l.claim > 0 ? Number((((l.claim - l.pay) / l.claim)).toFixed(4)) : '',
    l.target, l.ratio, l.billed, l.collected, l.why];
});
const tcv = Math.round(tc * VAT); const tpv = Math.round(tp * VAT);
const total = ['', `합계 ${lines.length}줄`, '', '', '', '', '', '', '', '', '', '', '',
  tc, tcv, tc + tcv, '', tp, tpv, tp + tpv, tc - tp, tc > 0 ? Number(((tc - tp) / tc).toFixed(4)) : '', '', '', '', '', ''];
const about = `${TAB} 청구·지급 검토표 — 파이어베이스 원자(v4/settlement_rows)에서 찍습니다. `
  + `원본 「프리패스 ${MONTH.slice(2, 4)}/${Number(MONTH.slice(5))}」 기준이고 «수식X(손으로 적은 값)»가 이깁니다. `
  + `⚠ 여기서 고쳐도 원자는 안 바뀝니다 — 틀린 곳을 알려 주시면 원자를 고치고 다시 찍습니다. `
  + `「청구」는 이번 달 청구서가 나가는 줄, 「수금」은 이미 받은 줄입니다.`;

console.log(`\n   머리글 ${HEAD.length}칸 · 데이터 ${body.length}줄`);
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다. --apply 로 찍는다.\n'); process.exit(0); }

// ── 탭 준비 ──
const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as {
  sheets?: { properties: { sheetId: number; title: string; gridProperties: { rowCount: number; columnCount: number } } }[] };
let prop = (meta.sheets || []).find((s) => s.properties.title === TAB)?.properties;
if (!prop) {
  const add = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}:batchUpdate`, {
    method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, gridProperties: { rowCount: body.length + 20, columnCount: HEAD.length } } } }] }),
  });
  if (!add.ok) { console.log(`   ✕ 탭 만들기 ${add.status} ${(await add.text()).slice(0, 200)}`); process.exit(1); }
  prop = ((await add.json()) as { replies?: { addSheet?: { properties: typeof prop } }[] }).replies?.[0]?.addSheet?.properties;
  console.log(`   탭 「${TAB}」 새로 만듦`);
}
if (!prop) { console.log('   ✕ 탭을 못 잡았다'); process.exit(1); }
// 칸이 모자라면 늘린다
const needC = HEAD.length; const needR = body.length + 4;
const grow: Record<string, unknown>[] = [];
if (needC > prop.gridProperties.columnCount) grow.push({ appendDimension: { sheetId: prop.sheetId, dimension: 'COLUMNS', length: needC - prop.gridProperties.columnCount } });
if (needR > prop.gridProperties.rowCount) grow.push({ appendDimension: { sheetId: prop.sheetId, dimension: 'ROWS', length: needR - prop.gridProperties.rowCount } });
if (grow.length) await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}:batchUpdate`, { method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: grow }) });

await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`'${TAB}'!A1:BZ500`)}:clear`, { method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: '{}' });
const w = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=RAW`, {
  method: 'PUT', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ values: [[TAB, about], HEAD, ...body, total] }),
});
console.log(`   쓰기 ${w.status} ${w.ok ? '✓' : (await w.text()).slice(0, 200)}`);
if (!w.ok) process.exit(1);

// ── 서식 — 체크박스 · 머리 색 · 돈/율 · 고정 ──
const iBill = HEAD.indexOf('청구'); const iColl = HEAD.indexOf('수금'); const iRate = HEAD.indexOf('이익률');
const money = HEAD.map((h, j) => (/액|합계|부가세|이익$|렌탈료/.test(h) ? j : -1)).filter((j) => j >= 0);
const reqs: Record<string, unknown>[] = [
  /**
   * ★**병합부터 푼다.** 옛 탭 머리에 병합된 셀이 남아 있으면 열 고정이 튕긴다 —
   *   「병합된 셀의 일부만 포함된 열을 고정할 수 없습니다」(실측 2026-09-01).
   *   ⚠ 이 요청은 병합이 «없어도» 안전하다.
   */
  { unmergeCells: { range: { sheetId: prop.sheetId } } },
  { updateSheetProperties: { properties: { sheetId: prop.sheetId, gridProperties: { frozenRowCount: 2, frozenColumnCount: 2 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
  { repeatCell: { range: { sheetId: prop.sheetId, startRowIndex: 1, endRowIndex: 2 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.90, blue: 0.97 }, textFormat: { bold: true, fontSize: 10 }, horizontalAlignment: 'CENTER', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,wrapStrategy)' } },
  ...[iBill, iColl].map((j) => ({ setDataValidation: { range: { sheetId: prop!.sheetId, startRowIndex: 2, endRowIndex: body.length + 2, startColumnIndex: j, endColumnIndex: j + 1 }, rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true } } })),
  ...money.map((j) => ({ repeatCell: { range: { sheetId: prop!.sheetId, startRowIndex: 2, endRowIndex: body.length + 3, startColumnIndex: j, endColumnIndex: j + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' } } }, fields: 'userEnteredFormat.numberFormat' } })),
  { repeatCell: { range: { sheetId: prop.sheetId, startRowIndex: 2, endRowIndex: body.length + 3, startColumnIndex: iRate, endColumnIndex: iRate + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0.0%' } } }, fields: 'userEnteredFormat.numberFormat' } },
  ...[HEAD.indexOf('공급사요율'), HEAD.indexOf('영업자요율')].map((j) => ({ repeatCell: { range: { sheetId: prop!.sheetId, startRowIndex: 2, endRowIndex: body.length + 2, startColumnIndex: j, endColumnIndex: j + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0.00%' } } }, fields: 'userEnteredFormat.numberFormat' } })),
  { repeatCell: { range: { sheetId: prop.sheetId, startRowIndex: body.length + 2, endRowIndex: body.length + 3 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.95, green: 0.95, blue: 0.90 }, textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
  /**
   * ★**규격 — 원장과 같은 손**(`수정이력-정산원장.md` 2026-08-25 「열 서식」).
   *   날짜 `yyyy-mm-dd` · 돈 `#,##0` · 율 `0.00%` · 기간 `0"개월"` · 차번은 TEXT.
   *   ⚠ 차번을 TEXT 로 안 두면 `142호1065` 같은 건 괜찮아도 숫자로 읽히는 차번이 지수 표기로 깨진다.
   */
  ...[HEAD.indexOf('접수일'), HEAD.indexOf('인도일')].map((j) => ({ repeatCell: { range: { sheetId: prop!.sheetId, startRowIndex: 2, endRowIndex: body.length + 2, startColumnIndex: j, endColumnIndex: j + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } })),
  { repeatCell: { range: { sheetId: prop.sheetId, startRowIndex: 2, endRowIndex: body.length + 2, startColumnIndex: HEAD.indexOf('계약기간'), endColumnIndex: HEAD.indexOf('계약기간') + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '0"개월"' }, horizontalAlignment: 'CENTER' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } },
  { repeatCell: { range: { sheetId: prop.sheetId, startRowIndex: 2, endRowIndex: body.length + 2, startColumnIndex: HEAD.indexOf('차량번호'), endColumnIndex: HEAD.indexOf('차량번호') + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' } },
  /** ★환수 줄은 붉게 — 마이너스라 눈에 먼저 들어와야 한다. */
  ...lines.map((l, i) => (l.kind === '환수' ? { repeatCell: { range: { sheetId: prop!.sheetId, startRowIndex: i + 2, endRowIndex: i + 3 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.99, green: 0.90, blue: 0.90 } } }, fields: 'userEnteredFormat.backgroundColor' } } : null)).filter(Boolean) as Record<string, unknown>[],
  /** ★수금 끝난 줄은 초록 — 「이건 이미 받았다」가 한눈에 보여야 다시 청구하지 않는다. */
  ...lines.map((l, i) => (l.collected ? { repeatCell: { range: { sheetId: prop!.sheetId, startRowIndex: i + 2, endRowIndex: i + 3 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.90, green: 0.96, blue: 0.90 } } }, fields: 'userEnteredFormat.backgroundColor' } } : null)).filter(Boolean) as Record<string, unknown>[],
  { autoResizeDimensions: { dimensions: { sheetId: prop.sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: HEAD.length } } },
];
const b = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}:batchUpdate`, { method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: reqs }) });
console.log(`   서식 ${b.status} ${b.ok ? '✓' : (await b.text()).slice(0, 300)}`);

// ── 원자에도 수금 표시를 남긴다 ──
const mark: Record<string, unknown> = {};
for (const r of mine) if (collectedSup.has(S(r.supplier))) {
  mark[`v4/settlement_rows/${S(r.code)}/collected`] = true;
  mark[`v4/settlement_rows/${S(r.code)}/billed`] = true;
  mark[`v4/settlement_rows/${S(r.code)}/collectedNote`] = `${MONTH} 청구분 수금완료 (대표 확인 2026-09-01)`;
}
if (Object.keys(mark).length) { await db.ref().update(mark); console.log(`   ✓ 원자에도 수금 표시 ${Object.keys(mark).length / 3}줄`); }
console.log(`\n   ✓ 끝. https://docs.google.com/spreadsheets/d/${LEDGER}/edit\n`);
process.exit(0);
