/**
 * **기계장치를 시험하기 위한 «가짜 검사기» ㉠ — 정직한 쪽.**
 *
 * 이 자는 운영에서 아무것도 안 본다. `check:known-bad` 의 «자가진단»에만 쓰인다.
 * 제 대조군을 갖고 있어서, 탐지기(DETECT)를 무력화하면 «검사기 고장» 을 외치고 exit 1 한다.
 * ⇒ 기계장치는 이 자를 **PASS** 로 판정해야 한다.
 */
const DETECT = /금지된자취/;

const 표본: Array<[string, string, boolean]> = [
  ['잡아야', '여기에 금지된자취 가 있다', true],
  ['말아야', '여기엔 아무것도 없다', false],
];

const 틀린 = 표본.filter(([, 글, 기대]) => DETECT.test(글) !== 기대);
if (틀린.length) {
  console.error(`✗ 검사기 고장 — 대조군 ${틀린.length}개가 어긋난다.`);
  process.exit(1);
}
console.log('✓ 정직한 표본 검사기 — 대조군 통과');
process.exit(0);
