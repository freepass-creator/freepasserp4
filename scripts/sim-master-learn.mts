/**
 * 마스터 학습 규칙 검증 — 목록이 아니라 **규칙**이 맞는지 본다.
 * 실행: npx tsx scripts/sim-master-learn.mts
 */
import {
  DEFAULT_RULES, foldTrim, inScope, linesIn, normalizeTrim, proposeTrims, proposeVariants,
  type EncarTuple,
} from '../lib/domain/master-learn';

let pass = 0; let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.error(`✗ ${name}`, JSON.stringify(detail ?? '')); }
};

// ── 트림 표기 다듬기 ──
check('판매 경로 꼬리표를 뗀다', normalizeTrim('트렌디(택시형)') === '트렌디');
check('렌터카 꼬리표도 뗀다', normalizeTrim('스탠다드(렌터카)') === '스탠다드');
check('인승은 트림이 아니다 — 앞에 붙으면 뗀다', normalizeTrim('9인승 노블레스') === '노블레스');
check('인승만 있으면 트림 아님', normalizeTrim('9인승') === '');
check('구조변경은 트림이 아니다', normalizeTrim('구조변경(LPG)') === '');
check('하이리무진은 트림이 아니다', normalizeTrim('7인승 하이리무진 (특장업체)') === '');
check('「(세부등급 없음)」은 트림 없음', normalizeTrim('(세부등급 없음)') === '');

// ── 접어서 같은 것 ──
check('「+」와 Plus 와 플러스는 같다',
  foldTrim('E-VALUE+') === foldTrim('E-Value Plus') && foldTrim('프리미엄+') === foldTrim('프리미엄 플러스'));
check('등급 꼬리번호는 서로 다른 트림', foldTrim('비즈니스 1') !== foldTrim('비즈니스'));
check('비즈니스 1과 2는 서로 다른 트림', foldTrim('비즈니스 1') !== foldTrim('비즈니스 2'));
check('로마숫자 꼬리도 트림 정체성으로 보존', foldTrim('플래티넘Ⅱ') !== foldTrim('플래티넘'));
check('다른 트림은 다르다', foldTrim('노블레스') !== foldTrim('시그니처'));

// ── 범위(10년) ──
check('단종이 기준 안이면 살린다', inScope('2018'));
check('오래 전 단종은 범위 밖', !inScope('2005'));
check('현행(연식 미기재)은 범위 안', inScope('현재'));

// ── 라인 어휘 ──
check('롱레인지를 읽는다', linesIn('롱레인지 AWD').includes('롱레인지'));
check('영문 Long Range 도 읽는다', linesIn('Long Range 2WD').includes('롱레인지'));
check('RS 를 읽는다', linesIn('1.2 RS').includes('RS'));
// ★「GT라인」은 트림이다 — 라인 어휘로 읽으면 파워트레인이 어긋난다.
check('GT라인은 GT 로 읽지 않는다', !linesIn('롱레인지 GT라인').includes('GT'));
check('GT 단독은 읽는다', linesIn('GT 4WD').includes('GT'));
check('없는 말은 안 만든다', linesIn('가솔린 2.0 AWD').length === 0);

// ── 제안 엔진 ──
const tuples: EncarTuple[] = [
  { maker: '기아', sub_model: 'K5 3세대', badge: '2.0 LPI(렌터카용)', badge_detail: '스탠다드', n: 149 },
  { maker: '기아', sub_model: 'K5 3세대', badge: '2.0 LPI(렌터카용)', badge_detail: '노블레스', n: 80 },
  // ★Badge 가 파워트레인인 것 — 트림으로 올리면 안 된다.
  { maker: '제네시스', sub_model: 'G80', badge: '가솔린 2.5 터보 AWD', badge_detail: '(세부등급 없음)', n: 1256 },
  // 문턱 미만 — 오등록으로 본다.
  { maker: '기아', sub_model: 'K5 3세대', badge: '2.0 LPI', badge_detail: '있을리없는트림', n: 2 },
  // 범위 밖 세대
  { maker: '현대', sub_model: '포니', badge: '1.4', badge_detail: '고급형', n: 40 },
];
const masterTrims: Record<string, string[]> = { 'K5 DL3': ['노블레스', '시그니처', '트렌디'], 'G80 RG3': [], 포니: [] };
const yearEnd: Record<string, string> = { 'K5 DL3': '2023', 'G80 RG3': '현재', 포니: '1982' };
const sub = (t: EncarTuple) => ({ 'K5 3세대': 'K5 DL3', G80: 'G80 RG3', 포니: '포니' }[t.sub_model] ?? null);

