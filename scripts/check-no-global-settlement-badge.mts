import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(file, 'utf8');
const failures: string[] = [];

const menuBadges = read('lib/domain/menu-badges.ts');
if (menuBadges.includes("store.list('settlement'")) {
  failures.push('메뉴 뱃지가 정산 원장 전체를 읽습니다.');
}

const tabBar = read('components/AppTabBar.tsx');
if (!tabBar.includes('needsWorkspaceBadges ? tabRole : null')) {
  failures.push('상품찾기에서 전역 메뉴 뱃지 조회를 막는 조건이 없습니다.');
}

const topBar = read('components/TopBar.tsx');
if (!topBar.includes('if (!needsWorkspaceBadges)')) {
  failures.push('데스크톱 상단바가 상품찾기에서 전역 메뉴 뱃지를 멈추지 않습니다.');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('PASS: 상품찾기 전역 메뉴가 settlement_rows를 읽지 않습니다.');
