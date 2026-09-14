/**
 * 전 공급사 «원천 직접 → Firestore» 오케스트레이터 — 수동 검증·반영 파이프라인.
 *
 * 사장님 2026-09-04 「나머지 자동화 가자.」 공급사마다 ingest-supplier-to-firestore 를 순서대로 돈다.
 *   - 대상·주소 = inventory-source-registry의 24개 공급사. Firestore partner나 문패 사본으로 덮지 않는다.
 *   - 기본은 미리보기, --apply일 때만 쓴다. 한 곳이 실패(503 등)해도 다음으로 간다.
 *   - 옛 writer와 동시에 켜지지 않도록 자동 schedule은 두지 않는다. 컷오버 전에는 dry-run으로 검증한다.
 *
 * 실행: ERP5_FIREBASE_APPLICATION_CREDENTIALS=tmp/firebase-auth/erp5.json npx tsx scripts/ingest-all-suppliers.mts
 *   --only=RP004,RP031  특정 공급사만 · --variable  변동만(가벼운 회차)
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { INVENTORY_SOURCES } from '../lib/domain/inventory-source-registry';

const TSX_CLI = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url));
const SHIM = fileURLToPath(new URL('./lib/server-only-shim.cjs', import.meta.url));
const INGEST = fileURLToPath(new URL('./ingest-supplier-to-firestore.mts', import.meta.url));
const REBORN = fileURLToPath(new URL('./ingest-reborncar-to-firestore.mts', import.meta.url));
const ONLY = (process.argv.find((a) => a.startsWith('--only='))?.split('=')[1] || '').split(',').map((s) => s.trim()).filter(Boolean);
const VARIABLE = process.argv.includes('--variable');
const STATUS_ONLY = process.argv.includes('--status-only');
const APPLY = process.argv.includes('--apply');
const RETIRE = process.argv.includes('--retire');

let targets = INVENTORY_SOURCES.map((source) => source.partnerCode);
if (ONLY.length) targets = targets.filter((c) => ONLY.includes(c));
console.log(`■ 직접수집 오케스트레이터 ${APPLY ? '반영' : '미리보기'} — 공급사 ${targets.length}곳${STATUS_ONLY ? ' (배차상태만)' : VARIABLE ? ' (변동만)' : ''}: ${targets.join(' · ')}\n`);

const RATE = /\b429\b|\b50[0234]\b|rate.?limit|quota|UNAVAILABLE|ECONNRESET|socket hang up/i;
const runOne = (code: string, apply: boolean): { ok: boolean; line: string } => {
  const args = code === 'RP023'
    ? [TSX_CLI, '--require', SHIM, REBORN, ...(apply ? ['--apply'] : []), ...(STATUS_ONLY ? ['--status-only'] : [])]
    : [TSX_CLI, '--require', SHIM, INGEST, `--code=${code}`, ...(apply ? ['--apply'] : []), ...(apply && (VARIABLE || STATUS_ONLY) ? ['--variable'] : []), ...(STATUS_ONLY ? ['--status-only'] : []), ...(apply && RETIRE ? ['--retire'] : [])];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000 });
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    if (r.status === 0) {
      const line = out.split(/\r?\n/).reverse().find((l) => /반영 완료|변동 폴링 완료|■ --apply|미리보기/.test(l)) || out.split(/\r?\n/).find((l) => /직접 수집|reborncar/.test(l)) || '완료';
      return { ok: true, line: line.trim() };
    }
    if (attempt < 2 && RATE.test(out)) { console.log(`  ${code} ⏳ 한도/일시오류 — 20초 쉬고 재시도`); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20_000); continue; }
    const lines = out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const diagnostic = [...lines].reverse().find((line) => /(?:Error:|PERMISSION_DENIED|UNAUTHENTICATED|credential|permission|denied|ENOENT|EACCES)/i.test(line));
    return { ok: false, line: (diagnostic || lines.at(-1) || 'Error').slice(0, 300) };
  }
  return { ok: false, line: 'Error' };
};

const runPhase = (apply: boolean, label: string): number => {
  let ok = 0, fail = 0;
  console.log(`\n── ${label} ──`);
  for (const code of targets) {
    const r = runOne(code, apply);
    console.log(`${r.ok ? '✓' : '✗'} ${code.padEnd(8)} ${r.line}`);
    if (r.ok) ok++; else fail++;
  }
  console.log(`■ ${label} 끝 — 성공 ${ok} · 실패 ${fail} / ${targets.length}`);
  return fail;
};

if (APPLY) {
  const preflightFailures = runPhase(false, '사전검사(쓰기 0건)');
  if (preflightFailures > 0) {
    console.error('■ 반영 중단 — 모든 원천이 사전검사를 통과해야 Firestore 쓰기를 시작합니다.');
    process.exit(1);
  }
}
const failures = runPhase(APPLY, APPLY ? '반영' : '미리보기');
process.exit(failures > 0 ? 1 : 0);
