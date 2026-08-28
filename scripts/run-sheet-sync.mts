/**
 * 시트 동기를 **손으로 한 번** 돌린다 — 검증(드라이런) → 반영.
 *
 * 사장님 「자동 동기화는 아직 하지 말자」라 크론은 꺼져 있다(`SHEET_DAILY_SYNC_ENABLED`).
 * 그래도 «지금 반영해 줘»가 필요할 때가 있어서, 화면의 검증·반영과 **같은 경로**
 * (`runDailySheetSync`)를 그대로 부른다. 다른 경로를 만들면 화면과 결과가 갈린다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/run-sheet-sync.mts                 검증만
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/run-sheet-sync.mts --apply         반영
 *   … --code=RP012        그 공급사만
 *
 * ⚠ `--apply` 는 운영 데이터를 쓴다. 스크립트 자체가 락·백업을 잡는다(runDailySheetSync 안).
 */
/*
 * 화면(Next)은 .env.local 을 알아서 읽지만 스크립트는 안 읽는다.
 * 같은 값을 손으로 다시 넣으면 화면과 갈리므로 그 파일을 그대로 태운다.
 */
import { readFileSync, existsSync } from 'node:fs';
const NL = String.fromCharCode(10);   // 정규식·이스케이프를 파일에 담다 여러 번 먹혀서 코드로 만든다
for (const f of ['.env.local', '.env.development.local']) {
  if (!existsSync(f)) continue;
  for (const raw of readFileSync(f, 'utf8').split(NL)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted = (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    if (value && process.env[key] == null) process.env[key] = value;
  }
}

const { runDailySheetSync } = await import('../lib/server/sheet-daily-sync');

const APPLY = process.argv.includes('--apply');
const codes = process.argv
  .filter((a) => a.startsWith('--code='))
  .map((a) => a.slice('--code='.length).trim())
  .filter(Boolean);

console.log(`${APPLY ? '★반영' : '검증(드라이런 — 아무것도 안 씀)'}${codes.length ? ` · 공급사 ${codes.join(', ')}` : ' · 전체'}\n`);

const result = await runDailySheetSync({ dryRun: !APPLY, providerCodes: codes });

console.log(`상태 ${result.status} · ok=${result.ok}`);
const r = result as unknown as Record<string, unknown>;
for (const key of ['runId', 'backupId', 'startedAt', 'finishedAt']) {
  if (r[key] != null) console.log(`  ${key} = ${String(r[key])}`);
}
const providers = (r.providers || r.results || []) as Record<string, unknown>[];
if (Array.isArray(providers) && providers.length) {
  console.log('\n공급사별:');
  for (const p of providers) {
    const bits = Object.entries(p)
      .filter(([k, v]) => k !== 'issues' && v != null && typeof v !== 'object')
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(' · ');
    console.log(`  ${bits}`);
    const issues = (p.issues || []) as unknown[];
    for (const i of issues.slice(0, 3)) console.log(`      ${String(i).slice(0, 140)}`);
    if (issues.length > 3) console.log(`      … ${issues.length - 3}건 더`);
  }
}
if (!result.ok) {
  console.log('\n막힌 이유:', JSON.stringify(r.blockReason ?? r.error ?? r).slice(0, 600));
  process.exit(1);
}
