/**
 * **정책 항목 값 규격 — 표기의 정본.** 드롭다운 목록·머리글 메모·값 정규화·작성 매뉴얼이 전부 여기서 나온다.
 *
 * ★왜(사장님 2026-08-18 — 「저거를 규격 통일 좀 하고 매뉴얼 만들면 되잖아」 · 「어디는 70만 달랑이고」 ·
 *   「어떤 건 만21세 어떤 건 만71세 이상 이러니까 표기 통일하자」)
 *   실측 2026-08-18: 20곳 정책 탭에 같은 뜻이 서너 표기로 갈려 있었다 —
 *     기본주행 「연 20,000km」×22 · 「연간 2만Km」×8 · 「연간 2.5만Km」 · 연령인하 「만 21세까지」×22 · 「만21세」×8 ·
 *     최대연령 「70」×7 · 연령 하향 요금 「100000」×7 · 위약금 「0.3」×7 · 초과주행 「200」×7 …
 *   뿌리는 규격이 두 곳에 있었던 것이다. 드롭다운 목록(`supplier-template-sheet.POLICY_COLUMNS.values`)과
 *   머리글 메모(`policy-sheet-layout.POLICY_SHEET_FIELDS.note`)가 서로 다른 표기를 권했다.
 *   **정본을 하나로 모은다.** 두 곳은 이 파일을 읽는다.
 *
 * ★표기 원칙 (매뉴얼에 그대로 실린다)
 *   1. 금액은 한글 단위로 붙여 쓴다 — 「50만원」·「100만원」·「5천만원」·「1천5백만원」·「1억원」·「1억5천만원」(사장님 2026-08-18 「보기 편하게」).
 *      쉼표·띄어쓰기 없음. 숫자만(「100000」)·단위 없이(「70만」)·소수 억(「1.5억원」)·쉼표 만원(「5,000만원」)은 쓰지 않는다.
 *      만원 아래는 「200원」·「1,000원」(원 단위만 천 단위 쉼표).
 *   2. 나이는 「만 N세 …」 — 띄어쓰기 하나(「만 21세까지」·「만 26세 이상」·「만 70세 이하」). 숫자만(「70」) 금지.
 *   3. 거리는 「연 20,000km」(소문자 km, 천 단위 쉼표). 「연간 2만Km」 금지.
 *   4. 비율은 「30%」. 「0.3」 금지. 횟수는 「3회」·「연간 5회」. 숫자만 금지.
 *   5. 가·부는 「가능 / 불가 / 협의」 세 말만. 「불가능」·「미제공」은 「불가」·「불포함」으로.
 *   6. 없으면 「없음」. 비워 두는 것과 「없음」은 다르다 — 빈칸은 «아직 안 적음»이다.
 *   7. 자유 서술 칸(전용계좌·특이사항·가입 보험사 등)은 표기 강제 없음. 단 「공급사 기재」 같은 자리표시 문구는 빈칸과 같다.
 *
 * ★추가운전(사장님 2026-08-18)
 *   「추가운전자 1인」은 «몇 명까지»를 묻던 칸이었다. 이제 **「추가운전」은 가능 여부만**(가능/불가/협의),
 *   **「추가운전 요금」에 「N인까지 · 1인당 월 M만원」**으로 인원과 요금을 함께 적는다.
 *   무료면 「N인까지 · 무료」, 인원 제한이 없으면 「제한없음 · 1인당 월 M만원」.
 *
 * ⚠ 정규화는 **뜻이 하나로 정해지는 표기 차이만** 고친다. 뜻이 갈리는 값(「10%」가 정률인지, 「무료 (제주 제외)」)은
 *   고치지 않고 «검토»로 남긴다 — 짐작해서 바꾸면 그게 곧 우리가 만든 오류다.
 */

const S = (value: unknown) => String(value ?? '').trim();
const compact = (value: unknown) => S(value).replace(/\s+/g, '').toLowerCase();

export type PolicyValueKind = 'enum' | 'money' | 'money_or_rate' | 'age_upto' | 'age_min' | 'age_max' | 'km' | 'percent' | 'count' | 'per_year_count' | 'days' | 'text' | 'driver_fee' | 'check';

export type PolicyValueRule = {
  name: string;
  kind: PolicyValueKind;
  /** 드롭다운에 올릴 값(허용값). text 는 없음 */
  allowed: string[];
  /** 매뉴얼에 보일 표기 규격 한 줄 */
  format: string;
  /** 매뉴얼 예시 */
  examples: string[];
  /** 동의어·옛 표기 → 규격값 (compact 비교) */
  synonyms?: Record<string, string>;
  /** enum 이지만 목록 밖의 값도 허용하나(예: 보증금분납 「2회까지」) */
  openEnum?: boolean;
  /** money_or_rate — 정률을 무엇의 %로 읽는가(「대여료의 」). 규격값 앞에 붙는다. 비면 「N%」 그대로. */
  rateLabel?: string;
};

export type PolicyNormalizeResult = {
  value: string;
  status: 'empty' | 'same' | 'fixed' | 'review';
  note?: string;
};

const YESNO = ['가능', '불가', '협의'];
/** 사장님 2026-08-19 — 「정액 00만원 또는 대여료의 00% — 비율이 필요한 곳은 전부 이걸로」 */
export const MONEY_OR_RATE_LIST = ['3만원', '5만원', '7만원', '10만원', '15만원', '20만원', '대여료의 3%', '대여료의 5%', '대여료의 7%', '대여료의 10%', '대여료의 15%', '대여료의 20%'];
const YESNO_SYN: Record<string, string> = { '불가능': '불가', '가능함': '가능', '협의가능': '협의', '상담': '협의', '별도협의': '협의' };

