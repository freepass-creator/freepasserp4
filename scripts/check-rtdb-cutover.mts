/**
 * **RTDB 폐기가 얼마나 남았나 — 숫자로 센다.** (읽기 전용 · 막지 않는다)
 *
 * > 사장님 2026-09-10 「**RTDB 를 왜 못 지우는지** … 답답해 죽겠다」 · 「그냥 파이어베이스를 옮길까??」
 *
 * ★**답답한 까닭은 «끝이 안 보여서»다.** 옮기는 일은 되고 있는데 «얼마나 남았는지»를 아무도 안 셌다.
 *   그래서 매번 「아직도 RTDB네」만 보인다. ⇒ 남은 수를 찍는다. 줄어드는 게 보이면 기다릴 수 있다.
 *
 * ★**큰 이관은 이미 끝났다** — 데이터는 `migrate-rtdb-to-firestore-full` 로 Firestore 에 옮겼고
 *   RTDB 원본은 «롤백 자산»으로 얼려 두었다. 심(`lib/server/firestore-ref-shim`)이 `db.ref()` 를
 *   그대로 흉내 내므로, 라우트는 **`const db = …` 한 줄**만 `firestoreAdminRef()` 로 바꾸면 된다.
 *   ⇒ 남은 것은 «큰 결단»이 아니라 **배선**이다.
 *
 * ⚠ 이 검사는 **막지 않는다**(exit 0). 막으면 이관 도중에 아무 일도 못 한다.
 *   막는 것은 「원자를 RTDB 에 쓰지 마라」 하나뿐 — `check:cycle-no-rtdb-write`.
 *
 *   npm run check:rtdb-cutover
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const S = (v: unknown) => String(v ?? '').trim();
const 목록 = (cmd: string): string[] => {
  try { return execSync(cmd, { encoding: 'utf8' }).split('\n').map(S).filter(Boolean); } catch { return []; }
};

/**
 * ① 라우트 — RTDB 를 «직접» 파는 곳(심을 안 쓴 곳).
 * ⚠ 실측 2026-09-10 — 처음엔 `getDatabase()` 만 찾아 «0» 이 나왔다. 라우트는 대부분
 *   `firebaseAdminDatabase()` 같은 헬퍼로 `db` 를 받는다. **찾는 이름이 하나면 못 찾는다** —
 *   그래서 「RTDB 를 여는 이름들」을 다 본다. 0 이 나오면 먼저 «내가 틀렸나»를 의심한다.
 */
const RTDB여는이름 = /getDatabase\s*\(|firebaseAdminDatabase\s*\(|getRtdb\s*\(/;
const 라우트 = 목록(`grep -rl "\.ref(" app/api 2>/dev/null`).filter((f) => {
  const src = readFileSync(f, 'utf8');
  return RTDB여는이름.test(src) && !/firestoreAdminRef\s*\(/.test(src);
});
const 호출수 = 라우트.reduce((n, f) => n + (readFileSync(f, 'utf8').match(/\.ref\(/g) || []).length, 0);
const 이미심 = 목록(`grep -rl "firestoreAdminRef()" app/api 2>/dev/null`).length;

/** ② 앱 저장소 본체 — `getStore()` 가 무엇을 보는가. 이게 몸통이다. */
let 저장소 = '모름';
try {
  const src = readFileSync('lib/firebase/rtdb-adapter.ts', 'utf8');
  저장소 = (src.match(/backend\s*=\s*'([^']+)'/) || [])[1] || '모름';
} catch { /* 파일이 없으면 이미 걷힌 것 */ }

/** ③ 회차(상품시트 파이프라인) — 오늘 정리한 쪽. */
const 회차파일 = ['scripts/hourly-sync.mts', 'scripts/refresh-sync.mts'];
const 부르는것 = new Set<string>();
for (const f of 회차파일) {
  try { for (const m of readFileSync(f, 'utf8').matchAll(/scripts\/[a-zA-Z0-9._-]+\.mts/g)) 부르는것.add(m[0]); } catch { /* 없으면 넘어감 */ }
}
let 회차읽기 = 0;
for (const f of 부르는것) {
  try { if (/getDatabase|v4\/(products|partners|policies)/.test(readFileSync(f, 'utf8'))) 회차읽기++; } catch { /* */ }
}

const 줄 = (a: string, b: string | number, c = '') => console.log(`  ${a.padEnd(30)} ${String(b).padStart(5)}   ${c}`);
console.log(`\n■ RTDB 폐기 — 남은 것\n`);
줄('① 라우트(심 안 씀)', 라우트.length, `호출 ${호출수}곳 · 한 줄씩 바꾸면 된다`);
줄('   그중 이미 심 쓰는 라우트', 이미심, '이만큼은 끝났다');
줄('② 앱 저장소 backend', 저장소, 저장소.startsWith('rtdb') ? '← 몸통. 이게 바뀌어야 화면이 옮겨진다' : '✓ 옮겨졌다');
줄('③ 회차가 RTDB 를 보는 곳', 회차읽기, '전부 «ERP 와 대조»가 목적 — ② 가 끝나면 저절로 없어진다');
console.log(`\n  ★쓰기는 이미 0 이다 — npm run check:cycle-no-rtdb-write`);
console.log(`  ★데이터는 이미 Firestore 에 있다 — RTDB 원본은 롤백 자산으로 얼려 둔 것이다.\n`);
if (라우트.length) {
  console.log('  남은 라우트(호출 많은 순)');
  for (const f of 라우트
    .map((f) => ({ f, n: (readFileSync(f, 'utf8').match(/\.ref\(/g) || []).length }))
    .sort((a, b) => b.n - a.n).slice(0, 10)) console.log(`     ${String(f.n).padStart(3)}곳  ${f.f}`);
  console.log('');
}
process.exit(0);
