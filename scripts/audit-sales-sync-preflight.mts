/** 판매시트 → ERP 파싱·커밋 가드 읽기 전용 사전감사. Firebase/Google에 쓰지 않는다. */
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
process.env.NEXT_PUBLIC_DATA_BACKEND = 'rtdb';
const [{ sheetSyncCommitBlockReason }, { firebaseAdminDatabase }, { fetchSalesInventorySheet }, { readPartners }] = await Promise.all([
  import('../lib/domain/sheet-sync-all'),
  import('../lib/server/firebase-admin'),
  import('../lib/server/sales-inventory-sheet'),
  import('../lib/server/sheet-daily-sync'),
]);

const companyId = String(process.env.SHEET_SYNC_COMPANY_ID || 'freepass').trim();
const db = firebaseAdminDatabase();
const partners = await readPartners(db, companyId);
const fetched = await fetchSalesInventorySheet({ partners });
const reason = sheetSyncCommitBlockReason(fetched);
const pending = fetched.lines.reduce((total, line) => total + line.products.filter((product) => product.is_pending_plate === true).length, 0);
const withoutAllocation = fetched.lines.filter((line) => line.products.some((product) => product.is_pending_plate === true) && !line.plateAlloc);

console.log(`■ 판매시트 ERP 사전감사 — 공급사 ${fetched.lines.length}곳 · 상품 ${fetched.products.length}대 · 번호미정 ${pending}대`);
console.log(`■ 번호미정 영구 부여기록 누락 공급사 ${withoutAllocation.length}곳`);
console.log(reason ? `⛔ 커밋 차단: ${reason}` : '✓ 커밋 경계 통과');
process.exit(reason ? 2 : 0);