export const POLICY_VALUE_RULES: PolicyValueRule[] = [
  // ★맨 앞 — 심사(사장님 2026-08-19 「무심사 · 소득확인 · 신용조회 3개」). 영업자 화면 뱃지, 손님·계약서엔 안 나감.
  { name: '심사조건', kind: 'enum', allowed: ['무심사', '소득확인', '신용조회'], format: '「무심사 / 소득확인 / 신용조회」', examples: ['소득확인'], synonyms: { '심사없음': '무심사', '없음': '무심사', '신용무관': '무심사', '소득무관': '무심사', '소득': '소득확인', '소득조회': '소득확인', '소득증빙': '소득확인', '신용': '신용조회', '신용확인': '신용조회', '신용심사': '신용조회', '심사필요': '신용조회' } },
  // ── ① 영업자 화면 + 계약서
  { name: '자차보상한도', kind: 'enum', openEnum: true, allowed: ['차량가액', '300만원', '400만원', '500만원', '1천만원', '미가입'], format: '「차량가액」 또는 금액(「500만원」)', examples: ['차량가액', '500만원'], synonyms: { '차량가기준': '차량가액', '차량가': '차량가액', '차량가액기준': '차량가액' } },
  { name: '대물보상한도', kind: 'money', allowed: ['2천만원', '3천만원', '5천만원', '1억원', '2억원', '3억원', '5억원', '10억원'], format: '금액 — 영업용(렌터카) 가입증권대로 「1억원」·「2억원」', examples: ['1억원', '2억원'] },
  { name: '대인보상한도', kind: 'enum', openEnum: true, allowed: ['무한', '1억원', '2억원', '3억원', '5억원'], format: '「무한」 또는 금액', examples: ['무한'], synonyms: { '무제한': '무한' } },
  { name: '자손보상', kind: 'money', allowed: ['1천5백만원', '3천만원', '5천만원', '1억원', '미가입'], format: '금액 — 「1억원」·「5천만원」·「1천5백만원」. 「1.5억원」처럼 소수 억 금지 → 「1억5천만원」', examples: ['1억원', '1천5백만원'] },
  { name: '무보험보상', kind: 'enum', openEnum: true, allowed: ['없음', '1억원', '2억원', '3억원', '5억원'], format: '금액 또는 「없음」', examples: ['2억원', '없음'], synonyms: { '미가입': '없음', '없슴': '없음', '해당없음': '없음' } },
  { name: '기본주행', kind: 'km', allowed: ['연 10,000km', '연 15,000km', '연 20,000km', '연 25,000km', '연 30,000km', '연 40,000km', '무제한', '협의'], format: '「연 20,000km」 — 소문자 km·천 단위 쉼표. 「연간 2만Km」 금지', examples: ['연 20,000km', '연 30,000km'] },
  // 사장님 2026-08-20 — 정비는 «있다/없다»가 아니라 «어디까지»다: 오일교환만 해 주는 곳이 많다. 프리패스 표준은 「미제공」.
  { name: '정비', kind: 'enum', allowed: ['미제공', '연1회오일', '연2회오일', '제공', '협의'], format: '「미제공 / 연1회오일 / 연2회오일 / 제공 / 협의」', examples: ['미제공', '연2회오일'], synonyms: { '불포함': '미제공', '미포함': '미제공', '없음': '미제공', '포함': '제공', '포함됨': '제공', '정비포함': '제공', '연1회 오일': '연1회오일', '연 1회 오일': '연1회오일', '오일1회': '연1회오일', '연2회 오일': '연2회오일', '연 2회 오일': '연2회오일', '오일2회': '연2회오일' } },
  { name: '보증금분납', kind: 'enum', openEnum: true, allowed: ['불가', '가능', '2회까지', '3회까지', '4회까지', '6회까지', '협의'], format: '「가능 / 불가 / 협의」, 횟수가 정해져 있으면 「N회까지」', examples: ['가능', '2회까지'], synonyms: { ...YESNO_SYN, '2회': '2회까지', '3회': '3회까지' } },
  { name: '승계 가능여부', kind: 'enum', allowed: YESNO, format: '「가능 / 불가 / 협의」', examples: ['협의'], synonyms: YESNO_SYN },
  // 사장님 2026-08-19 — 「승계수수료 불가도 있고 · 50 100 200 300 400 500」
  { name: '승계수수료', kind: 'money_or_rate', allowed: ['불가', '50만원', '100만원', '200만원', '300만원', '400만원', '500만원'], format: '「100만원」(정액) — 승계 안 되면 「불가」. 개월분(「월 대여료 1개월분」)도 읽는다', examples: ['100만원', '불가'] },

  // ── ② 영업자 화면
  { name: '자차최소면책금', kind: 'money', allowed: ['없음', '30만원', '50만원', '70만원', '100만원', '150만원', '200만원'], format: '금액 — 「50만원」', examples: ['50만원'] },
  { name: '자차최대면책금', kind: 'money', allowed: ['100만원', '150만원', '200만원', '300만원', '400만원', '500만원', '700만원', '1천만원'], format: '금액 — 「100만원」', examples: ['100만원'] },
  { name: '대물면책금', kind: 'money', allowed: ['없음', '10만원', '20만원', '30만원', '50만원', '100만원'], format: '금액 또는 「없음」', examples: ['30만원', '없음'] },
  { name: '대인면책금', kind: 'money', allowed: ['없음', '10만원', '20만원', '30만원', '50만원', '100만원'], format: '금액 또는 「없음」', examples: ['30만원', '없음'] },
  { name: '자손면책금', kind: 'money', allowed: ['없음', '10만원', '20만원', '30만원', '50만원', '100만원'], format: '금액 또는 「없음」', examples: ['30만원', '없음'] },
  { name: '보험료', kind: 'enum', allowed: ['보험료 포함', '보험료 별도'], format: '「보험료 포함 / 보험료 별도」', examples: ['보험료 포함'], synonyms: { '포함': '보험료 포함', '포함(회사가입)': '보험료 포함', '별도': '보험료 별도', '불포함': '보험료 별도' } },
  { name: '연령인하', kind: 'age_upto', allowed: ['불가', '만 21세까지', '만 22세까지', '만 23세까지', '만 24세까지', '만 25세까지', '협의'], format: '「만 N세까지」 또는 「불가 / 협의」. 「만21세」처럼 붙여 쓰거나 「까지」를 빼지 않는다', examples: ['만 21세까지', '불가'] },
  { name: '연령 하향 요금', kind: 'money_or_rate', rateLabel: '대여료의 ', allowed: [...MONEY_OR_RATE_LIST, '없음', '불가'], format: '월 할증 — 정액 「10만원」 또는 정률 「대여료의 10%」. 둘 중 하나만', examples: ['10만원', '대여료의 10%'] },
  /**
   * ★나이별로 할증이 다를 수 있다(사장님 2026-08-21 「정책에도 21세+ 23세+ 넣어줘 — 대여료의 10% 또는 정액으로 얼마 이거니까」).
   *   비워 두면 「연령 하향 요금」 한 값을 두 나이에 같이 쓴다. 적어 두면 그 나이 값이 이긴다.
   */
  { name: '21세+', kind: 'money_or_rate', rateLabel: '대여료의 ', allowed: [...MONEY_OR_RATE_LIST, '없음', '불가'], format: '만 21세까지 낮출 때 붙는 월 할증 — 정액 「10만원」 또는 정률 「대여료의 10%」. 안 낮춰 주면 「불가」', examples: ['10만원', '대여료의 10%', '불가'] },
  { name: '23세+', kind: 'money_or_rate', rateLabel: '대여료의 ', allowed: [...MONEY_OR_RATE_LIST, '없음', '불가'], format: '만 23세까지 낮출 때 붙는 월 할증 — 정액 「5만원」 또는 정률 「대여료의 5%」. 안 낮춰 주면 「불가」', examples: ['5만원', '대여료의 5%', '불가'] },
  { name: '최대연령', kind: 'age_max', allowed: ['만 60세 이하', '만 65세 이하', '만 70세 이하', '만 75세 이하', '만 80세 이하', '제한없음'], format: '「만 N세 이하」 또는 「제한없음」. 「70」처럼 숫자만 금지', examples: ['만 70세 이하', '제한없음'] },
  { name: '면허기간', kind: 'enum', openEnum: true, allowed: ['제한없음', '6개월 이상', '1년 이상', '2년 이상', '3년 이상', '5년 이상'], format: '「제한없음」 또는 「N년 이상」', examples: ['1년 이상'], synonyms: { '무관': '제한없음', '없음': '제한없음', '1년': '1년 이상', '2년': '2년 이상', '3년': '3년 이상' } },
  { name: '개인운전자범위', kind: 'enum', allowed: ['계약자 본인', '본인+직계가족', '본인+추가운전자', '협의'], format: '「계약자 본인 / 본인+직계가족 / 본인+추가운전자 / 협의」', examples: ['본인+직계가족'], synonyms: { '계약자본인만': '계약자 본인', '본인만': '계약자 본인', '계약자본인': '계약자 본인', '계약자본인+직계가족': '본인+직계가족', '계약자와배우자및직계가족': '본인+직계가족', '본인및직계가족': '본인+직계가족', '계약자본인+추가운전자': '본인+추가운전자' } },
  // 사장님 2026-08-19 — 인원은 「추가운전 인원」에, 요금은 «1인당 월» 정액/정률/무료/불가만. 옛 합성 표기(「1인까지 · 1인당 월 5만원」)는 transpose 가 두 칸으로 가른다.
  // 사장님 2026-08-19 — 「1 2 3 4 5 제한없음 추가인원」 (+불가 = 추가운전 안 받음)
  { name: '추가운전 인원', kind: 'enum', allowed: ['불가', '1인까지', '2인까지', '3인까지', '4인까지', '5인까지', '제한없음'], format: '「N인까지」 또는 「제한없음 / 불가」', examples: ['1인까지'], synonyms: { '1인': '1인까지', '2인': '2인까지', '3인': '3인까지', '4인': '4인까지', '5인': '5인까지', '1명': '1인까지', '2명': '2인까지', '3명': '3인까지', '1': '1인까지', '2': '2인까지', '3': '3인까지', '4': '4인까지', '5': '5인까지', '무제한': '제한없음', '0': '불가', '0인': '불가', '가능': '1인까지' } },
  { name: '추가운전 요금', kind: 'money_or_rate', rateLabel: '대여료의 ', allowed: ['불가', '무료', ...MONEY_OR_RATE_LIST], format: '1인당 월 — 정액 「5만원」 또는 정률 「대여료의 5%」. 무료면 「무료」, 안 받으면 「불가」', examples: ['5만원', '대여료의 5%', '무료'] },
  // 사장님 2026-08-19 — 「3 5 7 10 15 20만원 정액 / 대여료의 3 5 7 10 20%」
  { name: '추가주행 금액', kind: 'money_or_rate', rateLabel: '대여료의 ', allowed: [...MONEY_OR_RATE_LIST, '불가', '협의'], format: '1만km 더 탈 때 붙는 월 금액 — 정액 「10만원」 또는 정률 「대여료의 10%」. 둘 중 하나만', examples: ['10만원', '대여료의 10%'] },
  { name: '대여지역', kind: 'enum', openEnum: true, allowed: ['전국', '제주도 불가', '협의'], format: '「전국 / 제주도 불가 / 협의」', examples: ['전국'], synonyms: { '제주도불가': '제주도 불가', '제주불가': '제주도 불가', '제주제외': '제주도 불가' } },
  // 사장님 2026-08-19 — 「전액지원 / 일부지원 / 고객부담」
  // 제주는 원래 전부 제외(사장님 2026-08-19)라 「무료(제주 제외)」=전액지원. 따로 적지 않는다.
  { name: '탁송비', kind: 'enum', allowed: ['전액지원', '일부지원', '고객부담'], format: '「전액지원 / 일부지원 / 고객부담」. 제주는 어디나 제외라 따로 적지 않는다. 그 밖의 지역 예외는 특이사항에', examples: ['전액지원'], synonyms: { '무료': '전액지원', '전액': '전액지원', '회사부담': '전액지원', '무료(제주제외)': '전액지원', '무료제주제외': '전액지원', '전액지원(제주제외)': '전액지원', '유료': '고객부담', '고객': '고객부담', '일부지역무료': '일부지원', '일부지역': '일부지원', '일부': '일부지원', '협의': '일부지원' } },
  { name: '불가조건 1', kind: 'text', allowed: [], format: '계약이 안 되는 조건 하나 — 「3년 이내 음주이력」', examples: ['3년 이내 음주이력', '개인회생 진행 중', '면허 정지·취소 이력'] },
  { name: '불가조건 2', kind: 'text', allowed: [], format: '계약이 안 되는 조건 하나 — 「3년 이내 음주이력」', examples: ['3년 이내 음주이력', '개인회생 진행 중', '면허 정지·취소 이력'] },
  { name: '불가조건 3', kind: 'text', allowed: [], format: '계약이 안 되는 조건 하나 — 「3년 이내 음주이력」', examples: ['3년 이내 음주이력', '개인회생 진행 중', '면허 정지·취소 이력'] },
  { name: '불가조건 4', kind: 'text', allowed: [], format: '계약이 안 되는 조건 하나 — 「3년 이내 음주이력」', examples: ['3년 이내 음주이력', '개인회생 진행 중', '면허 정지·취소 이력'] },
  { name: '특이사항', kind: 'text', allowed: [], format: '영업자가 알아야 할 조건을 짧게. 여러 개면 「/」로', examples: ['21,23세 대여는 법인/사업자만 가능'] },
  // ⑩ 제출서류 — 체크박스(사장님 2026-08-19 「제출서류는 체크하게」). 값은 TRUE/FALSE.
  { name: '본인서명사실확인서', kind: 'check', allowed: [], format: '체크', examples: ['TRUE'] },
  { name: '가족관계증명서', kind: 'check', allowed: [], format: '체크', examples: ['TRUE'] },
  { name: '주민등록등초본', kind: 'check', allowed: [], format: '체크', examples: ['TRUE'] },
  { name: '운전경력증명서', kind: 'check', allowed: [], format: '체크', examples: ['TRUE'] },
  { name: '소득자료(계좌)', kind: 'check', allowed: [], format: '체크', examples: ['TRUE'] },
  { name: '소득자료(기관)', kind: 'check', allowed: [], format: '체크', examples: ['TRUE'] },
  { name: '필요서류 1', kind: 'text', allowed: [], format: '체크 여섯 밖에 더 받는 서류 하나 — 「재직증명서」', examples: ['재직증명서', '사업자등록증', '건강보험 자격득실확인서'] },
  { name: '필요서류 2', kind: 'text', allowed: [], format: '체크 여섯 밖에 더 받는 서류 하나 — 「재직증명서」', examples: ['재직증명서', '사업자등록증', '건강보험 자격득실확인서'] },
  { name: '필요서류 3', kind: 'text', allowed: [], format: '체크 여섯 밖에 더 받는 서류 하나 — 「재직증명서」', examples: ['재직증명서', '사업자등록증', '건강보험 자격득실확인서'] },
  { name: '필요서류 4', kind: 'text', allowed: [], format: '체크 여섯 밖에 더 받는 서류 하나 — 「재직증명서」', examples: ['재직증명서', '사업자등록증', '건강보험 자격득실확인서'] },
  { name: '기타사항 1', kind: 'text', allowed: [], format: '위 항목에 없는 계약조건 하나 — 계약서 특약 칸에 그대로 실린다', examples: ['블랙박스 임의 탈거 시 손해배상', '연 2회 이상 사고 시 보험료 차액 부담'] },
  { name: '기타사항 2', kind: 'text', allowed: [], format: '위 항목에 없는 계약조건 하나 — 계약서 특약 칸에 그대로 실린다', examples: ['블랙박스 임의 탈거 시 손해배상', '연 2회 이상 사고 시 보험료 차액 부담'] },
  { name: '기타사항 3', kind: 'text', allowed: [], format: '위 항목에 없는 계약조건 하나 — 계약서 특약 칸에 그대로 실린다', examples: ['블랙박스 임의 탈거 시 손해배상', '연 2회 이상 사고 시 보험료 차액 부담'] },
  { name: '기타사항 4', kind: 'text', allowed: [], format: '위 항목에 없는 계약조건 하나 — 계약서 특약 칸에 그대로 실린다', examples: ['블랙박스 임의 탈거 시 손해배상', '연 2회 이상 사고 시 보험료 차액 부담'] },

  // ── ③ 계약서 조문
  { name: '자차수리비율', kind: 'percent', allowed: ['20%', '30%', '50%'], format: '「20%」', examples: ['20%'] },
  { name: '기본운전자연령', kind: 'age_min', allowed: ['만 21세 이상', '만 23세 이상', '만 24세 이상', '만 25세 이상', '만 26세 이상', '만 27세 이상', '만 30세 이상'], format: '「만 N세 이상」. 「26」처럼 숫자만 금지', examples: ['만 26세 이상'] },
  { name: '긴급출동', kind: 'per_year_count', allowed: ['없음', '연간 2회', '연간 3회', '연간 4회', '연간 5회', '연간 6회', '무제한'], format: '「연간 N회」 또는 「무제한 / 없음」', examples: ['연간 5회'] },
  { name: '대차 제공', kind: 'enum', allowed: ['불가', '동급 대차', '협의'], format: '「불가 / 동급 대차 / 협의」', examples: ['불가'], synonyms: { '미제공': '불가', '없음': '불가', '제공': '동급 대차', '동급': '동급 대차' } },
  { name: 'GPS 장착', kind: 'enum', allowed: ['장착', '미장착'], format: '「장착 / 미장착」', examples: ['장착'], synonyms: { '있음': '장착', '없음': '미장착', '설치': '장착', '미설치': '미장착', 'GPS 장착': '장착', 'GPS 설치': '장착', 'GPS 있음': '장착', 'GPS 미장착': '미장착', 'GPS 미설치': '미장착', 'GPS 없음': '미장착' } },
  { name: '사고 다발 해지기준', kind: 'count', allowed: ['없음', '2회', '3회', '4회', '5회'], format: '「N회」 — 1년 내 과실 50% 이상 사고 횟수. 숫자만 금지', examples: ['3회'] },

  // ── ④ 아직 안 쓰임
  { name: '중도해지 위약금 1년미만', kind: 'money_or_rate', allowed: ['10%', '15%', '20%', '25%', '30%', '35%', '40%', '월 대여료 1개월분', '월 대여료 2개월분', '월 대여료 3개월분'], format: '정률 「30%」(잔여 대여료의) / 개월분 「월 대여료 2개월분」 / 정액 「100만원」 — 둘을 같이 쓰지 않는다', examples: ['30%', '월 대여료 2개월분'] },
  { name: '중도해지 위약금 1년이상', kind: 'money_or_rate', allowed: ['10%', '15%', '20%', '25%', '30%', '월 대여료 1개월분', '월 대여료 2개월분'], format: '정률 「20%」(잔여 대여료의) / 개월분 / 정액', examples: ['20%'] },
  { name: '초과주행 국산(1km당)', kind: 'money', allowed: ['100원', '150원', '200원', '250원', '300원'], format: '1km당 「N원」. 숫자만 금지', examples: ['200원'] },
  { name: '초과주행 수입(1km당)', kind: 'money', allowed: ['200원', '300원', '400원', '500원'], format: '1km당 「N원」', examples: ['400원'] },
  { name: '법인운전자범위', kind: 'enum', openEnum: true, allowed: ['임직원', '임직원+가족', '대표자 본인', '협의'], format: '「임직원 / 임직원+가족 / 대표자 본인 / 협의」', examples: ['임직원+가족'], synonyms: { '법인임직원및계약자가족': '임직원+가족', '계약사업자임직원및관계자': '임직원', '법인임직원': '임직원', '임직원및관계자': '임직원', '대표자본인만': '대표자 본인', '대표자만': '대표자 본인' } },
  // ★한 칸에 「불가」 아니면 수수료율(사장님 2026-08-21 「거기에 불가 또는 수수료율만 적어놓으면 되겄네」).
  //   수수료 칸을 따로 두지 않는다. 옛 값 「가능」은 지우지 않고 둔다 — 율을 모른다는 뜻이지 틀린 값이 아니다.
  { name: '대여료카드결제', kind: 'money_or_rate', openEnum: true, allowed: ['불가', '무료', '1%', '1.5%', '2%', '2.5%', '3%', '협의', '가능'], format: '「불가」 아니면 수수료율 「1.5%」. 수수료 없이 되면 「무료」, 아직 안 정했으면 「협의」. 「가능」은 옛 값(율 모름)', examples: ['1.5%', '불가'], synonyms: { '가능': '가능', '불가능': '불가', '안됨': '불가', '카드불가': '불가', '없음': '무료', '수수료없음': '무료', '무료가능': '무료', '0%': '무료' } },
  { name: '보증금카드결제', kind: 'money_or_rate', openEnum: true, allowed: ['불가', '무료', '1%', '1.5%', '2%', '2.5%', '3%', '협의', '가능'], format: '「불가」 아니면 수수료율 「1.5%」. 수수료 없이 되면 「무료」, 아직 안 정했으면 「협의」. 「가능」은 옛 값(율 모름)', examples: ['불가', '무료'], synonyms: { '가능': '가능', '불가능': '불가', '안됨': '불가', '카드불가': '불가', '없음': '무료', '수수료없음': '무료', '무료가능': '무료', '0%': '무료' } },

  // ── ⑤ 2026-08-19 신설 — 계약서 제6조·제7조·제24조가 참조하는데 시트에 없던 것(정본 docs/POLICY_ITEMS_FINAL_2026-08-19.md §8)
  { name: '결제방식', kind: 'enum', allowed: ['CMS 자동이체', '카드 자동결제', '계좌이체'], format: '「CMS 자동이체 / 카드 자동결제 / 계좌이체」', examples: ['CMS 자동이체'], synonyms: { 'CMS': 'CMS 자동이체', '자동이체': 'CMS 자동이체', 'cms자동이체': 'CMS 자동이체', '카드': '카드 자동결제', '카드결제': '카드 자동결제', '이체': '계좌이체' } },
  { name: '납부조건', kind: 'enum', allowed: ['선불', '후불', '협의'], format: '「선불 / 후불 / 협의」 — 계약 건별로 확정하는 기본값', examples: ['선불'], synonyms: { '선납': '선불', '후납': '후불' } },
  // 사장님 2026-08-19 — 고정일(1·5·10·15·20·25·말일)도 있고 「인도일 기준」·「5일 단위 인도일 기준」(제일 흔함)도 있다.
  { name: '월 납부일', kind: 'enum', openEnum: true, allowed: ['5일 단위 인도일 기준', '인도일 기준', '매월 1일', '매월 5일', '매월 10일', '매월 15일', '매월 20일', '매월 25일', '매월 말일'], format: '「5일 단위 인도일 기준」 / 「인도일 기준」 / 고정 「매월 N일」·「매월 말일」', examples: ['5일 단위 인도일 기준', '매월 25일'], synonyms: { '25일': '매월 25일', '매월25일': '매월 25일', '말일': '매월 말일', '인도일': '인도일 기준', '인도일기준': '인도일 기준', '출고일기준': '인도일 기준', '5일단위': '5일 단위 인도일 기준', '5일단위인도일': '5일 단위 인도일 기준', '5일단위인도일기준': '5일 단위 인도일 기준', '인도일5일단위': '5일 단위 인도일 기준' } },
  { name: '보증금 반환기한', kind: 'days', allowed: ['3일', '7일', '14일', '30일'], format: '「N일」 — 반납 뒤 며칠 안에', examples: ['7일'] },
  { name: '무보험면책금', kind: 'money', allowed: ['없음', '10만원', '20만원', '30만원', '50만원', '100만원'], format: '금액 또는 「없음」', examples: ['없음'] },
  { name: '시동제어 기준일', kind: 'days', allowed: ['3일', '5일', '7일', '10일', '15일', '없음'], format: '「N일」 — 납부기한 다음 날부터', examples: ['3일'] },
  { name: '차량회수 기준일', kind: 'days', allowed: ['7일', '10일', '15일', '20일', '30일'], format: '「N일」 — 시동제어 뒤 며칠 더 밀리면 회수·해지', examples: ['10일'] },
];

