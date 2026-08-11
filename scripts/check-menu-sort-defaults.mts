/** 모든 업무 메뉴가 이름 없는 「기본」 대신 실제 기본 정렬을 선언하는지 검사한다. */
import { readFileSync } from 'node:fs';
import { FINDER_DEFAULT_SORT, FINDER_SORTS, emptyBag } from '../features/finder/filter-state';
import { chatFilterDefaultFor, chatSortDefaultFor } from '../features/chat/room-filter';

const pages = [
  ['app/chat/page.tsx', 'recent'],
  ['app/contract/page.tsx', 'date'],
  ['app/inventory/page.tsx', 'status'],
  ['app/members/page.tsx', 'name'],
  ['app/policy/page.tsx', 'name'],
  ['app/settlement/page.tsx', 'date_desc'],
] as const;

let failed = 0;
const check = (label: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failed += 1;
};

for (const [file, value] of pages) {
  const source = readFileSync(file, 'utf8');
  check(`${file} 기본 정렬=${value}`, source.includes(`defaultValue: '${value}'`));
}

check('계약문의 기본 필터=전체', chatFilterDefaultFor('admin') === 'all');
check('계약문의 기본 정렬=최근순', chatSortDefaultFor('admin') === 'recent');
check('상품찾기 기본 정렬=대여료 낮은순',
  FINDER_DEFAULT_SORT === 'asc'
  && emptyBag().sort === FINDER_DEFAULT_SORT
  && FINDER_SORTS.find((option) => option.value === FINDER_DEFAULT_SORT)?.label === '대여료 낮은순');

const webTools = readFileSync('components/WebListTools.tsx', 'utf8');
check('명시적 기본값 화면은 공통 「기본」 항목 제외', webTools.includes('...(sort.defaultValue ? []'));

if (failed) process.exit(1);
