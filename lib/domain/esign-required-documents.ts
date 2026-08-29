import { CUSTOMER_INSURANCE_NOTE } from '@/lib/domain/esign-contract-kind';

export type EsignRequiredDocument = {
  key: string;
  label: string;
  note: string;
  required: boolean;
};

type Rec = Record<string, unknown>;
const S = (value: unknown) => String(value ?? '').trim();
export const MAX_ESIGN_REQUIRED_DOCUMENTS = 10; // 시트 체크 6(사장님 2026-08-19) + 기타서류

/**
 * 고객 직접가입 상품은 보험 증명서가 없으면 출고할 수 없다.
 * 문구는 구독 약정서 정본에서 이미 쓰는 안내를 재사용한다. 원본 파일은 private 경로에만 둔다.
 */
export const CUSTOMER_INSURANCE_CERTIFICATE: EsignRequiredDocument = {
  key: 'customer_insurance_certificate',
  label: '자동차보험 가입증명서(회사 질권 설정)',
  note: CUSTOMER_INSURANCE_NOTE,
  required: true,
};

export const ESIGN_DOCUMENT_PRESETS: Array<{
  key: string;
  label: string;
  documents: EsignRequiredDocument[];
}> = [
  {
    key: 'personal-basic',
    label: '개인 기본',
    documents: [
      { key: 'resident_register', label: '주민등록등본', note: '최근 3개월 이내 발급본을 첨부해 주세요.', required: true },
      { key: 'family_register', label: '가족관계증명서', note: '주민등록번호 뒷자리는 가려서 첨부해 주세요.', required: true },
    ],
  },
  {
    key: 'income',
    label: '소득 확인',
    documents: [
      { key: 'income_certificate', label: '소득금액증명원', note: '가장 최근 귀속연도 발급본을 첨부해 주세요.', required: true },
      { key: 'health_insurance', label: '건강보험 자격득실확인서', note: '최근 발급본을 첨부해 주세요.', required: false },
    ],
  },
  {
    key: 'business',
    label: '개인사업자',
    documents: [
      { key: 'business_registration', label: '사업자등록증', note: '현재 사업자 정보가 보이는 사본을 첨부해 주세요.', required: true },
      { key: 'vat_certificate', label: '부가가치세 과세표준증명', note: '최근 발급본을 첨부해 주세요.', required: true },
      { key: 'bank_book', label: '통장 사본', note: '대여료 출금계좌와 같은 계좌의 사본을 첨부해 주세요.', required: false },
    ],
  },
  /*
   * ★법인은 «누가 서명하느냐»로 서류가 갈린다(사장님 2026-08-28).
   *   대표이사가 서명하는 것은 «위임»이 아니라 «대표권 행사»다 — 위임장이 필요 없고,
   *   대표권은 법인등기부등본이 증명한다.
   *   위임장·재직증명서가 필요한 건 «대표이사가 아닌 임직원»이 서명할 때뿐이다.
   *
   * ⚠ 그래서 프리셋을 둘로 나누지 «않는다». 발행 시점에는 누가 서명할지 아직 모르기 때문이다
   *   (프리셋은 contract.customer_type 에서 자동으로 정해지고, 영업이 고르는 자리가 없다).
   *   둘로 나눠 놓고 영업이 잘못 고르면 «계약서에 대표이사라고 거짓이 찍힌다».
   *   그래서 위임 서류는 «해당 시»(required:false)로 항상 목록에 두고,
   *   손님이 관계를 「위임받은 임직원」으로 고르는 그 자리에서 필수로 승격시킨다
   *   — `applySignerRoleToDocuments()`. 화면과 서버가 그 함수 하나를 같이 쓴다.
   */
  {
    key: 'corporate',
    label: '법인',
    documents: [
      { key: 'business_registration', label: '사업자등록증', note: '현재 법인 정보가 보이는 사본을 첨부해 주세요.', required: true },
      { key: 'corporate_registry', label: '법인등기부등본', note: '최근 3개월 이내 발급본을 첨부해 주세요. 대표이사의 대표권을 여기서 확인합니다.', required: true },
      { key: 'corporate_seal', label: '법인인감증명서', note: '최근 3개월 이내 발급본을 첨부해 주세요.', required: true },
      { key: 'delegation_letter', label: '위임장', note: '대표이사가 아닌 분이 서명하는 경우에만 필요합니다. 법인인감을 날인하고, 위임 범위에 「자동차 대여계약 체결」이 있어야 합니다.', required: false },
      { key: 'employment_certificate', label: '재직증명서', note: '대표이사가 아닌 분이 서명하는 경우에만 필요합니다. 서명하는 분이 현재 재직 중임이 보여야 합니다.', required: false },
    ],
  },
];

