/**
 * **RTDB 를 «스왑점 밖»에서 직접 여는 파일이 늘지 않는가.** 읽기 전용. 늘면 exit 1.
 *
 * ★왜(사장님 2026-09-09 「알티디비는 안 쓸 거야 폐기했음」 · 「파이어스토어가 맞음」)
 *   결정은 났는데 코드는 아직 RTDB 를 판다. 그 상태로 문서만 「Firestore 가 정본」이라 적으면
 *   다음 사람은 «주변 코드»를 보고 RTDB 로 붙인다 — 규격이 아니라 주변이 본보기가 된다.
 *
 * ## 무엇을 세는가 — «db.ref( 개수»가 아니다
 *
 * ⚠⚠ 처음엔 `db.ref(` 문자열을 셌다가 **코덱스 독립검증에서 깨졌다**(2026-09-09):
 *   ㉠ 주석·문자열까지 세어 44 중 4가 가짜였다
 *   ㉡ `getDatabase().ref()` · `db().ref()` · 모듈러 `ref(db, …)` 같은 **진짜 호출을 못 봤다**(10+ 파일)
 *   ㉢ 무엇보다 **`db.ref(` 는 Firestore 심도 쓴다** — 정상 코드를 빚으로 세고 있었다
 *
 * ⇒ 세는 것은 **«문을 어디서 여느냐»** 다. 서버에는 단일 스왑점이 있다:
 *   `lib/server/firebase-admin.ts` `firebaseAdminDatabase()` — env 가 `firestore` 면 **같은 `.ref()` 얼굴의
 *   Firestore 심**을 돌려준다. 그 문으로 들어간 **37 파일**은 코드 한 줄 안 고치고 넘어간다. 빚이 아니다.
 *   빚은 **그 문을 건너뛰고 RTDB 를 직접 여는** 파일이다 — 플립해도 **안 넘어간다.**
 *
 * ★import 만 본다(TS AST). 주석·문자열은 애초에 안 걸린다 — ㉠ 을 되풀이하지 않는 방법이다.
 * ⚠ 이 자는 「몇 파일이 남았나」만 본다. **그 파일이 옳은지는 안 본다.**
 *
 *   npm run check:store              센다
 *   npm run check:store -- --tighten 줄었으면 CLAUDE.md 의 기준도 같이 내린다
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOC = 'CLAUDE.md';
const ROOTS = ['app', 'lib', 'components'];
const TIGHTEN = process.argv.includes('--tighten');

/** RTDB 로 들어가는 «문» — 이걸 import 하면 스왑점을 건너뛴 것이다. */
const DOORS = [/^firebase-admin\/database$/, /^firebase\/database$/, /rtdb-adapter$/];

/**
 * **문 자신은 세지 않는다.** 이 셋이 RTDB 를 여는 것은 «제 일»이다 —
 *   · `firebase-admin.ts`      스왑점 자신(env 보고 심이나 RTDB 를 돌려준다)
 *   · `firestore-ref-shim.ts`  Firestore 우선 · 못 찾으면 RTDB 로 내려가는 폴백을 제가 든다
 *   · `rtdb-adapter.ts`        RTDB 어댑터 자신
 * ⚠ 여기 파일을 더하는 것은 «면제»다. 더할 때는 왜 그 파일이 문인지 이 줄에 적는다.
 */
const GATES = new Set([
  'lib/server/firebase-admin.ts',
  'lib/server/firestore-ref-shim.ts',
  'lib/firebase/rtdb-adapter.ts',
]);

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (e.name !== 'node_modules') yield* walk(rel); continue; }
    if (/\.tsx?$/.test(e.name)) yield rel;
  }
}

