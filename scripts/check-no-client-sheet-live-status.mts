/**
 * 화면이 판매시트를 직접 다시 읽어 ERP 상태를 덮는 회귀를 막는다.
 * 상태 정본은 hourly-sync가 v4/products에 반영한 값이다. 브라우저 폴링은
 * 비용을 키우고 시트·ERP 대수를 순간적으로 갈라 놓았으므로 금지한다.
 */
import { readFileSync } from 'node:fs';

const CLIENT_FILES = [
  'features/finder/finder-data-store.ts',
  'app/m/[code]/page.tsx',
];
const forbidden = /sheet-live-status-client|\/api\/sheet\/live-status/;
let failed = false;

for (const file of CLIENT_FILES) {
  const source = readFileSync(file, 'utf8');
  if (forbidden.test(source)) {
    console.error(`✗ ${file}: 브라우저 상태 폴링이 다시 들어왔습니다.`);
    failed = true;
  } else {
    console.log(`✓ ${file}: 브라우저 상태 폴링 없음`);
  }
}

const legacyRoute = 'app/api/sheet/live-status/route.ts';
if (/runSheetLiveStatusSync/.test(readFileSync(legacyRoute, 'utf8'))) {
  console.error(`✗ ${legacyRoute}: 일반 요청이 전체 상태 동기화를 다시 실행합니다.`);
  failed = true;
} else {
  console.log(`✓ ${legacyRoute}: 상태 동기화 실행 경로 없음`);
}

if (failed) process.exit(1);
console.log('✓ 상태는 서버 자동동기 결과(v4/products)만 표시합니다.');
