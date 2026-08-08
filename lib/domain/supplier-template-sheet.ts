import { EXT_COLORS, INT_COLORS } from './color-master';
import { FUEL_TYPES, PRODUCT_TYPES, VEHICLE_STATES } from '@/lib/intake/entities';

/**
 * 공급사 **제공시트** 표준 양식 — 공급사가 프리패스에 재고를 주는 시트의 규격 1장.
 *
 * ★프리패스 시트와 방향이 반대다. 헷갈리면 원본이 날아간다.
 *   · `inventory-sheet-export.ts` = ERP → 영업자. 프리패스가 **쓴다**.
 *   · 이 파일                      = 공급사 → ERP. 프리패스는 **양식만 배포하고 값은 안 쓴다**.
 *     공급사 시트는 재고의 정본이라 덮어쓰면 원본이 사라진다.
 *
 * 왜 이 열 구성인가 — 발명이 아니라 **실측으로 굳힌 것**이다(2026-08-08 · 시트 18곳).
 *   차량번호·배차상태·차종·구분·옵션·비고는 이미 15곳 전부가 같은 이름으로 쓰고 있었다.
 *   여기서 하는 일은 셋이다.
 *     ① 이름 흔들림을 하나로  — 유종/연료 · 주행거리/km · 외장색/외장 · 내장색/내장 · 최초등록일/최초등록
 *     ② 아무도 안 쓰던 칸을 세움 — 차대번호 0곳 · 연식 0곳 · **사진링크 0곳**
 *        (사진이 190/287 밖에 안 붙던 이유. 열이 없어 셀에 박힌 링크를 긁고 있었다)
 *     ③ 1곳만 쓰던 칸을 표준으로 — 제조사·세부모델·트림·배기량 (RP004 확장판이 사실상 상위집합)
 *        트림이 없으면 매처가 짧은 이름으로 모델을 잠가 검수로 떨어진다(빌린카 16대 실측).
 *
 * ★헤더 위 정책 3줄이 파서를 안 깨는 이유
 *   `sheet-adapters.looksLikeHeader` 는 «칸 하나가 차량번호 그 자체 + 라벨 3칸 이상» 인 행을
 *   헤더로 본다. 정책 블록에는 「차량번호」라는 라벨이 없으므로 헤더로 오인되지 않고,
 *   `resolveHeaderRow` 가 아래 진짜 헤더행을 찾아낸다. 공급사가 정책을 더 적어 행이 밀려도 같다.
 *   ⚠ 그러므로 정책 라벨에 「차량번호」를 쓰면 안 된다.
 */

/**
 * 머리글 — 헤더 위 1줄. **공급사 단위로 한 번만 정하는 것**만 남긴다.
 * 차마다 달라지는 조건(면책금·연령·면허·정비)은 열로 내려갔다 — 한 곳에서만 말하게 한다.
 *
 * ⚠ 이 줄은 아직 읽어서 저장하지 않는다. 파서는 표만 읽는다.
 */
export const POLICY_ROWS: { label: string; hint: string; values?: string[] }[][] = [
  [
    { label: '공급사명', hint: '' },
    // ★이 시트를 «고쳐도 되는가»를 가르는 칸. 보관용은 우리가 채우는 거울이라
    //   여기에 손으로 적으면 반영되지 않고 원본과만 어긋난다.
    { label: '재고 출처', hint: '',
      values: ['공급사 입력(수기)', '홈페이지 자동연동', '공급사 시트 연동(보관용)'] },
    { label: '담당자', hint: '' },
    { label: '연락처', hint: '' },
    // 보증금을 «값»으로 주는 곳과 «규칙»으로 주는 곳이 갈린다(손오공=규칙, 대부분=값).
    { label: '보증금 규칙', hint: '',
      values: ['시트의 보증금 칸에 금액 입력', '대여료 × 약정연수 (12개월=1개월치)', '대여료 × 배율 (국산 2 · 수입 3)'] },
  ],
];

/**
 * 정책 열 — **차마다 다를 수 있어서** 열로 내렸다. 선택지는 정책관리에 실제로 있는 값이다
 * (2026-08-08 실측 · 정책 54건). 괄호 안은 그 값을 쓰는 정책 수.
 *
 * ★공급사가 칠 일은 거의 없다 — 재고에 붙은 정책(`policy_code`, 701대 중 493대)에서 미리 채워
 *   내보낸다. 보고 «틀린 것만» 고치면 된다.
 *
 * ⚠ 지금은 이 열을 읽어 정책으로 되돌리지 않는다. 정책의 정본은 ERP 정책관리다.
 *   여기 고친 값이 자동 반영되진 않는다 — 눈으로 확인하고 정책관리에서 고쳐야 한다.
 */
