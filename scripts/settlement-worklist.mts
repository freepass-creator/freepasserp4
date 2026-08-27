/**
 * **지금 원장 기준으로 «할 일»을 뽑는다.** 읽기만 한다 — 아무것도 안 고친다.
 *
 * ★사장님 2026-08-26 「지금 시트 현재 기준으로 처리해보자고」.
 *   화면이 아니라 목록이 필요할 때 쓴다 — 한 번에 훑고, 무엇을 누가 해야 하는지까지 적는다.
 *
 * ★★**「기계가 할 것」과 「사람이 정할 것」을 가른다.**
 *   섞어 놓으면 사람이 기계 몫까지 들여다보게 되고, 그러면 정작 정할 것을 못 정한다.
 *
 *   npx tsx scripts/settlement-worklist.mts
 *   npx tsx scripts/settlement-worklist.mts 2026-08     그 달 청구까지 같이 본다
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { normalizeRecord, type SettlementRecord } from '../lib/domain/settlement-record';
import { billingMonth, moneyOf, paidRoundsOf, roundsOf, type SettlementRow } from '../lib/domain/settlement-stage';
import { alertsOf, countAlerts, levelOf, type Alert } from '../lib/domain/settlement-alert';

const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '').trim();
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const ON = (v: unknown) => /^(TRUE|참|Y|예|1)$/i.test(S(v));
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const SERIAL0 = Date.UTC(1899, 11, 30);
const toDate = (v: unknown): Date | null => {
  const t = S(v);
  if (!t) return null;
  const n = Number(t);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const u = new Date(SERIAL0 + Math.round(n) * 86_400_000);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  const x = new Date(t);
  return Number.isNaN(+x) ? null : x;
};
const p2 = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date | null) => (d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : '');

/**
 * ★★**정본은 ERP 다**(2026-08-26 이관). 시트를 읽지 않는다 —
 *   시트만 고치면 할 일이 안 뜨고, ERP 만 고치면 시트 기준 목록이 거짓이 된다.
 *   ⚠ 되돌릴 일이 생기면 `settlement-store.ts` 의 `STORE` 를 보고 여기도 같이 맞춘다.
 */
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) {
  initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
}

type Rec = { row: SettlementRow; tab: string; channel: string };
const recs: Rec[] = Object.values((await getDatabase().ref('v4/settlement_rows').get()).val() || {})
  .map((raw) => normalizeRecord(raw as SettlementRecord))
  .map((r) => ({
    tab: '', channel: S(r.channel),
    row: {
      ...r,
      receivedAt: toDate(r.receivedAt), deliveredAt: toDate(r.deliveredAt), clawbackAt: toDate(r.clawbackAt),
    } as unknown as SettlementRow,
  }));

/**
 * ★★★**지난 것과 지금 할 일을 가른다.**
 *
 * ★사장님 2026-08-27 「과거거는 다 처리는 된거라 인지만 하고 있어」.
 *   원장에는 옛 흔적이 남아 있지만 실제로는 이미 정리된 건이다.
 *   ⚠ 안 가르면 매일 70여 건이 뜨고, 그 속에 «오늘 생긴» 한 건이 묻힌다.
 *     목록이 길면 사람은 목록을 안 본다 — 그게 목록이 죽는 방식이다.
 *
 * 가르는 자리 — **청구가 이미 나간 달인가.**
 * ```
 * 청구월이 이번 달보다 «이전»   지난 것 — 세기만 한다
 * 청구월이 이번 달 이후          할 일
 * 청구월이 «아직 없다»           할 일 — 인도가 안 됐다는 뜻이라 지금도 살아 있다
 * ```
 * ⚠ 지난 것도 «안 보여주는» 건 아니다. 몇 건인지는 늘 말한다 — 없던 일로 만들면 안 된다.
 *   전부 보려면 `--all`.
 */
const ALL = process.argv.includes('--all');
const THIS_MONTH = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
const isPast = (r: SettlementRow) => {
  const m = billingMonth(r);
  return !!m && m < THIS_MONTH;
};

const ctx = { issued: new Set<string>() };
const withAlerts = recs.map((x) => ({ ...x, alerts: alertsOf(x.row, ctx) })).filter((x) => x.alerts.length);

console.log(`\n${'═'.repeat(74)}`);
console.log(`  지금 원장 기준 — ${recs.length}줄 중 ${ALL ? `손이 필요한 ${withAlerts.length}건 (지난 것 포함)` : `★지금 손댈 것 ${withAlerts.filter((x) => !isPast(x.row)).length}건`}`);
console.log('═'.repeat(74));

// ★세는 것도 «지금 할 일»만 — 머리 숫자와 아래 목록이 갈리면 사람이 뭘 믿을지 모른다.
const nowOnly = withAlerts.filter((x) => ALL || !isPast(x.row));
for (const c of countAlerts(nowOnly.map((x) => x.alerts))) {
  console.log(`   ${c.level === '급함' ? '⛔' : '·'} ${String(c.n).padStart(4)}건  ${c.kind}`);
}

