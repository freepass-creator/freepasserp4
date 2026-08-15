export type EsignRequiredDocument = {
  key: string;
  label: string;
  note: string;
  required: boolean;
};

type Rec = Record<string, unknown>;
const S = (value: unknown) => String(value ?? '').trim();
export const MAX_ESIGN_REQUIRED_DOCUMENTS = 6;

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

export function serializeEsignRequiredDocuments(documents: EsignRequiredDocument[]): string {
  return JSON.stringify(normalizeEsignRequiredDocuments(documents));
}

export function esignDocumentPreset(key: string): EsignRequiredDocument[] {
  const preset = ESIGN_DOCUMENT_PRESETS.find((row) => row.key === key);
  return preset ? preset.documents.map((row) => ({ ...row })) : [];
}

