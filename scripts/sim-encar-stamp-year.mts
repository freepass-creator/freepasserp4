/**
 * 공급사 차명 「X1(2세대)」+연식 → 엔카 F48 구간. U11 과 섞이면 점검사항에 엔카 코드를 다시 적으라고 한다.
 */
import assert from 'node:assert/strict';
import { inYear, ordinalGen } from '../lib/domain/encar-spec-fill';

const check = (name: string, ok: boolean) => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (!ok) throw new Error(name);
};

console.log('\n══ 엔카 세대 — 차명 N세대 + 연식 구간 ══\n');

check('X1(2세대) 에서 2를 읽는다', ordinalGen('X1(2세대) 20i xDrive x라인 스페셜에디션') === 2);
check('1시리즈(3세대) 에서 3을 읽는다', ordinalGen('1시리즈(3세대) 120i 스포츠') === 3);
check('세대 없으면 0', ordinalGen('xDrive 20i M Sport Pack') === 0);

const f48 = { yearStart: 2016, yearEnd: 2022 };
const u11 = { yearStart: 2023, yearEnd: 2026 };
check('2021 은 F48 안', inYear(f48, 2021) === true);
check('2021 은 U11 밖', inYear(u11, 2021) === false);
check('2022 는 F48 안(끝 해)', inYear(f48, 2022) === true);
check('2023 은 U11 안', inYear(u11, 2023) === true);
check('2023 은 F48 밖', inYear(f48, 2023) === false);

const hit = [f48, u11].filter((a) => inYear(a, 2021));
check('2021 후보가 F48 하나', hit.length === 1 && hit[0] === f48);

console.log('\n  끝\n');
