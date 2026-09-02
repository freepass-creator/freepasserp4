/**
 * **청구월 탭을 «앞으로 몇 달치» 미리 찍는다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-01
 *   「과거 접수했던건들이 **어딘가에 청구월에는 들어가있어야** 하는거야. 그래서 우리는
 *    앞 2~5개월까지는 청구예정이 생길수 있는거고, 시트에서는 **탭으로 미리 만들어서** 관리하자는거지.
 *    이게 직원들한테 직관적이니까」
 *   「인도예정일은 없어도돼 청구월만 표기해서 그 탭에 반영해두면 되지」
 *
 * ★★**한 줄도 빠지지 않는다.** 청구월이 있으면 그 달 탭에, 없으면 「청구월미정」 탭에 선다.
 *   ⇒ 접수한 것은 «반드시 어딘가에» 있다. 조용히 사라지면 그게 누락이다.
 *
 * ★청구월 고르는 순서
 * ```
 * ① 적힌 청구월        접수할 때 사람이 적으면 인도를 안 기다리고 미리 선다
 * ② 계산              일시납 = 인도월 · 분납 = 인도월 + (회차−1)개월
 * ③ 둘 다 없으면       「청구월미정」 탭 — 사람이 정할 것
 * ```
 * ★원본은 «파이어베이스 원자»다. 시트를 다시 읽지 않는다 — 두 군데서 세면 어느 숫자도 못 믿는다.
 *
 *   npx tsx scripts/publish-settlement-month.mts 2026-08              그 달만
 *   npx tsx scripts/publish-settlement-month.mts 2026-08 --ahead=5    그 달부터 5달 뒤까지
 *   npx tsx scripts/publish-settlement-month.mts 2026-08 --ahead=5 --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';

const APPLY = process.argv.includes('--apply');
const FROM = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '').trim();
const AHEAD = Number((process.argv.find((a) => a.startsWith('--ahead='))?.split('=')[1]) || 0);
if (!FROM) { console.log('\n  달을 적어 주세요 — npx tsx scripts/publish-settlement-month.mts 2026-08 [--ahead=5] [--apply]\n'); process.exit(1); }
const VAT = 0.1;
const PENDING_TAB = '청구월미정';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원₩]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const SERIAL0 = Date.UTC(1899, 11, 30);
/** ★날짜는 숫자(serial)로 넣고 서식으로 보여 준다 — 글자로 쓰면 정렬·필터가 안 먹는다. */
const serial = (ymd: string): number | '' => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(S(ymd));
  return m ? Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - SERIAL0) / 86_400_000) : '';
};
const tabOf = (m: string) => `${m.slice(2, 4)}년${m.slice(5)}월`;
const addM = (m: string, k: number) => {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1 + k, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const D = (v: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(v)); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const roundsOf = (k: string) => { const m = /(\d)\s*회/.exec(S(k)); const n = m ? Number(m[1]) : 1; return n >= 2 ? n : 1; };

/** ★이미 수금이 끝난 곳 — 사람이 확인해 준 것만 적는다. 기계가 짐작하지 않는다. */
const COLLECTED: Record<string, string[]> = { '2026-08': ['우리캐피탈'] };

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;

type Row = Record<string, unknown>;
const rows = (Object.values((await db.ref('v4/settlement_rows').get()).val() || {}) as Row[]).filter((r) => r.cancelled !== true);
const claws = Object.values((await db.ref('v4/settlement_clawbacks').get()).val() || {}) as Row[];

/**
 * ★★**엔진과 «같은» 규칙이어야 한다** — `lib/domain/settlement-stage.ts` `billingMonth`.
 *   여기서 따로 세면 화면과 시트가 다른 달을 말한다.
 * ★분납 완료시점 청구는 **인도일이 2026-09 이후**인 건부터다(`CLAIM_ON_COMPLETE_SINCE`).
 *   ⚠ 시행일을 안 지키면 8월이 47줄 → 62줄로 부푼다(실측 2026-09-01) —
 *     지난 달 인도한 분납건이 죄다 8월로 밀려 들어온다.
 */
const SINCE = '2026-09';
const monthOf = (r: Row): string => {
  const written = S(r.billMonth);
  if (written) return written;
  const d = D(r.deliveredAt);
  if (!d) return '';
  const n = roundsOf(S(r.payKind));
  const onComplete = n >= 2 && ymOf(d) >= SINCE;
  return ymOf(onComplete ? new Date(d.getFullYear(), d.getMonth() + (n - 1), d.getDate()) : d);
};

type Line = { plate: string; model: string; cust: string; sup: string; ch: string; agent: string;
  product: string; term: number; rent: number; recv: string; deliv: string; supRate: number; agRate: number;
  claim: number; pay: number; target: string; ratio: number; why: string; billed: boolean; collected: boolean; kind: string };
const lineOf = (r: Row, month: string): Line => {
  const target = S(r.settleTarget) || '양쪽';
  const ratio = N(r.settleRatio) || 1;
  const hold = r.billHold === true; const excl = r.settleExclude === true;
  const claim = excl || target === '영업사만' || hold ? 0 : Math.round(N(r.claimWritten) * ratio);
  const pay = excl || target === '공급사만' ? 0 : Math.round(N(r.payWritten) * ratio);
  return {
    plate: S(r.plate) || '(차번없음)', model: S(r.model), cust: S(r.customer), sup: S(r.supplier) || '(미기재)',
    ch: S(r.channel) || '(미기재)', agent: S(r.agent), product: S(r.product), term: N(r.term), rent: N(r.rent),
    recv: S(r.receivedAt), deliv: S(r.deliveredAt), supRate: N(r.supplierRate), agRate: N(r.agentRate),
    claim, pay, target, ratio,
    why: [target !== '양쪽' ? target : '', ratio !== 1 ? `비율 ${ratio}` : '', hold ? '청구보류' : '',
      excl ? '정산제외' : '', r.settledAlready === true ? '정산완료' : '', r.vatIncluded === true ? '부가세포함' : '',
      S(r.settleNote) || S(r.note)].filter(Boolean).join(' · '),
    billed: claim !== 0, collected: (COLLECTED[month] || []).includes(S(r.supplier)), kind: '청구',
  };
};

const rateCell = (r: number): number | string => (r >= 1 ? '정액' : r || '');
const HEAD = ['접수일', '차량번호', '모델명', '고객명', '공급사', '영업채널', '영업담당자', '상품구분', '계약기간', '렌탈료',
  '인도일', '구분', '공급사요율', '청구액', '청구부가세', '청구합계', '영업자요율', '지급액', '지급부가세', '지급합계',
  '이익', '이익률', '정산대상', '정산비율', '청구', '수금', '비고'];

const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}?fields=sheets.properties`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as {
  sheets?: { properties: { sheetId: number; title: string; gridProperties: { rowCount: number; columnCount: number } } }[] };
const sheetOf = new Map((meta.sheets || []).map((s) => [s.properties.title, s.properties]));

/** 한 탭을 찍는다. 없으면 만든다. */
async function publish(tab: string, lines: Line[], about: string) {
  const body = lines.map((l) => {
    const cv = Math.round(l.claim * VAT); const pv = Math.round(l.pay * VAT);
    return [serial(l.recv), l.plate, l.model, l.cust, l.sup, l.ch, l.agent, l.product, l.term || '', l.rent || '',
      serial(l.deliv), l.kind, rateCell(l.supRate), l.claim, cv, l.claim + cv, rateCell(l.agRate), l.pay, pv, l.pay + pv,
      l.claim - l.pay, l.claim > 0 ? Number(((l.claim - l.pay) / l.claim).toFixed(4)) : '',
      l.target, l.ratio, l.billed, l.collected, l.why];
  });
  const tc = lines.reduce((a, b) => a + b.claim, 0); const tp = lines.reduce((a, b) => a + b.pay, 0);
  const tcv = Math.round(tc * VAT); const tpv = Math.round(tp * VAT);
  const total = ['', `합계 ${lines.length}줄`, '', '', '', '', '', '', '', '', '', '', '',
    tc, tcv, tc + tcv, '', tp, tpv, tp + tpv, tc - tp, tc > 0 ? Number(((tc - tp) / tc).toFixed(4)) : '', '', '', '', '', ''];
  if (!APPLY) return;

  let prop = sheetOf.get(tab);
  if (!prop) {
    const add = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}:batchUpdate`, {
      method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab, gridProperties: { rowCount: Math.max(body.length + 20, 60), columnCount: HEAD.length } } } }] }),
    });
    if (!add.ok) { console.log(`      ✕ 탭 만들기 ${add.status} ${(await add.text()).slice(0, 160)}`); return; }
    prop = ((await add.json()) as { replies?: { addSheet?: { properties: NonNullable<typeof prop> } }[] }).replies?.[0]?.addSheet?.properties;
    if (prop) sheetOf.set(tab, prop);
    console.log(`      탭 「${tab}」 새로 만듦`);
  }
  if (!prop) return;
  const grow: Record<string, unknown>[] = [];
  if (HEAD.length > prop.gridProperties.columnCount) grow.push({ appendDimension: { sheetId: prop.sheetId, dimension: 'COLUMNS', length: HEAD.length - prop.gridProperties.columnCount } });
  if (body.length + 4 > prop.gridProperties.rowCount) grow.push({ appendDimension: { sheetId: prop.sheetId, dimension: 'ROWS', length: body.length + 4 - prop.gridProperties.rowCount } });
  if (grow.length) await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}:batchUpdate`, { method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: grow }) });

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`'${tab}'!A1:BZ500`)}:clear`, { method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: '{}' });
  const w = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`'${tab}'!A1`)}?valueInputOption=RAW`, {
    method: 'PUT', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[tab, about], HEAD, ...body, total] }),
  });
  if (!w.ok) { console.log(`      ✕ 쓰기 ${w.status} ${(await w.text()).slice(0, 160)}`); return; }

  const id = prop.sheetId;
  const iBill = HEAD.indexOf('청구'); const iColl = HEAD.indexOf('수금'); const iRate = HEAD.indexOf('이익률');
  const money = HEAD.map((h, j) => (/액$|합계|부가세|이익$|렌탈료/.test(h) ? j : -1)).filter((j) => j >= 0);
  const RIGHT = ['렌탈료', '청구액', '청구부가세', '청구합계', '지급액', '지급부가세', '지급합계', '이익'];
  const LEFT = ['모델명', '비고'];
  const reqs: Record<string, unknown>[] = [
    { unmergeCells: { range: { sheetId: id } } },
    { updateSheetProperties: { properties: { sheetId: id, gridProperties: { frozenRowCount: 2, frozenColumnCount: 2 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: 1, endRowIndex: 2 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.85, green: 0.90, blue: 0.97 }, textFormat: { bold: true, fontSize: 10 }, horizontalAlignment: 'CENTER', wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,wrapStrategy)' } },
    // 정렬 — 돈은 우측 · 글은 좌측 · 나머지 가운데
    ...HEAD.map((h, j) => ({ repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: body.length + 3, startColumnIndex: j, endColumnIndex: j + 1 }, cell: { userEnteredFormat: { horizontalAlignment: RIGHT.includes(h) ? 'RIGHT' : LEFT.includes(h) ? 'LEFT' : 'CENTER', verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)' } })),
    ...[iBill, iColl].map((j) => ({ setDataValidation: { range: { sheetId: id, startRowIndex: 2, endRowIndex: body.length + 2, startColumnIndex: j, endColumnIndex: j + 1 }, rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true } } })),
    ...money.map((j) => ({ repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: body.length + 3, startColumnIndex: j, endColumnIndex: j + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' } } }, fields: 'userEnteredFormat.numberFormat' } })),
    { repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: body.length + 3, startColumnIndex: iRate, endColumnIndex: iRate + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0.0%' } } }, fields: 'userEnteredFormat.numberFormat' } },
    ...[HEAD.indexOf('공급사요율'), HEAD.indexOf('영업자요율')].map((j) => ({ repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: body.length + 2, startColumnIndex: j, endColumnIndex: j + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0.00%' } } }, fields: 'userEnteredFormat.numberFormat' } })),
    ...[HEAD.indexOf('접수일'), HEAD.indexOf('인도일')].map((j) => ({ repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: body.length + 2, startColumnIndex: j, endColumnIndex: j + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } }, fields: 'userEnteredFormat.numberFormat' } })),
    { repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: body.length + 2, startColumnIndex: HEAD.indexOf('계약기간'), endColumnIndex: HEAD.indexOf('계약기간') + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '0"개월"' } } }, fields: 'userEnteredFormat.numberFormat' } },
    { repeatCell: { range: { sheetId: id, startRowIndex: 2, endRowIndex: body.length + 2, startColumnIndex: HEAD.indexOf('차량번호'), endColumnIndex: HEAD.indexOf('차량번호') + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' } },
    ...lines.map((l, i) => (l.kind === '환수' ? { repeatCell: { range: { sheetId: id, startRowIndex: i + 2, endRowIndex: i + 3 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.99, green: 0.90, blue: 0.90 } } }, fields: 'userEnteredFormat.backgroundColor' } } : null)).filter(Boolean) as Record<string, unknown>[],
    ...lines.map((l, i) => (l.collected ? { repeatCell: { range: { sheetId: id, startRowIndex: i + 2, endRowIndex: i + 3 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.90, green: 0.96, blue: 0.90 } } }, fields: 'userEnteredFormat.backgroundColor' } } : null)).filter(Boolean) as Record<string, unknown>[],
    { repeatCell: { range: { sheetId: id, startRowIndex: body.length + 2, endRowIndex: body.length + 3 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.95, green: 0.95, blue: 0.90 }, textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
    { autoResizeDimensions: { dimensions: { sheetId: id, dimension: 'COLUMNS', startIndex: 0, endIndex: HEAD.length } } },
  ];
  const b = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}:batchUpdate`, { method: 'POST', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ requests: reqs }) });
  if (!b.ok) console.log(`      ⚠ 서식 ${b.status} ${(await b.text()).slice(0, 160)}`);
}

