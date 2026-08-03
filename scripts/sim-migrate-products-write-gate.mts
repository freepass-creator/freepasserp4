/** v3→v4 직접 복사 실행은 실데이터 이관계획 승인 전 항상 차단되어야 한다. */

const { migrateV3ProductsToV4 } = await import('../lib/firebase/migrate-products');

let blocked = false;
let message = '';
try {
  await migrateV3ProductsToV4(false);
} catch (error) {
  blocked = true;
  message = String((error as Error).message || error);
}

const ok = blocked && message.includes('직접 복사는 잠겨 있습니다');
console.log(`${ok ? 'PASS' : 'FAIL'} v3→v4 직접 복사 write gate — ${message || '차단되지 않음'}`);
if (!ok) process.exit(1);
