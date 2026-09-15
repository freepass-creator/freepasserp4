/**
 * **채(館) 셋의 경계가 새는지 잰다.** — `npm run check:wings`
 *
 * ★★★사장님 2026-09-08 「상품찾기 / 견적 / 전자계약 및 정산·회원사파트너사 관리 이렇게 크게 3개로 쪼갤 거야」
 *   · 「상품찾기는 지금 **화이트라벨 프로젝트로 분리해내고 있음**」
 *
 * ★★**쪼개기 전에 «경계»부터 세운다.** 저장소를 먼저 쪼개면 공용(원자 사전·토큰·인증·원자 데이터)이
 *   세 벌로 갈라져 「어느 게 정본이냐」를 잃는다. 그래서 실물을 옮기기 «전»에,
 *   한 앱 안에서 세 채가 서로를 얼마나 붙잡고 있는지를 먼저 재고 그 수를 줄여 나간다.
 *
 * 세 가지를 본다.
 * ```
 * ① 도면에 없는 층    app/ 아래 폴더가 lib/domain/wings.ts 에 안 적혀 있으면 멈춘다
 * ② 채 사이 샘        한 채 «전용» 파일이 다른 채 «전용» 파일을 import 하는 것 — 늘면 멈춘다
 * ③ 공용이 아닌 공용  공용 자리에 있는데 한 채만 쓰는 파일 — 세어서 보여만 준다
 * ```
 *
 * ★**줄자는 «늘 때만» 빨간불이다**(건물도면과 같은 규칙). 좋아졌으면 `-- --tighten` 으로 기준을 낮춘다.
 *   좋아진 것까지 빨갛게 뜨면 아무도 그 불을 안 믿는다.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { WINGS, ROUTE_WING, SEAMS, SEAMS_SOLVED, type Wing } from '../lib/domain/wings';

const SLASH = (p: string) => p.split('\\').join('/');
const ROOT = SLASH(process.cwd());
const rel = (p: string) => SLASH(relative(ROOT, p));
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
const TIGHTEN = process.argv.includes('--tighten');
/**
 * 기준선 — 지금 남아 있는 샘의 수. 이보다 늘면 멈춘다.
 * ⚠ **tmp/ 에 두지 않는다** — gitignore 라 다음 사람 손에는 기준선이 «없는» 채로 도착하고,
 *   그러면 검사기가 그때의 샘 수를 새 기준으로 적어 버려 늘어난 것을 못 잡는다.
 */
const BASE_FILE = 'docs/wings-baseline.json';

const EXT = ['.tsx', '.ts', '/index.tsx', '/index.ts', '/page.tsx', '/route.ts'];
const resolveImp = (from: string, spec: string): string | null => {
  let base: string;
  if (spec.startsWith('@/')) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null;
  for (const e of ['', ...EXT]) { const p = base + e; if (existsSync(p) && statSync(p).isFile()) return SLASH(p); }
  return null;
};
const impsOf = (f: string) => {
  const out: string[] = [];
  for (const m of readFileSync(f, 'utf8').matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
    const r = resolveImp(f, m[1]); if (r) out.push(r);
  }
  return out;
};
const walkDir = (d: string): string[] => {
  const p = join(ROOT, d); if (!existsSync(p)) return [];
  const out: string[] = [];
  for (const n of readdirSync(p)) {
    const f = join(p, n);
    if (statSync(f).isDirectory()) out.push(...walkDir(join(d, n)));
    else if (/\.tsx?$/.test(n)) out.push(SLASH(f));
  }
  return out;
};

const problems: { what: string; where: string }[] = [];

/* ── ① 도면에 없는 층 ───────────────────────────────────────────────── */
const folders = readdirSync(join(ROOT, 'app'))
  .filter((n) => statSync(join(ROOT, 'app', n)).isDirectory());
const orphan = folders.filter((n) => !(n in ROUTE_WING));
for (const n of orphan) {
  problems.push({ what: `app/${n} 이 어느 채인지 안 적혀 있습니다`, where: 'lib/domain/wings.ts · ROUTE_WING' });
}

