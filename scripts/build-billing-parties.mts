/**
 * **「청구자·지급자」 한 장 — 그 달에 돈이 오가는 곳과, 우리가 «못 채운 칸»을 세운다.**
 * 기본 dry-run, 반영은 `--apply`. F02 「프리패스 거래처 정리」에 탭으로 붙는다.
 *
 * ★사장님 2026-09-07 「지수한테 **청구자 지급자 정리** 좀 해 보자」
 *
 * ★★**왜 필요한가 — 종이는 다 뽑았는데 «보낼 곳»을 모른다.**
 * ```
 * 2026-08 실측   청구서 13장 · 정산서 5장을 다 만들었다
 *                그런데 거래처 31곳 가운데 정산 담당자 메일이 적힌 곳은 «한 곳»뿐이다
 * ```
 *   주소를 지어낼 수는 없다 — 틀린 곳으로 나가면 남의 회사가 우리 거래 내역을 본다.
 *   ⇒ 「누가 얼마를 주고받는지」와 「무엇이 비었는지」를 한 장에 세워, 사람이 채우게 한다.
 *
 * ★★**청구자와 지급자를 «한 표»에 둔다.** 둘은 축이 반대라 시트는 갈라 두지만,
 *   빈칸을 채우는 일은 한 사람이 한 번에 한다. 표를 가르면 한쪽만 채우고 끝난다.
 *   ⚠ 이 탭은 **우리 안에서만 본다**(F02 는 회사 시트다). 그래서 두 축을 나란히 놔도 된다 —
 *     밖으로 나가는 공급사·채널 시트에는 여전히 서로의 축이 못 들어간다.
 *
 * ⚠ 지어내지 않는다. 비면 「(비었음)」이라 적는다 — 그게 채워 달라는 자리다.
 *
 * ```
 * npx tsx scripts/build-billing-parties.mts 2026-08
 * npx tsx scripts/build-billing-parties.mts 2026-08 --apply
 * ```
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { billingMonthIn, lockedMonthsOf, type SettlementRow } from '../lib/domain/settlement-stage';
import { claimOf, payOf } from '../lib/domain/settlement-money';
import { PARTNER_CI, ciOf } from '../lib/domain/partner-ci';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const D = (v: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(v)); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '2026-08').trim();
const APPLY = process.argv.includes('--apply');
const VAT = 0.1;
/** 이름 맞추기 — 「스타」와 「스타스카이」가 한곳으로 떨어지게. */
const key = (v: unknown) => S(v).toLowerCase().replace(/[\s()·\-_.㈜]/g, '')
  .replace(/(주식회사|렌터카|렌트카|모빌리티|무심사)/g, '');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const tok = async () => (await jwt.getAccessToken()).token;
