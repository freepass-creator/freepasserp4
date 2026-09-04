/**
 * **종이 ↔ 시트 ↔ 원자가 «같은 숫자»인지 맞대 본다.**
 *
 * ★사장님 2026-09-04 「각 렌트사 영업자 시트에 맞게 들어갔는지와 청구서 잘 만들어 졌는지」.
 *
 * ★★**세 곳에 같은 돈이 적힌다.** 하나라도 어긋나면 상대가 그 자리에서 묻는다 —
 * ```
 * 원자   v4/settlement_rows          정본. 여기서 다 나온다
 * 종이   tmp/정산서-YYYY-MM/*.html   상대에게 «보내는» 것
 * 시트   각 공급사·채널 시트의 달 탭    상대가 «열어 보는» 것
 * ```
 *   ⇒ 셋이 한 원까지 같아야 「맞게 들어갔다」고 말할 수 있다. 눈으로 세지 않는다.
 *
 *   npx tsx scripts/check-settlement-sync.mts 2026-08
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { billingMonthIn, lockedMonthsOf, settleTargetOf, type SettlementRow } from '../lib/domain/settlement-stage';
import { SUPPLIER_ALIAS } from '../lib/domain/settlement-fee-table';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const D = (v: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(v)); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
const VAT = 0.1;
const MONTH = S(process.argv.find((a) => /^\d{4}-\d{2}$/.test(a))) || '2026-08';
/** 이름 맞추기 — 「스타」와 「스타스카이」가 한곳으로 떨어지게. */
const key = (v: unknown) => S(v).toLowerCase().replace(/[\s()·\-_.]/g, '').replace(/(주식회사|㈜|렌터카|렌트카|무심사|모빌리티)/g, '');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com',
  scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'] });
const tok = async () => (await jwt.getAccessToken()).token;

// ── ① 원자 ────────────────────────────────────────────────
type Row = Record<string, unknown>;
const all = (Object.values((await db.ref('v4/settlement_rows').get()).val() || {}) as Row[]).filter((r) => r.cancelled !== true);
const asRow = (r: Row) => ({ ...r, receivedAt: D(r.receivedAt), deliveredAt: D(r.deliveredAt) } as unknown as SettlementRow);
const locked = lockedMonthsOf(all.map(asRow));
const rows = all.filter((r) => billingMonthIn(asRow(r), locked) === MONTH);
const claws = (Object.values((await db.ref('v4/settlement_clawbacks').get()).val() || {}) as Row[]).filter((c) => S(c.month) === MONTH);

const atomClaim = new Map<string, number>(); const atomPay = new Map<string, number>();
const add = (m: Map<string, number>, k: string, v: number) => { if (k) m.set(k, (m.get(k) || 0) + v); };
for (const r of rows) {
  const t = settleTargetOf(r.settleTarget); const ratio = N(r.settleRatio) || 1;
  const hold = r.billHold === true; const ex = r.settleExclude === true; const gross = r.vatIncluded === true;
  const cr = ex || t === '영업' || hold ? 0 : Math.round(N(r.claimWritten) * ratio);
  const pr = ex || t === '공급' ? 0 : Math.round(N(r.payWritten) * ratio);
  const c = gross ? Math.round(cr / (1 + VAT)) : cr; const p = gross ? Math.round(pr / (1 + VAT)) : pr;
  add(atomClaim, S(r.supplier), c + (gross ? cr - c : Math.round(c * VAT)));
  add(atomPay, S(r.channel), p + (gross ? pr - p : Math.round(p * VAT)));
}
for (const c of claws) {
  const s = N(c.supplierAmt); const a = N(c.agentAmt);
  add(atomClaim, S(c.supplier), -(s + Math.round(s * VAT)));
  add(atomPay, S(c.channel), -(a + Math.round(a * VAT)));
}

// ── ② 종이 ────────────────────────────────────────────────
/** 종이의 «지급 금액/청구 금액» = 요약표 마지막 줄의 셋째 칸. */
const paper = new Map<string, number>();
const DIR = `tmp/정산서-${MONTH}`;
if (existsSync(DIR)) {
  for (const f of readdirSync(DIR).filter((x) => x.endsWith('.html'))) {
    const who = f.replace(`${MONTH} `, '').replace(/ 영업수수료.*/, '');
    const h = readFileSync(`${DIR}/${f}`, 'utf8');
    /**
     * ★**요약표의 `td.k` 가 «청구/지급 금액»이다.**
     *   마지막 td 를 집으면 부가세 칸을 집는다 — 합계는 <b> 로 감싸여 있고
     *   상세표·요약표가 칸 차례가 달라 자리로 세면 틀린다(실측 2026-09-04 전부 1/11 로 나왔다).
     */
    const k = /<td class="k">([0-9,\-]+)<\/td>/.exec(h);
    if (k) paper.set(key(who), N(k[1]));
  }
}

