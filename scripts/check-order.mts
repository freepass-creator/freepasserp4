/**
 * 오더 가드 — 「커서가 시킨 것만 했나」를 기계로 확인한다.
 *
 * ★사장님 2026-08-30 「커서한테 오더를 내리니까 지가 맘대로만 막 하더라구」
 *
 * 오더 문서에 「범위 밖으로 나가지 마라」라고 **적어도 나갑니다**(정제칸 오더 §4에 그 문장이 있었는데도
 * 나갔다). 글은 지킴을 강제하지 못한다. 그래서 오더에 «기계가 읽는 두 칸»을 붙이고 이 가드가 잰다.
 *
 *   손대도 되는 파일  → 그 밖의 파일이 바뀌면 즉시 빨간불 (임의 개선·곁다리 리팩터가 여기서 걸린다)
 *   완료조건 숫자     → 내려가야 할 숫자만 내려갔는지, 다른 층이 나빠지지 않았는지
 *
 * 쓰기:
 *   npx tsx scripts/check-order.mts <오더.md> --start   ← 오더를 넘기기 «전»에 현재 상태를 도장 찍는다
 *   npx tsx scripts/check-order.mts <오더.md>            ← 커서가 끝냈다고 하면 이걸로 받는다
 *
 * ★--start 가 왜 필요한가: 이 저장소는 늘 작업 중이라 워킹트리가 이미 지저분하다(오늘도 40여 개).
 *   시작 시점을 도장 찍어 두지 않으면 «커서가 건드린 것»과 «원래 지저분하던 것»을 못 가른다.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, measureTarget, floors, rooms } from './lib/building-census.mts';

const args = process.argv.slice(2);
const orderPath = args.find((arg) => !arg.startsWith('--'));
const MODE_START = args.includes('--start');

if (!orderPath) {
  console.error('쓰기: npx tsx scripts/check-order.mts <오더.md> [--start]');
  process.exit(1);
}
if (!existsSync(orderPath)) {
  console.error(`✗ 오더 문서가 없습니다: ${orderPath}`);
  process.exit(1);
}

const STAMP_DIR = join(ROOT, 'scripts/.order-base');
const stampPath = join(STAMP_DIR, `${basename(orderPath).replace(/\.md$/, '')}.json`);

// ── 오더 읽기 ───────────────────────────────────────────────────────────────

const lines = readFileSync(orderPath, 'utf8').split(/\r?\n/);

function section(marker: string): string[] {
  const start = lines.findIndex((line) => line.trim() === `<!-- 오더:${marker} -->`);
  const end = lines.findIndex((line) => line.trim() === `<!-- /오더:${marker} -->`);
  if (start < 0 || end < 0) {
    console.error(`✗ 오더에 <!-- 오더:${marker} --> 구간이 없습니다 — 이 가드가 읽을 수 있는 오더가 아닙니다.`);
    console.error('  본: docs/crosscheck/오더-cursor-껍데기-높이-2026-08-30.md');
    process.exit(1);
  }
  return lines.slice(start + 1, end);
}

function cells(line: string): string[] {
  return line.split('|').slice(1, -1).map((cell) => cell.trim().replace(/`/g, ''));
}

/** 손대도 되는 파일 — `app/login/page.tsx` 또는 `components/ui/` 처럼 접두어로 적는다. */
const allowed = section('범위')
  .filter((line) => line.trim().startsWith('|'))
  .map((line) => cells(line)[0])
  .filter((value) => value && value !== '손대도 되는 파일' && !/^-+$/.test(value.replace(/[: ]/g, '')));

/** 완료조건 — | 대상 | 칸(raw|높이) | 지금 | 목표 | */
type Goal = { key: string; column: 'raw' | 'height'; from: number; to: number };
const goals: Goal[] = section('완료')
  .filter((line) => line.trim().startsWith('|'))
  .map(cells)
  .filter((row) => row.length >= 4 && row[0] && row[0] !== '대상' && !/^-+$/.test(row[0].replace(/[: ]/g, '')))
  .map((row) => ({
    key: row[0],
    column: row[1].includes('raw') ? 'raw' : 'height',
    from: Number(row[2].replace(/[^0-9]/g, '')) || 0,
    to: Number(row[3].replace(/[^0-9]/g, '')) || 0,
  }));

// ── 지금 건물 상태 ──────────────────────────────────────────────────────────

function census(): Record<string, { raw: number; height: number }> {
  const out: Record<string, { raw: number; height: number }> = {};
  for (const [key, m] of floors()) out[key] = { raw: m.raw, height: m.height };
  for (const [key, m] of rooms()) out[key] = { raw: m.raw, height: m.height };
  return out;
}