const POLICY_COLUMNS: { name: string; note: string; field?: string; values?: string[] }[] = [
  // ★이 칸이 우선한다. 코드를 적으면 오른쪽을 일일이 채울 필요가 없다.
  { name: '정책코드', note: 'POL-0047 — 적으면 이 정책이 우선. 오른쪽은 그 정책의 내용(참고)' },

  // ── 자차 ──
  { name: '자차보상', note: '', field: 'own_damage_compensation', values: ['차량가액', '1000만원', '500만원', '400만원'] },
  { name: '자차수리비율', note: '', field: 'own_damage_repair_ratio', values: ['20%', '50%', '100%'] },
  { name: '자차최소면책금', note: '', field: 'own_damage_min_deductible', values: ['50만원', '100만원', '30만원', '200만원'] },
  { name: '자차최대면책금', note: '', field: 'own_damage_max_deductible', values: ['100만원', '50만원', '400만원'] },
  // ── 대물 ──
  { name: '대물보상한도', note: '', field: 'property_compensation_limit', values: ['1억원', '2억원', '10억원', '5천만원', '3천만원'] },
  { name: '대물면책금', note: '', field: 'property_deductible', values: ['30만원', '50만원', '없음'] },
  // ── 대인·자손·무보험 ──
  { name: '대인면책금', note: '', field: 'injury_deductible', values: ['30만원', '50만원', '없음'] },
  { name: '자손보상', note: '', field: 'self_body_accident', values: ['1억원', '5,000만원', '1,500만원'] },
  { name: '자손면책금', note: '', field: 'self_body_deductible', values: ['30만원', '50만원', '없음'] },
  { name: '무보험보상', note: '', field: 'uninsured_damage', values: ['2억원', '없음'] },
  { name: '보험료', note: '', field: 'insurance_included', values: ['보험료 포함', '보험료 별도'] },
  // ── 운전자 ──
  { name: '기본운전자연령', note: '', field: 'basic_driver_age', values: ['만 26세 이상', '만 21세 이상'] },
  { name: '연령인하', note: '', field: 'driver_age_lowering', values: ['협의', '만21세', '만23세', '불가'] },
  { name: '최대연령', note: '', field: 'driver_age_upper_limit', values: ['만 65세 이하', '제한없음', '만 70세 이하', '만 60세 이하'] },
  { name: '면허기간', note: '', field: 'license_period', values: ['1년 이상', '제한없음', '2년 이상', '3년 이상'] },
  { name: '개인운전자범위', note: '', field: 'personal_driver_scope', values: ['계약자 본인+직계가족', '계약자 본인만', '계약자 본인+추가운전자', '협의'] },
  { name: '법인운전자범위', note: '', field: 'business_driver_scope', values: ['계약사업자 임직원 및 관계자', '대표자 본인만', '협의'] },
  { name: '추가운전자', note: '', field: 'additional_driver_allowance_count', values: ['1인', '2인', '불가'] },
  // ── 그 밖의 조건 ──
  // ── 주행 ──
  // 대부분의 공급사는 «정책 한 줄»이면 끝난다 — 기본 주행거리와 1만km 추가 요율.
  // 오토플러스만 매물마다 정액이 달라(실측 54대: 3만·4만·5만 …) 상품리스트에 열을 따로 둔다.
  { name: '기본주행', note: '연 1만km · 연 2만km · 무제한', values: ['연 1만km', '연 2만km', '연 3만km', '무제한', '협의'] },
  { name: '추가주행 방식', note: '1만km 더 탈 때 어떻게 올리는가', values: ['정액', '대여료 비례', '불가', '협의'] },
  { name: '추가주행 금액', note: '정액이면 40000 · 비례면 10%', values: ['30000', '40000', '50000', '5%', '10%'] },
  { name: '정비', note: '', field: 'maintenance_service', values: ['협의', '불포함', '포함'] },
  { name: '대여지역', note: '', field: 'rental_region', values: ['전국', '제주도불가', '협의'] },
  { name: '보증금카드결제', note: '', field: 'deposit_card_payment', values: ['협의', '가능', '불가'] },
  { name: '보증금분납', note: '', field: 'deposit_installment', values: ['협의', '가능', '불가능'] },
];
/** 열 이름 → 정책 레코드 필드. 이관 때 연결된 정책에서 미리 채우는 데 쓴다. */
export const POLICY_COLUMN_FIELDS: { name: string; field: string }[] =
  POLICY_COLUMNS.filter((c) => c.field).map((c) => ({ name: c.name, field: c.field! }));
