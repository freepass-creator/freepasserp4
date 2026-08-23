/**
 * 판매시트 ERP 반영 1회의 제품 공개 노드를 반영 직전 값으로 되돌린다.
 * 기본은 읽기 전용 미리보기이며 `--apply` 없이는 쓰지 않는다.
 *
 *   npm run rollback:sales-erp -- --run=run_xxx
 *   npm run rollback:sales-erp -- --run=run_xxx --apply
 */
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
process.env.NEXT_PUBLIC_DATA_BACKEND = 'rtdb';

const APPLY = process.argv.includes('--apply');
const sourceRunId = String(process.argv.find((arg) => arg.startsWith('--run=')) || '').slice('--run='.length).trim();
if (!sourceRunId) {
  console.error('사용법: npm run rollback:sales-erp -- --run=<동기화 run id> [--apply]');
  process.exit(2);
}

const { rollbackDailySheetSyncBackup } = await import('../lib/server/sheet-daily-sync');
const result = await rollbackDailySheetSyncBackup({ sourceRunId, dryRun: !APPLY });
console.log(`■ ERP 판매시트 롤백 ${APPLY ? '반영' : '미리보기'} — ${result.status}`);
console.log(`   복구대상 ${result.restorable} · 이미 원본 ${result.untouched} · 충돌 ${result.conflicts}`);
if (result.blockReason) console.log(`   중단사유 ${result.blockReason}`);
process.exit(result.ok ? 0 : 1);
