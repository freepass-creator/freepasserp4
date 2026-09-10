/**
 * **SSOT 대조 — 정산원장(F04) ↔ 원자(Firestore) 를 «달마다» 맞댄다.** 읽기만 한다.
 *
 * ★★★사장님 2026-09-10 「**ssot 명확하게 해서 정산할 수 있어야 해**」
 *
 * ── 왜 흐렸나
 * `check:chain` 은 «이번 달 한 달»만 본다. 그래서 지난 달이 갈려 있어도 아무도 모른다.
 * 게다가 원장과 원자는 **양방향**이었다 —
 * ```
 *   사람이 원장에 적는다 ──▶ atomize-settlement-month ──▶ 원자
 *   원자 ──▶ run-settlement-sheet ──▶ 원장 탭 넷을 «다시 세운다»
 * ```
 * 한쪽만 돌면 다른 쪽이 뒤처진다. 실측 2026-09-10: 원장에 청구월이 박혔는데 원자가 빈 줄이 셋 있었다.
 *
 * ── 이 검사가 하는 일
 * 달마다 **줄 수 · 청구 · 지급**을 맞대고, 갈린 달과 «그 줄»을 이름으로 찍는다.
 * ★숫자만 보면 어느 차인지 모른다 — 고치려면 차번이 나와야 한다.
 *
 * ```
 * npm run check:ssot
 * npx tsx scripts/check-settlement-ssot.mts 2026-08     그 달만
 * ```
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { SETTLEMENT_LEDGER_ID as LEDGER, SETTLEMENT_INTAKE_TAB, SETTLEMENT_WATCH_TAB, SETTLEMENT_DONE_TAB } from '../lib/domain/settlement-ledger';
/** ★돈은 «엔진 문»으로만 센다 — 여기서 손으로 다시 셈하면 그 순간 정본이 둘이 된다. */
import { claimOf, payOf, type SettlementRow } from '../lib/domain/settlement/engine';
/** ★원자가 시작하는 달 — 그 앞은 «시트가 기록»이라 원자에 없는 게 정상이다. */
import { ATOM_FROM_MONTH, isAtomMonth } from '../lib/domain/settlement-atom';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => Number(S(v).replace(/[,\s원]/g, '')) || 0;
const W = (n: number) => Math.round(n).toLocaleString('ko-KR');
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const ONLY = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '';
/**
 * ★`--전부` — 원자 경계 앞(2026-07 이전)까지 «다» 맞댄다.
 *   사장님 2026-09-10 「ssot 만들어 보자, 기존 시트에 있는 거라 과거 시트랑 해서」 —
 *   지난 달을 원자로 가져오려면 «무엇이 얼마나 빠졌는지»부터 세야 한다.
 *   ⚠ 평소 검사(경계 뒤만)와 섞지 않는다. 이건 «옮기려고 세는» 자리다.
 */
