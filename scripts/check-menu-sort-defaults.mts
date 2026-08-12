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
check('웹 공통 정렬은 이름 없는 「기본」 항목을 만들지 않음',
  !webTools.includes("label: '기본'")
  && webTools.includes('placeholder={sort.defaultValue ? undefined')
  && webTools.includes('options={sort.options.map'));

const mobileTools = readFileSync('components/MobilePageShell.tsx', 'utf8');
check('모바일 공통 정렬은 실제 기본 옵션명으로 복원',
  !mobileTools.includes("placeholder={sortCfg.defaultValue ? undefined : '기본'}")
  && mobileTools.includes('const sortDefaultLabel =')
  && mobileTools.includes('clearLabel={sortDefaultLabel}'));

if (failed) process.exit(1);