/**
 * ★★**한 번 «박힌» 달은 잠근다.**
 *   그 달에 `billMonth` 가 박힌 줄이 있으면 그 달은 사람이 이미 맞춰 놓은 달이다
 *   (2026-08 은 청구서까지 나갔고 우리캐피탈은 수금까지 끝났다).
 *   ⇒ 그 달 탭에는 **박힌 줄만** 세운다. 계산으로 뒤늦게 들어오는 줄이 확정된 달을 흔들면 안 된다.
 *   ⚠ 대신 그런 줄을 «버리지 않는다» — 「청구월미정」으로 보내 사람이 어느 달로 보낼지 정하게 한다.
 *     사장님 「과거 접수했던건들이 어딘가에 청구월에는 들어가있어야 하는거야」.
 */
const locked = new Set(rows.map((r) => S(r.billMonth)).filter(Boolean));
const monthFor = (r: Row): string => {
  const m = monthOf(r);
  if (!m) return '';
  if (S(r.billMonth)) return m;                 // 박힌 줄은 그대로
  return locked.has(m) ? '' : m;                // 잠긴 달로 «계산되어» 오는 줄은 미정으로
};
const bumped = rows.filter((r) => !S(r.billMonth) && monthOf(r) && locked.has(monthOf(r)));

// ── 달마다 찍는다 ─────────────────────────────────────────
const months = Array.from({ length: Math.max(1, AHEAD + 1) }, (_, k) => addM(FROM, k));
console.log(`\n■ 청구월 탭 ${months.length}달 — ${months.join(' · ')} ${APPLY ? '(반영)' : '(대조만)'}\n`);
let grand = 0;
for (const m of months) {
  const mine = rows.filter((r) => monthFor(r) === m);
  const lines = mine.map((r) => lineOf(r, m));
  for (const c of claws.filter((x) => S(x.month) === m)) {
    lines.push({ plate: S(c.plate), model: '', cust: '', sup: S(c.supplier) || '(미기재)', ch: S(c.channel) || '(미기재)', agent: '',
      product: '', term: 0, rent: 0, recv: '', deliv: S(c.at), supRate: 0, agRate: 0,
      claim: -Math.round(N(c.supplierAmt)), pay: -Math.round(N(c.agentAmt)), target: '양쪽', ratio: 1,
      why: `환수 — ${S(c.reason) || '사유 미기재'}`, billed: false, collected: false, kind: '환수' });
  }
  lines.sort((a, b) => (a.sup === b.sup ? a.plate.localeCompare(b.plate) : a.sup.localeCompare(b.sup)));
  const tc = lines.reduce((a, b) => a + b.claim, 0); const tp = lines.reduce((a, b) => a + b.pay, 0);
  grand += tc;
  console.log(`   ${tabOf(m).padEnd(9)} ${String(lines.length).padStart(3)}줄  청구 ${won(tc).padStart(12)} · 지급 ${won(tp).padStart(12)} · 이익 ${won(tc - tp).padStart(11)}${lines.length ? '' : '   (아직 없음 — 탭만 세워 둔다)'}`);
  await publish(tabOf(m), lines, `${tabOf(m)} 청구·지급 — 파이어베이스 원자에서 찍습니다. `
    + `청구월은 «적힌 값»이 이기고, 없으면 인도일에서 계산합니다(일시납=인도월 · 분납=인도월+(회차−1)개월). `
    + `⚠ 여기서 고쳐도 원자는 안 바뀝니다. 「청구」는 청구서가 나가는 줄, 「수금」은 이미 받은 줄입니다.`);
}

