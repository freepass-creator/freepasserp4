/**
 * 계약서 표기 사전 — **섹션별로 어떤 원자를 어떻게 보여줄지.**
 *
 * ★`FIELD_MAP` 과 무엇이 다른가
 *   저기는 「erp3 템플릿 141칸을 무엇으로 채우나」(기계용 매핑)다.
 *   여기는 「사람에게 무엇을 어떤 꼴로 보여주나」다. 같은 원자라도 자리마다 표기가 다르다 —
 *   주민등록번호는 **계약서엔 전체**, **진행 화면엔 마스킹**이다.
 *
 * ★표기 방식이 원자의 일부다
 *   「주민등록번호」라고만 적어 두면 누군가 관리자 목록에 그대로 뿌린다.
 *   그래서 `mask` 를 필드에 붙여 둔다 — 빼먹으면 유출이다.
 *
 * ★`required` 는 «계약서에 빈칸으로 나가면 안 되는 것»이다.
 *   종이 양식의 노란칸(필수 입력)과 같은 뜻이다(`01. JPK_개인(개인사업자) 계약서.xlsx`).
 */
import type { AtomSource } from '@/lib/domain/esign-field-map';

/** 화면에 어떻게 내보내나. */
export type MaskKind =
  /** 그대로. */
  | 'none'
  /** 뒷자리 가림 — 880505-1****** */
  | 'rrn'
  /** 가운데 가림 — 010-****-5678 */
  | 'phone'
  /** 동 단위까지만 — 서울시 강남구 … */
  | 'address'
  /** 앞뒤만 — 11-02-******-54 */
  | 'license'
  /** 계좌 뒷자리 가림 */
  | 'account';

export type DisplayField = {
  key: string;
  label: string;
  from: AtomSource;
  /** 계약서에 빈칸으로 나가면 안 되는 값. */
  required: boolean;
  /** 계약서 인쇄용 마스킹. 원본이 필요한 자리라 대개 none 이다. */
  onContract: MaskKind;
  /** ERP 화면·목록용 마스킹. 여기서 원본을 뿌리면 유출이다. */
  onScreen: MaskKind;
  note?: string;
};

export type DisplaySection = {
  key: string;
  title: string;
  /** 이 섹션이 왜 있는지 — 손님에게 한 줄. */
  note: string;
  fields: DisplayField[];
  /** 해당될 때만 그린다. */
  conditional?: string;
};

const f = (
  key: string, label: string, from: AtomSource, required: boolean,
  onScreen: MaskKind = 'none', onContract: MaskKind = 'none', note?: string,
): DisplayField => ({ key, label, from, required, onScreen, onContract, note });