export const POLICY_COLUMN_NAMES = POLICY_COLUMNS.map((c) => c.name);

/**
 * 표준 열 — **왼쪽부터 렌트사가 채우는 순서**다.
 *   신원(차번) → 지금 팔 수 있나(상태·구분) → 차 스펙 → 사진·메모 → 돈.
 * 자주 바뀌는 칸(배차상태)을 왼쪽에 두어 매일 손대는 열이 스크롤 밖으로 안 나가게 한다.
 */
/**
 * 앞줄 — **차를 특정하는 것만.** 여기까지 채우면 어느 차인지 정해진다.
 * 매일 손대는 칸(상태)을 왼쪽에 둬서 스크롤 밖으로 안 나가게 한다.
 */
const FRONT_COLUMNS: { name: string; note: string; required?: boolean }[] = [
  { name: '차량번호', note: '12가3456. 신차로 번호 전이면 비우고 차대번호를 채운다', required: true },
  { name: '상태', note: '출고가능 / 출고협의 / 출고불가 / 상품화중', required: true },
  { name: '분류', note: '신차렌트 / 중고렌트 / 신차구독 / 중고구독', required: true },
  { name: '제조사', note: '현대 · 기아 · BMW …' },
  // ★자유입력이 맞다. 실측(2026-08-08 · 올릴 수 있는 409대) 결과 차종 검수는 6대(1.5%)뿐이고
  //   신뢰도 high 가 376대다. 1,754종 드롭다운을 고르게 하는 건 그 1.5% 를 위해 나머지를
  //   괴롭히는 셈이고, 정작 틀린 6대는 드롭다운으로도 못 고친다 —
  //   「BMW 120i」→인피니티 I30 · 「E200」→크라이슬러 200 처럼 «짧은 수입차 이름» 문제라
  //   매칭 쪽에서 풀어야 한다.
  // 중요한 건 목록이 아니라 **긴 이름**이다. 트림까지 한 칸에 이어 쓰면 세대·사양까지 잡힌다.
  //
  // ★열 이름이 「차명(트림)」이어야 한다. 「차명」으로 두면 파서가 그 칸을 **model** 로 보내고,
  //   매처가 짧은 이름으로 모델을 잠가 **엉뚱한 세대**를 고른다 —
  //   「쏘나타 디 엣지 DN8 2.0 가솔린 인스퍼레이션」이 1990년대 「쏘나타 II Y3」로 붙었다(실측).
  //   「차명(트림)」은 trim_name 으로 가서 문장 전체를 보고 제대로 잡고, 원문도 추가표기로 남는다.
  //   기존 공급사들이 98.5% 맞는 것도 다들 「모델명(트림)」 열을 쓰기 때문이다.
  { name: '차명(트림)', note: '더 뉴 아반떼 CN7 1.6 가솔린 인스퍼레이션 — 트림까지 한 칸에', required: true },
  { name: '옵션', note: '선루프, 통풍시트 (쉼표로 구분)' },
  { name: '외부색상', note: '흰색 · 검정 …' },
  { name: '내부색상', note: '' },
  { name: '연식', note: '2024' },
  { name: '주행거리', note: '12000 (km, 숫자만)' },
  { name: '연료', note: '가솔린 · 디젤 · 하이브리드 · 전기 · LPG' },
  { name: '배기량', note: '1998 (cc)' },
  // 승합·SUV 는 인승이 곧 상품이다 — 카니발 9인승과 7인승은 손님에게 다른 차다.
  // 재고 701대 중 307대(44%)에 이미 담겨 있는데 담을 칸이 없어 시트로 못 나가고 있었다(실측 2026-08-08).
  { name: '인승', note: '5 · 7 · 9 …' },
  // 표기가 6가지로 갈려 있었다(2WD·AWD·4WD·xDrive·콰트로·4MATIC) — 두 값으로 세운다.
  { name: '구동', note: '2WD · 4WD — 안 적으면 2WD 로 본다' },
];

/**
 * 뒷줄 — 요금 다음에 오는 부가정보와 정책.
 * ⚠ 여기 열 이름에 「N개월」 꼴을 쓰면 안 된다 — 파서가 기간 요금 열로 읽어
 *   장기보증 블록에 붙어 버린다.
 */
