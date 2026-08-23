import type { ConsentAtom } from '@/lib/domain/esign-inputs';
import type { EsignRequiredDocument } from '@/lib/domain/esign-required-documents';
import { normalizePolicyValue } from '@/lib/domain/policy-value-spec';

const S = (value: unknown): string => String(value ?? '').trim();

/**
 * 프리패스 고객 링크가 실제로 받는 동의의 봉인 규격.
 *
 * 계약서의 모든 부속동의를 항상 받지 않는다. 신용조회·CMS는 별도 업무가 실제로
 * 시작될 때만 받고, 이 링크는 계약 체결에 필요한 개인정보 및 GPS 장착 차량의
 * 위치정보만 계약별로 동결한다.
 */
// v2는 정책 원문의 표기 차이를 정규화한 뒤, 실제로 받은 동의와 수납 방식까지
// 함께 동결한다. v1/무버전 링크는 완료 PDF 열람만 보존하고 새 인도·정산에는 쓰지 않는다.
export const FREEPASS_CONSENT_PROFILE_VERSION = 'freepass-consent-v2';
export const FREEPASS_PAYMENT_METHODS = ['CMS 자동이체', '카드 자동결제', '계좌이체'] as const;
export const FREEPASS_SUPPORTED_PAYMENT_METHOD = '계좌이체';

export type FreepassConsentProfile = {
  version: string;
  requiredKeys: string[];
  atoms: ConsentAtom[];
  /** 발행 시점의 정규화된 심사 분류. 신용조회는 별도 동의 기능 전까지 발행하지 않는다. */
  screeningCriteria: string;
  /** 발행 시점의 정규화된 GPS 장착 여부. */
  gpsInstalled: string;
  /** 발행 시점의 정규화된 수납 방식. */
  paymentMethod: string;
  /** 카드/CMS처럼 별도 수납 위임·인증이 필요한지. 현재는 이런 상품을 발행하지 않는다. */
  requiresExternalPaymentAuthorization: boolean;
  /** CMS 본인인증·출금동의는 본계약과 별도다. 완료 전 차량 인도는 허용하지 않는다. */
  cmsRequiredBeforeHandover: boolean;
};

/**
 * CMS 출금동의·예금주 인증은 본계약과 별도 법정/금융 절차다. 아직 그 절차를
 * 보관·검증하는 흐름이 없으므로 고객 서명 뒤 인도에서 멈추게 하지 않고, 링크
 * 발행 전에 명시적으로 막는다.
 */
export function freepassConsentOperationalBlocker(profile: FreepassConsentProfile): string {
  if (!profile.requiresExternalPaymentAuthorization && profile.paymentMethod === FREEPASS_SUPPORTED_PAYMENT_METHOD) return '';
  const method = S(profile.paymentMethod) || '자동수납';
  return `${method} 상품은 수납 위임·본인인증 절차를 연결한 뒤 전자계약을 발행할 수 있습니다. 현재는 계좌이체 정책만 사용해 주세요.`;
}

export function isFreepassPaymentMethod(value: unknown): boolean {
  return (FREEPASS_PAYMENT_METHODS as readonly string[]).includes(S(value));
}

/**
 * 정책 원문은 레거시/시트에서 동의어로 들어올 수 있다. 고객 동의 여부를 raw 문자열과
 * 비교하면 `신용확인`, `설치`처럼 뜻은 확정됐지만 표기만 다른 값을 놓친다.
 * 모르는 표기는 어느 쪽으로도 추정하지 않고 발행을 막는다.
 */
function normalizedSensitivePolicyEnum(
  fieldName: '심사조건' | 'GPS 장착' | '결제방식',
  raw: unknown,
  allowed: readonly string[],
  label: string,
): string {
  const result = normalizePolicyValue(fieldName, raw);
  if (result.status === 'review' || !allowed.includes(result.value)) {
    throw new Error(`${label} 값을 확인할 수 없어 전자계약을 발행할 수 없습니다. 정책관리에서 허용된 값으로 확정해 주세요.`);
  }
  return result.value;
}

function privacyAtom(landlordCompanyName: string): ConsentAtom {
  return {
    key: 'privacy',
    label: '개인정보 수집·이용 및 계약 이행에 필요한 제공 동의',
    group: 'customer',
    required: true,
    items: [
      '성명', '주민등록번호', '연락처', '주소', '운전면허번호',
      '비상연락처', '운전면허증 사진', '본인 셀카',
    ],
    purpose: '자동차 임대차계약 체결·이행, 본인확인, 운전자격 확인, 대여료 청구 및 세금계산서 발행',
    retention: '계약 종료 후 5년 및 관계 법령상 보존기간',
    recipients: landlordCompanyName ? [{
      name: landlordCompanyName,
      purpose: '자동차 임대차계약 심사·체결·이행 및 차량 인도 관리',
      items: ['성명', '연락처', '주소', '운전면허번호', '계약 차량·조건'],
    }] : [],
    refusalNote: '필수 개인정보 처리 동의를 거부하면 자동차 임대차계약의 체결 및 이행이 불가능합니다.',
  };
}