/**
 * ══ 섹션을 어떻게 나누나 ══
 *
 * 기준은 **「누구/무엇에 관한 사실인가」** 하나다. 화면 길이나 데이터 출처로 나누지 않는다.
 *   · 출처로 나누면 손님이 못 읽는다 — 「정책에서 온 값」 섹션 같은 건 손님에게 뜻이 없다.
 *   · 길이로 나누면 같은 주제가 두 동강 난다(보험이 갈리면 앞장만 읽는다).
 *
 * 그래서 **주체 → 대상 → 조건 → 위험 → 돈** 순으로 9섹션이다.
 *
 *   ① lessee      임차인정보   누가 빌리나              ← 사람
 *   ② lessee_biz  사업자정보   (개인사업자일 때)
 *   ③ vehicle     차량정보     무엇을 · 누구 차를 빌리나 ← 물건
 *   ④ terms       대여조건     얼마에 얼마나            ← 조건
 *   ⑤ driver      운전자       누가 몰 수 있나
 *   ⑥ insurance   보험         사고 나면 보상은         ← 위험
 *   ⑦ accident    사고·면책    사고 나면 내 부담은
 *   ⑧ bank        출금계좌     돈이 어디서 빠지나       ← 돈
 *   ⑨ guarantor   연대보증인   (연대보증일 때)
 *
 * **임대인은 별도 섹션이 아니라 ③에 붙였다**(2026-08-09 결정). 차는 임대인 소유다 —
 * 「무엇을 빌리나」와 「누구 차인가」는 한 생각이고, 회사 정보만 한 화면 두면
 * 손님이 넘길 이유가 없는 빈 단계가 생긴다.
 *
 * **⑥보험과 ⑦사고·면책을 일부러 갈랐다.** 손님이 헷갈리는 지점이 정확히 여기다 —
 * 「대인 무한」(보험이 물어주는 한도)과 「대인 면책금 30만원」(내가 무는 돈)은 반대 방향인데
 * 한 표에 있으면 둘 다 보상으로 읽는다.
 *
 * ══ 섹션 안에서 원자를 어떻게 배열하나 ══
 *
 *   1. **식별 → 속성 → 부가** 순. 그 섹션이 무엇에 관한 것인지부터 박고 들어간다.
 *      임차인정보면 이름이 먼저지 비상연락처가 먼저일 수 없다.
 *   2. **필수(`required`)가 선택보다 앞.** 손님이 위에서부터 읽다 멈춰도 중요한 건 봤어야 한다.
 *   3. **짝은 붙인다.** 보상한도-면책금, 시작일-종료일, 주소-실거주지처럼
 *      비교해서 읽는 값은 떨어뜨리지 않는다.
 *   4. **금액은 큰 단위부터.** 대여기간 → 월 대여료 → 보증금.
 *   5. 계약서 인쇄 순서와 어긋나면 계약서를 따른다 — 손님이 두 벌을 대조한다.
 *
 * 배열이 규칙과 맞는지는 `sim-esign-display-fields.mts` 가 지킨다.
 */