/* ── 채마다 닿는 파일을 걸어서 모은다 ───────────────────────────────── */
const doorsOf = (w: Wing) => folders.filter((n) => ROUTE_WING[n] === w).map((n) => `app/${n}`);
const reach = (doors: string[]) => {
  const seen = new Set<string>(doors.flatMap(walkDir));
  const q = [...seen];
  while (q.length) {
    const f = q.pop() as string;
    for (const i of impsOf(f)) if (!seen.has(i)) { seen.add(i); q.push(i); }
  }
  return seen;
};
const R = {} as Record<Wing, Set<string>>;
for (const w of WINGS) R[w.key] = reach(doorsOf(w.key));
const KEYS = WINGS.map((w) => w.key);
/** 그 채만 쓰는 파일 = 전용. 둘 이상이 쓰면 공용. */
const onlyOf = (k: Wing) => new Set([...R[k]].filter((f) => !KEYS.some((o) => o !== k && R[o].has(f))));
const ONLY = {} as Record<Wing, Set<string>>;
for (const k of KEYS) ONLY[k] = onlyOf(k);
const wingOfFile = (f: string): Wing | null => KEYS.find((k) => ONLY[k].has(f)) ?? null;

/* ── ② 채 사이 샘 ──────────────────────────────────────────────────── */
type Leak = { from: string; to: string; a: Wing; b: Wing };
const leaks: Leak[] = [];
for (const k of KEYS) for (const f of ONLY[k]) {
  for (const i of impsOf(f)) {
    const o = wingOfFile(i);
    if (o && o !== k) leaks.push({ from: rel(f), to: rel(i), a: k, b: o });
  }
}

/* ── ③ 공용 자리에 있는데 한 채만 쓰는 것 ──────────────────────────── */
const shelf = /^(lib|components|features)\//;
const soloShelf = KEYS.flatMap((k) => [...ONLY[k]].map(rel).filter((r) => shelf.test(r)).map((r) => ({ r, k })));

/* ── 재서 보여 준다 ────────────────────────────────────────────────── */
console.log('\n■ 채(館) 셋 — 경계가 어디까지 섰나\n');
for (const w of WINGS) {
  console.log(`   ${pad(w.name, 22)} 닿는 파일 ${String(R[w.key].size).padStart(4)} · 그 채만 쓰는 것 ${String(ONLY[w.key].size).padStart(4)}`);
}
const common = new Set([...R['찾기']].filter((f) => R['견적'].has(f) && R['거래'].has(f)));
console.log(`   ${pad('셋 다 쓰는 것(공용)', 22)} ${String(common.size).padStart(4)}`);

console.log(`\n■ 채 사이 샘 ${leaks.length}곳 — 한 채 전용이 다른 채 전용을 붙잡고 있다\n`);
const byPair = new Map<string, Leak[]>();
for (const l of leaks) byPair.set(`${l.a}→${l.b}`, [...(byPair.get(`${l.a}→${l.b}`) || []), l]);
for (const [p, ls] of [...byPair.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`   ${pad(p, 12)} ${String(ls.length).padStart(3)}곳`);
  for (const l of ls.slice(0, 6)) console.log(`        ${l.from}  →  ${l.to}`);
  if (ls.length > 6) console.log(`        … 그 밖 ${ls.length - 6}곳`);
}
if (!leaks.length) console.log('   없습니다.');

/**
 * ★★**걸린 자리는 «걸어가서» 본다.** 직접 import 만 보면 한 칸만 건너뛴 얽힘을
 *   「풀렸다」고 말한다 — 실측 2026-09-08, `store.ts → FirestoreAdapter → contract-dedupe` 를
 *   직접 import 가 없다는 이유로 풀렸다고 찍었다. 안 풀렸는데 초록불이 뜨는 게 제일 나쁘다.
 */
