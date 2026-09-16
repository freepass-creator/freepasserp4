/**
 * **정산 원자는 RTDB 를 안 본다 — 빗장.** `npm run check:nortdb`
 *
 * ★★★사장님 2026-09-09 「rtdb 는 이제 아예 안 쓴다고」 ·
 *   2026-09-14 「RTDB 영구 폐기」 — 인스턴스·API·리스너·어댑터·fallback 을 만들지도 되살리지도 않는다.
 *   남은 RTDB 참조는 **제거 대상 migration debt** 다.
 *
 * 왜 이 검사가 필요한가 — **두 곳에 두면 반드시 갈린다.**
 * 2026-09-09 실측: 원자(파이어스토어)에서 우리캐피탈을 9,457,525 로 바로잡았는데
 * 정산서 발행기가 RTDB 를 읽고 있어 종이에는 9,841,650 이 그대로 찍혔다.
 * 숫자가 틀린 게 아니라 **정본이 둘이었던 것**이다. 사람이 기억으로 막을 일이 아니다.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ★★★**`.ref()` 를 보고 RTDB 라고 판정하면 틀린다 — 2026-09-16 실측.**
 *   이관이 끝난 지금 `lib`·`app` 의 `db.ref('settlement_rows')` 는 **RTDB 가 아니다.**
 *   `firebaseAdminStore()` → `firestore-path-store` 어댑터가 받아 Firestore
 *   `settlement_rows` 컬렉션으로 보낸다(경로형 호출부 178곳을 안 건드리려고 둔 심).
 *   ⇒ **`.ref(` 만 세는 빗장은 정상 코드를 통째로 오탐한다.** 그런 빗장은 곧 꺼진다.
 *
 * ★★**그래서 무엇을 보나 — 「그 파일이 실제로 RTDB 에 닿을 수 있나」를 먼저 본다.**
 * ```
 * RTDB 에 닿는 표식   import 'firebase-admin/database' · import 'firebase/database' · getDatabase(
 * 정산을 만지는 표식   settlement_rows · settlement_clawbacks 를 «리터럴로» 쓰거나
 *                      그 이름에 묶인 «변수»(const NODE = 'settlement_rows')를 .ref() 에 넘긴다
 * ```
 *   **둘이 한 파일에서 만나면 exit 1.**
 *
 * ★★**변수를 반드시 같이 본다.** 옛 판정식은 `` .ref('settlement_rows' `` 같은 글자 그대로만 잡았고,
 *   실제로 새던 두 곳은 변수를 한 번 거쳤다는 이유만으로 통과했다 —
 *   `const NODE = 'settlement_rows'` → `db.ref(NODE).update(patch)`,
 *   `const ROWS_NODE = …` → ``db().ref(`${ROWS_NODE}/${code}`).set(rec)``.
 *   빗장이 걸려 있는데 문은 열려 있었다.
 *
 * ★**오탐을 막는 셋.**
 *   ① **주석은 안 본다** — 블록·꼬리 주석을 글자 단위로 지우고 «실행 코드»만 본다(줄번호는 안 밀린다).
 *   ② **묶인 변수만 센다** — 노드 이름 «그 자체»에 묶인 이름만 위험하다.
 *      `CONFIRM_NODE = 'v4/settlement_confirmations'` 같은 다른 노드는 안 걸린다.
 *   ③ **RTDB 표식이 없는 파일은 아예 안 본다** — Firestore 로 가는 `.ref()` 는 죄가 없다.
 *
 * ★**범위 — 저절로 도는 길만 exit 1.**
 *   `lib/**` · `app/**` 은 서버가 요청을 받으면 «사람 손 없이» 타는 길이다. 여기서만 막는다.
 *   `scripts/**` 은 사람이 일부러 치는 삽이라 **세어서 이름만 보여 준다**(제거 대상 debt).
 *   ⚠ 이 경계를 «통과시키려고» 넓히지 마라. 삽을 걷어내면 그때 scripts 도 exit 1 로 올린다.
 */
import { readFileSync, globSync } from 'node:fs';

const S = (v: unknown) => String(v ?? '').trim();
const NODES = ['settlement_rows', 'settlement_clawbacks'];
const ALT = NODES.join('|');

/**
 * 주석을 지운다 — **줄 수와 글자 자리는 그대로** 두고 내용만 공백으로 바꾼다(줄번호가 안 밀린다).
 * 문자열 안의 `//` 를 주석으로 오인하지 않으려고 따옴표 상태를 같이 끈다.
 */
function stripComments(src: string): string {
  let out = '';
  let mode: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' = 'code';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && d === '/') { mode = 'line'; out += '  '; i++; continue; }
      if (c === '/' && d === '*') { mode = 'block'; out += '  '; i++; continue; }
      if (c === "'") mode = 'sq';
      else if (c === '"') mode = 'dq';
      else if (c === '`') mode = 'tpl';
      out += c; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } else out += ' '; continue; }
    if (mode === 'block') {
      if (c === '*' && d === '/') { mode = 'code'; out += '  '; i++; continue; }
      out += c === '\n' ? '\n' : ' '; continue;
    }
    // 문자열 안 — 내용은 남긴다(`.ref('settlement_rows')` 의 인자가 여기 있다).
    if (c === '\\') { out += c + (d ?? ''); i++; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = 'code';
    out += c;
  }
  return out;
}

