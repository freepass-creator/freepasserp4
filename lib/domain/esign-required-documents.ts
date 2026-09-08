/**
 * **전자계약을 «진행»할 때 쓰는 요구서류 — 거래 채.**
 *
 * ★★★**서류를 «읽는» 부분은 `lib/domain/required-documents`(공용)로 갈랐다**(2026-09-08).
 *   채(館) 셋의 경계를 재 보니, 손님만 보는 매물 화면(`/shop`·`/q`·`/m`)까지 이 파일을 거쳐
 *   위약금율·지연이자·계약종류(`esign-contract-kind`)를 **통째로** 끌고 있었다.
 *   그런데 그쪽이 실제로 쓰는 건 **서류 이름 목록 하나**뿐이었다(`product.ts` 727행 —
 *   「무슨 서류 필요해요?」에 영업자가 바로 답하라고 카드에 적는 그 줄).
 *
 * ⇒ 여기 남은 것은 «계약을 진행할 때만» 쓰는 것들이다 —
 *   프리셋 · 보험가입증명서 · 서명자 역할 · 봉인 서류.
 *
 * ⚠ **부르던 이름은 그대로 다시 내보낸다** — 열두 곳이 이 경로로 부르고 있어 손대지 않는다.
 *   새로 쓸 때 «읽기»만 하면 `required-documents` 를 직접 부르는 쪽이 짐이 가볍다.
 */
import { CUSTOMER_INSURANCE_NOTE } from '@/lib/domain/esign-contract-kind';
import {
  MAX_ESIGN_REQUIRED_DOCUMENTS,
  mergeEsignRequiredDocuments,
  policyEsignRequiredDocuments,
  type EsignRequiredDocument,
} from '@/lib/domain/required-documents';

export {
  MAX_ESIGN_REQUIRED_DOCUMENTS,
  mergeEsignRequiredDocuments,
  normalizeEsignRequiredDocuments,
  policyEsignRequiredDocuments,
  serializeEsignRequiredDocuments,
} from '@/lib/domain/required-documents';
export type { EsignRequiredDocument } from '@/lib/domain/required-documents';

type Rec = Record<string, unknown>;
const S = (value: unknown) => String(value ?? '').trim();

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
      { key: 'delegation_letter', label: '위임장', note: '위임받은 임직원이 서명하는 경우 첨부해 주세요.', required: false },
      { key: 'employment_certificate', label: '재직증명서', note: '위임받은 임직원이 서명하는 경우 첨부해 주세요.', required: false },
    ],
  },
];

/** 법인 임차인은 계약당사자, 서명자는 대표자 또는 위임받은 임직원이다. */
export const SIGNER_ROLES = ['대표이사', '위임받은 임직원'] as const;
export const DELEGATED_SIGNER_ROLE = '위임받은 임직원';

/**
 * 발행 시에는 위임 여부를 알 수 없으므로 선택 서류로 동결한다. 고객이 위임받은
 * 임직원을 고르면 제출 직전에만 두 서류를 필수로 올린다.
 */
export function applySignerRoleToDocuments(
  documents: EsignRequiredDocument[],
  signerRole: unknown,
): EsignRequiredDocument[] {
  const delegated = S(signerRole) === DELEGATED_SIGNER_ROLE;
  const required = (key: string) => delegated && (key === 'delegation_letter' || key === 'employment_certificate');
  const base = documents.map((document) => ({ ...document, required: document.required || required(document.key) }));
  if (!delegated) return base;
  const additions: EsignRequiredDocument[] = [
    { key: 'delegation_letter', label: '위임장', note: '법인 명의의 서명 권한 위임장을 첨부해 주세요.', required: true },
    { key: 'employment_certificate', label: '재직증명서', note: '서명자의 재직을 확인할 수 있는 서류를 첨부해 주세요.', required: true },
  ];
  return mergeEsignRequiredDocuments(base, additions);
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

export function esignDocumentPreset(key: string): EsignRequiredDocument[] {
  const preset = ESIGN_DOCUMENT_PRESETS.find((row) => row.key === key);
  return preset ? preset.documents.map((row) => ({ ...row })) : [];
}

