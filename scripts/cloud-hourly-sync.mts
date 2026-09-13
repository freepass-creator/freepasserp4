import { spawnSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');

console.log(`\n── CLOUD HOURLY SYNC — ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
console.log('   ①~⑤ 최신화 → ⑥-0 발행 미리보기 → ⑥-1 SOURCE→ADAPTER→ATOM 게이트 → ⑥ F01 → ⑦ ERP');

const args = ['tsx', 'scripts/run-hourly-with-ssot-gate.mts', ...(APPLY ? ['--apply'] : [])];
const result = spawnSync('npx', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

if (result.error) throw result.error;
if ((result.status ?? 1) !== 0) {
  throw new Error(`cloud-hourly-sync 실패(exit ${result.status}) — 게이트 이후 단계는 실행되지 않았습니다.`);
}

console.log(`\n✓ cloud-hourly-sync ${APPLY ? '반영' : '미리보기'} 완료`);
