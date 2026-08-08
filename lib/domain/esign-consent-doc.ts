/**
 * 전자계약 — 손님이 확인·동의할 «내용»의 SSOT.
 *
 * ★왜 여기에 두나
 *   손님 화면은 착한거래가 그린다. 그런데 **무엇을 보여주고 무엇에 동의받는지**는 우리 데이터다
 *   (원자 정의 `lib/intake/entities.ts` · 값 = 계약 스냅샷 + 정책). 이 정의를 착한거래에 복제하면
 *   필드를 하나 늘릴 때마다 양쪽이 어긋난다. 그래서 **우리가 만들어 payload 로 넘기고 저쪽은 렌더러**다.
 *   (`docs/ESIGN_CHAKHANDEAL_INTEGRATION.md` §3.1)
 *
 * ★2026-08-08 사장님 결정
 *   계약서 조항 문구가 본질이 아니다. **계약 원자에 대한 동의**를 받는 것이 본질이다.
 *   그래서 손님은 긴 계약서를 스크롤하지 않고 «본인정보 → 차량정보 → 대여조건 → 보험» 을
 *   한 화면씩 확인하고 동의한다. 조항은 마지막 약관 한 페이지로 몰아 통독시킨다.
 *
 * ★표시 문자열까지 여기서 만든다
 *   금액 콤마·개월 표기를 저쪽이 다시 포맷하면 화면과 계약서의 숫자가 달라 보인다.
 *   값은 `value`(사람이 읽는 문자열)로 굳혀 보내고, 원본은 `raw` 에 남긴다.
 */
import type { EntityRecord } from '@/lib/intake/entities';

type Rec = Record<string, unknown>;
const S = (v: unknown): string => String(v ?? '').trim();
const N = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** 1,234,000 — 계약서·화면 공통 표기. */
export const wonText = (v: unknown): string => `${N(v).toLocaleString('ko-KR')}원`;

/** 010-1234-5678 — 하이픈 없는 저장값을 사람이 읽는 꼴로. */
export function phoneText(v: unknown): string {
  const d = S(v).replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return S(v);
}

export type ConsentRow = { label: string; value: string; raw?: unknown };
export type ConsentGroup = {
  key: 'identity' | 'vehicle' | 'rental' | 'insurance';
  title: string;
  /** 이 묶음이 왜 있는지 — 손님에게 한 줄로. */
  note: string;
  rows: ConsentRow[];
  confirmLabel: string;
  required: true;
};

/**
 * 보험 표시 순서·라벨 — `entities.ts` policy 필드에서 가져온 그대로.
 * 여기서 라벨을 새로 지으면 ERP 화면과 계약서의 용어가 갈린다.
 */
const INSURANCE_ROWS: [string, string][] = [
  ['injury_compensation_limit', '대인 보상한도'],
  ['injury_deductible', '대인 면책금'],
  ['property_compensation_limit', '대물 보상한도'],
  ['property_deductible', '대물 면책금'],
  ['self_body_accident', '자손 보상한도'],
  ['self_body_deductible', '자손 면책금'],
  ['uninsured_damage', '무보험 보상한도'],
  ['uninsured_deductible', '무보험 면책금'],
  ['own_damage_compensation', '자차 보상'],
  ['own_damage_repair_ratio', '자차 자기부담률'],
  ['own_damage_min_deductible', '자차 최소 면책금'],
  ['own_damage_max_deductible', '자차 최대 면책금'],
  ['annual_roadside_assistance', '긴급출동'],
];

/** 값이 있는 행만 남긴다 — 빈 칸을 «—» 로 채우면 손님이 «없는 보장»을 있는 걸로 읽는다. */
const kept = (rows: ConsentRow[]): ConsentRow[] => rows.filter((r) => r.value !== '');

/**
 * 계약 하나 → 손님이 확인할 묶음 4개.
 * 값이 통째로 빈 묶음은 **떨어뜨리지 않고 남긴다** — 「차량정보 없음」이 화면에 보여야 사고를 잡는다.
 */