export const POLICY_VALUE_RULE_BY_NAME: Record<string, PolicyValueRule> = Object.fromEntries(POLICY_VALUE_RULES.map((r) => [r.name, r]));

/** 정책 항목 이름 변경 이력 — 옛 머리글을 읽으면 새 이름으로 본다. */
export const POLICY_FIELD_RENAMES: Record<string, string> = {
  '불가조건': '불가조건 1', // 사장님 2026-08-19 — 한 칸 → 4칸(1~4)
  '기타서류': '필요서류 1', // 사장님 2026-08-20 — 한 칸 → 4칸(1~4)
  '추가운전자': '추가운전',
  '추가운전자 요금': '추가운전 요금',
  '대차 정책': '대차 제공', // 사장님 2026-08-19
  '회수·해지 기준일': '차량회수 기준일',
};

/** 자리표시 문구 — 값이 아니다(빈칸과 같다). */
const PLACEHOLDERS = new Set(['공급사 기재', '공급사기재', '미기재', '입력요망', '-', '—', 'n/a', 'na', '?']);

/* ── 숫자·단위 도우미 ── */
const num = (raw: string) => Number(raw.replace(/,/g, ''));
const withComma = (n: number) => Math.round(n).toLocaleString('en-US');

/** 원 단위 정수 → 규격 금액 문자열 */
/** 만원 단위 수(0~9,999) → 「5천」·「1천5백」·「500」·「50」. 사장님 2026-08-18 「1억5천만원 · 5천만원 · 100만원 · 50만원」 */
function manPart(man: number): string {
  if (man < 1000) return String(man);
  const th = Math.floor(man / 1000), rest = man % 1000;
  if (!rest) return `${th}천`;
  if (rest % 100 === 0) return `${th}천${rest / 100}백`;
  return `${th}천${rest}`;
}
export function formatWon(won: number): string {
  if (!Number.isFinite(won) || won < 0) return '';
  if (won === 0) return '없음';
  if (won % 10_000 !== 0) return `${withComma(won)}원`;
  const man = won / 10_000;
  const eok = Math.floor(man / 10_000), rest = man % 10_000;
  if (eok && !rest) return `${eok}억원`;
  if (eok) return `${eok}억${manPart(rest)}만원`;
  return `${manPart(man)}만원`;
}