// ── 청구월이 안 정해진 줄 — 한 줄도 안 빠지게 ─────────────
const pending = rows.filter((r) => !monthFor(r));
const bumpedSet = new Set(bumped.map((r) => S(r.code)));
console.log(`\n   ${PENDING_TAB.padEnd(9)} ${String(pending.length).padStart(3)}줄  ★어느 달에도 못 선 줄 — 사람이 정해야 한다`);
console.log(`      ├ 잠긴 달로 «계산»된 줄        ${bumped.length}건  이미 확정된 달이라 못 넣는다. 어느 달로 보낼지 정할 것`);
console.log(`      └ 인도도 청구월도 «없는» 줄     ${pending.length - bumped.length}건  접수만 된 상태`);
for (const r of pending.slice(0, 12)) {
  const why = bumpedSet.has(S(r.code)) ? `계산상 ${monthOf(r)} — 그 달은 확정됨` : '인도·청구월 없음';
  console.log(`      ${S(r.plate).padEnd(11)} ${(S(r.supplier) || '(미기재)').padEnd(10)} 접수 ${(S(r.receivedAt) || '—').padEnd(11)} ${S(r.payKind).padEnd(6)} ${why}`);
}
if (pending.length > 12) console.log(`      … 외 ${pending.length - 12}건`);
await publish(PENDING_TAB, pending.map((r) => {
  const l = lineOf(r, '');
  // ★왜 여기 있는지를 «줄마다» 적는다. 사유를 모르면 사람이 어느 달로 보낼지 못 정한다.
  const why = bumpedSet.has(S(r.code)) ? `계산상 ${monthOf(r)} 인데 그 달은 이미 확정됨 — 어느 달로 보낼지 정하세요` : '인도도 청구월도 없음 — 접수만 된 상태';
  return { ...l, why: [l.why, why].filter(Boolean).join(' · ') };
}), '어느 달에도 «못 선» 줄입니다. ★접수 탭 「청구월」에 적으면 그 달 탭으로 옮겨 갑니다. '
  + '여기 있는 동안은 어느 달에도 청구되지 않습니다. '
  + '갈래 둘 — ① 계산상 «이미 확정된 달»로 떨어져 못 넣은 줄(그 달 청구서가 이미 나갔다) '
  + '② 인도도 청구월도 없는 줄(접수만 된 상태). 비고에 어느 쪽인지 적혀 있습니다.');

console.log(`\n   ${months.length}달 청구 합 ${won(grand)}`);
if (!APPLY) console.log('\n※ dry-run — 아무것도 안 썼다. --apply 로 찍는다.\n');
else console.log(`\n   ✓ 끝. https://docs.google.com/spreadsheets/d/${LEDGER}/edit\n`);
process.exit(0);
