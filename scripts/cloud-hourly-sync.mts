import { mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const DUMP = 'tmp/prepublish-main.json';
const APPLY = process.argv.includes('--apply');

function run(label: string, command: string, args: string[]) {
  console.log(`\n── ${label}`);
  const r = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.error) throw r.error;
  if ((r.status ?? 1) !== 0) throw new Error(`${label} 실패(exit ${r.status})`);
}

mkdirSync('tmp', { recursive: true });
rmSync(DUMP, { force: true });

// 1) 실제 반영 전에 현재 발행기가 무엇을 만들지 파일로 고정한다.
run('PREPUBLISH DRY-RUN', 'npx', ['tsx', 'scripts/publish-origin-tab.mts', `--dump=${DUMP}`]);

// 2) 공급사 원천을 전용 어댑터로 ATOM 화하고, 발행 예정값과 대조한다.
//    한 칸이라도 다르면 여기서 종료되어 F01/ERP 쓰기 단계로 가지 않는다.
run('SSOT ADAPTER GATE', 'npx', ['tsx', 'scripts/ssot-prepublish-gate.mts', `--dump=${DUMP}`]);

if (!APPLY) {
  console.log('\n✓ cloud-hourly-sync dry-run 완료. 실제 반영은 --apply');
  process.exit(0);
}

// 3) 게이트를 통과한 회차만 기존 전체 파이프라인을 실행한다.
run('HOURLY SYNC APPLY', 'npx', ['tsx', 'scripts/hourly-sync.mts', '--apply']);
console.log('\n✓ SOURCE → ADAPTER → ATOM 검증 후 F01 → ERP 동기 완료');