/** 금액 표기 → 원 단위 정수. 못 읽으면 null */
export function parseWon(raw: string): number | null {
  const t = compact(raw).replace(/원$/, '');
  if (!t) return null;
  let m: RegExpMatchArray | null;
  // 만원 부분 — 「5천」「1천5백」「1천500」「500」「5,000」 전부 읽는다.
  const manOf = (part: string): number | null => {
    const q = part.replace(/,/g, '');
    if (!q) return 0;
    let mm: RegExpMatchArray | null;
    if ((mm = q.match(/^(\d+(?:\.\d+)?)천(?:(\d+)백)?(\d+)?$/))) return Math.round(Number(mm[1]) * 1000) + (mm[2] ? Number(mm[2]) * 100 : 0) + (mm[3] ? Number(mm[3]) : 0);
    if ((mm = q.match(/^(\d+)백(\d+)?$/))) return Number(mm[1]) * 100 + (mm[2] ? Number(mm[2]) : 0);
    if (/^\d+(?:\.\d+)?$/.test(q)) return Number(q);
    return null;
  };
  if ((m = t.match(/^(\d+(?:\.\d+)?)억(?:(.+?)만)?$/))) { const rest = m[2] ? manOf(m[2]) : 0; return rest === null ? null : Math.round(Number(m[1]) * 100_000_000) + Math.round(rest * 10_000); }
  if ((m = t.match(/^(.+?)만$/))) { const man = manOf(m[1]); return man === null ? null : Math.round(man * 10_000); }
  if ((m = t.match(/^(\d[\d,]*)$/))) return num(m[1]);
  return null;
}