const ALL = process.argv.includes('--전부');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const fsdb = getFirestore();
const jwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const tok = async () => (await jwt.getAccessToken()).token;
const readTab = async (tab: string): Promise<string[][]> => {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`'${tab}'!A1:BZ900`)}?valueRenderOption=UNFORMATTED_VALUE`,
    { headers: { Authorization: `Bearer ${await tok()}` } });
  if (!r.ok) { console.log(`\n  ✕ 「${tab}」 를 못 읽었습니다 ${r.status}\n`); process.exit(1); }
  return (((await r.json()) as { values?: unknown[][] }).values || []).map((v) => (v || []).map(S));
};

/* ── ① 원장 ───────────────────────────────────────────────────── */
type L = { month: string; plate: string; cust: string; sup: string; claim: number; pay: number; tab: string; claw: boolean };
const led: L[] = [];
for (const t of [SETTLEMENT_INTAKE_TAB, SETTLEMENT_DONE_TAB, SETTLEMENT_WATCH_TAB]) {
  const g = await readTab(t);
  const hi = g.findIndex((x) => x.includes('차량번호'));
  if (hi < 0) continue;
  const H = g[hi];
  const c = (...names: string[]) => { for (const n of names) { const i = H.indexOf(n); if (i >= 0) return i; } return -1; };
  const iy = c('청구년'); const im = c('청구월');
  /** ★「수식X」가 이긴다 — 손으로 적은 값이 정본이다(2026-09-01 사고). */
  const iY = c('판매 수수료', '판매수수료'); const iZ = c('판매 수수료 (수식X)');
  const iAL = c('출고수수료'); const iAM = c('출고 수수료 (수식X)');
  const iCI = c('공급사인센티브'); const iAI = c('에이전시인센티브');
  const iCan = c('취소'); const iPl = c('차량번호'); const iCu = c('고객명'); const iSup = c('업체명', '공급사');
  /**
   * ★★**환수는 원장이 «칸으로» 말한다** — 「환수」 체크. 짐작하지 않는다.
   *   ⚠ 앞서 나는 `settlement_clawbacks` 에 같은 «달|차번»이 있으면 그 차의 원장행을 «전부» 뺐다.
   *     Codex 적대검증(2026-09-10)이 반례를 재현했다:
   *       PLATE_ONLY_FILTER before=2 classifiedClaw=2 kept=0  ← expected 1·1
   *     같은 달·같은 차에 «정상행과 환수행»이 각각 있으면 둘 다 사라진다.
   *     그러면 「일치」가 떠도 그건 환수 금액이 맞다는 뜻이 아니다 — **거짓 합격**이다.
   *   ⇒ 원장의 「환수」 칸으로 가른다. 원장이 적어 둔 것을 읽지, 다른 데서 짐작하지 않는다.
   */
  const iClaw = c('환수');
  for (const r of g.slice(hi + 1)) {
    if (/^(TRUE|true|O|o|Y|y|1|취소)$/.test(S(r[iCan]))) continue;
    const y = N(r[iy]); const m = N(r[im]);
    if (!y || !m) continue;
    led.push({
      month: `${y}-${String(m).padStart(2, '0')}`, tab: t,
      plate: S(r[iPl]) || '(차번없음)', cust: S(r[iCu]), sup: S(r[iSup]),
      claim: (iZ >= 0 && S(r[iZ]) ? N(r[iZ]) : N(r[iY])) + (iCI >= 0 ? N(r[iCI]) : 0),
      pay: (iAM >= 0 && S(r[iAM]) ? N(r[iAM]) : N(r[iAL])) + (iAI >= 0 ? N(r[iAI]) : 0),
      claw: iClaw >= 0 && /^(TRUE|true|O|o|Y|y|1)$/.test(S(r[iClaw])),
    });
  }
}

/* ── ② 원자 ───────────────────────────────────────────────────── */
const atoms = (await fsdb.collection('settlement_rows').get()).docs.map((d) => d.data() as Record<string, unknown>)
  .filter((r) => r.cancelled !== true && S(r.billMonth));

/**
 * ★★★**환수는 «별도 컬렉션»에 산다** — `settlement_clawbacks` (원자 규격 머리글: 「두 곳에 두면 갈린다」).
 *
 *   그래서 **원장 한 줄이 원자에서 두 곳으로 갈린다** —
 *   보통 줄은 `settlement_rows`, 환수 줄은 `settlement_clawbacks`.
 *
 * ⚠ 여기를 안 보면 환수 줄이 통째로 «원자에 없는 것»으로 보인다.
 *   실측 2026-09-10: 지난 달 「빠진 줄」 21개가 **21개 다 환수였다.** 하나도 빠진 게 아니었다.
 *   ★거짓 경보가 한 번 뜨면 그 검사는 그날로 안 믿게 된다 — 오늘만 이 병이 두 번째다.
 */
const claws = (await fsdb.collection('settlement_clawbacks').get()).docs.map((d) => d.data() as Record<string, unknown>);
/**
 * ⚠ 「달|차번이 clawbacks 에 있으면 환수」로 가르던 도우미는 걷어냈다 —
 *   같은 달·같은 차의 «정상행»까지 같이 빼 버렸다(Codex 반례 PLATE_ONLY_FILTER).
 *   환수 여부는 원장의 「환수」 칸이 말한다.
 */

/* ── ③ 달마다 맞댄다 ──────────────────────────────────────────── */
const 달 = [...new Set([...led.map((r) => r.month), ...atoms.map((r) => S(r.billMonth))])]
  .filter((m) => !ONLY || m === ONLY).sort();

console.log(`\n■ SSOT 대조 — 정산원장(F04) ↔ 원자  ·  원자 구간은 ${ATOM_FROM_MONTH} 부터\n`);
console.log(`   ${pad('달', 9)} ${'원장'.padStart(4)} ${'원자'.padStart(4)}   ${pad('원장 청구', 13)} ${pad('원자 청구', 13)}   ${pad('원장 지급', 13)} ${pad('원자 지급', 13)}`);

const 사고: string[] = [];
const 참고: string[] = [];
for (const m of 달) {
  const L전 = led.filter((r) => r.month === m);
  /**
   * ★환수로 담긴 줄은 원장 쪽에서도 뺀다 — 그래야 «rows ↔ rows» 끼리 견준다.
   *   환수는 아래에 따로 몇 건인지 찍는다. 섞어 세면 어느 쪽이 틀렸는지 못 가린다.
   */
  const L환 = L전.filter((r) => r.claw);
  const L2 = L전.filter((r) => !r.claw);
  const A2 = atoms.filter((r) => S(r.billMonth) === m);

  /**
   * ★★★**정산 비율은 원자에서만 곱해진다** — Codex 적대검증 2026-09-10 이 재현했다.
   *
   *   원장 「계약번호(메모)」 칸에 「50%」 같은 말이 적히면 원자화가 그것을 축으로 옮기고
   *   (`settleTarget`·`settleRatio`), `claimOf`/`payOf` 가 그 비율을 곱한다.
   *   ⇒ **원장은 «원문», 원자는 «규칙 적용본»이다.** 그냥 견주면 비율 걸린 줄마다 갈린다.
   *   실측: 161허1384 원장 1,372,800 → 원자 686,400 (0.5)
   *        161허1169 청구 원문이 0 이라 «청구는 0 차이인데 지급만» 464,400 갈렸다
   *        — 내가 못 풀던 그 비대칭의 정답이다.
   *
   * ⇒ 원장 값에 «그 줄의 원자가 쓴 비율»을 곱해 견준다. 그래야 «규칙 적용 후»끼리 견주게 된다.
   * ⚠ 짝을 못 지으면 비율을 1 로 둔다 — 모르는 것을 0.5 로 짐작하면 갈린 것을 덮어 버린다.
   */
  const 비율표 = new Map<string, number[]>();
  for (const a of A2) {
    const k = `${S(a.plate).replace(/\s/g, '')}|${S(a.customer)}`;
    const r = Number(a.settleRatio);
    (비율표.get(k) || 비율표.set(k, []).get(k)!).push(r > 0 ? r : 1);
  }
  const 쓴비율 = new Map<string, number>();
  const 비율of = (r: { plate: string; cust: string }) => {
    const k = `${r.plate.replace(/\s/g, '')}|${r.cust}`;
    const arr = 비율표.get(k);
    if (!arr || !arr.length) return 1;
    const i = 쓴비율.get(k) || 0;
    쓴비율.set(k, i + 1);
    return arr[Math.min(i, arr.length - 1)];
  };
  const 비율걸림: string[] = [];
  const LC = L2.reduce((a, r) => { const v = 비율of(r); if (v !== 1) 비율걸림.push(`${r.plate} ×${v}`); return a + r.claim * v; }, 0);
  쓴비율.clear();
  const LP = L2.reduce((a, r) => a + r.pay * 비율of(r), 0);
  const AC = A2.reduce((a, r) => a + claimOf(r as unknown as SettlementRow), 0);
  const AP = A2.reduce((a, r) => a + payOf(r as unknown as SettlementRow), 0);

  /**
   * ★★**원자 구간 앞은 재지 않는다** — 「2026-08 부터가 원자, 그 앞은 시트가 기록」이 정한 것이다.
   *   여기서 사고로 부르면 매번 30건 넘게 뜨고, 그러면 아무도 이 검사를 안 믿는다.
   */
  if (!ALL && !isAtomMonth(m)) {
    console.log(`   ${pad(m, 9)} ${String(L2.length).padStart(4)} ${String(A2.length).padStart(4)}   ${W(LC).padStart(13)} ${W(AC).padStart(13)}   ${W(LP).padStart(13)} ${W(AP).padStart(13)}  · 시트가 기록`);
    continue;
  }

  const 줄갈림 = L2.length !== A2.length;
  /** ⚠ 지급 축에는 다리가 없다 — 갈리면 사고다. */
  const 지급갈림 = Math.abs(LP - AP) > 1;
  const 청구갈림 = Math.abs(LC - AC) > 1;
  const 표 = 줄갈림 || 지급갈림 ? ' ✕' : 청구갈림 ? ' △' : ' ✓';
  const 환 = `${L환.length ? `  환수 ${L환.length}` : ''}${비율걸림.length ? `  비율 ${비율걸림.length}` : ''}`;
  console.log(`   ${pad(m, 9)} ${String(L2.length).padStart(4)} ${String(A2.length).padStart(4)}   ${W(LC).padStart(13)} ${W(AC).padStart(13)}   ${W(LP).padStart(13)} ${W(AP).padStart(13)}${표}${환}`);

  if (지급갈림) 사고.push(`${m}  지급이 갈립니다 — 원장 ${W(LP)} · 원자 ${W(AP)}  (지급 축엔 다리가 없습니다)`);

  /**
   * ★★**환수는 «금액까지» 맞댄다** — 건수만 세면 금액이 틀려도 통과한다.
   *   원장 판매수수료 → `supplierAmt` · 출고수수료 → `agentAmt` 로 옮긴다
   *   (atomize-settlement-month.mts:305). 소비처도 같은 축으로 차감하므로 뜻은 같다.
   */
  const C2 = claws.filter((c) => S(c.month) === m);
  const 원장환수공급 = L환.reduce((a, r) => a + r.claim, 0);
  const 원장환수영업 = L환.reduce((a, r) => a + r.pay, 0);
  const 원자환수공급 = C2.reduce((a, c) => a + (Number(c.supplierAmt) || 0), 0);
  const 원자환수영업 = C2.reduce((a, c) => a + (Number(c.agentAmt) || 0), 0);
  if (L환.length !== C2.length) 사고.push(`${m}  환수 건수가 갈립니다 — 원장 ${L환.length}건 · 원자 ${C2.length}건`);
  if (Math.abs(원장환수공급 - 원자환수공급) > 1) 사고.push(`${m}  환수 공급사 몫이 갈립니다 — 원장 ${W(원장환수공급)} · 원자 ${W(원자환수공급)}`);
  if (Math.abs(원장환수영업 - 원자환수영업) > 1) 사고.push(`${m}  환수 영업자 몫이 갈립니다 — 원장 ${W(원장환수영업)} · 원자 ${W(원자환수영업)}`);
  if (청구갈림) 참고.push(`${m}  청구 차이 ${W(LC - AC)} — 「그 달 청구하지 않는 줄」 같은 다리인지는 npm run check:chain ${m} 이 말합니다`);

  if (!줄갈림) continue;
  /** ★어느 줄인지 찍는다 — 숫자만 보면 무엇을 고쳐야 할지 모른다. */
  const 원자키 = new Map<string, number>();
  for (const a of A2) { const k = `${S(a.plate)}|${S(a.customer)}`; 원자키.set(k, (원자키.get(k) || 0) + 1); }
  for (const r of L2) {
    const k = `${r.plate}|${r.cust}`;
    const n = 원자키.get(k) || 0;
    if (n > 0) 원자키.set(k, n - 1);
    else 사고.push(`${m}  원장에만  ${pad(r.plate, 11)} ${pad(r.cust, 8)} ${pad(r.sup, 10)} 청구 ${W(r.claim)}  [${r.tab}]`);
  }
  for (const [k, n] of 원자키) { for (let i = 0; i < n; i++) 사고.push(`${m}  원자에만  ${k.replace('|', '  ')}`); }
}

if (참고.length) {
  console.log(`\n   △ 청구 축 — 다리가 있을 수 있는 차이 ${참고.length}건`);
  for (const x of 참고) console.log(`      ${x}`);
}

if (사고.length) {
  console.log(`\n  ✕ 갈린 곳 ${사고.length}개 — 줄 수와 지급은 다리가 없습니다\n`);
  for (const x of 사고) console.log(`     ${x}`);
  console.log(`
  ★고치는 법 — 어느 쪽이 «맞는지»는 사람이 정한다. 도구가 함부로 덮지 않는다.
     원장이 맞으면   npx tsx scripts/atomize-settlement-month.mts <달> --apply
     원자가 맞으면   npm run settlement:sheet:apply   (원장 탭을 원자에서 다시 세운다)
`);
  process.exit(1);
}
console.log(`\n  ✓ 원자 구간(${ATOM_FROM_MONTH}~)에서 원장과 원자가 줄 수·지급으로 같습니다.\n`);
