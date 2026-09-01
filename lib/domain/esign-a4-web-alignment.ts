/**
 * A4 정본과 손님 웹 화면의 대응표.
 *
 * 웹은 A4를 축소해 그리는 화면이 아니다. 모바일에서 읽기 좋게 재구성하되,
 * 어느 A4 항목이 어느 웹 단계에서 확인·수집·동의되는지는 이 표 하나로 고정한다.
 * 새 서식이나 웹 묶음을 추가할 때 이 표와 검증을 함께 갱신하지 않으면 발행을 막는다.
 */
export const A4_WEB_SECTION_ALIGNMENT = [
  { a4: '01', title: '계약자 정보', web: '본인확인', mode: '고객 입력·확인' },
  { a4: '02', title: '대여 차량 정보', web: '차량 · 기간 · 금액', mode: '동결값 열람' },
  { a4: '03', title: '대여 조건', web: '차량 · 기간 · 금액', mode: '동결값 열람' },
  { a4: '04', title: '자동차 보험', web: '운전자 · 보험 · 사고·중도해지', mode: '동결값 열람' },
  { a4: '05', title: '정비 서비스', web: '결제 · 만기 · 서비스', mode: '동결값 열람' },
  { a4: '06', title: '결제 방법', web: '결제 · 만기 · 서비스', mode: '동결값 열람' },
  { a4: '07', title: '특약 사항', web: '결제 · 만기 · 서비스', mode: '동결값 열람' },
  { a4: '08', title: '추가 운전자', web: '추가 운전자', mode: '해당 시 고객 입력·확인' },
  { a4: '09', title: '연대보증인', web: '별도 연대보증 약정', mode: '해당 시 주계약 발행 차단' },
  { a4: '10', title: '동의 및 확인 사항', web: '계약서·약관 전체 내용 동의', mode: '원본 열람·전문 동의·서명' },
] as const;

type GroupLike = { key?: unknown };

const CORE_WEB_GROUPS = ['vehicle', 'rental', 'payment', 'driver', 'insurance', 'accident', 'service'];
const GUARANTOR_FIELDS = [
  'guarantor_name', 'guarantor_rrn', 'guarantor_phone', 'guarantor_address',
  'guarantor_relation', 'guarantor_occupation', 'guarantee_limit', 'guarantee_period',
] as const;

const text = (value: unknown) => String(value ?? '').trim();

/**
 * 발행 전 검증. UI를 바꾸지 않고도 A4 원문의 핵심 섹션이 웹 확인 경로에서
 * 빠지는 회귀를 막는다. 연대보증은 보증인 본인의 별도 서명이 필요하므로 주계약
 * 링크에 섞지 않는다.
 */
export function assertA4WebContractAlignment(input: {
  consentGroups: GroupLike[];
  agreementSectionCount: number;
  contract: Record<string, unknown>;
}) {
  const groupKeys = new Set(input.consentGroups.map((group) => text(group.key)).filter(Boolean));
  const missing = CORE_WEB_GROUPS.filter((key) => !groupKeys.has(key));
  if (missing.length) {
    throw new Error(`A4 계약서와 웹 계약조건의 대응이 불완전합니다: ${missing.join(', ')}`);
  }
  if (!Number.isInteger(input.agreementSectionCount) || input.agreementSectionCount < 1) {
    throw new Error('A4 계약서와 대응하는 약관 전문을 동결하지 못했습니다.');
  }
  if (GUARANTOR_FIELDS.some((key) => text(input.contract[key]))) {
    throw new Error('연대보증이 있는 계약은 보증인 본인의 별도 전자서명 약정으로 체결해 주세요. 주계약 링크에는 포함할 수 없습니다.');
  }
}