function gpsAtom(): ConsentAtom {
  return {
    key: 'gps',
    label: '차량 위치정보(GPS) 수집·이용 동의',
    group: 'customer',
    required: true,
    items: ['대여 차량에 설치된 GPS·통신 단말의 위치정보'],
    purpose: '차량 도난·분실 방지, 사고 대응, 계약 이행 확인 및 연체·연락두절 시 차량 보호·회수',
    retention: '계약 기간 동안 수집하며 계약 종료 후 지체 없이 파기합니다. 다만 분쟁·채권 관련 자료는 해당 절차 종료 시까지 보관합니다.',
    refusalNote: '위치정보 수집 동의를 거부하면 GPS 장착 차량의 계약 체결이 제한될 수 있습니다.',
  };
}

function supportingDocumentsAtom(
  requiredDocuments: EsignRequiredDocument[],
  landlordCompanyName: string,
): ConsentAtom | null {
  if (!requiredDocuments.length) return null;
  return {
    key: 'supporting_documents_consent',
    label: '추가 제출서류 수집·이용 및 계약 렌터카사 제공 동의',
    group: 'customer',
    required: true,
    items: [...requiredDocuments.map((document) => document.label), '제출서류에 기재된 개인정보'],
    purpose: '렌터카 계약 심사, 계약 체결 및 계약상 의무 이행 확인',
    retention: '계약 종료 후 관계 법령이 정한 기간까지',
    recipients: landlordCompanyName ? [{
      name: landlordCompanyName,
      purpose: '임대차계약 심사·체결·이행 관리',
      items: requiredDocuments.map((document) => document.label),
    }] : [],
    refusalNote: '동의하지 않으면 렌터카사가 요구하는 계약서류를 확인할 수 없어 계약을 진행할 수 없습니다.',
  };
}

export function buildFreepassConsentProfile(input: {
  landlordCompanyName: unknown;
  gpsInstalled: unknown;
  paymentMethod: unknown;
  screeningCriteria: unknown;
  requiredDocuments: EsignRequiredDocument[];
}): FreepassConsentProfile {
  const screeningCriteria = normalizedSensitivePolicyEnum(
    '심사조건', input.screeningCriteria, ['무심사', '소득확인', '신용조회'], '심사조건',
  );
  const gpsInstalled = normalizedSensitivePolicyEnum(
    'GPS 장착', input.gpsInstalled, ['장착', '미장착'], 'GPS 장착 여부',
  );
  const paymentMethod = normalizedSensitivePolicyEnum(
    '결제방식', input.paymentMethod, FREEPASS_PAYMENT_METHODS, '결제방식',
  );
  // 「신용조회」라는 내부 심사 분류만으로는 조회기관·제공처가 특정되지 않는다.
  // 승인된 개별 신용동의 프로필을 붙이는 기능이 생기기 전까지는 발행을 멈춘다.
  if (screeningCriteria === '신용조회') {
    throw new Error('신용조회 계약은 조회기관·제공처가 확정된 별도 신용정보 동의 절차가 준비된 뒤 발행할 수 있습니다.');
  }

  const landlordCompanyName = S(input.landlordCompanyName);
  const atoms: ConsentAtom[] = [privacyAtom(landlordCompanyName)];
  if (gpsInstalled === '장착') atoms.push(gpsAtom());
  const documents = supportingDocumentsAtom(input.requiredDocuments, landlordCompanyName);
  if (documents) atoms.push(documents);

  return {
    version: FREEPASS_CONSENT_PROFILE_VERSION,
    requiredKeys: ['rental_terms', ...atoms.filter((atom) => atom.required).map((atom) => atom.key)],
    atoms,
    screeningCriteria,
    gpsInstalled,
    paymentMethod,
    requiresExternalPaymentAuthorization: paymentMethod !== FREEPASS_SUPPORTED_PAYMENT_METHOD,
    cmsRequiredBeforeHandover: paymentMethod === 'CMS 자동이체',
  };
}

export function isFrozenFreepassConsentProfile(value: unknown): value is FreepassConsentProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = Array.isArray(row.requiredKeys) ? row.requiredKeys.map(S).filter(Boolean) : [];
  const atoms = Array.isArray(row.atoms) ? row.atoms : [];
  if (S(row.version) !== FREEPASS_CONSENT_PROFILE_VERSION) return false;
  if (!['무심사', '소득확인'].includes(S(row.screeningCriteria))) return false;
  if (!['장착', '미장착'].includes(S(row.gpsInstalled))) return false;
  if (S(row.paymentMethod) !== FREEPASS_SUPPORTED_PAYMENT_METHOD) return false;
  if (row.requiresExternalPaymentAuthorization !== false) return false;
  if (!keys.includes('rental_terms') || !keys.includes('privacy')) return false;
  if ((S(row.gpsInstalled) === '장착') !== keys.includes('gps')) return false;
  const allowed = new Set(['rental_terms', ...atoms.map((atom) => S((atom as Record<string, unknown>)?.key)).filter(Boolean)]);
  return keys.length === new Set(keys).size && keys.every((key) => allowed.has(key));
}