/** 지금 워킹트리에서 바뀐 파일(추적·미추적 모두). */
function changedFiles(): string[] {
  const output = execFileSync('git', ['status', '--porcelain=1', '-uall'], { cwd: ROOT, encoding: 'utf8' });
  return output.split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).trim().replace(/^"|"$/g, ''))
    .map((path) => path.split(' -> ').pop() as string)
    .map((path) => path.replace(/\\/g, '/'));
}

// ── --start : 도장 ──────────────────────────────────────────────────────────

if (MODE_START) {
  mkdirSync(STAMP_DIR, { recursive: true });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  writeFileSync(stampPath, JSON.stringify({
    order: basename(orderPath), head, dirty: changedFiles(), census: census(),
  }, null, 2), 'utf8');
  console.log(`✓ 시작 도장을 찍었습니다 — ${orderPath}`);
  console.log(`  기준 커밋 ${head.slice(0, 8)} · 이미 더러운 파일 ${changedFiles().length}개는 «커서 것»으로 안 셉니다.`);
  console.log('\n  이제 커서에게 오더를 넘기세요. 끝났다고 하면:');
  console.log(`  npx tsx scripts/check-order.mts ${orderPath}`);
  process.exit(0);
}

// ── 받기 ────────────────────────────────────────────────────────────────────

if (!existsSync(stampPath)) {
  console.error('✗ 시작 도장이 없습니다 — 오더를 넘기기 전에 먼저 찍어야 «커서가 건드린 것»을 가릴 수 있습니다.');
  console.error(`  npx tsx scripts/check-order.mts ${orderPath} --start`);
  process.exit(1);
}

const stamp = JSON.parse(readFileSync(stampPath, 'utf8')) as {
  head: string; dirty: string[]; census: Record<string, { raw: number; height: number }>;
};

const problems: string[] = [];
const good: string[] = [];

// ① 범위 — 손대도 되는 파일 밖을 건드렸나
const wasDirty = new Set(stamp.dirty);
const touched = changedFiles().filter((path) => !wasDirty.has(path));
const outside = touched.filter((path) => !allowed.some((prefix) => path === prefix || path.startsWith(prefix)));
if (outside.length) {
  const shown = outside.slice(0, 20).map((path) => `\n      ${path}`).join('');
  const more = outside.length > 20 ? `\n      … 외 ${outside.length - 20}개` : '';
  problems.push(`오더 범위 밖 파일 ${outside.length}개를 건드렸습니다 — 시킨 것만 하기로 한 자리입니다:${shown}${more}`);
} else {
  good.push(`범위 지킴 — 건드린 파일 ${touched.length}개가 전부 오더 안입니다`);
}

// ② 완료조건 — 내려가야 할 숫자가 내려갔나
for (const goal of goals) {
  const measured = measureTarget(goal.key);
  if (!measured) {
    problems.push(`완료조건의 «${goal.key}» 를 찾을 수 없습니다 (오더의 대상 이름을 확인하세요)`);
    continue;
  }
  const now = measured[goal.column];
  const name = goal.column === 'raw' ? 'raw 컨트롤' : '하드코딩 높이';
  if (now > goal.to) {
    problems.push(`${goal.key} ${name}: 목표 ${goal.to} 인데 아직 ${now} 입니다 (시작 ${goal.from})`);
  } else {
    good.push(`${goal.key} ${name} ${goal.from} → ${now} (목표 ${goal.to})`);
  }
}

// ③ 곁다리 — 오더에 없는 층·방이 나빠졌나. 「고치다가 저쪽을 건드린 것」이 여기서 걸린다.
const goalKeys = new Set(goals.map((goal) => goal.key));
const now = census();
for (const [key, value] of Object.entries(now)) {
  const before = stamp.census[key];
  if (!before) {
    problems.push(`«${key}» 이 새로 생겼습니다 — 오더에 없는 층·방을 만들었습니다`);
    continue;
  }
  if (goalKeys.has(key)) continue;
  if (value.raw > before.raw) problems.push(`«${key}» raw 컨트롤이 ${before.raw} → ${value.raw} 로 늘었습니다 (오더 밖)`);
  if (value.height > before.height) problems.push(`«${key}» 하드코딩 높이가 ${before.height} → ${value.height} 로 늘었습니다 (오더 밖)`);
}

// ── 보고 ────────────────────────────────────────────────────────────────────

for (const line of good) console.log(`  ✓ ${line}`);

if (problems.length) {
  console.error(`\n✗ 오더대로가 아닙니다 — ${problems.length}건\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`\n  오더: ${orderPath}`);
  console.error('  되돌리려면 오더 밖 파일만 `git checkout --` 하면 됩니다.');
  process.exit(1);
}

console.log(`\n✓ 오더대로입니다 — ${basename(orderPath)}`);
console.log('  이어서: npm run check:building · npm run check:ui · npx tsc --noEmit');
