/**
 * **예약 작업 지도가 실제 예약과 같은가** — `docs/예약작업-지도.md` ↔ `.github/workflows/*.yml` cron · `vercel.json` crons.
 *
 * ★사장님 2026-09-16 「그 예약자를 우리가 하나로 통일하고, 이제 여기서 어느 AI든 통일을 좀 해놓자」.
 *   지도에 없는 cron 이 생기면(어느 AI 가 워크플로를 더하거나 cron 을 바꾸면) exit 1 — CI 가 막는다.
 *   거꾸로 지도에만 있고 파일에 없는 cron 도 막는다(지도가 낡았다).
 *
 *   npm run check:schedules
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';

const MAP = 'docs/예약작업-지도.md';
const fails: string[] = [];
const S = (v: unknown) => String(v ?? '').trim();
const map = readFileSync(MAP, 'utf8');

/** 표 줄 → { file, cron }. 파일 칸은 `xxx.yml`/`vercel.json`, cron 칸은 백틱 안. */
const rows: { file: string; cron: string; extra: string }[] = [];
for (const line of map.split(/\r?\n/)) {
  if (!line.startsWith('|')) continue;
  const cells = line.split('|').slice(1, -1).map(S);
  const file = (cells[0] || '').replace(/`/g, '');
  if (!/\.(yml|json)$/.test(file)) continue;
  const cronCell = cells.find((c) => /^`[^`]*\*[^`]*`$/.test(c)) || '';
  rows.push({ file, cron: cronCell.replace(/`/g, ''), extra: cells[1] || '' });
}

const seen = new Set<string>();
const WF = '.github/workflows';
for (const f of readdirSync(WF).filter((x) => /\.ya?ml$/.test(x))) {
  const src = readFileSync(`${WF}/${f}`, 'utf8');
  const crons = [...src.matchAll(/^\s*-\s*cron:\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  for (const cron of crons) {
    const key = `${f} ${cron}`; seen.add(key);
    if (!rows.some((r) => r.file === f && r.cron === cron)) fails.push(`지도에 없는 예약 — ${f} cron '${cron}' → ${MAP} ① 표에 한 줄 넣는다`);
  }
}
if (existsSync('vercel.json')) {
  const v = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons?: { path: string; schedule: string }[] };
  for (const c of v.crons || []) {
    const key = `vercel.json ${c.schedule}`; seen.add(key);
    if (!rows.some((r) => r.file === 'vercel.json' && r.cron === c.schedule)) fails.push(`지도에 없는 Vercel cron — ${c.path} '${c.schedule}' → ${MAP} ② 표`);
  }
}
for (const r of rows) {
  if (!r.cron) continue;
  if (!seen.has(`${r.file} ${r.cron}`)) fails.push(`지도에만 있는 예약(파일에 없음) — ${r.file} '${r.cron}' — 지도가 낡았다`);
}

/** 규칙 문장 — 지워지면 «어느 AI든 통일»이 문서에서 사라진 것이다. */
for (const phrase of [
  'GitHub Actions(이 저장소 main) 한 곳에만 둔다',
  '운영 판매시트 F01 · 하허호 F86 에 쓰는 것은',
  'production-sheet-write-gate',
  'FREEPASS_MANUAL_PUBLISH_APPROVED',
  '발행 엔진은 하나',
]) if (!map.includes(phrase)) fails.push(`${MAP} 규칙 문장이 사라졌다 — 「${phrase}」`);

/** ★하허호 F86 지키기 — 사장님 2026-09-16 「하허호 시트는 제일 중요하게」. 통합 워크플로에서 이 장치가 빠지면 막는다. */
{
  const wf = readFileSync(`${WF}/erp5-ssot-refresh.yml`, 'utf8');
  for (const [needle, why] of [
    ['scripts/backup-f86.mts', 'F86 발행 직전 백업'],
    ['scripts/build-channel-supplier-sheet.mts', 'F86 발행'],
    ['scripts/audit-f86-vs-atom.mts', 'F86 감사(첫 관문)'],
    ['--max-age-min=', 'F86 신선도 감시'],
    ["steps.snapshot.outcome == 'success'", 'F01 이 실패해도 F86 은 나간다'],
  ] as const) if (!wf.includes(needle)) fails.push(`통합 워크플로에서 「${why}」 가 빠졌다 — ${needle}`);
}

/** AI 규칙 파일들이 이 지도를 가리키는가. */
for (const f of ['AGENTS.md', 'CLAUDE.md', '.cursorrules', 'docs/AI_COLLABORATION.md']) {
  if (existsSync(f) && !readFileSync(f, 'utf8').includes('docs/예약작업-지도.md')) fails.push(`${f} 가 예약 지도(docs/예약작업-지도.md)를 안 가리킨다`);
}

if (fails.length) {
  console.error(`\n⛔ 예약 지도와 실제 예약이 다르다 — ${fails.length}건\n`);
  for (const x of fails) console.error(`  ✗ ${x}`);
  process.exit(1);
}
console.log(`✓ 예약 지도 = 실제 예약 — 표 ${rows.filter((r) => r.cron).length}줄 · 워크플로·Vercel cron 모두 등록됨 · AI 규칙 파일 4곳이 지도를 가리킨다`);