const direct: string[] = [];
for (const r of ROOTS) for (const f of walk(r)) {
  if (GATES.has(f)) continue;
  const src = ts.createSourceFile(f, readFileSync(join(ROOT, f), 'utf8'), ts.ScriptTarget.Latest, true);
  /*
   * ⚠ **최상위 `import` 만 보면 놓친다** — 코덱스 2차 검증(2026-09-09)이
   *   `lib/login-helpers.ts:14` 의 `await import('firebase/database')` 를 잡아냈다.
   *   동적 `import()` 와 `require()` 도 «문을 여는» 것이라 같이 센다.
   * ⚠ 그래도 못 보는 것이 남는다 — 재노출(`export … from`) · 별칭 경로 · compat SDK.
   *   이 자는 「몇이 남았나」를 세지 「전부 잡았다」고 말하지 않는다.
   */
  let opens = false;
  const visit = (n: ts.Node) => {
    if (opens) return;
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      if (DOORS.some((d) => d.test(n.moduleSpecifier.getText().slice(1, -1)))) { opens = true; return; }
    }
    /*
     * ⚠ **재노출(`export … from`)도 문이다**(2026-09-10 코덱스 검토 — 그냥 넘어갔다).
     *   `export { x } from 'firebase/database'` 는 import 선언이 아니라 export 선언이라
     *   위 가지에 안 걸린다. 그런데 그 파일을 쓰는 쪽에서는 똑같이 RTDB 로 들어간다.
     */
    if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      if (DOORS.some((d) => d.test(n.moduleSpecifier!.getText().slice(1, -1)))) { opens = true; return; }
    }
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText();
      const dynamic = callee === 'require' || n.expression.kind === ts.SyntaxKind.ImportKeyword;
      const arg = n.arguments[0];
      if (dynamic && arg) {
        if (ts.isStringLiteral(arg) && DOORS.some((d) => d.test(arg.getText().slice(1, -1)))) { opens = true; return; }
        /*
         * ⚠⚠ **글자를 이어 붙인 주소는 «읽을 수 없다»**(코덱스 재현 — `import('firebase/' + 'database')`).
         *   읽을 수 없는 것을 「없다」로 세면 그게 구멍이다. 조각 어디엔가 `firebase`·`database`
         *   가 보이면 **문으로 친다** — 아니라고 증명할 수 없으면 «있다» 쪽으로 센다.
         * ★정말 아니면 그 자리에서 글자 그대로 적으면 된다. 이어 붙일 이유가 없다.
         */
        if (!ts.isStringLiteral(arg) && /firebase|database/i.test(arg.getText())) { opens = true; return; }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  if (opens) direct.push(f);
}

console.log('\nRTDB 를 «스왑점 밖»에서 직접 여는 파일\n');
const by = new Map<string, number>();
for (const f of direct) {
  const k = f.startsWith('app/api') ? 'app/api' : f.split('/').slice(0, 2).join('/');
  by.set(k, (by.get(k) ?? 0) + 1);
}
for (const [k, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}  ${k}`);
console.log(`   ${String(direct.length).padStart(4)}  합계  (문 자신 ${GATES.size}개는 제외)`);

/* 대조군 — 어댑터가 안 잡히면 «재는 쪽»이 틀린 것이다(오늘 세 번 그랬다). */
const control = 'lib/firebase/auth.ts';
if (!direct.includes(control) && !GATES.has(control)) {
  console.error(`\n✗ 검사기 고장 — 대조군 ${control} 가 안 잡힌다. 사전이 아니라 이 자를 고쳐라.`);
  process.exit(1);
}

const doc = readFileSync(join(ROOT, DOC), 'utf8');
const said = doc.match(/스왑점을 건너뛰고 RTDB 를 직접 여는 파일 \*\*(\d+)개\*\*/);
if (!said) {
  console.error(`\n✗ ${DOC} 에서 기준 숫자를 못 찾았다 — 「스왑점을 건너뛰고 RTDB 를 직접 여는 파일 **N개**」 문구가 있어야 한다.`);
  process.exit(1);
}
const base = Number(said[1]);

if (direct.length > base) {
  console.error(`\n✗ 늘었다 — 기준 ${base} → 지금 ${direct.length}.`);
  console.error('   새 코드는 firebaseAdminDatabase()(스왑점) 또는 getStore() 로 붙인다 — 그래야 플립 한 줄로 같이 넘어간다.');
  console.error('   정말 직접 열어야 하면 그 이유를 그 자리 주석에 남기고 기준을 «사람이» 올려라.');
  process.exit(1);
}
if (direct.length < base) {
  if (!TIGHTEN) {
    console.log(`\n✓ 줄었다 — 기준 ${base} → 지금 ${direct.length}.`);
    console.log('   ★`npm run check:store -- --tighten` 으로 기준도 같이 내려라 — 안 내리면 늘어도 안 잡힌다.');
    process.exit(1);
  }
  writeFileSync(join(ROOT, DOC), doc.replace(said[0], said[0].replace(`**${base}개**`, `**${direct.length}개**`)), 'utf8');
  console.log(`\n✓ 기준을 ${base} → ${direct.length} 로 내렸다(${DOC}).`);
  process.exit(0);
}

/*
 * ── 플립을 막는 자리 — 컬렉션·루트 경로 `transaction()` ──────────────────
 *
 * ★★**세는 이유**(코덱스 2026-09-09 독립검증 · 심을 실제로 «실행해» 재현):
 *   Firestore 심은 **문서 경로 아닌 `transaction()` 을 거부**한다
 *   (`firestore-ref-shim` — 「transaction 은 문서 경로여야 함」).
 *   그런데 `ref('v4')` · `ref('v4/products')` 처럼 컬렉션·루트로 부르는 곳이 남아 있다.
 *   ⇒ `NEXT_PUBLIC_DATA_BACKEND=firestore` 로 플립하는 순간 **그 자리들이 터진다.**
 *     스왑점 주석은 이걸 「루트 트랜잭션 2곳」이라 적고 있었다 — 실제는 그보다 많다.
 *
 * ★이건 «파일 수»가 아니라 «호출 자리 수»다. 한 파일에 둘 있으면 둘로 센다 —
 *   고칠 것이 자리 단위이기 때문이다.
 * ⚠ 경로가 변수·템플릿이면 세그먼트를 못 세므로 **안 센다.** 그런 자리는 이 자가 못 본다 —
 *   「0이 되면 플립해도 된다」는 뜻이 아니라 「보이는 것이 0」이라는 뜻이다.
 */
const txCalls: string[] = [];
for (const r of ROOTS) for (const f of walk(r)) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/\.ref\(\s*['"`]([^'"`$]*)['"`]\s*\)\s*\.transaction\(/g)) {
    /*
     * ★★**심의 «제» 규칙을 그대로 쓴다 — 지어내지 않는다**(`firestore-ref-shim` `parse()`):
     *   맨 앞 `v4` 를 떼고 → 다음 조각이 컬렉션 → 그다음이 문서 id.
     *   그래서 **`v4` 를 뗀 뒤 두 조각 이상**이어야 문서다. 그 미만이면 `docRef()` 가 null 이라 던진다.
     * ⚠ 처음엔 「세그먼트 홀수 = 컬렉션」이라 «가정»했다가 `v4/products` 를 놓쳤다(6 중 3만 셌다).
     *   규칙은 읽는 것이지 짐작하는 것이 아니다.
     */
    const segs = m[1].split('/').filter(Boolean);
    if (segs[0] === 'v4') segs.shift();
    if (segs.length < 2) {
      const line = src.slice(0, m.index).split('\n').length;
      txCalls.push(`${f}:${line}  ref('${m[1]}')`);
    }
  }
}

