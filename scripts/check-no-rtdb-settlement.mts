/**
 * **정산은 RTDB 를 안 본다 — 빗장.** `npm run check:nortdb`
 *
 * ★★★사장님 2026-09-09 「rtdb 는 이제 아예 안 쓴다고」
 *   「**왜 자꾸 알티디비가 슬렁슬렁 나오냐 그냥 꺼 버려**」
 *
 * 왜 이 검사가 필요한가 — **두 곳에 두면 반드시 갈린다.**
 * 2026-09-09 실측: 원자(파이어스토어)에서 우리캐피탈을 9,457,525 로 바로잡았는데
 * 정산서 발행기가 RTDB 를 읽고 있어 종이에는 9,841,650 이 그대로 찍혔다.
 * 숫자가 틀린 게 아니라 **정본이 둘이었던 것**이다. 사람이 기억으로 막을 일이 아니다.
 *
 * ⇒ `settlement_rows` · `settlement_clawbacks` 를 **RTDB 로 만지면 exit 1**.
 *
 * 이관이 끝났으므로 예외는 없다.
 */
import { readFileSync, globSync } from 'node:fs';

const S = (v: unknown) => String(v ?? '').trim();
const NODES = ['settlement_rows', 'settlement_clawbacks'];

const files = globSync(['scripts/**/*.mts', 'scripts/**/*.ts', 'lib/**/*.ts', 'lib/**/*.tsx', 'app/**/*.ts', 'app/**/*.tsx'])
  .map((f) => f.replace(/\\/g, '/'));

console.log('\n■ 정산이 RTDB 를 보나 — 보면 안 된다\n');
const bad: string[] = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    /** 주석은 봐준다 — 「예전엔 여기 있었다」는 기록이라 지우면 왜 옮겼는지 모른다. */
    if (/^\s*(\*|\/\/)/.test(L)) continue;
    if (!/\.ref\(|getDatabase\(\)/.test(L)) continue;
    for (const n of NODES) {
      if (L.includes(`v4/${n}`) || new RegExp(`\\.ref\\((?:'|\`)${n}`).test(L)) {
        bad.push(`${f}:${i + 1}  ${S(L).slice(0, 96)}`);
      }
    }
  }
}
if (bad.length) {
  console.log(`  ✕ ${bad.length}곳이 아직 RTDB 로 정산을 만집니다 — 정본이 둘이 됩니다.\n`);
  for (const x of bad) console.log(`     ${x}`);
  console.log('\n  파이어스토어로 바꾸세요:');
  console.log("     읽기  (await fsdb.collection('settlement_rows').get()).docs.map((d) => d.data())");
  console.log("     쓰기  fsdb.collection('settlement_rows').doc(code).set(data, { merge: true })\n");
  process.exit(1);
}
console.log(`   ✓ ${files.length}개 파일 어디에서도 RTDB 로 정산을 만지지 않습니다.`);
console.log('   ✓ 예외 0개 — Firestore 단일 경로입니다.\n');