export const DISPLAY_SECTIONS: DisplaySection[] = [
  {
    key: 'lessee',
    title: '임차인정보',
    note: '계약 당사자입니다. 다르면 서명하지 말고 담당자에게 알려 주세요.',
    fields: [
      f('customer_name', '이름', '계약', true),
      // 계약서엔 전체가 필요하다(세금계산서 근거 — 부가가치세법 §32②). 화면엔 뒷자리를 가린다.
      f('customer_id', '주민등록번호', '본인확인', true, 'rrn', 'none', '계약서에는 필요한 범위에서 표시하고 고객 화면에서는 마스킹합니다'),
      f('customer_phone', '연락처', '계약', true, 'phone'),
      f('customer_address', '주소', '계약', true, 'address'),
      f('residence_address', '실거주지', '입력', false, 'address', 'none', '주소와 다를 때만'),
      f('driver_license_no', '면허번호', '본인확인', true, 'license'),
      f('emergency_contact', '비상연락처', '입력', true, 'phone'),
      f('emergency_relation', '관계', '입력', true),
    ],
  },
  {
    key: 'lessee_biz',
    title: '사업자정보',
    note: '개인사업자로 계약할 때만 씁니다.',
    conditional: '개인사업자',
    fields: [
      f('biz_name', '상호', '입력', true),
      f('biz_number', '사업자등록번호', '입력', true),
      f('biz_address', '사업장 소재지', '입력', true),
      f('tax_ceo', '대표자', '미정', false),
      f('tax_biz_type_item', '업태·종목', '미정', false),
      f('tax_email', '계산서 이메일', '미정', false),
    ],
  },
  {
    key: 'vehicle',
    title: '차량정보',
    note: '실제로 인도받을 차량과, 그 차를 빌려주는 회사입니다.',
    fields: [
      // 식별(차량번호·차종) → 속성(연식·유종·색상·주행) → 소유자 → 부가(차대번호·옵션) 순.
      f('car_number', '차량번호', '계약', true),
      f('vehicle_name', '차종', '계약', true),
      f('model_year', '연식', '계약', true),
      f('fuel', '유종', '계약', true),
      f('color_exterior', '외부 색상', '재고', true),
      f('odometer_delivery', '출고 시 주행거리', '재고', true),
      f('vehicle_classification', '차량 구분', '재고', true),
      // ★임대인은 별도 섹션이 아니라 여기 붙는다(2026-08-09 결정).
      //   차는 임대인 소유다 — 「무엇을 빌리나」와 「누구 차인가」는 한 생각이고,
      //   회사 정보만 따로 한 화면 두면 손님이 넘길 이유가 없는 빈 단계가 생긴다.
      f('company_name', '임대인', '파트너', true, 'none', 'none', '차량 소유자·계약 상대방'),
      f('company_phone', '임대인 연락처', '파트너', true),
      f('company_address', '임대인 주소', '파트너', true),
      f('company_ceo', '임대인 대표자', '파트너', false),
      f('company_biz_no', '임대인 사업자등록번호', '파트너', false),
      f('rental_business_no', '자동차대여사업 등록번호', '파트너', false),
      f('color_interior', '내부 색상', '재고', false),
      f('vin', '차대번호', '재고', false),
      f('options', '옵션', '재고', false),
    ],
  },
  {
    key: 'terms',
    title: '대여조건',
    note: '매월 내실 금액과 기간입니다.',
    fields: [
      f('rent_month', '대여기간', '계약', true),
      f('rent_amount', '월 대여료', '계약', true),
      f('deposit_amount', '보증금', '계약', true),
      f('contract_start', '계약시작일', '파생', true),
      f('contract_end', '계약종료일', '파생', true),
      f('annual_mileage', '약정 주행거리', '정책', true),
      f('over_mileage_rate', '초과주행 요금', '정책', true),
      f('deposit_installment', '보증금 분납', '입력', false),
      f('buyback_price', '만기 인수가격', '입력', false, 'none', 'none', '인수형만 필수'),
    ],
  },
  {
    key: 'driver',
    title: '운전자',
    note: '이 차를 몰 수 있는 사람입니다. 범위를 벗어난 사람이 몰다 사고가 나면 보험이 적용되지 않습니다.',
    fields: [
      f('driver_age', '운전자 연령', '정책', true),
      f('driver_scope', '운전자 범위', '입력', true),
      f('drv1_name', '추가운전자 성함', '입력', false),
      f('drv1_relation', '관계', '입력', false),
      f('drv1_rrn', '주민등록번호', '본인확인', false, 'rrn'),
      f('drv1_license', '면허번호', '본인확인', false, 'license'),
      f('drv1_phone', '연락처', '입력', false, 'phone'),
    ],
  },
  {
    key: 'insurance',
    title: '보험',
    note: '사고가 났을 때 어디까지 보상되는지입니다.',
    fields: [
      f('insurance_condition', '가입 주체', '파생', true),
      f('coverage_liability_person', '대인배상', '정책', true),
      f('coverage_liability_property', '대물배상', '정책', true),
      f('coverage_self_injury', '자기신체사고', '정책', true),
      f('insurer_name', '가입 보험사·공제조합', '정책', true),
      f('coverage_uninsured', '무보험차상해', '정책', false),
      f('emergency_dispatch_limit', '긴급출동', '정책', false),
    ],
  },
  {
    key: 'accident',
    title: '사고·면책',
    note: '사고가 났을 때 손님이 부담하는 금액입니다.',
    fields: [
      f('deductible_liability_person', '대인 면책금', '파생', true),
      f('deductible_liability_property', '대물 면책금', '파생', true),
      f('self_damage_deductible_min', '자차 최소 면책금', '파생', true),
      f('self_damage_deductible_max', '자차 최대 면책금', '파생', true),
      f('self_damage_deductible_rate', '자차 자기부담률', '정책', true),
      f('self_damage_exclusions', '면책 제외', '고정', true),
    ],
  },
  {
    key: 'bank',
    title: '출금계좌',
    note: '대여료가 매월 빠져나갈 계좌입니다.',
    conditional: '자동이체 선택',
    fields: [
      f('cms_bank', '은행', '입력', true),
      f('cms_account_no', '계좌번호', '입력', true, 'account'),
      f('cms_holder', '예금주', '입력', true),
      f('cms_holder_birth', '예금주 생년월일', '입력', true, 'rrn'),
      f('cms_holder_phone', '예금주 연락처', '입력', true, 'phone'),
      f('auto_debit_date', '월 납부일', '입력', true),
    ],
  },
  {
    key: 'guarantor',
    title: '연대보증인',
    note: '연대보증이 있는 계약에만 씁니다.',
    conditional: '연대보증',
    fields: [
      f('guarantor_name', '성명', '미정', true),
      f('guarantor_rrn', '주민등록번호', '본인확인', true, 'rrn'),
      f('guarantor_phone', '연락처', '미정', true, 'phone'),
      f('guarantor_address', '주소', '미정', true, 'address'),
      f('guarantor_relation', '관계', '미정', true),
      f('guarantee_limit', '보증 한도', '미정', true),
      f('guarantee_period', '보증 기간', '파생', true),
    ],
  },
];