const DETAIL_COLUMNS: { name: string; note: string; required?: boolean }[] = [
  { name: '최초등록일', note: '2024-03-15' },
  { name: '사진링크', note: '드라이브 폴더 또는 이미지 URL — 비면 카탈로그에 사진이 안 붙는다' },
  /**
   * 매물마다 1만km 증액이 다른 곳을 위한 칸(오토플러스).
   * 비어 있으면 정책의 「추가주행 금액」을 쓴다 — 보증금과 같은 구조다.
   * 대여료표에는 **가장 낮은 주행 기준 요금만** 적는다. 주행마다 열을 늘리면
   * 오플만 요금 칸이 760개가 된다(실측) — 접으면 391개로 준다.
   */
  { name: '1만km증액', note: '이 차만 다르면 적는다. 비면 정책값을 쓴다' },
  { name: '차대번호', note: 'KMHxxxxxxxxxxxxxx — 번호판 나오기 전 신차를 붙잡는 유일한 신원' },
  { name: '비고', note: '' },
];

/**
 * 기간 표준 — **1 · 12 · 24 · 36 · 48 · 60개월**(2026-08-08 확정).
 * 단기보증이 1·12를, 장기보증이 24~60을 관할한다. 파서의 보증 블록 스코프에 맞춘 배치라
 * 순서를 바꾸면 보증금이 엉뚱한 기간에 붙는다.
 */
export const SHORT_PERIODS = ['1', '12'] as const;
export const LONG_PERIODS = ['24', '36', '48', '60'] as const;
/** 표준 밖 기간을 렌트사가 직접 적는 여백. 제목을 바꿔 쓰는 칸이라 값이 아니라 «이름»이 자리표시다. */
export const FREE_PERIOD_SLOTS = ['기타기간①', '기타기간②', '기타기간③'] as const;

/** price 키 → 열 이름. `24` → 「24개월」 · `24_2만` → 「24개월2만」(파서가 되읽을 수 있는 표기). */
export const periodColumnName = (key: string) => {
  const [months, km] = key.split('_');
  return `${months}개월${km || ''}`;
};

/**
 * 기간 열의 «주행 기준»을 사람이 읽을 말로.
 *
 * 기간마다 약정주행이 다른 공급사가 있다 — 오토플러스는 12개월만 3만km 기준이고
 * 18·24·36개월은 2만/3만이 따로 있다. 열 이름만으로는 「12개월」이 무슨 주행인지 알 수 없어
 * 영업이 손님에게 잘못 말한다. 헤더 셀 메모로 붙여 둔다(행을 안 먹는다).
 */
export const periodColumnNote = (key: string): string => {
  const [months, km] = key.split('_');
  if (!km) return '월 대여료(원, 숫자만)';
  return `${months}개월 · 약정주행 연 ${km}km 기준 · 월 대여료(원, 숫자만)`;
};

/**
 * 기간 열을 만든다. 표준 6종은 늘 두고, **그 공급사가 실제로 쓰는 기간만** 덧붙인다.
 *
 * 왜 덧붙이나 — 오토플러스는 18개월과 주행 변형(24개월2만·24개월3만)을 쓴다(179대, 실측).
 * 표준 6종에만 우겨넣으면 같은 개월에서 하나만 남고 나머지 요금이 조용히 사라진다.
 * 표준은 «이름과 순서»를 정하는 것이지 있는 값을 버리라는 뜻이 아니다.
 */
export function buildPeriodColumns(usedKeys: string[] = []): { name: string; note: string; required?: boolean }[] {
  const monthOf = (k: string) => Number(k.split('_')[0]) || 0;
  const extra = usedKeys.filter((k) => !SHORT_PERIODS.includes(k as never) && !LONG_PERIODS.includes(k as never));
  const short = [...SHORT_PERIODS, ...extra.filter((k) => monthOf(k) < 24)];
  const long = [...LONG_PERIODS, ...extra.filter((k) => monthOf(k) >= 24)];
  const sortKeys = (ks: string[]) => [...new Set(ks)].sort((a, b) => monthOf(a) - monthOf(b) || a.localeCompare(b));
  return [
    { name: '단기보증', note: '보증금(원). 오른쪽 단기 기간을 관할한다', required: true },
    ...sortKeys(short).map((k) => ({ name: periodColumnName(k), note: periodColumnNote(k) })),
    { name: '장기보증', note: '보증금(원). 오른쪽 장기 기간을 관할한다', required: true },
    ...sortKeys(long).map((k) => ({ name: periodColumnName(k), note: periodColumnNote(k) })),
    // 표준 밖 기간을 파는 렌트사를 위한 여백 3칸.
    // 파서는 **헤더 이름**으로 기간을 잡으므로(`\d+개월` + 선택적 `N만`), 렌트사가 이 칸의
    // «제목»을 「18개월」·「24개월2만」 으로 바꿔 쓰면 그대로 연동된다. 비워 두면 무시된다 —
    // 「기타기간①」 은 어느 패턴에도 안 걸리므로 안전한 자리표시다.
    ...FREE_PERIOD_SLOTS.map((name, i) => ({
      name,
      note: i === 0 ? '다른 기간을 팔면 이 칸의 «제목»을 18개월 처럼 바꿔 쓰세요 (보증금은 장기보증 적용)' : '',
    })),
  ];
}