/** 법인 계약에서 서명자가 법인과 맺은 관계. 「위임받은 임직원」이면 아래 두 서류가 필수가 된다. */
export const SIGNER_ROLES = ['대표이사', '위임받은 임직원'] as const;
export const DELEGATED_SIGNER_ROLE = '위임받은 임직원';
const DELEGATION_DOCUMENT_KEYS = ['delegation_letter', 'employment_certificate'];

/**
 * 서명자의 관계에 따라 위임 서류를 «필수로 승격»한다.
 *
 * ★손님 화면과 서버가 **이 함수 하나를** 같이 쓴다.
 *   각자 판정하면 «화면엔 선택인데 서버가 막는» 상태가 생기고, 손님은 이유를 모른 채 갇힌다.
 *   승격만 하고 강등은 하지 않는다 — 정책이 이미 필수로 정한 서류를 관계 때문에 풀어 주면 안 된다.
 */
export function applySignerRoleToDocuments(
  documents: EsignRequiredDocument[],
  signerRole: unknown,
): EsignRequiredDocument[] {
  if (S(signerRole) !== DELEGATED_SIGNER_ROLE) return documents;
  return documents.map((document) => (
    DELEGATION_DOCUMENT_KEYS.includes(document.key) ? { ...document, required: true } : document
  ));
}

function safeKey(value: unknown, index: number, used: Set<string>): string {
  const base = S(value).toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^_+|_+$/g, '')
    || `document_${index + 1}`;
  let key = base.slice(0, 48);
  let suffix = 2;
  while (used.has(key)) key = `${base.slice(0, 42)}_${suffix++}`;
  used.add(key);
  return key;
}

export function normalizeEsignRequiredDocuments(value: unknown): EsignRequiredDocument[] {
  let source = value;
  if (typeof source === 'string') {
    if (!source.trim()) return [];
    try { source = JSON.parse(source); }
    catch { return []; }
  }
  if (!Array.isArray(source)) return [];
  const used = new Set<string>();
  return source.slice(0, MAX_ESIGN_REQUIRED_DOCUMENTS).flatMap((item, index) => {
    const row = item && typeof item === 'object' && !Array.isArray(item) ? item as Rec : {};
    const label = S(row.label).slice(0, 40);
    if (!label) return [];
    return [{
      key: safeKey(row.key, index, used),
      label,
      note: S(row.note).slice(0, 160),
      required: row.required !== false,
    }];
  });
}

export function policyEsignRequiredDocuments(policy: Rec | null | undefined): EsignRequiredDocument[] {
  return normalizeEsignRequiredDocuments(
    policy?.esign_required_documents ?? policy?.required_documents,
  );
}

/** 여러 출처의 요구서류를 키 기준으로 합친다. 앞쪽 항목을 우선해 고객 화면의 순서도 고정한다. */
export function mergeEsignRequiredDocuments(
  ...groups: Array<EsignRequiredDocument[] | null | undefined>
): EsignRequiredDocument[] {
  const byKey = new Map<string, EsignRequiredDocument>();
  for (const group of groups) {
    for (const document of normalizeEsignRequiredDocuments(group || [])) {
      const current = byKey.get(document.key);
      byKey.set(document.key, current
        ? { ...current, required: current.required || document.required }
        : document);
    }
  }
  return [...byKey.values()].slice(0, MAX_ESIGN_REQUIRED_DOCUMENTS);
}

/**
 * 프리패스 전자계약의 봉인 요구서류.
 * 보험별도는 정책이 추가서류를 비워도 보험가입증명서를 반드시 맨 앞에 넣는다.
 */
export function freepassEsignRequiredDocuments(
  policy: Rec | null | undefined,
  insuranceSide: '회사포함' | '고객직접',
): EsignRequiredDocument[] {
  const policyDocuments = policyEsignRequiredDocuments(policy);
  return insuranceSide === '고객직접'
    ? mergeEsignRequiredDocuments([CUSTOMER_INSURANCE_CERTIFICATE], policyDocuments)
    : policyDocuments;
}

export function serializeEsignRequiredDocuments(documents: EsignRequiredDocument[]): string {
  return JSON.stringify(normalizeEsignRequiredDocuments(documents));
}

export function esignDocumentPreset(key: string): EsignRequiredDocument[] {
  const preset = ESIGN_DOCUMENT_PRESETS.find((row) => row.key === key);
  return preset ? preset.documents.map((row) => ({ ...row })) : [];
}

