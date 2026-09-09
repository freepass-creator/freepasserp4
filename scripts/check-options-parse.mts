/**
 * **선택옵션 파서가 «없는 옵션»을 만들지 않는가.** 읽기 전용. 어긋나면 exit 1.
 *
 * ★왜(사장님 2026-09-09 「**선택옵션은 왜 잘못된 정보를 끌고 오는가**」)
 *   파서가 `[,/]` 를 그냥 잘라서 **괄호 안의 콤마까지** 잘랐다. 운영 실측 —
 *   「차체자세제어장치(VDC,ESC,ESP)」가 「차체자세제어장치(VDC」·「ESC」·「ESP)」 셋이 되어
 *   **191대의 손님 카드에 `ESP)` 같은 칩**이 서 있었다. 거짓 조각 383개.
 *   ★숫자까지 오염됐다 — 그 셋이 각각 191대로 집계돼 「많이 달린 옵션」 상위에 올라와 있었다.
 *
 * ⚠ **「고쳤다」를 코드로 못 박는다.** 파서는 한 줄만 건드려도 조용히 되돌아간다 —
 *   되돌아가면 화면에 다시 `ESP)` 가 선다. 오류도 안 나고 아무도 모른다.
 *
 *   npm run check:options
 */
import { parseProductOptions, normalizeProductOptionsText } from '../lib/domain/product';

type Case = { raw: string; want: string[]; why: string };
const CASES: Case[] = [
  { raw: '차체자세제어장치(VDC,ESC,ESP)', want: ['차체자세제어장치(VDC,ESC,ESP)'],
    why: '괄호 안 콤마는 구분자가 아니다 — 이게 191대를 깨뜨리던 그 값이다' },
  { raw: 'MP3, 경사로밀림방지(HAS), 네비게이션', want: ['MP3', '경사로밀림방지(HAS)', '네비게이션'],
    why: '괄호 밖 콤마는 그대로 자른다' },
  { raw: '에어백(운전석, 동승석, 사이드, 커튼), 스마트키', want: ['에어백(운전석, 동승석, 사이드, 커튼)', '스마트키'],
    why: '괄호 안에 콤마가 여럿이어도 한 덩어리' },
  { raw: '전각（가,나）, 뒤', want: ['전각（가,나）', '뒤'],
    why: '전각 괄호도 본다 — 공급사 시트에 둘 다 온다' },
  { raw: '짝안맞음(가,나, 뒤', want: ['짝안맞음(가,나, 뒤'],
    why: '닫히지 않은 괄호는 그 조각에 남긴다 — 잘못 자르느니 붙어 있는 편이 낫다' },
  { raw: '가/나', want: ['가', '나'], why: '슬래시도 구분자다' },
  { raw: '크루즈 컨트롤 (일반), 스마트 크루즈 컨트롤 (SCC)', want: ['크루즈 컨트롤 (일반)', '스마트 크루즈 컨트롤 (SCC)'],
    why: '괄호 앞 공백이 있어도 같다' },
];

let bad = 0;
console.log('\n선택옵션 파서 — 「없는 옵션」을 만들지 않는가\n');
for (const c of CASES) {
  const got = parseProductOptions(c.raw);
  const ok = JSON.stringify(got) === JSON.stringify(c.want);
  if (!ok) { bad += 1; console.log(`  ✗ ${c.raw}\n      나온 것 ${JSON.stringify(got)}\n      바라는 것 ${JSON.stringify(c.want)}\n      ${c.why}`); }
  else console.log(`  ✓ ${c.raw}`);
}

/* 어떤 입력이든 **괄호 짝이 깨진 조각**을 내놓으면 안 된다 — 화면에 「ESP)」 가 서는 꼴이다. */
const broken = CASES.flatMap((c) => parseProductOptions(c.raw))
  .filter((t) => (t.split('(').length - t.split(')').length) < 0 || (t.split('（').length - t.split('）').length) < 0);
if (broken.length) { bad += 1; console.log(`\n  ✗ 괄호가 «닫히기만» 한 조각이 나왔다: ${broken.join(' · ')}`); }

/*
 * ★저장 문자열은 «안 바뀌어야» 한다 — 이 고침은 «읽는 법»이지 «담는 법»이 아니다.
 *   normalizeProductOptionsText 는 잘랐다가 `,` 로 도로 잇기 때문에 결과가 같다.
 *   여기가 깨지면 시트→ERP 로 나르는 길에서 글자가 바뀐다(집 규칙 「있는 걸 그대로 나르기」).
 */
const keep = '차체자세제어장치(VDC,ESC,ESP)';
if (normalizeProductOptionsText(keep) !== keep) {
  bad += 1;
  console.log(`\n  ✗ 저장 문자열이 바뀌었다: ${normalizeProductOptionsText(keep)} ≠ ${keep}`);
} else console.log('\n  ✓ 저장 문자열 그대로 — 나르는 길에서 글자를 바꾸지 않는다');

console.log(bad ? `\n✗ 어긋난 것 ${bad}건\n` : '\n✓ 파서가 「없는 옵션」을 만들지 않는다\n');
process.exit(bad ? 1 : 0);