const enumMatch = (rule: PolicyValueRule, raw: string): string | null => {
  const c = compact(raw);
  const hit = rule.allowed.find((a) => compact(a) === c);
  if (hit) return hit;
  // 동의어 표는 사람이 읽기 좋은 원문 표기("CMS" 등)로도 관리한다. 입력값과
  // 키를 같은 compact 규칙으로 대조해야 대소문자·공백 차이 때문에 뜻이 확정된
  // 값을 review로 잘못 보내지 않는다.
  const syn = Object.entries(rule.synonyms || {}).find(([key]) => compact(key) === c)?.[1];
  return syn ?? null;
};

/**
 * 값 하나를 규격으로 정규화한다. 뜻이 하나로 정해질 때만 고치고, 아니면 review 로 남긴다.
 */
export function normalizePolicyValue(fieldName: string, rawValue: unknown): PolicyNormalizeResult {
  const raw = S(rawValue);
  const name = POLICY_FIELD_RENAMES[fieldName] || fieldName;
  const rule = POLICY_VALUE_RULE_BY_NAME[name];
  if (!raw) return { value: '', status: 'empty' };
  if (PLACEHOLDERS.has(compact(raw))) return { value: '', status: 'fixed', note: '자리표시 문구 → 빈칸' };
  if (!rule) return { value: raw, status: 'same' };
  const done = (value: string): PolicyNormalizeResult => value === raw ? { value, status: 'same' } : { value, status: 'fixed', note: `${raw} → ${value}` };
  const c = compact(raw);

  // 어느 종류든 허용값·동의어에 정확히 맞으면 그것으로.
  const e = enumMatch(rule, raw);
  if (e) return done(e);

  switch (rule.kind) {
    case 'text': return { value: raw, status: 'same' };
    case 'check': {
      // 체크박스 칸 — 시트는 TRUE/FALSE 를 준다. 손으로 적은 ○·✓·예·필요도 체크로 읽는다.
      if (isCheckedValue(raw)) return done('TRUE');
      if (/^(false|x|×|아니오|아니요|불필요|없음|no|n|-)$/i.test(c)) return done('FALSE');
      return { value: raw, status: 'review', note: '체크 칸 — 체크하거나 비워 두세요' };
    }
    case 'days': {
      if (/^(없음|무기한|협의)$/.test(c)) return done(c);
      const m = c.match(/^(\d+)\s*일?(이내|안|내)?$/);
      if (m) return done(`${Number(m[1])}일`);
      return { value: raw, status: 'review', note: rule.format };
    }
    case 'money_or_rate': {
      // 정액·정률·개월분을 한 칸에 — 어느 쪽인지는 표기가 말한다. 「7만원 또는 10%」처럼 둘이면 계약서에 못 굳는다 → 검토.
      if (/또는|or|\//.test(c) && /%/.test(c) && /원/.test(c)) return { value: raw, status: 'review', note: '정액·정률을 같이 적음 — 둘 중 하나만' };
      if (/^(없음|불가|협의|무료)$/.test(c)) return done(c === '무료' ? '없음' : c);
      const pct = c.replace(/^1인당/, '').match(/^(?:대여료의?|월대여료의?|잔여대여료의?)?(\d+(?:\.\d+)?)%$/);
      if (pct) return done(`${rule.rateLabel || ''}${pct[1]}%`);
      const months = c.match(/^(?:월?대여료)?(\d+)개월(?:분|치)?$/);
      if (months) return done(`월 대여료 ${months[1]}개월분`);
      const won = parseWon(raw.replace(/^1인당\s*/, '').replace(/^월\s*/, '').trim());
      if (won !== null) return done(formatWon(won));
      return { value: raw, status: 'review', note: `정액(「10만원」)·정률(「대여료의 10%」)·개월분(「월 대여료 2개월분」) 중 하나로 — ${rule.format}` };
    }
    case 'enum': return rule.openEnum ? { value: raw, status: 'review', note: `목록 밖 값 — ${rule.format}` } : { value: raw, status: 'review', note: `허용값 아님(${rule.allowed.join('/')})` };
    case 'money': {
      if (/없음|무료/.test(c) && rule.allowed.includes('없음')) return done('없음');
      if (/^0(만원|원|%)?$/.test(c)) return rule.allowed.includes('없음') ? done('없음') : { value: raw, status: 'review', note: '0 — 없음인지 미기재인지' };
      if (/^\d+(\.\d+)?%$/.test(c)) return { value: raw, status: 'review', note: '비율 표기 — 정액 칸에 비율' };
      if (/^(협의|불가|불가능)$/.test(c)) return done(c === '불가능' ? '불가' : c);
      const won = parseWon(raw);
      if (won === null) {
        // 복합 서술(「사망·후유장애 1인당 3천만원 · 부상 1인당 1,500만원」)은 문장은 두고 금액 토큰 표기만 규격으로.
        const retok = raw.replace(/(\d[\d,]*)만원/g, (_m, n) => formatWon(Number(String(n).replace(/,/g, '')) * 10_000))
          .replace(/(\d+\.\d+)억원/g, (_m, n) => formatWon(Number(n) * 100_000_000));
        if (retok !== raw) return done(retok);
        // 금액 토큰이 둘 이상이고 전부 규격이면 복합 서술로 받아들인다(1인당 한도처럼 더 정확한 정보).
        const tokens = raw.match(/\d[\d,]*(?:억(?:[\d천백]+만)?|천[\d백]*만|백만|만)?원/g) || [];
        if (tokens.length >= 2 && tokens.every((tk) => formatWon(parseWon(tk) ?? -1) === tk)) return { value: raw, status: 'same' };
        return { value: raw, status: 'review', note: `금액을 못 읽음 — ${rule.format}` };
      }
      // 초과주행(1km당)은 원 단위 그대로
      if (/1km당/.test(name)) return done(`${withComma(won)}원`);
      return done(formatWon(won));
    }
    case 'age_upto': {
      const m = c.match(/^만?(\d{2})세?(까지|이하)?$/);
      if (m) return done(`만 ${m[1]}세까지`);
      return { value: raw, status: 'review', note: rule.format };
    }
    case 'age_min': {
      const m = c.match(/^만?(\d{2})세?(이상|부터)?$/);
      if (m) return done(`만 ${m[1]}세 이상`);
      return { value: raw, status: 'review', note: rule.format };
    }
    case 'age_max': {
      if (/제한없음|무관|없음/.test(c)) return done('제한없음');
      const m = c.match(/^만?(\d{2})세?(이하|까지|미만)?$/);
      if (m) return done(`만 ${m[1]}세 이하`);
      return { value: raw, status: 'review', note: `${rule.format} — 「만 71세 이상」처럼 하한을 적었으면 뜻을 확인` };
    }
    case 'km': {
      if (/무제한/.test(c)) return done('무제한');
      if (/협의/.test(c)) return done('협의');
      let m = c.match(/^(연간|연|년)?(\d+(?:\.\d+)?)만km(주행)?$/);
      if (m) return done(`연 ${withComma(Number(m[2]) * 10_000)}km`);
      m = c.match(/^(연간|연|년)?(\d[\d,]*)km(주행)?$/);
      if (m) return done(`연 ${withComma(num(m[2]))}km`);
      return { value: raw, status: 'review', note: rule.format };
    }
    case 'percent': {
      const m = c.match(/^(\d+(?:\.\d+)?)(%|퍼센트|프로)?$/);
      if (m) { const n = Number(m[1]); const pct = m[2] ? n : (n <= 1 ? n * 100 : n); return done(`${Math.round(pct * 100) / 100}%`); }
      return { value: raw, status: 'review', note: rule.format };
    }
    case 'count': {
      if (/없음/.test(c)) return done('없음');
      const m = c.match(/^(\d+)회?$/);
      if (m) return done(`${m[1]}회`);
      return { value: raw, status: 'review', note: rule.format };
    }
    case 'per_year_count': {
      if (/무제한/.test(c)) return done('무제한');
      if (/없음/.test(c)) return done('없음');
      const m = c.match(/^(연간|연|년)?(\d+)회$/);
      if (m) return done(`연간 ${m[2]}회`);
      return { value: raw, status: 'review', note: rule.format };
    }
    case 'driver_fee': {
      const parsed = parseDriverFee(raw);
      return parsed ? done(parsed) : { value: raw, status: 'review', note: rule.format };
    }
    default: return { value: raw, status: 'same' };
  }
}

/** 「추가운전 요금」 — 「N인까지 · 1인당 월 M만원」. 옛 두 칸(추가운전자 인원 + 요금)을 합칠 때도 쓴다. */
export function composeDriverFee(countRaw: unknown, feeRaw: unknown): string | null {
  const count = compact(countRaw);
  const feeText = S(feeRaw);
  let head = '';
  if (!count || /^(불가|0|0인)$/.test(count)) head = count ? '불가' : '';
  else if (/제한없음|무제한/.test(count)) head = '제한없음';
  else { const m = count.match(/^(\d+)(인|명)?(까지)?$/); if (m) head = `${m[1]}인까지`; }
  const feeC = compact(feeText);
  let tail = '';
  if (!feeC) tail = '';
  else if (/무료|없음|^0(만원|원)?$|^월0만원$/.test(feeC)) tail = '무료';
  else if (/협의/.test(feeC)) tail = '협의';
  else if (/%$/.test(feeC)) tail = `1인당 ${feeText.replace(/^1인당/, '').trim().replace(/^월\s*/, '')}`;
  else { const won = parseWon(feeC.replace(/^월/, '').replace(/^1인당/, '').replace(/^월/, '')); if (won === null) return null; tail = `1인당 월 ${formatWon(won)}`; }
  if (head === '불가') return '불가';
  if (!head && !tail) return null;
  if (!head) return tail;                 // 인원 모름 — 요금만
  if (!tail) return head;                 // 요금 모름 — 인원만
  return `${head} · ${tail}`;
}

export function parseDriverFee(raw: string): string | null {
  const t = S(raw);
  if (!t) return null;
  const c = compact(t);
  if (/^(협의|불가)$/.test(c)) return c;
  const parts = t.split(/[·/,]/).map(S).filter(Boolean);
  if (parts.length === 2) return composeDriverFee(parts[0].replace(/까지$/, ''), parts[1]);
  if (parts.length === 1) {
    if (/인(까지)?$/.test(c) || /제한없음/.test(c)) return composeDriverFee(parts[0].replace(/까지$/, ''), '');
    return composeDriverFee('', parts[0]);
  }
  return null;
}

/** 체크 칸(제출서류)이 «받는다»인가 — 시트 TRUE / ✓ / ○ / 예 / 필요 / Y. */
export function isCheckedValue(v: unknown): boolean {
  const c = String(v ?? '').trim().toLowerCase().replace(/\s+/g, '');
  return /^(true|✓|✔|☑|○|o|예|필요|필수|y|yes|1)$/.test(c);
}
/** 체크박스로 받는 열 이름들 — 시트 도구가 BOOLEAN 검증을 건다. */
export const POLICY_CHECK_FIELD_NAMES: readonly string[] = POLICY_VALUE_RULES.filter((r) => r.kind === 'check').map((r) => r.name);