/** 기본 표준 열 — 기간은 표준 6종만. 공급사별 확장은 `buildColumns` 를 쓴다. */
/** 상품리스트 탭의 정책 칸은 **가리키는 칸 하나뿐**이다. 내용은 「정책」 탭이 정의한다 —
 *  같은 조건을 차마다 22칸씩 되풀이하면 한 곳만 고쳐도 나머지가 어긋난다. */
const POLICY_REF_COLUMN: { name: string; note: string; required?: boolean } = {
  name: '정책코드', note: 'POL-0047 — 「정책」 탭에서 그 코드의 조건을 정의한다',
};

export const TEMPLATE_COLUMNS = [...FRONT_COLUMNS, ...buildPeriodColumns(), POLICY_REF_COLUMN, ...DETAIL_COLUMNS];

/** 공급사가 실제로 쓰는 기간을 반영한 열 구성. */
export const buildColumns = (usedKeys: string[] = []) =>
  [...FRONT_COLUMNS, ...buildPeriodColumns(usedKeys), POLICY_REF_COLUMN, ...DETAIL_COLUMNS];


export const ROW_HEADER = 0;          // 0행 헤더 — 바로 아래가 상품이다

export const ROW_DATA = 1;            // 1행부터 상품

/**
 * 값이 정해진 열 → 드롭다운. 오타 하나가 매물 유실이라 입력에서 막는다.
 *
 * ★목록을 여기에 베껴 적지 않는다. ERP 상수를 그대로 끌어 쓴다 —
 *   베껴 두면 ERP 만 바뀌었을 때 시트가 옛 어휘를 계속 권하고, 그 차이는 아무도 못 본다.
 *   제조사는 차종마스터가 정본이라 `buildColumns` 를 부르는 쪽에서 넣어 준다.
 */
export const VALUE_LISTS: Record<string, readonly string[]> = {
  // 공급사 시트에 «계약중»은 없다 — ERP 내부 상태다(계약금 확인 엔진 전용).
  상태: VEHICLE_STATES.filter((v) => v !== '계약중' && v !== '즉시출고'),
  분류: PRODUCT_TYPES,
  연료: FUEL_TYPES,
  외부색상: EXT_COLORS,
  내부색상: INT_COLORS,
  // 실측 분포(2026-08-08): 5 · 9 · 7 · 4 · 8 · 11 · 6 · 12 · 15
  인승: ['5', '7', '9', '4', '6', '8', '11', '12', '15'],
  구동: ['2WD', '4WD'],
};

/**
 * 연식 — 올해+1(선출고 신차) 부터 **10년 전까지**.
 * 렌터카로 도는 차가 그 안이다. 목록이 길면 고르기만 힘들고, 더 오래된 차는 손으로 치면 된다
 * (`strict: false` 라 목록 밖 값도 들어간다). 손으로 적으면 해가 바뀔 때 낡으므로 계산한다.
 */
export function yearOptions(thisYear: number): string[] {
  return Array.from({ length: 12 }, (_, i) => String(thisYear + 1 - i));
}

/**
 * 시트에 올릴 값 표 — **첫 줄이 헤더, 둘째 줄부터 상품**이다.
 * 안내문을 행으로 두지 않는다. 행이면 사람이 지우다 헤더까지 건드리고, 파서도 한 줄을
 * 매물로 볼 뻔한다. 설명은 헤더 «셀 메모»로 붙인다(buildTemplateFormat).
 */
export function buildTemplateValues(columns = TEMPLATE_COLUMNS): string[][] {
  return [columns.map((c) => c.name)];
}

type Rec = Record<string, unknown>;
const grid = (gid: number, r0: number, r1: number, c0: number, c1: number) =>
  ({ sheetId: gid, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 });

/**
 * 서식 — 「채우는 칸」과 「읽는 칸」이 한눈에 갈려야 렌트사가 헤맬 일이 없다.
 *   정책 라벨=진회색 배경 · 값칸=노랑(여기 쓰라는 뜻) · 헤더=남색 고정 · 필수열=연빨강 헤더 · 예시행=회색 이탤릭.
 */