/* ── 마스킹 ── */

const digits = (v: string) => v.replace(/\D/g, '');

/**
 * 880505-******* — 뒷자리 전부 가린다. **성별 한 자리도 남기지 않는다**(그것만으로 특정이 좁혀진다).
 *
 * 같은 칸에 생년월일이 오기도 한다(예금주 생년월일·사업자 계좌). 그건 가릴 게 없으므로 그대로 둔다 —
 * 주민등록번호는 **13자리**뿐이다. 자릿수로만 가른다.
 */
export function maskRrn(v: string): string {
  const d = digits(v);
  if (d.length !== 13) return v;
  return `${d.slice(0, 6)}-${'*'.repeat(7)}`;
}

/** 010-****-5678 */
export function maskPhone(v: string): string {
  const d = digits(v);
  if (d.length === 11) return `${d.slice(0, 3)}-****-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-***-${d.slice(6)}`;
  return v;
}

/** 서울시 강남구 … — 시·구까지만 남긴다. */
export function maskAddress(v: string): string {
  const parts = String(v).trim().split(/\s+/);
  return parts.length <= 2 ? v : `${parts.slice(0, 2).join(' ')} …`;
}

/** 11-02-******-54 */
export function maskLicense(v: string): string {
  const parts = String(v).trim().split('-');
  if (parts.length < 4) return v;
  return `${parts[0]}-${parts[1]}-${'*'.repeat(parts[2].length)}-${parts[3]}`;
}

/** 110-***-**5928 — 앞 3자리와 끝 4자리만. */
export function maskAccount(v: string): string {
  const raw = String(v).trim();
  const d = digits(raw);
  if (d.length < 8) return raw;
  return `${d.slice(0, 3)}${'*'.repeat(d.length - 7)}${d.slice(-4)}`;
}

export function applyMask(value: unknown, kind: MaskKind): string {
  const v = String(value ?? '').trim();
  if (!v) return '';
  switch (kind) {
    case 'rrn': return maskRrn(v);
    case 'phone': return maskPhone(v);
    case 'address': return maskAddress(v);
    case 'license': return maskLicense(v);
    case 'account': return maskAccount(v);
    default: return v;
  }
}

/** 화면 표기 — ERP·관리자 목록에서 부른다. 여기를 안 거치면 원본이 샌다. */
export function screenValue(field: DisplayField, value: unknown): string {
  return applyMask(value, field.onScreen);
}

/** 계약서 인쇄 표기 — 대개 원본 그대로다. */
export function contractValue(field: DisplayField, value: unknown): string {
  return applyMask(value, field.onContract);
}

/** 화면에서 가려야 하는 필드 — 감사·점검용. */
export function maskedFields(): DisplayField[] {
  return DISPLAY_SECTIONS.flatMap((s) => s.fields).filter((x) => x.onScreen !== 'none');
}

export function findDisplayField(key: string): DisplayField | null {
  for (const s of DISPLAY_SECTIONS) {
    const hit = s.fields.find((x) => x.key === key);
    if (hit) return hit;
  }
  return null;
}