console.log('\n플립을 막는 자리 — 컬렉션·루트 경로 transaction()\n');
if (!txCalls.length) console.log('   (보이는 것 없음 — 변수 경로는 이 자가 못 본다)');
for (const c of txCalls) console.log(`   ${c}`);
console.log(`   ${String(txCalls.length).padStart(4)}  자리`);

const txSaid = doc.match(/컬렉션·루트 경로로 부르는 곳이 \*\*(\d+) 파일 (\d+) 자리\*\*/);
if (!txSaid) {
  console.error(`\n✗ ${DOC} 에서 플립 선행 숫자를 못 찾았다 — 「컬렉션·루트 경로로 부르는 곳이 **N 파일 M 자리**」 문구가 있어야 한다.`);
  process.exit(1);
}
const txBase = Number(txSaid[2]);
if (txCalls.length > txBase) {
  console.error(`\n✗ 플립을 막는 자리가 늘었다 — 기준 ${txBase} → 지금 ${txCalls.length}.`);
  console.error('   컬렉션·루트 경로 transaction() 은 Firestore 심이 못 받는다. 문서 단위로 쪼개거나 다른 잠금을 써라.');
  process.exit(1);
}
if (txCalls.length < txBase && !TIGHTEN) {
  console.log(`\n✓ 줄었다 — 플립 선행 ${txBase} → ${txCalls.length}. \`-- --tighten\` 으로 기준도 내려라.`);
  process.exit(1);
}
if (txCalls.length < txBase && TIGHTEN) {
  const files = new Set(txCalls.map((c) => c.split(':')[0])).size;
  writeFileSync(join(ROOT, DOC),
    readFileSync(join(ROOT, DOC), 'utf8')
      .replace(txSaid[0], `컬렉션·루트 경로로 부르는 곳이 **${files} 파일 ${txCalls.length} 자리**`), 'utf8');
  console.log(`\n✓ 플립 선행 기준을 ${txBase} → ${txCalls.length} 로 내렸다.`);
}
console.log(`\n✓ 기준대로 ${base}개 — 늘지 않았다.`);
