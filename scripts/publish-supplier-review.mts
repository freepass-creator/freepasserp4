/**
 * **업체별 산출표 — 태윤 매니저 확인용.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-01 「업체별 산출표로 적고 어디 확인해보라고 하자」
 *
 * ★★**한 장에 셋을 나란히 둔다.**
 * ```
 * 표 산출   원자 + 수수료표 로직으로 «기계가» 낸 값
 * 가감      사람이 더하거나 뺀 값 + 그 «사유»
 * 최종 청구  = 표 산출 + 가감   ← 실제로 나가는 금액
 * ```
 *   ★가감이 0 이면 표대로다. 0 이 아닌데 사유가 비면 **그게 물어볼 자리**다.
 *   ⚠ 지금은 금액만 덮어써서 근거가 없었다 — `109호3689` 처럼 「왜 500,000 인가」를 사람에게 물어야 했다.
 *
 * ★**확인칸**을 둔다 — 태윤 매니저가 업체마다 ○/× 를 찍고 다른 것만 적어 주면 된다.
 *
 *   npx tsx scripts/publish-supplier-review.mts 2026-08 [--apply]
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { feeRuleFor, type FeeRule } from '../lib/domain/settlement-fee-table';

const APPLY = process.argv.includes('--apply');
const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '2026-08').trim();
const TAB = `${MONTH.slice(2, 4)}년${MONTH.slice(5)}월 산출확인`;
const VAT = 0.1;
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원₩]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;

const EV = /EV\b|EV6|아이오닉|모델\s*[3YXS]|테슬라|니로|코나|폴스타/i;
const kindOf = (product: string, model: string): { kind: FeeRule['kind']; form?: string; fallback?: FeeRule['kind'] } => {
  if (/견적출고/.test(product)) return { kind: '신차', form: '매칭출고' };
  const ev = EV.test(model);
  if (/선출고/.test(product)) return ev ? { kind: '전기차', fallback: '신차' } : { kind: '신차', form: '선출고' };
  if (/구독/.test(product)) return { kind: '구독' };
  return ev ? { kind: '전기차', fallback: '재렌트' } : { kind: '재렌트' };
};

type Row = Record<string, unknown>;
const rows = (Object.values((await db.ref('v4/settlement_rows').get()).val() || {}) as Row[])
  .filter((r) => r.cancelled !== true && S(r.billMonth) === MONTH);
const claws = (Object.values((await db.ref('v4/settlement_clawbacks').get()).val() || {}) as Row[]).filter((c) => S(c.month) === MONTH);

type L = { plate: string; sup: string; ch: string; model: string; product: string; term: number;
  calc: number | null; final: number; adj: number; reason: string; basis: string; rate: string };
const lines: L[] = [];
for (const r of rows) {
  const sup = S(r.supplier) || '(미기재)'; const product = S(r.product); const term = N(r.term); const model = S(r.model);
  const target = S(r.settleTarget) || '양쪽'; const ratio = N(r.settleRatio) || 1;
  const { kind, form, fallback } = kindOf(product, model);
  const f = feeRuleFor(S(r.supplier), kind, term, form, fallback);
  const final = target === '영업사만' || r.settleExclude === true ? 0 : Math.round(N(r.claimWritten) * ratio);
  let calc: number | null = null; let basis = ''; let rate = '';
  if (f && f.auto) {
    const base = f.basis === '정액' ? 0 : (f.basis === '차량가액' ? N(r.price) : N(r.rent) * term);
    calc = target === '영업사만' ? 0 : Math.round((f.basis === '정액' ? Number(f.claim) : base * Number(f.claim)) * ratio);
    basis = f.basis;
    rate = typeof f.claim === 'number' && f.claim < 1 ? `${(Number(f.claim) * 100).toFixed(2)}%` : won(Number(f.claim));
  } else if (f) { basis = f.basis; rate = String(f.claim); } else { basis = '표에 없음'; }
  lines.push({
    plate: S(r.plate) || '(차번없음)', sup, ch: S(r.channel) || '(미기재)', model, product, term,
    calc, final, adj: calc === null ? 0 : final - calc,
    reason: S(r.adjustReason) || S(r.settleNote) || S(r.note) || (target !== '양쪽' ? target : ''),
    basis, rate,
  });
}
for (const c of claws) lines.push({
  plate: S(c.plate), sup: S(c.supplier) || '(미기재)', ch: S(c.channel) || '(미기재)', model: '', product: '환수', term: 0,
  calc: -N(c.supplierAmt), final: -N(c.supplierAmt), adj: 0, reason: `환수 — ${S(c.reason) || '사유 미기재'}`, basis: '환수', rate: '',
});

// ── 업체별로 접는다 ──
const bySup = new Map<string, L[]>();
for (const l of lines) (bySup.get(l.sup) || bySup.set(l.sup, []).get(l.sup)!).push(l);
const sups = [...bySup].sort((a, b) => b[1].reduce((s, l) => s + l.final, 0) - a[1].reduce((s, l) => s + l.final, 0));

const HEAD = ['공급사', '건수', '표 산출', '가감', '최종 청구(공급가)', '부가세', '청구 합계', '확인', '다르면 여기 적어 주세요'];
const body: (string | number)[][] = [];
const detail: (string | number)[][] = [];
let TC = 0; let TA = 0;
for (const [sup, ls] of sups) {
  const calc = ls.reduce((a, b) => a + (b.calc ?? b.final), 0);
  const fin = ls.reduce((a, b) => a + b.final, 0);
  const adj = fin - calc; TC += fin; TA += adj;
  body.push([sup, ls.length, calc, adj || '', fin, Math.round(fin * VAT), fin + Math.round(fin * VAT), '', '']);
  // 가감이 있는 줄만 아래에 자세히 — 확인할 곳만 보여 준다
  for (const l of ls.filter((x) => x.adj !== 0)) {
    detail.push([`   └ ${l.plate}`, `${l.model} ${l.product}${l.term || ''}`, l.calc ?? '', l.adj, l.final, '', '',
      '', l.reason || '★사유가 비어 있습니다 — 왜 다른지 적어 주세요']);
  }
}
console.log(`\n■ ${MONTH} 업체별 산출확인 — 공급사 ${sups.length}곳 · 표 산출과 다른 줄 ${lines.filter((l) => l.adj !== 0).length}건 ${APPLY ? '(반영)' : '(대조만)'}\n`);
console.log('   공급사          건    표 산출        가감        최종 청구');
for (const b of body) console.log(`   ${String(b[0]).padEnd(14)} ${String(b[1]).padStart(2)} ${won(Number(b[2])).padStart(12)} ${(b[3] ? won(Number(b[3])) : '—').padStart(11)} ${won(Number(b[4])).padStart(13)}`);
console.log(`   ${'합계'.padEnd(14)}    ${won(TC - TA).padStart(12)} ${(TA ? won(TA) : '—').padStart(11)} ${won(TC).padStart(13)}`);
if (detail.length) { console.log('\n   ★확인이 필요한 줄'); for (const d of detail) console.log(`   ${String(d[0]).padEnd(14)} ${String(d[1]).padEnd(20)} 표 ${won(Number(d[2])).padStart(11)} → 최종 ${won(Number(d[4])).padStart(11)}  ${d[8]}`); }
if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼다. --apply 로 찍는다.\n'); process.exit(0); }

// ── 탭에 찍는다 ──
const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as {
  sheets?: { properties: { sheetId: number; title: string; gridProperties: { rowCount: number; columnCount: number } } }[] };
let prop = (meta.sheets || []).find((s) => s.properties.title === TAB)?.properties;
if (!prop) {
  const add = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}:batchUpdate`, {
    method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: TAB, index: 1, gridProperties: { rowCount: body.length + detail.length + 20, columnCount: HEAD.length } } } }] }),
  });
  if (!add.ok) { console.log(`   ✕ 탭 만들기 ${add.status} ${(await add.text()).slice(0, 200)}`); process.exit(1); }
  prop = ((await add.json()) as { replies?: { addSheet?: { properties: NonNullable<typeof prop> } }[] }).replies?.[0]?.addSheet?.properties;
  console.log(`   탭 「${TAB}」 만듦`);
}
if (!prop) process.exit(1);
const about = `${MONTH} 업체별 산출확인 — 박태윤 매니저님 확인 부탁드립니다. `
  + '「표 산출」은 원자(차량가액·대여료·기간)에 수수료표를 걸어 기계가 낸 값이고, 「최종 청구」는 실제로 나갈 금액입니다. '
  + '「가감」이 «—」이면 표대로라 볼 것이 없습니다. 숫자가 있는 줄만 아래에 자세히 폈습니다 — 그 줄만 봐 주시면 됩니다. '
  + '★「가감」과 「사유」는 기계가 산출해 넣은 것입니다 — 맞으면 「확인」에 ○, 다르면 맞는 금액과 이유를 오른쪽에 적어 주세요.';
const total = ['합계', lines.length, TC - TA, TA || '', TC, Math.round(TC * VAT), TC + Math.round(TC * VAT), '', ''];

await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`'${TAB}'!A1:Z300`)}:clear`, { method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: '{}' });
const values = [[TAB, about], HEAD, ...body, total, [], ['★ 표 산출과 «다른» 줄 — 여기만 봐 주시면 됩니다'],
  ['차량번호', '차량·상품', '표 산출', '가감', '최종 청구', '', '', '확인', '사유 / 맞는 금액'], ...detail];
const w = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`'${TAB}'!A1`)}?valueInputOption=RAW`, {
  method: 'PUT', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values }),
});
console.log(`   쓰기 ${w.status} ${w.ok ? '✓' : (await w.text()).slice(0, 200)}`);
if (!w.ok) process.exit(1);

const id = prop.sheetId; const last = body.length + 3; const dHead = last + 3;
const money = [2, 3, 4, 5, 6];
const reqs: Record<string, unknown>[] = [
  { unmergeCells: { range: { sheetId: id } } },
  { mergeCells: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: HEAD.length }, mergeType: 'MERGE_ALL' } },
  { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 58 }, fields: 'pixelSize' } },
  { repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.18, green: 0.24, blue: 0.38 }, textFormat: { bold: true, fontSize: 11, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)' } },
  { repeatCell: { range: { sheetId: id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: HEAD.length }, cell: { userEnteredFormat: { backgroundColor: { red: 0.95, green: 0.96, blue: 0.98 }, textFormat: { fontSize: 9 }, horizontalAlignment: 'LEFT', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP', padding: { left: 8, right: 8, top: 2, bottom: 2 } } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,padding)' } },
  ...[1, dHead].map((rw) => ({ repeatCell: { range: { sheetId: id, startRowIndex: rw, endRowIndex: rw + 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 1.0, green: 0.95, blue: 0.80 }, textFormat: { bold: true, fontSize: 10 }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)' } })),
  ...money.map((j) => ({ repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: dHead + detail.length + 1, startColumnIndex: j, endColumnIndex: j + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } })),
  // ★가감이 있는 업체 줄은 주황 — 볼 곳이 한눈에
  ...body.map((b, i) => (b[3] ? { repeatCell: { range: { sheetId: id, startRowIndex: i + 2, endRowIndex: i + 3 }, cell: { userEnteredFormat: { backgroundColor: { red: 1.0, green: 0.92, blue: 0.82 } } }, fields: 'userEnteredFormat.backgroundColor' } } : null)).filter(Boolean) as Record<string, unknown>[],
  { repeatCell: { range: { sheetId: id, startRowIndex: last - 1, endRowIndex: last }, cell: { userEnteredFormat: { backgroundColor: { red: 0.92, green: 0.94, blue: 0.90 }, textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
  // 확인칸 — 굵은 테두리로 「여기 적으세요」
  { repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: dHead + detail.length + 1, startColumnIndex: 7, endColumnIndex: 9 }, cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 0.90 }, horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat(backgroundColor,horizontalAlignment)' } },
  { updateSheetProperties: { properties: { sheetId: id, gridProperties: { frozenRowCount: 2 } }, fields: 'gridProperties.frozenRowCount' } },
  { autoResizeDimensions: { dimensions: { sheetId: id, dimension: 'COLUMNS', startIndex: 0, endIndex: HEAD.length } } },
];
const b = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}:batchUpdate`, { method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: reqs }) });
console.log(`   서식 ${b.status} ${b.ok ? '✓' : (await b.text()).slice(0, 300)}`);

/**
 * ★★**가감은 «기계가» 적는다**(사장님 2026-09-01 「사람이 입력하는건 아니고 ai가 산출해서 입력할거야」).
 *   표 산출과 적힌 값의 차이를 그대로 「청구가감」·「지급가감」에 박고,
 *   사유는 그 줄에 이미 있는 말(메모·정산대상)에서 끌어온다.
 * ⚠ **금액은 안 건드린다.** 적힌 값이 정본이고, 가감은 «왜 다른가»를 적어 두는 칸이다.
 * ⚠ 사유를 못 찾으면 «비워 둔다» — 지어내지 않는다. 빈 사유가 곧 「사람에게 물어볼 자리」다.
 */