// ── ③ 시트 ────────────────────────────────────────────────
const H = { Authorization: `Bearer ${await tok()}` };
const drive = async (q: string) => (((await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=80&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: H })).json()) as { files?: { id: string; name: string }[] }).files) || [];
const TAB = `${MONTH.slice(2, 4)}년${MONTH.slice(5)}월 정산`;
const sheet = new Map<string, number>();
for (const q of ["name contains '프리패스 재고'", "name contains '프리패스 정산'"]) {
  for (const f of await drive(`${q} and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`)) {
    if (/구버전|폐기|백업/.test(f.name)) continue;
    const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}?fields=sheets.properties.title`, { headers: { Authorization: `Bearer ${await tok()}` } })).json() as { sheets?: { properties: { title: string } }[] };
    for (const t of (meta.sheets || []).map((s) => s.properties.title).filter((t) => t.startsWith(TAB))) {
      const who = t.includes(' · ') ? t.split(' · ')[1] : f.name.replace(/^\[[^\]]*\]\s*/, '').replace(/\s*프리패스 (재고|정산).*$/, '');
      const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${f.id}/values/${encodeURIComponent(`'${t}'!A1:Q80`)}`, { headers: { Authorization: `Bearer ${await tok()}` } });
      const g = (((await r.json()) as { values?: unknown[][] }).values) || [];
      const sum = g.find((v) => S((v || [])[1]) === '합계');
      if (!sum) continue;
      const nums = (sum as unknown[]).map(N).filter((x) => x !== 0);
      if (nums.length) sheet.set(key(who), nums[nums.length - 1]);
    }
  }
}

// ── ④ 맞대 보기 ───────────────────────────────────────────
/**
 * ★**이름이 세 곳에서 다 다르다** — 원자 「스타스카이」 · 종이 「스타스카이」 · 시트 「스타」.
 *   별칭표를 먼저 보고, 안 되면 «앞글»로 맞춘다. 이름 때문에 「없음」이 뜨면 거짓 경보다.
 */
/** 종이·시트가 달리 부르는 이름 — 별칭표에 없는 것만 적는다. */
const SAME: Record<string, string> = { smc: '에스엠씨', 에스엠씨: 'smc' };
const look = (m: Map<string, number>, name: string): number | undefined => {
  const k0 = key(name);
  if (m.has(k0)) return m.get(k0);
  /**
   * ★★**앞글 맞춤이 별칭보다 먼저다.**
   *   「엘씨렌트」는 별칭표에서 「빌린카」로 가는데, 종이에는 「엘씨」가 따로 있다.
   *   별칭을 먼저 보면 «남의 종이»를 집어 726,000 을 816,750 과 맞대게 된다(실측).
   *   별칭은 «제 이름으로 아무 것도 못 찾을 때» 마지막으로 본다.
   */
  for (const [k, v] of m) if (k && (k.startsWith(k0) || k0.startsWith(k))) return v;
  const same = SAME[k0];
  if (same && m.has(key(same))) return m.get(key(same));
  const al = SUPPLIER_ALIAS[name];
  if (al && m.has(key(al))) return m.get(key(al));
  return undefined;
};

const show = (title: string, atoms: Map<string, number>) => {
  console.log(`\n■ ${title}`);
  const names = [...new Set([...atoms.keys()])].filter((n) => atoms.get(n));
  let bad = 0;
  for (const n of names.sort()) {
    const a = atoms.get(n) || 0; const p = look(paper, n); const s = look(sheet, n);
    const okP = p === undefined ? null : Math.abs(p - a) <= 1;
    const okS = s === undefined ? null : Math.abs(s - a) <= 1;
    if (okP === false || okS === false) bad++;
    const mark = okP === false || okS === false ? '✕' : (p === undefined || s === undefined ? '~' : 'o');
    console.log(`  ${mark} ${n.padEnd(11)} 원자 ${won(a).padStart(12)}   종이 ${(p === undefined ? '없음' : won(p)).padStart(12)}   시트 ${(s === undefined ? '없음' : won(s)).padStart(12)}`);
  }
  return bad;
};
console.log(`\n■ ${MONTH} — 종이 ${paper.size}장 · 시트 탭 ${sheet.size}개`);
const b1 = show('공급사 — 받을 것', atomClaim);
const b2 = show('영업채널 — 줄 것', atomPay);
console.log(b1 + b2 ? `\n  ✕ 어긋난 곳 ${b1 + b2}곳 — 「~」는 한쪽이 아직 없는 것입니다.\n`
  : '\n  ✓ 원자·종이·시트가 한 원까지 같습니다.\n');
process.exit(0);