const trims = proposeTrims(tuples, (s) => masterTrims[s] || [], (s) => yearEnd[s] || '', sub);
check('결손 트림을 뽑는다', trims.some((p) => p.sub === 'K5 DL3' && p.trim === '스탠다드'), trims.map((p) => p.trim));
check('이미 있는 트림은 안 뽑는다', !trims.some((p) => p.trim === '노블레스'));
check('★Badge(파워트레인)를 트림으로 올리지 않는다', !trims.some((p) => p.sub === 'G80 RG3'), trims);
check('문턱 미만은 버린다', !trims.some((p) => p.trim === '있을리없는트림'));
check('범위 밖 세대는 손대지 않는다', !trims.some((p) => p.sub === '포니'));
check('어느 파워트레인에 붙는지도 같이 준다',
  trims.find((p) => p.trim === '스탠다드')?.badges.join('').includes('LPI') === true);

const vt: EncarTuple[] = [
  { maker: '쉐보레', sub_model: '트랙스 크로스오버', badge: '1.2 RS', badge_detail: '플러스', n: 201 },
  { maker: '현대', sub_model: '아이오닉5', badge: '롱레인지 AWD', badge_detail: '프레스티지', n: 444 },
];
const vSub = (t: EncarTuple) => ({ '트랙스 크로스오버': '트랙스 크로스오버 9BQC', 아이오닉5: '아이오닉5 NE' }[t.sub_model] ?? null);
const vars = proposeVariants(
  vt,
  (s) => (s === '아이오닉5 NE' ? ['전기 롱레인지', '전기 롱레인지 AWD'] : ['가솔린 1.2']),
  () => '현재', vSub,
);
check('담을 자리 없는 라인을 뽑는다', vars.some((p) => p.line === 'RS'), vars.map((p) => `${p.sub}/${p.line}`));
check('이미 담고 있는 라인은 안 뽑는다', !vars.some((p) => p.line === '롱레인지'));
check('그 라인 아래 트림도 같이 준다', vars.find((p) => p.line === 'RS')?.trims.includes('플러스') === true);

// ── 실데이터에서 드러난 노이즈 3종(2026-08-09) ──
check('세대 표기는 트림이 아니다 — 「2세대」', normalizeTrim('2세대') === '');
check('세대코드는 트림이 아니다 — 「WK2」', normalizeTrim('WK2') === '');
check('숫자 세대명은 트림이 아니다 — 파나메라 「970」', normalizeTrim('970') === '');
check('그래도 진짜 트림은 남는다', normalizeTrim('오버랜드') === '오버랜드');
check('「GT Line」과 「GT라인」은 같다', foldTrim('GT Line') === foldTrim('GT라인'));
check('「GT-Line」과 「GT라인」은 같다', foldTrim('GT-Line') === foldTrim('GT라인'));
check('「인스퍼레이션 N Line」과 「… N라인」도 같다',
  foldTrim('인스퍼레이션 N Line') === foldTrim('인스퍼레이션 N라인'));

// 세대 이름에 든 라인 어휘는 축 결손이 아니다 — 「3시리즈 GT」의 GT 는 차 이름이다.
const gtCase = proposeVariants(
  [{ maker: 'BMW', sub_model: '3시리즈 GT', badge: '320d GT', badge_detail: '', n: 195 }],
  () => ['디젤 2.0'], () => '현재', () => '3시리즈 GT F34',
);
check('세대 이름에 든 GT 는 축 결손이 아니다', gtCase.length === 0, gtCase.map((p) => p.line));

// 세대 이름에 든 말은 트림이 아니다 — 코드 모양이 제각각이라 «이름에 있나»로 가른다.
const genInName = proposeTrims(
  [{ maker: '폭스바겐', sub_model: '티구안', badge: '2.0 TDI', badge_detail: '5N', n: 129 }],
  () => [], () => '현재', () => '뉴 티구안 5N',
);
check('세대 이름에 든 「5N」은 트림이 아니다', genInName.length === 0, genInName.map((p) => p.trim));

// ── 신차견적기에서 드러난 노이즈(2026-08-09 · 31건 중 대부분) ──
check('「기본」은 트림이 아니라 «없음»의 표시', normalizeTrim('기본') === '');
check('「기본 모델」도 마찬가지', normalizeTrim('기본 모델') === '');
check('「기본형」은 진짜 트림이라 남긴다', normalizeTrim('기본형') === '기본형');
check('외장 패키지는 트림이 아니다', normalizeTrim('Black Exterior') === '' && normalizeTrim('Black Ink') === '');
check('옵션 패키지도 아니다', normalizeTrim('스포츠 패키지') === '');
check('판매경로 접두를 뗀다 — 「렌터카 트렌디」', normalizeTrim('렌터카 트렌디') === '트렌디');
check('접두만 있으면 빈값', normalizeTrim('렌터카') === '');
check('「Honors」와 「아너스」는 같다', foldTrim('Honors') === foldTrim('아너스'));

check('문턱 기본값은 3대', DEFAULT_RULES.minListings === 3);

console.log(`\n━━ 결과: ${pass}/${pass + fail} 통과`);
if (fail) process.exit(1);