export function buildConsentGroups(contract: EntityRecord, policy?: Rec | null): ConsentGroup[] {
  const c = contract as Rec;
  const p = (policy || {}) as Rec;

  const trim = [c.trim_name_snapshot, c.trim_extra_snapshot].map(S).filter(Boolean).join(' ');
  const vehicleName = S(c.vehicle_name_snapshot)
    || [c.maker_snapshot, c.model_snapshot, c.sub_model_snapshot].map(S).filter(Boolean).join(' ');

  return [
    {
      key: 'identity',
      title: '본인정보',
      note: '아래 정보로 계약이 작성됩니다. 다르면 서명하지 말고 담당자에게 알려 주세요.',
      rows: kept([
        { label: '성명', value: S(c.customer_name), raw: c.customer_name },
        { label: '연락처', value: phoneText(c.customer_phone), raw: c.customer_phone },
        { label: '생년월일', value: S(c.customer_birth), raw: c.customer_birth },
        { label: '주소', value: S(c.customer_address), raw: c.customer_address },
      ]),
      confirmLabel: '위 본인정보가 정확함을 확인합니다',
      required: true,
    },
    {
      key: 'vehicle',
      title: '차량정보',
      note: '실제로 인도받을 차량입니다.',
      rows: kept([
        { label: '차량번호', value: S(c.car_number_snapshot), raw: c.car_number_snapshot },
        { label: '차량', value: vehicleName, raw: vehicleName },
        { label: '세부모델', value: S(c.variant_snapshot), raw: c.variant_snapshot },
        { label: '트림', value: trim, raw: trim },
        { label: '연식', value: S(c.year_snapshot), raw: c.year_snapshot },
        { label: '연료', value: S(c.fuel_type_snapshot), raw: c.fuel_type_snapshot },
      ]),
      confirmLabel: '위 차량으로 계약함을 확인합니다',
      required: true,
    },
    {
      key: 'rental',
      title: '대여조건',
      note: '매월 내실 금액과 기간입니다.',
      rows: kept([
        { label: '대여기간', value: N(c.rent_month_snapshot) ? `${N(c.rent_month_snapshot)}개월` : '', raw: c.rent_month_snapshot },
        { label: '월 대여료', value: N(c.rent_amount_snapshot) ? wonText(c.rent_amount_snapshot) : '', raw: c.rent_amount_snapshot },
        // 보증금 0 은 «무보증»이라는 뜻이라 빈칸으로 떨어뜨리지 않는다.
        { label: '보증금', value: N(c.deposit_amount_snapshot) ? wonText(c.deposit_amount_snapshot) : '무보증', raw: c.deposit_amount_snapshot },
        { label: '약정 주행거리', value: S(p.annual_mileage), raw: p.annual_mileage },
        { label: '초과 주행요금', value: S(p.mileage_upcharge_per_10000km), raw: p.mileage_upcharge_per_10000km },
        { label: '중도해지', value: S(p.penalty_condition), raw: p.penalty_condition },
      ]),
      confirmLabel: '위 대여조건에 동의합니다',
      required: true,
    },
    {
      key: 'insurance',
      title: '보험',
      note: '사고가 났을 때 어디까지 보상되는지입니다. 면책금은 손님이 부담하는 금액입니다.',
      rows: kept([
        ...INSURANCE_ROWS.map(([key, label]) => ({ label, value: S(p[key]), raw: p[key] })),
        { label: '기본 운전자 연령', value: S(p.basic_driver_age), raw: p.basic_driver_age },
        { label: '추가운전자', value: S(p.additional_driver_allowance_count), raw: p.additional_driver_allowance_count },
      ]),
      confirmLabel: '위 보험 조건을 확인했습니다',
      required: true,
    },
  ];
}

/** 손님이 찍어 올릴 서류. `required` 는 이것 없이 서명 못 넘어간다는 뜻. */
export type RequiredDoc = { key: string; label: string; note: string; required: boolean };
export const REQUIRED_DOCS: RequiredDoc[] = [
  { key: 'family_register', label: '가족관계증명서', note: '주민번호 뒷자리는 가려서 촬영해 주세요.', required: true },
  { key: 'resident_register', label: '주민등록등본', note: '최근 3개월 이내 발급본.', required: true },
  { key: 'bank_book', label: '통장 사본', note: '자동이체 계좌.', required: false },
];

