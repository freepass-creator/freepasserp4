/**
 * **ERP 일일 동기를 로컬 코드로 돌린다** — 배포 전에 «지금 고친 로직»으로 ERP(RTDB)를 맞춰 본다.
 *
 * ★사장님 2026-08-20 「로컬에서는 바로 반영되잖아 · 로컬 기준으로 맞추는 거 로직 짜고 배포하자」.
 *   서버 라우트(`/api/sheet/sync-daily`)와 **같은 함수**(`runDailySheetSync`)를 부른다 — 배포본과 결과가 갈리지 않게.
 *   ⚠ 쓰는 곳은 운영 RTDB 다(로컬 DB 가 따로 없다). 그래서 기본은 dry_run 이고 `--apply` 를 줘야 쓴다.
 *
 *   npx tsx scripts/run-sheet-daily-sync-local.mts            # dry-run(무엇이 바뀌는지만)
 *   npx tsx scripts/run-sheet-daily-sync-local.mts --apply
 */
import { readFileSync } from 'node:fs';

process.env.NEXT_PUBLIC_DATA_BACKEND = 'rtdb';
// .env.local — 웹(dev 서버)이 쓰는 값과 같은 환경으로 돌린다(로컬 기준으로 맞추려면 같은 설정이어야 한다).
const NEWLINE = new RegExp('\r?\n');
const ENV_LINE = new RegExp('^\s*([A-Z0-9_]+)\s*=\s*(.*)$');
for (const file of ['.env.local', '.env.development.local']) {
  try {
    for (const line of readFileSync(file, 'utf8').split(NEWLINE)) {
      const m = ENV_LINE.exec(line); if (!m) continue;
      const val = m[2].replace(/^["']|["']$/g, '');
      if (val && !process.env[m[1]]) process.env[m[1]] = val;
    }
  } catch { /* 없으면 건너뛴다 */ }
}

const APPLY = process.argv.includes('--apply');
const { runDailySheetSync } = await import('../lib/server/sheet-daily-sync');
const res = await runDailySheetSync({ dryRun: !APPLY }) as unknown as Record<string, unknown>;
const counts = (res.counts || {}) as Record<string, number>;
console.log(`■ ERP 일일 동기 ${APPLY ? '반영' : '미리보기'} — ${String(res.status || '')}`);
console.log(`   원본 ${counts.sourceRows} · 반영 ${counts.imported} · 신규 ${counts.created} · 갱신 ${counts.updated} · 그대로 ${counts.unchanged} · 값없음 ${counts.noPrice} · 확정 ${counts.confirmed} · 검수 ${counts.review}`);
for (const p of ((res.providers || []) as Record<string, unknown>[]).slice(0, 30)) {
  const c = (p.counts || {}) as Record<string, number>;
  console.log(`   ${String(p.code).padEnd(8)} ${String(p.label || '').padEnd(14)} 원본 ${String(c.sourceRows).padStart(3)} · 신규 ${String(c.created).padStart(3)} · 갱신 ${String(c.updated).padStart(3)}${p.status === 'blocked' ? '  ⛔ ' + String(p.blockReason || '') : ''}`);
}
if ((res as { notes?: string[] }).notes?.length) console.log('   ' + (res as { notes: string[] }).notes.join('\n   '));
process.exit(0);
