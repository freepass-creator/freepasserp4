/**
 * 세부트림 확정 검증 — 좁혀진 후보 안에서 여러 방법으로 찾는다.
 * 실행: npx tsx scripts/sim-trim-resolve.mts
 */
import { chosung, resolveTrim, similarity, stripGradeNumber, threshold } from '../lib/domain/vehicle-trim-resolve';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, detail ?? ''); }
};

const CN7 = ['스마트', '모던', '인스퍼레이션'];
const DN8 = ['스마트', '모던', '프리미엄 밀레니얼', '프리미엄', '프리미엄 패밀리', '프리미엄 플러스', '인스퍼레이션'];
const K8 = ['노블레스 라이트', '노블레스', '베스트 셀렉션', '시그니처', '시그니처 블랙', '프레스티지'];

// ── 1. 그대로 포함 — 2글자 트림도 잡아야 한다(옛 코드는 3글자 미만을 건너뛰었다) ──
check('2글자 「모던」을 잡는다',
  resolveTrim('아반떼CN7 런칭 자가용 가솔린 1.6 4도어 A/T 모던', CN7)?.trim === '모던',
  resolveTrim('아반떼CN7 런칭 자가용 가솔린 1.6 4도어 A/T 모던', CN7));
check('「익스클루시브」를 잡는다',
  resolveTrim('쏘나타DN8 The Edge 가솔린 2.0 CVVL 인스퍼레이션', DN8)?.trim === '인스퍼레이션');
// 긴 트림이 먼저다 — 「프리미엄 플러스」인데 「프리미엄」을 집으면 등급이 깎인다.
check('긴 트림을 먼저 집는다',
  resolveTrim('쏘나타 2.0 프리미엄 플러스', DN8)?.trim === '프리미엄 플러스',
  resolveTrim('쏘나타 2.0 프리미엄 플러스', DN8));
check('「시그니처 블랙」이 「시그니처」보다 먼저',
  resolveTrim('K8 하이브리드 시그니처 블랙', K8)?.trim === '시그니처 블랙');

// ── 2. 영문 표기 ──
check('Prestige → 프레스티지', resolveTrim('K8 3.5 LPG Prestige', K8)?.trim === '프레스티지');
check('Signature → 시그니처', resolveTrim('K8 2.5 SIGNATURE', K8)?.trim === '시그니처');
check('Modern → 모던', resolveTrim('Avante CN7 1.6 Modern', CN7)?.trim === '모던');
check('별칭으로 잡으면 how=별칭', resolveTrim('K8 3.5 Prestige', K8)?.how === '별칭');

// ── 3. 오탈자 ──
check('엑스클루시브 → 익스클루시브',
  resolveTrim('쏘나타 2.0 엑스클루시브', ['익스클루시브', '모던'])?.trim === '익스클루시브');
check('프레스티쥐 → 프레스티지', resolveTrim('K8 LPG 프레스티쥐', K8)?.trim === '프레스티지');
check('시그니쳐 → 시그니처', resolveTrim('K8 2.5 시그니쳐', K8)?.trim === '시그니처');
check('오탈자로 잡으면 how=오탈자', resolveTrim('K8 프레스티쥐', K8)?.how === '오탈자');

// ── 4. 초성 ──
check('초성 변환', chosung('프레스티지') === 'ㅍㄹㅅㅌㅈ', chosung('프레스티지'));
check('초성 「ㅍㄹㅅㅌㅈ」 → 프레스티지', resolveTrim('K8 3.5 ㅍㄹㅅㅌㅈ', K8)?.trim === '프레스티지');
check('초성 「ㅇㅅㅋㄹㅅㅂ」 → 익스클루시브',
  resolveTrim('쏘나타 ㅇㅅㅋㄹㅅㅂ', ['익스클루시브', '모던'])?.trim === '익스클루시브');
check('초성으로 잡으면 how=초성', resolveTrim('K8 ㅍㄹㅅㅌㅈ', K8)?.how === '초성');

// ── 5. 유사도 · 후보 수에 따른 문턱 ──
check('후보가 적으면 문턱이 낮다', threshold(2) < threshold(20));
check('유사도 계산', similarity('프레스티지', '프레스티지') === 1);
check('다른 말은 유사도가 낮다', similarity('모던', '인스퍼레이션') < 0.3);

// ── 오탐 방지 — 여기가 제일 중요하다 ──
// 후보에 없는 트림을 지어내면 «없는 등급»을 파는 셈이다.
check('후보에 없으면 안 만든다', resolveTrim('아반떼 1.6 캘리그래피', CN7) === null,
  resolveTrim('아반떼 1.6 캘리그래피', CN7));