/**
 * 약관 — **샘플이다.**
 *
 * ⚠ 법률 검토를 받지 않았다. 발송 배선을 시험하기 위한 자리채움이고,
 *   실제 손님에게 나가기 전에 공급사별 정본으로 교체해야 한다.
 *   교체 시 `version` 을 반드시 올릴 것 — 계약에 `sign_consent_version` 으로 박히고,
 *   나중에 «이 손님이 어느 판에 동의했나»를 그것으로만 되짚을 수 있다.
 */
export const SAMPLE_AGREEMENT = {
  version: 'sample-v1',
  title: '자동차 대여 표준약관 (샘플)',
  /** 실제 정본으로 교체되기 전까지 true. 관리 화면에 경고를 띄우는 근거. */
  isSample: true,
  sections: [
    {
      t: '제1조 (목적)',
      b: '이 약관은 대여사업자(이하 "회사")와 임차인(이하 "고객") 사이의 자동차 대여에 관한 권리와 의무를 정함을 목적으로 합니다.',
    },
    {
      t: '제2조 (대여기간)',
      b: '대여기간은 계약서에 기재된 기간으로 하며, 인도일로부터 기산합니다. 기간 만료 전 연장을 원하는 경우 만료일 30일 전까지 회사에 통지하여야 합니다.',
    },
    {
      t: '제3조 (대여료 및 지급)',
      b: '고객은 계약서에 기재된 월 대여료를 매월 약정일에 지급합니다. 지급이 지연되는 경우 회사는 연체이자를 청구할 수 있으며, 2개월 이상 연체 시 계약을 해지하고 차량을 회수할 수 있습니다.',
    },
    {
      t: '제4조 (보증금)',
      b: '보증금은 계약 종료 후 차량 반납과 정산이 완료된 때 반환합니다. 미납 대여료·수리비·과태료가 있는 경우 보증금에서 공제한 후 잔액을 반환합니다.',
    },
    {
      t: '제5조 (차량의 사용)',
      b: '고객은 선량한 관리자의 주의로 차량을 사용하여야 하며, 다음 행위를 하여서는 안 됩니다. ① 전대·담보 제공·매각 ② 유상운송 ③ 경주·시험주행 ④ 음주·무면허 운전 ⑤ 계약서에 기재되지 않은 자의 운전.',
    },
    {
      t: '제6조 (보험)',
      b: '차량에는 계약서에 기재된 조건의 자동차보험이 가입됩니다. 사고 발생 시 고객은 면책금을 부담하며, 제5조를 위반한 상태의 사고는 보험 적용에서 제외되어 고객이 전액 부담합니다.',
    },
    {
      t: '제7조 (정비 및 관리)',
      b: '고객은 정기점검·소모품 교환 등 통상의 유지관리를 이행합니다. 고객의 관리 소홀로 발생한 고장·손상의 수리비는 고객이 부담합니다.',
    },
    {
      t: '제8조 (중도해지)',
      b: '고객이 약정기간 만료 전 해지하는 경우 계약서에 기재된 중도해지 위약금을 부담합니다. 회사는 고객이 제3조·제5조를 위반한 경우 최고 후 계약을 해지할 수 있습니다.',
    },
    {
      t: '제9조 (차량 반납)',
      b: '고객은 계약 종료일에 인도받은 장소 또는 회사가 지정한 장소에 차량을 반납합니다. 반납 시 차량 상태를 함께 확인하며, 통상의 마모를 넘는 손상은 고객이 부담합니다.',
    },
    {
      t: '제10조 (개인정보)',
      b: '회사는 계약의 이행에 필요한 범위에서 고객의 개인정보를 수집·이용하며, 계약 종료 후 관계 법령이 정한 기간이 지나면 파기합니다. 본인확인 과정에서 제출된 신분증·얼굴 사진은 계약의 진정성 증명 목적으로만 보관합니다.',
    },
    {
      t: '제11조 (분쟁의 해결)',
      b: '이 계약에 관한 분쟁은 상호 협의로 해결하되, 협의가 이루어지지 않는 경우 관계 법령 및 상관례에 따르며, 소송은 민사소송법상의 관할법원에 제기합니다.',
    },
  ],
} as const;

export const AGREEMENT_CONFIRM_LABEL = '위 약관을 모두 읽고 이해했으며 이에 동의합니다';
