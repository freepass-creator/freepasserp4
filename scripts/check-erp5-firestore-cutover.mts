import { assertErp5WhitelabelCutoverReady, erp5WhitelabelCutoverRequested } from '../lib/server/erp5-firestore-app';

if (!erp5WhitelabelCutoverRequested()) {
  console.log('HOLD ERP5_WHITELABEL_FIRESTORE_ENABLED=false (기본 안전 상태)');
  process.exit(0);
}

try {
  await assertErp5WhitelabelCutoverReady();
  console.log('PASS ERP5 화이트라벨 전환 영수증과 inventory 대사가 모두 READY');
} catch (error) {
  console.error(`HOLD ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