check('빈 후보면 null', resolveTrim('아무 글자', []) === null);
check('빈 원문이면 null', resolveTrim('', CN7) === null);
// 「N라인」은 트림이 아니라 디자인 패키지다 — 후보에 N 이 있어도 N라인을 N 으로 붙이면 안 된다.
check('N라인을 N 으로 붙이지 않는다',
  resolveTrim('아반떼 1.6 N라인 인스퍼레이션', ['N', '모던', '인스퍼레이션'])?.trim === '인스퍼레이션',
  resolveTrim('아반떼 1.6 N라인 인스퍼레이션', ['N', '모던', '인스퍼레이션']));
// 숫자만 있는 글에서 트림을 만들어내면 안 된다.
check('숫자뿐이면 안 만든다', resolveTrim('2.0 1600 2025', CN7) === null,
  resolveTrim('2.0 1600 2025', CN7));

// ── 실데이터에서 확인된 오탈자(2026-08-09 실측) ──
check('프레스지티 → 프레스티지(셀토스 5대)',
  resolveTrim('더 2026 셀토스 1.6T 프레스지티', ['프레스티지', '트렌디', '시그니처'])?.trim === '프레스티지');
check('비지니스 → 비즈니스(쏘나타 9대)',
  resolveTrim('쏘나타 디 엣지 LPG 2.0 비지니스', ['비즈니스', '스마트', '모던'])?.trim === '비즈니스');
// 등급 번호가 붙어도 잡아야 한다 — 번호 하나로 통째로 놓치면 아깝다.
check('비지니스2 → 비즈니스', stripGradeNumber('비지니스2') === '비지니스');
check('번호 붙은 트림을 잡는다',
  resolveTrim('쏘나타 디 엣지 LPG 2.0 비지니스2', ['비즈니스', '스마트', '모던'])?.trim === '비즈니스',
  resolveTrim('쏘나타 디 엣지 LPG 2.0 비지니스2', ['비즈니스', '스마트', '모던']));
check('스텐다드 → 스탠다드', resolveTrim('K5 2.0 스텐다드', ['스탠다드', '트렌디'])?.trim === '스탠다드');
// 번호를 떼도 후보에 없으면 여전히 안 만든다.
check('번호 떼도 후보에 없으면 null',
  resolveTrim('쏘나타 캘리그래피2', ['스마트', '모던']) === null,
  resolveTrim('쏘나타 캘리그래피2', ['스마트', '모던']));

// ── 오탈자 스캔(2026-08-09)으로 확인된 것 ──
check('프레스트지 → 프레스티지(골프)', resolveTrim('골프 2.0 TDI 프레스트지', ['프레스티지', '프리미엄'])?.trim === '프레스티지');
check('시그지쳐 → 시그니처(G90)', resolveTrim('G90 3.8 시그지쳐', ['시그니처', '노블레스'])?.trim === '시그니처');
check('인스파레이션 → 인스퍼레이션', resolveTrim('아반떼 1.6 인스파레이션', CN7)?.trim === '인스퍼레이션');

/**
 * ★오탈자 사전에 «비슷한 다른 말»을 넣으면 안 된다.
 *   스캔에서 「아이오닉→아이코닉」·「E클래스→E 클래식」 같은 후보가 나왔는데 전부 **다른 차**다.
 *   넣었으면 현대 아이오닉이 르노 아이코닉 트림을 달았을 것이다.
 */
check('아이오닉을 아이코닉으로 바꾸지 않는다',
  resolveTrim('아이오닉 6 Long Range AWD', ['아이코닉', '모던']) === null,
  resolveTrim('아이오닉 6 Long Range AWD', ['아이코닉', '모던']));
// 벤츠 E-클래스 실제 원문 — 트림 후보는 E300·E350 인데 원문은 E200 이다. 없는 걸 만들면 안 된다.
check('E200 을 E300 으로 올리지 않는다',
  resolveTrim('E클래스(6세대) E200 아방가르드', ['E300 아방가르드', 'E350 아방가르드']) === null,
  resolveTrim('E클래스(6세대) E200 아방가르드', ['E300 아방가르드', 'E350 아방가르드']));
// 「레인지」는 「롱 레인지」의 조각일 뿐이다 — 조각으로 전체를 붙이면 안 된다.
check('레인지 조각으로 롱 레인지를 만들지 않는다',
  resolveTrim('EV6 레인지', ['롱 레인지', '스탠다드']) === null,
  resolveTrim('EV6 레인지', ['롱 레인지', '스탠다드']));

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);