/**
 * 이 파일이 **실제로 RTDB 에 닿을 수 있나.** 닿을 수 없으면 `.ref()` 는 Firestore 심이라 죄가 없다.
 *
 * ★`firebaseAdminDatabase` 를 같이 본다 — 이관 «전»의 RTDB 손잡이 이름이다. 그 함수는 파일 안에서
 *   `getDatabase(` 를 부르지 않고 «불러다 쓰기»만 하므로, 모듈 표식만 보면 옛 코드가 통째로 빠져나간다.
 *   실측: 이관 전 `settlement-sheet-import.ts` 는 `import { firebaseAdminDatabase }` 한 줄과
 *   `db.ref(NODE)` 뿐이라 database 모듈 표식이 아예 없었다. 그 이름이 다시 나타나면 그 자체가 위반이다.
 */
const RTDB_REACH = /from\s*['"](?:firebase-admin\/database|firebase\/database)['"]|require\(\s*['"](?:firebase-admin\/database|firebase\/database)['"]|\bgetDatabase\s*\(|\bfirebaseAdminDatabase\b/;

/** 이 파일 안에서 «노드 이름 그 자체»에 묶인 변수 이름들. */
function boundToNode(code: string): Set<string> {
  const names = new Set<string>();
  const re = new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=;]+)?=\\s*(['"\`])(?:v4/)?(?:${ALT})\\2`, 'g');
  for (const m of code.matchAll(re)) names.add(m[1]);
  return names;
}

type Hit = { line: number; text: string };

/** RTDB 표식이 있는 파일에서 «정산 노드를 만지는 `.ref()`» 를 찾는다. 리터럴이든 변수 경유든. */
function hits(file: string): Hit[] {
  const raw = readFileSync(file, 'utf8');
  const code = stripComments(raw);
  if (!RTDB_REACH.test(code)) return [];
  const vars = boundToNode(code);
  const out: Hit[] = [];
  for (const m of code.matchAll(/\.ref\(\s*([^)\n]*)/g)) {
    const arg = m[1];
    const literal = new RegExp(`(?:v4/)?(?:${ALT})`).test(arg);
    const viaVar = [...vars].some((v) => new RegExp(`\\b${v}\\b`).test(arg));
    if (!literal && !viaVar) continue;
    const line = code.slice(0, m.index).split('\n').length;
    out.push({ line, text: S(raw.split('\n')[line - 1]).slice(0, 96) });
  }
  return out;
}

/** 정산이 아니어도 — 저절로 도는 길에 RTDB 모듈이 «들어오는 것» 자체를 막는다(전역 지침). */
function rtdbImport(file: string): Hit[] {
  const raw = readFileSync(file, 'utf8');
  const code = stripComments(raw);
  const out: Hit[] = [];
  for (const m of code.matchAll(new RegExp(RTDB_REACH.source, 'g'))) {
    const line = code.slice(0, m.index).split('\n').length;
    out.push({ line, text: S(raw.split('\n')[line - 1]).slice(0, 96) });
  }
  return out;
}

const pick = (globs: string[]) => globSync(globs).map((f) => f.replace(/\\/g, '/'));
const SELF = 'scripts/check-no-rtdb-settlement.mts';

const RUNTIME = pick(['lib/**/*.ts', 'lib/**/*.tsx', 'app/**/*.ts', 'app/**/*.tsx']);
const TOOLS = pick(['scripts/**/*.mts', 'scripts/**/*.ts']).filter((f) => f !== SELF);

console.log('\n■ 정산 원자가 RTDB 를 보나 — 저절로 도는 길에서는 보면 안 된다\n');

const bad: string[] = [];
for (const f of RUNTIME) {
  for (const h of hits(f)) bad.push(`${f}:${h.line}  [정산×RTDB] ${h.text}`);
  for (const h of rtdbImport(f)) bad.push(`${f}:${h.line}  [RTDB 모듈] ${h.text}`);
}

if (bad.length) {
  console.log(`  ✕ lib·app ${bad.length}곳이 RTDB 로 되돌아갔습니다 — 정본이 둘이 됩니다.\n`);
  for (const x of bad) console.log(`     ${x}`);
  console.log('\n  파이어스토어로 가세요 (정본 = Firestore `settlement_rows`):');
  console.log("     경로형  firebaseAdminStore().ref('settlement_rows')   ← 심이 Firestore 로 보낸다");
  console.log("     직접    getFirestore(firebaseAdminApp()).collection('settlement_rows')\n");
  process.exit(1);
}

console.log(`   ✓ lib·app ${RUNTIME.length}개 파일 — RTDB 모듈도, RTDB 로 만지는 정산도 없습니다.`);
console.log("     (`.ref('settlement_rows')` 는 firestore-path-store 심을 타 Firestore 로 갑니다 — RTDB 가 아닙니다.)");

// ── 사람이 치는 삽 — 세어서 이름만 보여 준다.
const debtFiles = new Map<string, number>();
for (const f of TOOLS) { const n = hits(f).length; if (n) debtFiles.set(f, n); }
if (debtFiles.size) {
  const total = [...debtFiles.values()].reduce((a, b) => a + b, 0);
  console.log(`\n   ※ scripts ${debtFiles.size}개 파일 · ${total}곳은 아직 RTDB 로 정산을 만집니다.`);
  console.log('     사람이 일부러 치는 삽이라 여기서 막지 않습니다 — 제거 대상 migration debt 입니다(전역 지침 2026-09-14).');
  console.log('     걷어내면 이 검사를 scripts 까지 올립니다.\n');
  for (const [f, n] of [...debtFiles].sort()) console.log(`     · ${f}  (${n})`);
}
console.log('');