const pathTo = (from: string, to: string): string[] | null => {
  const start = join(ROOT, from);
  if (!existsSync(start)) return null;
  const back = new Map<string, string>();
  const seen = new Set([SLASH(start)]);
  const q = [SLASH(start)];
  while (q.length) {
    const f = q.shift() as string;
    if (rel(f) === to) {
      const out: string[] = [];
      for (let c: string | undefined = f; c; c = back.get(c)) out.unshift(rel(c));
      return out;
    }
    for (const i of impsOf(f)) if (!seen.has(i)) { seen.add(i); back.set(i, f); q.push(i); }
  }
  return null;
};
console.log(`\n■ 아직 안 푼 «걸린 자리» ${SEAMS.length}곳 — 찾기를 뜯어낼 때 이것부터 푼다\n`);
for (const s of SEAMS) {
  const path = pathTo(s.from, s.to);
  if (!path) { console.log(`   ✓ ${pad(s.from, 26)} → ${pad(s.to, 38)} 풀렸습니다`); continue; }
  console.log(`   · ${pad(s.from, 26)} → ${pad(s.to, 38)} ${s.how}`);
  console.log(`        ${path.join('  →  ')}`);
}

/**
 * ★★★**한 번 푼 것은 다시 얽히면 «멈춘다».** 풀어 놓기만 하고 안 지키면,
 *   다음 사람이 편한 쪽으로 한 줄 부르면서 조용히 되돌아간다 — 그게 여태 겪은 회귀의 정체다.
 */
console.log(`
■ 다시 얽히면 안 되는 길 ${SEAMS_SOLVED.length}곳`);
for (const s of SEAMS_SOLVED) {
  const path = pathTo(s.from, s.to);
  console.log(`   ${path ? '✕' : '✓'} ${pad(s.from, 26)} ↛ ${pad(s.to, 34)} ${s.at} ${s.how}`);
  if (path) {
    console.log(`        ${path.join('  →  ')}`);
    problems.push({ what: `${s.from} 가 «다시» ${s.to} 를 끌고 있습니다`, where: `lib/domain/wings.ts · SEAMS_SOLVED — ${s.how}` });
  }
}

if (soloShelf.length) {
  console.log(`\n■ 공용 자리에 있는데 한 채만 쓰는 파일 ${soloShelf.length}개 — 옮길 후보입니다`);
  const g = new Map<Wing, string[]>();
  for (const { r, k } of soloShelf) g.set(k, [...(g.get(k) || []), r]);
  for (const [k, rs] of g) console.log(`   ${pad(k, 6)} ${rs.length}개 — 예: ${rs.slice(0, 3).join(' · ')}`);
}

/* ── 기준선과 견준다 ───────────────────────────────────────────────── */
type Base = { leaks: number; at: string };
const prev: Base | null = existsSync(join(ROOT, BASE_FILE))
  ? JSON.parse(readFileSync(join(ROOT, BASE_FILE), 'utf8')) : null;
if (TIGHTEN || !prev) {
  writeFileSync(join(ROOT, BASE_FILE), JSON.stringify({ leaks: leaks.length, at: new Date().toISOString().slice(0, 10) }, null, 2));
  console.log(`\n   기준선을 ${leaks.length} 곳으로 적었습니다 (${BASE_FILE}).`);
} else if (leaks.length > prev.leaks) {
  problems.push({ what: `채 사이 샘이 ${prev.leaks} → ${leaks.length} 로 늘었습니다`, where: '위 «채 사이 샘» 목록' });
} else if (leaks.length < prev.leaks) {
  console.log(`\n   ✓ 샘이 ${prev.leaks} → ${leaks.length} 로 줄었습니다 — «npm run check:wings -- --tighten» 으로 기준을 낮추세요.`);
}

if (problems.length) {
  console.log(`\n  ✕ 채 경계가 ${problems.length}군데 어긋났습니다\n`);
  problems.forEach((p, i) => console.log(`   ${i + 1}. ${p.what}\n      → ${p.where}`));
  console.log('\n  새 층을 올렸으면 lib/domain/wings.ts 에 한 줄을 더합니다.');
  console.log('  ⚠ 이 검사를 «먼저» 고쳐 통과시키는 것은 경계를 지운 것과 같습니다.\n');
  process.exit(1);
}
console.log('\n  ✓ 채 경계가 그대로입니다 — 층 배치 · 채 사이 샘\n');
process.exit(0);