export function buildTemplateFormat(
  gid: number,
  columns = TEMPLATE_COLUMNS,
  extra: Record<string, readonly string[]> = {},
  /** 표(Table)로 만들 예정이면 개별 데이터확인은 걸지 않는다 —
   *  표의 열 타입이 그걸 소유해서 「typed columns 에는 허용되지 않는다」로 거부된다. */
  opts: { asTable?: boolean } = {},
): Rec[] {
  const width = columns.length;
  const out: Rec[] = [];

  // 헤더 — 남색 바탕 흰 글씨. 필수 열만 밝은 글씨로 구분한다.
  out.push({
    repeatCell: {
      range: grid(gid, ROW_HEADER, ROW_HEADER + 1, 0, width),
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.13, green: 0.20, blue: 0.33 },
          textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } },
          horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
    },
  });
  for (const [i, c] of columns.entries()) {
    if (c.required) {
      out.push({
        repeatCell: {
          range: grid(gid, ROW_HEADER, ROW_HEADER + 1, i, i + 1),
          cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 0.80, blue: 0.55 } } } },
          fields: 'userEnteredFormat.textFormat',
        },
      });
    }
    // 설명은 «셀 메모»로. 행을 안 먹고, 마우스만 올리면 보인다.
    if (c.note) {
      out.push({
        repeatCell: {
          range: grid(gid, ROW_HEADER, ROW_HEADER + 1, i, i + 1),
          cell: { note: c.note }, fields: 'note',
        },
      });
    }
  }

  out.push({
    updateSheetProperties: {
      properties: { sheetId: gid, gridProperties: { frozenRowCount: ROW_HEADER + 1, frozenColumnCount: 1 } },
      fields: 'gridProperties(frozenRowCount,frozenColumnCount)',
    },
  });
  // ★기본 필터를 걸지 않는다. 표(Table)로 바꿀 때 «겹치는 필터가 있으면» 변환이 거부된다
  //   ("please remove the filter that overlaps with the conversion area", 실측 2026-08-08).
  //   표는 열 이름 필터를 스스로 제공하므로 잃는 것도 없다.

  // 값이 정해진 열 → 드롭다운. 오타 하나가 매물 유실이 된다.
  for (const [name, values] of Object.entries(opts.asTable ? {} : { ...VALUE_LISTS, ...extra })) {
    if (!values?.length) continue;
    const c = columns.findIndex((x) => x.name === name);
    if (c < 0) continue;
    out.push({
      setDataValidation: {
        range: grid(gid, ROW_DATA, 500, c, c + 1),
        rule: {
          condition: { type: 'ONE_OF_LIST', values: values.map((v) => ({ userEnteredValue: v })) },
          showCustomUi: true, strict: false,
        },
      },
    });
  }

  out.push({
    updateDimensionProperties: {
      range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 0, endIndex: width },
      properties: { pixelSize: 110 }, fields: 'pixelSize',
    },
  });
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// 「정책」 탭 — 공급사가 쓰는 정책을 **코드 한 줄에 하나씩** 적는다.
//
// 상품리스트는 정책코드로 «가리키기만» 하고 내용은 여기서 정의한다. 조건이 바뀌면 여기 한 줄만
// 고치면 되고, 그 코드를 쓰는 차가 몇 대든 함께 바뀐다.
// 맨 끝 「특이사항」은 공급사가 자기 사정을 자유롭게 적는 칸이다 — 우리 어휘로 못 담는 것들
// (예: "탁송 제주 불가", "주말 출고 불가", "선납 시 할인").
// ────────────────────────────────────────────────────────────────────────────

export const POLICY_TAB_NAME = '정책';
const POLICY_BLANK_COLS = 3;      // 새 정책을 적을 빈 칸

/**
 * 「정책」 탭은 **세로가 항목, 가로가 정책**이다.
 *
 * 정책은 공급사당 두어 개인데 항목은 스무 개가 넘는다. 정책을 행으로 두면 오른쪽으로 한없이
 * 흘러 한 정책을 다 보려면 스크롤을 해야 한다. 뒤집으면 한 화면에서 정책끼리 «세로로 비교»된다.
 *
 * 맨 아래 「특이사항」은 우리 항목으로 못 담는 조건을 자유롭게 적는 칸이다
 * (예: 주말 출고 불가 · 제주 탁송 불가 · 선납 할인).
 */
/**
 * 정책 탭에 싣는 줄.
 *
 * ★`field`(ERP 정책 필드) 가 없다고 빼면 안 된다. 주행 조건(기본주행·추가주행 방식·금액)은
 *   ERP 정책에 대응 필드가 아직 없지만 **공급사가 반드시 답해야 하는 값**이다.
 *   빼면 물어볼 자리가 사라져 아무도 안 적는다(실측 2026-08-08: 세 줄이 통째로 누락됐다).
 *   미리 채워 줄 수는 없을 뿐이고, 물어보는 것과 채워 주는 것은 다른 일이다.
 */