const mark: Record<string, unknown> = {};
let wrote = 0; let noReason = 0;
for (const r of rows) {
  const sup = S(r.supplier); const product = S(r.product); const term = N(r.term); const model = S(r.model);
  const target = S(r.settleTarget) || '양쪽'; const ratio = N(r.settleRatio) || 1;
  const { kind, form, fallback } = kindOf(product, model);
  const f = feeRuleFor(sup, kind, term, form, fallback);
  if (!f || !f.auto) continue;                       // 기계가 못 내는 줄은 가감을 못 잰다
  const base = f.basis === '정액' ? 0 : (f.basis === '차량가액' ? N(r.price) : N(r.rent) * term);
  const calcC = target === '영업사만' ? 0 : Math.round((f.basis === '정액' ? Number(f.claim) : base * Number(f.claim)) * ratio);
  const calcP = target === '공급사만' ? 0 : Math.round((f.basis === '정액' ? Number(f.pay) : base * Number(f.pay)) * ratio);
  const finC = target === '영업사만' || r.settleExclude === true ? 0 : Math.round(N(r.claimWritten) * ratio);
  const finP = target === '공급사만' || r.settleExclude === true ? 0 : Math.round(N(r.payWritten) * ratio);
  const dC = finC - calcC; const dP = finP - calcP;
  if (!dC && !dP) continue;
  const reason = S(r.settleNote) || S(r.note) || (target !== '양쪽' ? target : '');
  if (!reason) noReason += 1;
  mark[`v4/settlement_rows/${S(r.code)}/claimAdjust`] = dC;
  mark[`v4/settlement_rows/${S(r.code)}/payAdjust`] = dP;
  mark[`v4/settlement_rows/${S(r.code)}/adjustReason`] = reason;
  mark[`v4/settlement_rows/${S(r.code)}/adjustBy`] = 'publish-supplier-review';
  wrote += 1;
}
if (Object.keys(mark).length) {
  await db.ref().update(mark);
  console.log(`\n   ✓ 가감을 원자에 적었다 — ${wrote}줄${noReason ? ` (그중 사유가 비어 «사람에게 물어볼 줄» ${noReason})` : ''}`);
} else console.log('\n   가감이 필요한 줄이 없다 — 전부 표대로다.');
console.log(`\n   ✓ 끝. https://docs.google.com/spreadsheets/d/${LEDGER}/edit\n`);
process.exit(0);