/** 한 갈래를 펴서 보여 준다. **무엇을 해야 하는지**까지 적는다. */
const show = (kind: Alert['kind'], title: string, todo: string) => {
  // ★지난 것은 접는다 — 이미 처리된 건이라 여기 뜨면 «오늘 생긴» 건이 묻힌다.
  const list = withAlerts.filter((x) => x.alerts.some((a) => a.kind === kind) && (ALL || !isPast(x.row)));
  const past = pastBy.get(kind) || 0;
  if (!list.length) {
    if (past && !ALL) console.log(`
· ${title} — 지난 것 ${past}건 (이미 처리됨 · 인지만)`);
    return;
  }
  console.log(`
■ ${title} — ${list.length}건${past && !ALL ? ` (그 밖에 지난 것 ${past}건은 접었다)` : ''}`);
  console.log(`   할 일: ${todo}`);
  for (const x of list.slice(0, 30)) {
    const r = x.row;
    const extra = kind === '분납임박' || kind === '분납부러짐'
      ? `${paidRoundsOf(r)}/${roundsOf(r.payKind)}회`
      : `청구 ${won(moneyOf(r).claim)}`;
    console.log(`      ${r.plate.padEnd(11)} ${(r.supplier || '(공급사 미기재)').padEnd(11)} ${(r.agent || '').padEnd(7)} 접수 ${iso(r.receivedAt) || '—'} 인도 ${iso(r.deliveredAt) || '—'}  ${extra}`);
  }
  if (list.length > 30) console.log(`      … 외 ${list.length - 30}건`);
};

/** 지난 것이 몇 건인지 — 갈래별로 세어 둔다. */
const pastBy = new Map<string, number>();
for (const x of withAlerts) {
  if (!isPast(x.row)) continue;
  for (const a of x.alerts) pastBy.set(a.kind, (pastBy.get(a.kind) || 0) + 1);
}

console.log('\n\n──────── 사람이 «정해야» 하는 것 ────────');
// ★날짜부터 본다 — 다른 판정이 다 날짜 위에 선다.
show('날짜뒤집힘', '인도일이 접수일보다 빠르다', '둘 중 하나가 오타다. 그대로 두면 틀린 달로 청구된다');
show('인도가미래', '인도일이 아직 오지 않은 날이다', '날짜를 고치거나 인도완료를 끈다');
show('취소인데인도', '취소인데 인도까지 갔다', '환수를 켜고 금액·날짜를 넣거나, 인도일이 잘못 들어갔는지 본다');
show('청구액없음', '청구액이 안 잡힌다', '요율표를 확인한다. 이대로 두면 이 건은 그냥 안 청구된다');
show('환수미완', '환수인데 날짜나 금액이 없다', '환수일을 넣는다 — 없으면 어느 달에서 뺄지 못 정한다');
show('인도지연', '접수만 하고 오래 인도가 없다', '살아 있는 건인지 확인한다. 아니면 취소로 닫는다');
show('서류없이인도', '계약서 없이 인도됐다', '계약서를 받았는지 보고 체크한다');

console.log('\n\n──────── 이 달 안에 «해야» 하는 것 ────────');
show('청구지연', '청구월이 지났는데 청구서가 안 나갔다', '지금 발행한다. 안 하면 그대로 묻힌다');
show('청구누락', '이 달 청구서가 아직 안 나갔다', '영업자 확인을 받고 발행한다');
show('분납부러짐', '분납이 멈췄다', '환수 금액을 정해 처리한다');
show('분납임박', '다음 회차가 곧이다', '들어오는지 본다. 안 들어오면 납입회차를 박아 멈춰 세운다');

if (MONTH) {
  const fixed = recs.filter((x) => !x.row.cancelled && billingMonth(x.row) === MONTH);
  const byParty = new Map<string, { n: number; claim: number }>();
  for (const x of fixed) {
    const k = x.row.supplier || '(공급사 미기재)';
    const c = byParty.get(k) || { n: 0, claim: 0 };
    c.n += 1; c.claim += moneyOf(x.row).claim;
    byParty.set(k, c);
  }
  const tot = fixed.reduce((s, x) => s + moneyOf(x.row).claim, 0);
  console.log(`\n\n──────── ${MONTH} 청구 대상 ────────`);
  console.log(`   ${fixed.length}건 · ${won(tot)}`);
  for (const [k, v] of [...byParty].sort((a, b) => b[1].claim - a[1].claim)) {
    console.log(`      ${String(v.n).padStart(3)}건  ${won(v.claim).padStart(12)}  ${k}`);
  }
}

const urgent = withAlerts.filter((x) => levelOf(x.alerts) === '급함').length;
console.log(`\n${urgent ? `⛔ 급한 것 ${urgent}건 — 돈이 걸려 있다.` : '■ 급한 것 없음.'}\n`);