export const POLICY_TAB_FIELD_ROWS: { name: string; values?: string[] }[] = [
  { name: '정책명' },
  ...POLICY_COLUMNS.filter((c) => c.name !== '정책코드').map((c) => ({ name: c.name, values: c.values })),
  { name: '특이사항' },
];

export function buildPolicyTabValues(policies: Record<string, string>[]): string[][] {
  const cols = policies.length + POLICY_BLANK_COLS;
  const row = (label: string, pick: (p: Record<string, string>) => string) => [
    label,
    ...policies.map(pick),
    ...Array(POLICY_BLANK_COLS).fill(''),
  ];
  return [
    row('정책코드', (p) => String(p['정책코드'] ?? '')),
    ...POLICY_TAB_FIELD_ROWS.map((f) => row(f.name, (p) => String(p[f.name] ?? ''))),
  ].map((r) => r.slice(0, cols + 1));
}

export function buildPolicyTabFormat(gid: number, policyCount: number): Rec[] {
  const width = policyCount + POLICY_BLANK_COLS + 1;
  const rows = POLICY_TAB_FIELD_ROWS.length + 1;         // 정책코드 줄 + 항목들
  const out: Rec[] = [];

  // 첫 줄(정책코드) — 남색 바탕 흰 글씨.
  out.push({
    repeatCell: {
      range: grid(gid, 0, 1, 0, width),
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.13, green: 0.20, blue: 0.33 },
          textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } },
          horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)',
    },
  });
  // 첫 칸(항목 이름) — 회색 굵게.
  out.push({
    repeatCell: {
      range: grid(gid, 1, rows, 0, 1),
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.90, green: 0.91, blue: 0.93 },
          textFormat: { bold: true, fontSize: 10 }, verticalAlignment: 'MIDDLE',
          horizontalAlignment: 'LEFT',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,horizontalAlignment)',
    },
  });
  // 값 칸 — 재고 탭과 같은 규격(10pt · 가운데 세로정렬 · 줄무늬 없음).
  // 두 탭의 글자 크기가 다르면 같은 시트인데 다른 문서처럼 보인다.
  out.push({
    repeatCell: {
      range: grid(gid, 1, rows, 1, width),
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 1, green: 1, blue: 1 },
          textFormat: { fontSize: 10 },
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'CLIP',
        },
      },
      fields: 'userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)',
    },
  });
  // 한 줄 걸러 옅은 회색 — 가로로 눈이 미끄러지지 않게. 재고 탭 줄무늬와 같은 색.
  for (let r = 2; r < rows; r += 2) {
    out.push({
      repeatCell: {
        range: grid(gid, r, r + 1, 0, width),
        cell: { userEnteredFormat: { backgroundColor: { red: 0.97, green: 0.97, blue: 0.98 } } },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  }

  // 항목마다 «가로 한 줄» 드롭다운.
  for (const [i, f] of POLICY_TAB_FIELD_ROWS.entries()) {
    if (!f.values?.length) continue;
    out.push({
      setDataValidation: {
        range: grid(gid, i + 1, i + 2, 1, width),
        rule: {
          condition: { type: 'ONE_OF_LIST', values: f.values.map((v) => ({ userEnteredValue: v })) },
          showCustomUi: true, strict: false,
        },
      },
    });
  }

  // 특이사항 줄은 줄바꿈 — 잘려 보이면 안 적는다.
  out.push({
    repeatCell: {
      range: grid(gid, rows - 1, rows, 1, width),
      cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } },
      fields: 'userEnteredFormat(wrapStrategy,verticalAlignment)',
    },
  });

  out.push({
    updateSheetProperties: {
      properties: { sheetId: gid, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } },
      fields: 'gridProperties(frozenRowCount,frozenColumnCount)',
    },
  });
  out.push({
    updateDimensionProperties: {
      range: { sheetId: gid, dimension: 'ROWS', startIndex: 0, endIndex: rows },
      properties: { pixelSize: 28 }, fields: 'pixelSize',
    },
  });
  out.push({
    updateDimensionProperties: {
      range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 150 }, fields: 'pixelSize',
    },
  });
  out.push({
    updateDimensionProperties: {
      range: { sheetId: gid, dimension: 'COLUMNS', startIndex: 1, endIndex: width },
      properties: { pixelSize: 220 }, fields: 'pixelSize',
    },
  });
  return out;
}

