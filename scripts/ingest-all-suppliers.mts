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
const APPLY = process.argv.includes('--apply');
const RETIRE = process.argv.includes('--retire');

let targets = INVENTORY_SOURCES.map((source) => source.partnerCode);
if (ONLY.length) targets = targets.filter((c) => ONLY.includes(c));
console.log(`■ 직접수집 오케스트레이터 ${APPLY ? '반영' : '미리보기'} — 공급사 ${targets.length}곳${VARIABLE ? ' (변동만)' : ''}: ${targets.join(' · ')}\n`);

const RATE = /\b429\b|\b50[0234]\b|rate.?limit|quota|UNAVAILABLE|ECONNRESET|socket hang up/i;
const runOne = (code: string): { ok: boolean; line: string } => {
  const args = code === 'RP023'
    ? [TSX_CLI, '--require', SHIM, REBORN, ...(APPLY ? ['--apply'] : [])]
    : [TSX_CLI, '--require', SHIM, INGEST, `--code=${code}`, ...(APPLY ? ['--apply'] : []), ...(VARIABLE ? ['--variable'] : []), ...(RETIRE ? ['--retire'] : [])];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000 });
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    if (r.status === 0) {
      const line = out.split(/\r?\n/).reverse().find((l) => /반영 완료|변동 폴링 완료|■ --apply|미리보기/.test(l)) || out.split(/\r?\n/).find((l) => /직접 수집|reborncar/.test(l)) || '완료';
      return { ok: true, line: line.trim() };
    }
    if (attempt < 2 && RATE.test(out)) { console.log(`  ${code} ⏳ 한도/일시오류 — 20초 쉬고 재시도`); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20_000); continue; }
    return { ok: false, line: (out.split(/\r?\n/).filter(Boolean).pop() || 'Error').slice(0, 160) };
  }
  return { ok: false, line: 'Error' };
};

let ok = 0, fail = 0;
for (const code of targets) {
  const r = runOne(code);
  console.log(`${r.ok ? '✓' : '✗'} ${code.padEnd(8)} ${r.line}`);
  if (r.ok) ok++; else fail++;
}
console.log(`\n■ 끝 — 성공 ${ok} · 실패 ${fail} / ${targets.length}`);
process.exit(fail > 0 ? 1 : 0);
