/**
 * **파이어스토어를 RTDB(정본)에 맞춘다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★★★사장님 2026-09-08 「파이어스토어에 박으면서 가자」 · 「**절대 안 틀리게**」
 *
 * ★★**왜 필요한가.** 이중 쓰기를 켜기 «전»에 다른 세션이 옮겨 둔 옛 스냅샷이 남아 있다.
 *   실측 2026-09-08 — 8월이 RTDB 53줄인데 파이어스토어는 95줄이었다.
 *   그대로 두면 읽기를 옮기는 날 «옛 숫자»로 갈아탄다.
 *
 * ★★★**지우는 규칙 — 「그 차가 RTDB 에 있으면」만 지운다.**
 * ```
 * 유령   같은 차·같은 사람이 RTDB 에 «있다» → 코드만 바뀐 옛 문서다. 지운다
 * 진짜   그 차가 RTDB 에 «아예 없다»        → 안 지운다. 이름을 대고 보고만 한다
 * ```
 *   오늘 걷는 기준 한 칸이 어긋나 8월이 통째로 날아갔다. 같은 일을 여기서 또 내면 안 된다.
 *   ⇒ **모르는 것은 안 지운다.** 남겨 두면 사람이 보지만, 지우면 아무도 못 본다.
 *
 * ```
 * npx tsx scripts/sync-settlement-to-firestore.mts
 * npx tsx scripts/sync-settlement-to-firestore.mts --apply
 * ```
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';

const S = (v: unknown) => String(v ?? '').trim();
const P = (v: unknown) => S(v).replace(/\s/g, '');
const N = (v: unknown) => Number(S(v).replace(/[,\s원]/g, '')) || 0;
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const APPLY = process.argv.includes('--apply');

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();
const fs = getFirestore();

let put = 0; let del = 0; const keep: string[] = [];
for (const [node, col, label] of [
  ['v4/settlement_rows', 'settlement_rows', '정산 원자'],
  ['v4/settlement_clawbacks', 'settlement_clawbacks', '환수'],
] as const) {
  const rt = Object.entries((await db.ref(node).get()).val() || {}) as [string, Record<string, unknown>][];
  const st = (await fs.collection(col).get()).docs.map((d) => [d.id, d.data() as Record<string, unknown>] as [string, Record<string, unknown>]);
  const rtKeys = new Set(rt.map(([k]) => k));
  /** 그 «차»가 RTDB 에 있나 — 달이 달라도 있으면 있는 것이다(달을 옮긴 줄이 있다). */
  const rtCars = new Set(rt.map(([, v]) => `${P(v.plate)}|${S(v.customer)}`));

  const writes: [string, Record<string, unknown> | null][] = [];
  for (const [k, v] of rt) writes.push([k, v]);                       // RTDB 를 그대로 덮는다
  const ghosts = st.filter(([k, v]) => !rtKeys.has(k) && rtCars.has(`${P(v.plate)}|${S(v.customer)}`));
  const reals = st.filter(([k, v]) => !rtKeys.has(k) && !rtCars.has(`${P(v.plate)}|${S(v.customer)}`));
  for (const [k] of ghosts) writes.push([k, null]);

  console.log(`\n■ ${label} — RTDB ${rt.length}줄 · 파이어스토어 ${st.length}줄`);
  console.log(`   덮어쓸 것 ${rt.length} · 지울 «유령» ${ghosts.length} · 남길 «진짜» ${reals.length}`);
  for (const [k, v] of reals) {
    keep.push(`${label} ${S(v.plate) || '(차번없음)'} ${S(v.customer)}`);
    console.log(`   · 남긴다 ${pad(S(v.plate) || '(차번없음)', 11)} ${pad(S(v.customer), 16)} ${pad(S(v.billMonth || v.month) || '(달없음)', 9)}`
      + ` 청구 ${won(N(v.claimWritten)).padStart(10)} · 지급 ${won(N(v.payWritten)).padStart(10)}  [${k}]  ← RTDB 에 그 차가 없다`);
  }
  if (!APPLY) continue;
  for (let i = 0; i < writes.length; i += 400) {
    const b = fs.batch();
    for (const [id, data] of writes.slice(i, i + 400)) {
      const ref = fs.collection(col).doc(id);
      if (data === null) { b.delete(ref); del++; } else { b.set(ref, data); put++; }
    }
    await b.commit();
  }
}

if (!APPLY) { console.log('\n※ dry-run — 아무것도 안 썼습니다. --apply 로 맞춥니다.\n'); process.exit(0); }
console.log(`\n  ✓ 덮어쓴 것 ${put} · 지운 유령 ${del}`);
if (keep.length) {
  console.log(`  ※ 남긴 «진짜» ${keep.length}줄 — RTDB 에 그 차가 없어 손대지 않았습니다. 사람이 봐야 합니다.`);
  console.log('    (달을 옮긴 줄이면 RTDB 에 그 달로 서 있을 것이고, 그러면 위 «유령»으로 잡힙니다.)');
}
console.log('  ※ 이어서 — npm run check:parity 로 두 곳이 같은 말을 하는지 봅니다.\n');
process.exit(0);