/**
 * 탭을 다시 쓸 때 **옛 서식을 지운다.**
 *
 * values clear 는 값만 지운다 — 서식·드롭다운·셀메모는 남는다. 배치가 바뀌면(헤더가 4행에서
 * 0행으로 내려오는 식) 옛 헤더색·설명행 회색이 엉뚱한 데이터 줄에 그대로 붙어
 * "헤더 밑에 헤더가 하나 더 있는" 화면이 된다(실측 2026-08-08).
 */
export function resetSheetRequests(gid: number): Rec[] {
  const all = { sheetId: gid, startRowIndex: 0, endRowIndex: 2000, startColumnIndex: 0, endColumnIndex: 80 };
  return [
    { repeatCell: { range: all, cell: {}, fields: 'userEnteredFormat' } },
    { repeatCell: { range: all, cell: {}, fields: 'note' } },
    { setDataValidation: { range: all } },
    { updateSheetProperties: {
        properties: { sheetId: gid, gridProperties: { frozenRowCount: 0, frozenColumnCount: 0 } },
        fields: 'gridProperties(frozenRowCount,frozenColumnCount)',
    } },
  ];
}


/**
 * 구글시트 **「표(Table)」** 로 만든다 — 드롭다운이 «칩(알약)» 으로 뜨는 유일한 길이다.
 *
 * 일반 데이터확인(`setDataValidation`)은 화살표로만 나온다. 규칙에 표시 스타일을 담는 자리가
 * 아예 없다(`DataValidationRule` = strict·condition·showCustomUi·inputMessage, 실측 2026-08-08).
 * 표의 열 타입 `DROPDOWN` 이 칩 렌더링을 맡는다. 덤으로 머리행 고정·줄무늬·열 이름 필터가 딸려온다.
 */
export function buildTableRequest(
  gid: number,
  columns = TEMPLATE_COLUMNS,
  extra: Record<string, readonly string[]> = {},
  rowCount = 500,
): Rec {
  const lists: Record<string, readonly string[]> = { ...VALUE_LISTS, ...extra };
  return {
    addTable: {
      table: {
        name: '재고',
        range: { sheetId: gid, startRowIndex: ROW_HEADER, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: columns.length },
        rowsProperties: {
          headerColorStyle: { rgbColor: { red: 0.13, green: 0.20, blue: 0.33 } },
          firstBandColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
          secondBandColorStyle: { rgbColor: { red: 0.97, green: 0.97, blue: 0.98 } },
        },
        columnProperties: columns.map((c, i) => {
          const values = lists[c.name];
          if (values?.length) {
            return {
              columnIndex: i,
              columnName: c.name,
              columnType: 'DROPDOWN',
              dataValidationRule: {
                condition: { type: 'ONE_OF_LIST', values: values.map((v) => ({ userEnteredValue: v })) },
              },
            };
          }
          /**
           * 금액·주행은 **글자**로 둔다.
           *
           * 표(Table)에서는 열 타입만 표시를 정한다 — `repeatCell` 숫자서식이 통째로 무시된다
           * (실측 2026-08-08). DOUBLE 은 「1070000」로 붙어 자리수를 눈으로 세야 하고,
           * CURRENCY 는 「₩1,070,000.00」로 소수점까지 강제한다.
           * 글자로 두고 우리가 「1,070,000」을 써 넣으면 제일 읽기 쉽다.
           * 재유입은 문제없다 — 파서가 숫자 아닌 글자를 걷어내고 읽는다(sim-atom-pipeline 로 지킨다).
           * 대신 시트 안에서 숫자 정렬·합계는 못 한다. 공급사가 그걸 하는 칸이 아니다.
           */
          return { columnIndex: i, columnName: c.name, columnType: 'TEXT' };
        }),
      },
    },
  };
}


/**
 * 숫자 칸 **우측 정렬** — 표를 만든 «뒤»에 건다.
 *
 * 표에서는 숫자서식(`numberFormat`)이 통째로 무시되므로 쉼표는 값에 넣어 두고(글자 열),
 * 정렬만 서식으로 맞춘다. 자리수가 세로로 떨어져야 금액을 눈으로 비교할 수 있다.
 */
export function buildNumberFormats(gid: number, columns = TEMPLATE_COLUMNS, rowCount = 500): Rec[] {
  const out: Rec[] = [];
  for (const [i, c] of columns.entries()) {
    if (!/보증|개월|주행거리|배기량|연식|인승/.test(c.name)) continue;
    out.push({
      repeatCell: {
        range: grid(gid, ROW_DATA, rowCount, i, i + 1),
        cell: { userEnteredFormat: { horizontalAlignment: 'RIGHT' } },
        fields: 'userEnteredFormat.horizontalAlignment',
      },
    });
  }
  return out;
}
