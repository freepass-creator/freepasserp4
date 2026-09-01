/**
 * **교차 검증판 집계 — 「찾은 사람이 자기 건을 검증했는가」를 잡는다.**
 *
 * ★사장님 2026-08-21 「커서, 클로드, 코덱스가 교차 검증할거야」.
 *   그날 클로드가 두 번 헛다리를 짚었고 **둘 다 자기가 만든 도구로 자기가 확인**해서 늦게 잡혔다.
 *   ① 감사 도구가 옛 원장 탭을 읽는 줄 모르고 결과를 옮김(16건 중 7건 헛발)
 *   ② 시트 「안내」를 안 보고 사전을 잘못 잡아 없는 문제 55건을 지어냄
 *   ⇒ **찾은 사람의 판정은 검증으로 세지 않는다.** 그것이 이 도구가 하는 일의 전부다.
 *
 * 판: `docs/CROSSCHECK-*.md` 의 표(#·무엇·찾음).
 * 판정: `docs/crosscheck/<이름>.md` 에 한 줄씩. 남의 파일은 고치지 않는다(같이 만지면 서로 덮는다).
 *
 *     F3 | 맞음 | 시트 「차종마스터」 탭에서 팰리세이드 줄을 직접 열어 확인
 *
 * 판정은 셋뿐 — 맞음 · 틀림 · 못정함.
 *
 *   npx tsx scripts/check-crosscheck.mts
 *   npx tsx scripts/check-crosscheck.mts --board=docs/CROSSCHECK-2026-08-21.md
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';

const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const VERDICTS = ['맞음', '틀림', '못정함'] as const;
type Verdict = (typeof VERDICTS)[number];

// ── 판 — 제일 최근 CROSSCHECK 문서
const boardPath = arg('board') || readdirSync('docs').filter((f) => /^CROSSCHECK-.*\.md$/.test(f)).sort().pop();
if (!boardPath) { console.log('교차 검증판이 없다 — docs/CROSSCHECK-<날짜>.md 를 먼저 만들어라.'); process.exit(1); }
const board = readFileSync(boardPath.startsWith('docs') ? boardPath : join('docs', boardPath), 'utf8');

type Item = { id: string; what: string; finder: string };
const items: Item[] = [];
for (const line of board.split(/\r?\n/)) {
  // | **F1** | 무엇 | 찾음 | 근거 |
  const m = /^\|\s*\*{0,2}(F\d+)\*{0,2}\s*\|(.+?)\|(.+?)\|/.exec(line);
  if (!m) continue;
  items.push({ id: m[1], what: S(m[2]).replace(/\*\*/g, '').slice(0, 60), finder: S(m[3]).replace(/\(.*?\)/g, '').replace(/\*\*/g, '').trim() });
}
if (!items.length) { console.log(`${boardPath} 에서 항목(F1·F2…)을 못 읽었다 — 표 형식을 확인해라.`); process.exit(1); }

// ── 판정
type Vote = { who: string; verdict: Verdict; why: string; line: number };
const votes: Vote[] = [];
const bad: string[] = [];
const dir = 'docs/crosscheck';
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
for (const f of files) {
  const who = basename(f, '.md');
  readFileSync(join(dir, f), 'utf8').split(/\r?\n/).forEach((raw, i) => {
    const line = S(raw);
    if (!line || line.startsWith('#') || line.startsWith('>')) return;
    const p = line.split('|').map(S);
    if (p.length < 2 || !/^F\d+$/.test(p[0])) return;
    if (!VERDICTS.includes(p[1] as Verdict)) { bad.push(`${f}:${i + 1} 판정이 「${p[1]}」 — 맞음·틀림·못정함 셋뿐이다`); return; }
    if (!items.some((it) => it.id === p[0])) { bad.push(`${f}:${i + 1} 판에 없는 항목 ${p[0]}`); return; }
    if (!S(p[2])) { bad.push(`${f}:${i + 1} ${p[0]} 근거가 비었다 — 무엇을 열어 봤는지 적어라`); return; }
    votes.push({ who, verdict: p[1] as Verdict, why: S(p[2]), line: i + 1 });
    (votes[votes.length - 1] as Vote & { id?: string }).id = p[0];
  });
}
const idOf = (v: Vote) => (v as Vote & { id: string }).id;

console.log(`\n■ 교차 검증 — ${boardPath} · 항목 ${items.length} · 검증자 ${files.length}명 · 판정 ${votes.length}건\n`);

let unchecked = 0, selfOnly = 0, split = 0;
for (const it of items) {
  const mine = votes.filter((v) => idOf(v) === it.id);
  const others = mine.filter((v) => v.who !== it.finder);
  const self = mine.filter((v) => v.who === it.finder);
  const kinds = new Set(others.map((v) => v.verdict));

  let mark = '  ', note = '';
  if (!others.length) {
    if (self.length) { mark = '⚠ '; note = `찾은 사람(${it.finder})만 봤다 — 검증이 아니다`; selfOnly++; }
    else { mark = '· '; note = '아직 아무도 안 봄'; unchecked++; }
  } else if (kinds.size > 1) {
    mark = '⚡'; note = `갈림 — ${others.map((v) => `${v.who}:${v.verdict}`).join(' · ')}`; split++;
  } else {
    mark = '✓ '; note = `${[...kinds][0]} — ${others.map((v) => v.who).join('·')}`;
  }
  console.log(`  ${mark}${it.id.padEnd(4)} ${it.what.padEnd(62)} 찾음 ${it.finder.padEnd(8)} ${note}`);
  for (const v of others) console.log(`        └ ${v.who} 「${v.verdict}」 ${v.why.slice(0, 90)}`);
  /**
   * ★찾은 사람의 판정은 **안 센다.** 조용히 버리면 본인은 «내가 확인했다»고 여긴다 —
   *   오늘 사고가 정확히 그 모양이었다. 버렸다는 사실을 눈에 보이게 적는다.
   */
  for (const v of self) console.log(`        ✗ ${v.who} 「${v.verdict}」 — 자기가 찾은 건이라 안 셈`);
}

const done = items.length - unchecked - selfOnly;
console.log(`\n  검증됨 ${done} · 아무도 안 봄 ${unchecked} · 자기만 봄 ${selfOnly} · 갈림 ${split}`);

if (bad.length) { console.log('\n  ── 형식이 틀린 줄'); for (const b of bad) console.log(`     ${b}`); }
if (split) console.log('\n  ⚡ 갈린 것은 **고치지 말고 사장님께 올린다.** 둘 다 근거를 적어 둔 상태로 둔다.');
if (selfOnly) console.log('\n  ⚠ 자기 건을 자기가 검증한 것이 있다. 다른 둘 중 하나가 원본을 열어 봐야 닫힌다.');
if (unchecked) console.log(`\n  · 아직 ${unchecked}건이 아무도 안 봤다.`);

process.exit(bad.length || split ? 1 : 0);
