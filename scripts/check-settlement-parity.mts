/**
 * **RTDB 와 파이어스토어가 «같은 말»을 하는지 잰다.** — `npm run check:parity`
 *
 * ★★★사장님 2026-09-08 「파이어스토어에 박으면서 가자」 · 「**절대 안 틀리게**」
 *
 * ★★**이중 쓰기의 값은 «둘이 같다»는 데 있다.** 「둘 다 썼다」가 아니다.
 *   한쪽만 성공한 채 지나가면, 읽기를 옮기는 날 조용히 틀린 숫자로 갈아탄다.
 *   그래서 옮기는 동안에는 «매번» 두 곳을 맞대야 한다.
 *
 * ★**돈부터 본다.** 줄 수가 같아도 금액이 갈리면 정산서가 갈린다.
 *   그래서 ① 있고 없고 ② 청구·지급 ③ 그 밖 칸 차례로 본다.
 *
 * ```
 * npm run check:parity              모든 달
 * npm run check:parity -- 2026-08   그 달만
 * ```
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => Number(S(v).replace(/[,\s원]/g, '')) || 0;
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '').trim();

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const fs = getFirestore();

/** 값이 아니라 «뜻»으로 견준다 — 숫자 0 과 빈칸, 「48」과 48 은 같은 말이다. */
const same = (a: unknown, b: unknown) => {
  if (typeof a === 'number' || typeof b === 'number') return Math.abs(N(a) - N(b)) < 0.51;
  return S(a) === S(b);
};
/** 돈 칸 — 여기가 갈리면 종이가 갈린다. 먼저, 그리고 반드시 본다. */
const MONEY = ['claimWritten', 'payWritten', 'claimIncentive', 'payIncentive', 'settleRatio'] as const;
/** 볼 필요 없는 칸 — 쓸 때마다 달라지는 것. */
const SKIP = new Set(['updatedAt']);

let problems = 0;
for (const [node, col, label] of [
  ['v4/settlement_rows', 'settlement_rows', '정산 원자'],
  ['v4/settlement_clawbacks', 'settlement_clawbacks', '환수'],
] as const) {
  const r = (await db.ref(node).get()).val() || {} as Record<string, Record<string, unknown>>;
  const rt = new Map<string, Record<string, unknown>>(Object.entries(r as Record<string, Record<string, unknown>>));
  const fsAll = await fs.collection(col).get();
  const st = new Map<string, Record<string, unknown>>(fsAll.docs.map((d) => [d.id, d.data() as Record<string, unknown>]));
  const pick = (m: Map<string, Record<string, unknown>>) => MONTH
    ? new Map([...m].filter(([, v]) => S(v.billMonth || v.month) === MONTH)) : m;
  const A = pick(rt); const B = pick(st);

  console.log(`\n■ ${label}${MONTH ? ` · ${MONTH}` : ''} — RTDB ${A.size}줄 · 파이어스토어 ${B.size}줄`);

  const onlyA = [...A.keys()].filter((k) => !B.has(k));
  const onlyB = [...B.keys()].filter((k) => !A.has(k));
  for (const k of onlyA) { problems++; const v = A.get(k)!; console.log(`   ✕ ${pad(S(v.plate) || '(차번없음)', 11)} ${pad(S(v.customer), 8)} — 파이어스토어에 «없다»  [${k}]`); }
  for (const k of onlyB) { problems++; const v = B.get(k)!; console.log(`   ✕ ${pad(S(v.plate) || '(차번없음)', 11)} ${pad(S(v.customer), 8)} — RTDB 에 «없다» (안 걷힌 줄일 수 있다)  [${k}]`); }

  let moneyBad = 0; let fieldBad = 0;
  for (const [k, a] of A) {
    const b = B.get(k); if (!b) continue;
    for (const f of MONEY) if (!same(a[f], b[f])) {
      problems++; moneyBad++;
      console.log(`   ✕ ${pad(S(a.plate) || '(차번없음)', 11)} ${pad(S(a.customer), 8)} 「${f}」 RTDB ${won(N(a[f]))} · FS ${won(N(b[f]))}`);
    }
    for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (SKIP.has(f) || (MONEY as readonly string[]).includes(f)) continue;
      if (!same(a[f], b[f])) {
        fieldBad++;
        if (fieldBad <= 8) console.log(`   · ${pad(S(a.plate) || '(차번없음)', 11)} 「${f}」 RTDB «${S(a[f])}» · FS «${S(b[f])}»`);
      }
    }
  }
  if (fieldBad > 8) console.log(`   · … 그 밖 칸 어긋남 ${fieldBad - 8}건 더`);
  if (!onlyA.length && !onlyB.length && !moneyBad) console.log(`   ✓ 줄도 돈도 같습니다${fieldBad ? ` (돈 아닌 칸 ${fieldBad}군데는 위에)` : ''}`);
}

if (problems) {
  console.log(`\n  ✕ 두 곳이 ${problems}군데 갈렸습니다 — 읽기를 옮기기 전에 맞춰야 합니다.`);
  console.log('  맞추는 법 — 그 달을 다시 원자화하면 두 곳에 같이 씁니다:  npx tsx scripts/atomize-settlement-month.mts <달> --apply\n');
  process.exit(1);
}
console.log('\n  ✓ RTDB 와 파이어스토어가 같은 말을 합니다.\n');
process.exit(0);
