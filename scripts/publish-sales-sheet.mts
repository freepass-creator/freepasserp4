/**
 * 영업자 시트 반영을 **서버와 똑같은 경로로** 실행한다.
 *
 * 관리자 버튼(`/api/inventory/sheet-export`)·일일 동기화와 같은 함수
 * (`lib/server/inventory-sheet-publish.ts`)를 부른다. CLI 가 따로 표를 만들면
 * 언젠가 다른 표가 나가고, 그때 영업자는 어느 쪽이 «지금»인지 알 수 없다.
 *
 * 고정 탭 두 장에 덮어쓴다 — 「상품리스트」(현행 63열) · 「종합표」(구버전 41열).
 * 탭을 새로 쌓지 않는다.
 *
 *   npx tsx scripts/publish-sales-sheet.mts
 *   SNAPSHOT=1 npx tsx scripts/publish-sales-sheet.mts   (이력용 날짜 탭을 따로)
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { publishInventorySheet } from '../lib/server/inventory-sheet-publish';

const S = (v: unknown) => String(v ?? '').trim();
if (!S(process.env.INVENTORY_EXPORT_SHEET_ID)) {
  console.error('✗ INVENTORY_EXPORT_SHEET_ID 가 없습니다(.env.local 확인).');
  process.exit(1);
}
if (!getApps().length) {
  const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
  initializeApp({
    credential: cert(sa),
    databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app',
  });
}

const result = await publishInventorySheet(getDatabase(), {
  origin: S(process.env.INVENTORY_EXPORT_ORIGIN) || 'https://freepasserp.com',
  snapshot: S(process.env.SNAPSHOT) === '1',
});
console.log(`\n✓ 반영 완료 ${result.count}대`);
console.log(`  현행 표   「${result.tab}」`);
console.log(`  구버전    「${result.jonghap}」`);
console.log(`  ${result.url}`);
