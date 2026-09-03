import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(file, 'utf8');
const failures: string[] = [];

const menuBadges = read('lib/domain/menu-badges.ts');
if (menuBadges.includes("store.list('settlement'")) failures.push('메뉴 뱃지가 정산 원장 전체를 읽습니다.');

for (const file of ['components/TopBar.tsx', 'components/AppTabBar.tsx']) {
  const source = read(file);
  if (!source.includes('needsWorkspaceBadges')) failures.push(`${file}: 상품찾기에서 전역 뱃지 조회를 멈추는 조건이 없습니다.`);
}

if (read('app/m/[code]/page.tsx').includes('sheet-live-status-client')) {
  failures.push('상품 상세가 브라우저 상태 폴링을 실행합니다.');
}
if (read('app/api/sheet/live-status/route.ts').includes('runSheetLiveStatusSync')) {
  failures.push('상태 API가 브라우저 요청으로 동기화를 실행합니다.');
}

const sheetView = read('features/finder/SheetView.tsx');
if (!sheetView.includes('href={detailHref!}\n              prefetch={false}')) {
  failures.push('시트 목록의 상세 링크 자동 선로딩이 꺼져 있지 않습니다.');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('PASS: 상품찾기·공유 흐름의 정산/시트 상태 반복 조회가 차단됐습니다.');