const api = async (u: string, m?: string, b?: unknown) => {
  const r = await fetch(u, { method: m || 'GET', headers: { Authorization: `Bearer ${await tok()}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  if (!r.ok) { console.log(`\n  ✕ ${r.status} — ${(await r.text()).slice(0, 200)}\n`); process.exit(1); }
  return r.json() as Promise<Record<string, unknown>>;
};

// ── 그 달에 돈이 오가는 곳 ─────────────────────────────────
type Row = Record<string, unknown>;
const all = (Object.values((await db.ref('v4/settlement_rows').get()).val() || {}) as Row[]).filter((r) => r.cancelled !== true);
const asRow = (r: Row) => ({ ...r, receivedAt: D(r.receivedAt), deliveredAt: D(r.deliveredAt) } as unknown as SettlementRow);
const locked = lockedMonthsOf(all.map(asRow));
const rows = all.filter((r) => (S(r.billMonth) || billingMonthIn(asRow(r), locked)) === MONTH);
const claws = (Object.values((await db.ref('v4/settlement_clawbacks').get()).val() || {}) as Row[]).filter((c) => S(c.month) === MONTH);

/**
 * ★★**나간 종이와 «한 원까지» 같은 수를 적는다.**
 *   순액을 다 더한 뒤 부가세를 붙이면 줄마다 반올림한 종이와 몇십 원씩 어긋난다 —
 *   그 맞지 않는 숫자가 개입단 물음이 된다. ⇒ «줄마다» 세서 더한다(발행기와 같은 식).
 */
type Sum = { name: string; net: number; n: number };
const claim = new Map<string, Sum>(); const pay = new Map<string, Sum>();
const bump = (m: Map<string, Sum>, name: string, v: number, count: boolean) => {
  if (!name) return; const k = key(name);
  const cur = m.get(k) || { name, net: 0, n: 0 };
  m.set(k, { name: cur.name, net: cur.net + v, n: cur.n + (count && v ? 1 : 0) });
};
/** 그 줄의 합계(부가세 포함) — 적힌 값이 VAT 포함이면 또 붙이지 않는다. */
const grossOf = (raw: number, vatIncluded: boolean) => {
  if (!raw) return 0;
  if (vatIncluded) return raw;
  return raw + Math.round(raw * VAT);
};
for (const r of rows) {
  bump(claim, S(r.supplier), grossOf(claimOf(r), r.vatIncluded === true), true);
  bump(pay, S(r.channel), grossOf(payOf(r), r.vatIncluded === true), true);
}
for (const c of claws) {
  bump(claim, S(c.supplier), -grossOf(N(c.supplierAmt), false), false);
  bump(pay, S(c.channel), -grossOf(N(c.agentAmt), false), false);
}

// ── F02 가 아는 것 ────────────────────────────────────────
const files = ((await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("name contains '거래처 정리' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`)) as { files?: { id: string; name: string }[] }).files || [];
if (!files.length) { console.log('\n  ✕ F02 「거래처 정리」 시트를 못 찾았습니다\n'); process.exit(1); }
const F02 = files[0];
type Known = { staff: string; phone: string; mail: string; bizNo: string };
const known = new Map<string, Known>();
for (const t of ['공급사', '영업채널']) {
  const g = ((await api(`https://sheets.googleapis.com/v4/spreadsheets/${F02.id}/values/${encodeURIComponent(`'${t}'!A1:AZ300`)}`)) as { values?: unknown[][] }).values || [];
  const h0 = g.findIndex((r) => (r || []).some((c) => S(c) === '업체명')); if (h0 < 0) continue;
  const h = (g[h0] || []).map(S); const ix = (n: string) => h.indexOf(n);
  for (const r of g.slice(h0 + 1)) {
    const nm = S((r || [])[ix('업체명')]); if (!nm) continue;
    known.set(key(nm), { staff: S((r || [])[ix('실무자')]), phone: S((r || [])[ix('실무자 연락처')]),
      mail: S((r || [])[ix('이메일')]), bizNo: S((r || [])[ix('사업자번호')]) });
  }
}

// ── 표 짓기 ──────────────────────────────────────────────
const HEAD = ['구분', '업체명', '코드', `${MONTH} 금액(VAT 포함)`, '건', '담당자', '연락처', '이메일', '정산계좌', '사업자번호', '채워야 할 것'];
const WIDTH = [72, 170, 68, 140, 44, 92, 120, 220, 230, 120, 200];
const BLANK = '(비었음)';
type Line = (string | number)[];
const lineOf = (kind: '청구자' | '지급자', s: Sum): Line => {
  const ci = ciOf(s.name); const k = known.get(key(s.name)) || { staff: '', phone: '', mail: '', bizNo: '' };
  const mail = k.mail || S(ci?.mail);
  /** ★지급자에게만 «정산계좌»를 묻는다 — 청구자에게는 우리가 받으므로 그쪽 계좌가 필요 없다. */
  const acct = kind === '지급자' ? S(ci?.payAccount) : '해당 없음 (우리가 받는 쪽)';
  const need = [!mail && '이메일', kind === '지급자' && !acct && '정산계좌',
    !k.staff && '담당자', !(k.bizNo || S(ci?.bizNo)) && '사업자번호'].filter(Boolean).join(' · ');
  return [kind, S(ci?.legal) || s.name, S(ci?.code), Math.round(s.net), s.n,
    k.staff || BLANK, k.phone || BLANK, mail || BLANK, acct || BLANK,
    k.bizNo || S(ci?.bizNo) || BLANK, need || '✓ 다 있음'];
};
const sortBy = (m: Map<string, Sum>) => [...m.values()].filter((s) => s.net !== 0 || s.n).sort((a, b) => b.net - a.net);
const claimLines = sortBy(claim).map((s) => lineOf('청구자', s));
const payLines = sortBy(pay).map((s) => lineOf('지급자', s));

console.log(`\n■ ${MONTH} 청구자 ${claimLines.length}곳 · 지급자 ${payLines.length}곳 ${APPLY ? '(반영)' : '(대조만)'}\n`);
const show = (t: string, ls: Line[]) => {
  console.log(`  ── ${t}`);
  for (const l of ls) console.log(`     ${String(l[1]).padEnd(22)} ${won(N(l[3])).padStart(12)}  ${l[10]}`);
  const gap = ls.filter((l) => String(l[10]) !== '✓ 다 있음').length;
  console.log(`     → 채울 곳 ${gap} / ${ls.length}\n`);
};
show('청구자 — 우리가 받을 곳', claimLines);
show('지급자 — 우리가 줄 곳', payLines);

const TAB = `${MONTH.slice(2, 4)}년${MONTH.slice(5)}월 청구자·지급자`;
if (!APPLY) { console.log(`※ dry-run — 「${TAB}」 탭을 안 만들었습니다. --apply 로 붙입니다.\n`); process.exit(0); }

// ── 탭 붙이기 ────────────────────────────────────────────
const meta = (await api(`https://sheets.googleapis.com/v4/spreadsheets/${F02.id}?fields=sheets.properties(title,sheetId)`)) as { sheets?: { properties: { title: string; sheetId: number } }[] };
let id = (meta.sheets || []).find((s) => s.properties.title === TAB)?.properties.sheetId;
if (id === undefined) {
  const add = (await api(`https://sheets.googleapis.com/v4/spreadsheets/${F02.id}:batchUpdate`, 'POST',
    { requests: [{ addSheet: { properties: { title: TAB, index: (meta.sheets || []).length } } }] })) as { replies?: { addSheet?: { properties?: { sheetId?: number } } }[] };
  id = add.replies?.[0]?.addSheet?.properties?.sheetId;
}
const pad = (n: number) => Array.from({ length: n }, () => '');
const values: Line[] = [
  [`${MONTH.slice(0, 4)}년 ${Number(MONTH.slice(5))}월 — 청구자·지급자`, ...pad(HEAD.length - 1)],
  ['「채워야 할 것」에 적힌 칸을 채워 주시면 그 달 청구서·정산서가 바로 나갑니다. 이메일은 대표 메일이 아니라 «정산 담당자» 주소가 맞습니다.', ...pad(HEAD.length - 1)],
  HEAD,
  ...claimLines, ...payLines,
  pad(HEAD.length),
  ['합계', `청구 ${won(claimLines.reduce((a, l) => a + N(l[3]), 0))} · 지급 ${won(payLines.reduce((a, l) => a + N(l[3]), 0))}`, ...pad(HEAD.length - 2)],
];
const colName = (n: number) => { let s = ''; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
await api(`https://sheets.googleapis.com/v4/spreadsheets/${F02.id}/values/${encodeURIComponent(`'${TAB}'!A1:${colName(HEAD.length)}${values.length + 5}`)}?valueInputOption=RAW`, 'PUT',
  { values: [...values, ...Array.from({ length: 5 }, () => pad(HEAD.length))] });

const NAVY = { red: 0.106, green: 0.165, blue: 0.290 };
const all1 = (a: number, b: number) => ({ sheetId: id, startRowIndex: a, endRowIndex: b, startColumnIndex: 0, endColumnIndex: HEAD.length });
const last = 3 + claimLines.length + payLines.length;
await api(`https://sheets.googleapis.com/v4/spreadsheets/${F02.id}:batchUpdate`, 'POST', { requests: [
  { mergeCells: { range: all1(0, 1), mergeType: 'MERGE_ROWS' } },
  { mergeCells: { range: all1(1, 2), mergeType: 'MERGE_ROWS' } },
  { repeatCell: { range: all1(0, 1), cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 13, foregroundColor: { red: 1, green: 1, blue: 1 } }, verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment)' } },
  { repeatCell: { range: all1(1, 2), cell: { userEnteredFormat: { textFormat: { fontSize: 10 }, horizontalAlignment: 'LEFT' } }, fields: 'userEnteredFormat(textFormat,horizontalAlignment)' } },
  { repeatCell: { range: all1(2, 3), cell: { userEnteredFormat: { backgroundColor: NAVY, textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } }, horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)' } },
  { repeatCell: { range: { sheetId: id, startRowIndex: 3, endRowIndex: last, startColumnIndex: 3, endColumnIndex: 5 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0' }, horizontalAlignment: 'RIGHT' } }, fields: 'userEnteredFormat(numberFormat,horizontalAlignment)' } },
  { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 38 }, fields: 'pixelSize' } },
  ...WIDTH.map((w, c) => ({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, properties: { pixelSize: w }, fields: 'pixelSize' } })),
  { updateSheetProperties: { properties: { sheetId: id, gridProperties: { frozenRowCount: 3 } }, fields: 'gridProperties.frozenRowCount' } },
  { repeatCell: { range: { sheetId: id }, cell: { userEnteredFormat: { textFormat: { fontFamily: 'Roboto' } } }, fields: 'userEnteredFormat.textFormat.fontFamily' } },
] });
console.log(`  ✓ 「${F02.name}」 에 「${TAB}」 탭을 붙였습니다.`);
console.log(`     https://docs.google.com/spreadsheets/d/${F02.id}\n`);
process.exit(0);
