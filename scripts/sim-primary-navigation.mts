import assert from 'node:assert/strict';
import { appTabsFor, isTabRoute } from '../lib/tabbar';

assert.deepEqual(appTabsFor('admin').map((tab) => tab.href), ['/finder', '/contract', '/settlement', '/inventory']);
assert.deepEqual(appTabsFor('provider').map((tab) => tab.href), ['/finder', '/contract', '/inventory']);
// 영업자는 당분간 매물만 — 계약서관리(/esign)는 관리자 메뉴로 갔다(2026-08-19).
assert.deepEqual(appTabsFor('agent').map((tab) => tab.href), ['/finder', '/contract']);
for (const role of ['admin', 'provider', 'agent'] as const) {
  assert.equal(appTabsFor(role).some((tab) => tab.href === '/chat'), false, `${role} 주메뉴에 문의가 남음`);
  assert.equal(appTabsFor(role).some((tab) => tab.href === '/esign'), false, `${role} 하단탭에 계약서관리가 남음`);
  // 계약진행 = 목록+진행상황 화면 — 이동한다(준비중 아님).
  assert.equal(appTabsFor(role).find((tab) => tab.href === '/contract')?.soon, undefined, `${role} 계약진행 탭이 막힘`);
  assert.equal(appTabsFor(role).find((tab) => tab.href === '/finder')?.soon, undefined, `${role} 상품찾기 탭이 막힘`);
}
assert.equal(isTabRoute('/settlement', 'admin'), true);
assert.equal(isTabRoute('/settlement', 'provider'), false);
assert.equal(isTabRoute('/settlement', 'agent'), false);
assert.equal(isTabRoute('/esign', 'admin'), true);
assert.equal(isTabRoute('/esign', 'agent'), false);

console.log('sim-primary-navigation: PASS');
