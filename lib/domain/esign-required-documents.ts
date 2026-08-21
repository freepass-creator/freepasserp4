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
  {
    key: 'corporate',
    label: '법인',
    documents: [
      { key: 'business_registration', label: '사업자등록증', note: '현재 법인 정보가 보이는 사본을 첨부해 주세요.', required: true },
      { key: 'corporate_registry', label: '법인등기부등본', note: '최근 3개월 이내 발급본을 첨부해 주세요.', required: true },
      { key: 'corporate_seal', label: '법인인감증명서', note: '최근 3개월 이내 발급본을 첨부해 주세요.', required: true },
    ],
  },
];

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

