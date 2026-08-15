import { hasTermFrozen } from '@/lib/domain/contract';
import {
  AGREEMENT_CONFIRM_LABEL,
  READ_THROUGH_ROWS,
  SAMPLE_AGREEMENT,
  buildConsentGroups,
  paginateForMobile,
} from '@/lib/domain/esign-consent-doc';
import { findContractKind, type InsuranceSide } from '@/lib/domain/esign-contract-kind';
import { findTemplate } from '@/lib/domain/esign-templates';
import { customerInputGroupsFor, customerInputsFor, pendingConsents } from '@/lib/domain/esign-inputs';
import {
  KEY_CLAUSE_CONFIRM_LABEL, agreementWithEmphasis, keyClauseSummaries,
} from '@/lib/domain/esign-agreement-emphasis';
import { providerContractIdentity, type ContractTemplateProfile } from '@/lib/domain/esign-template-profile';
import { buildTemplateFieldsFromRecords } from '@/lib/domain/esign-template-fields';
import { policyEsignRequiredDocuments } from '@/lib/domain/esign-required-documents';

export type ChakhandealActor = {
  uid: string;
  role: 'agent' | 'provider' | 'admin';
  rawRole: string;
  agentChannelCode: string;
};

type RecordValue = Record<string, unknown>;
const text = (value: unknown): string => String(value ?? '').trim();

/**
 * 계약서 발송은 **플랫폼 관리자만**(2026-08-08 사장님 결정).
 *
 * 손님에게 나가는 건 법적 효력이 있는 계약서고, 한 번 나가면 회수가 안 된다.
 * 영업자·공급사는 약정까지 만들고 발송 버튼은 관리자가 누른다 — 검수 지점을 하나로 모은다.
 * `role==='admin'` 은 `rawRole==='admin'`(플랫폼 관리자) 하나뿐이다(`verifyActiveBearer`).
 * contract 인자는 호출부 시그니처 유지를 위해 남겨 둔다 — 지금 판정에는 쓰지 않는다.
 */
export function canSendChakhandealContract(actor: ChakhandealActor, _contract: RecordValue): boolean {
  return actor.role === 'admin' && actor.rawRole === 'admin';
}

/**
 * 착한거래 계약 발행 payload.
 *
 * `templateFields` / `templateState` 는 A4 인쇄 칸(data-field).
 * `consentGroups`·`requiredDocs`·`agreement` 는 **손님 화면**이다.
 * 화면 값에서 인쇄본을 되짚어 만들지 않는다 — 빈칸·어긋남이 난다.
 *
 * ⚠ PII 는 `signer`(이름·생년·연락처)까지만 나간다. 주민번호·주소·면허번호는 우리가 갖고 있지도,
 *   보내지도 않는다 — 착한거래가 본인확인 과정에서 직접 받는다(§3).
 *   `consentGroups.identity` 의 주소는 계약에 이미 있는 값을 **확인시키는 용도**로만 실린다.
 */
export function chakhandealIssuePayload(
  identity: {
    memberCompany: string;
    /** 착한거래가 실제로 렌더할 외부 템플릿 ID. 계약유형 키와 섞지 않는다. */
    templateId: string;
    contractKind?: string;
    templateProfile?: ContractTemplateProfile;
  },
  contract: RecordValue,
  policy?: RecordValue | null,
  insuranceSide: InsuranceSide = '회사포함',
  partner?: RecordValue | null,
  opts?: {
    product?: RecordValue | null;
    /** 관리자 직접 입력 — 외부값 위에 덮어씀 */
    templateFieldOverrides?: Record<string, string> | null;
  },
): RecordValue {
  if (!hasTermFrozen(contract as Parameters<typeof hasTermFrozen>[0])) {
    throw new Error('약정에서 대여기간·금액을 먼저 확정해 주세요');
  }
  const birth = text(contract.customer_birth || contract.birth);
  const product = opts?.product || null;
  // 스냅샷이 비면 재고·원본 필드로 보강 — 손님 요지(차종·번호·기간)가 빈칸으로 나가지 않게.
  const carNumber = text(
    contract.car_number_snapshot || contract.car_number || product?.car_number,
  );
  const vehicleName = text(contract.vehicle_name_snapshot)
    || text(
      [contract.maker_snapshot, contract.model_snapshot, contract.sub_model_snapshot]
        .map(text)
        .filter(Boolean)
        .join(' '),
    )
    || text(
      [product?.maker, product?.model, product?.sub_model]
        .map(text)
        .filter(Boolean)
        .join(' '),
    );
  const enriched = {
    ...contract,
    car_number_snapshot: carNumber,
    vehicle_name_snapshot: text(contract.vehicle_name_snapshot) || vehicleName,
    rent_month_snapshot: contract.rent_month_snapshot || contract.rent_month,
    rent_amount_snapshot: contract.rent_amount_snapshot || contract.rent_amount,
    deposit_amount_snapshot:
      contract.deposit_amount_snapshot ?? contract.deposit_amount ?? 0,
  };
  // 예전 호출부는 templateId에 계약유형을 넣었다. 신규 경로는 외부 템플릿 ID와
  // 계약유형을 분리하며, fallback은 로컬 회귀·기발행 호환을 위해서만 남긴다.
  const contractKind = text(identity.contractKind || contract.contract_kind || identity.templateId);
  const spec = findContractKind(contractKind);
  const standardTemplate = findTemplate(identity.templateProfile?.baseTemplateId);
  const provider = providerContractIdentity(partner, contract.provider_company_code);
  const groups = buildConsentGroups(
    {
      ...enriched,
      // 선택은 관리자 화면에서 끝났다. 고객 화면은 이 확정값을 읽고 동의하기만 한다.
      ...(spec ? { contract_kind: spec.key } : {}),
      ...(standardTemplate ? { esign_standard_template_label: standardTemplate.label } : {}),
    } as Parameters<typeof buildConsentGroups>[0],
    policy,
    insuranceSide,
  );
  const { fields: templateFields, state: templateState } = buildTemplateFieldsFromRecords({
    contract: enriched,
    policy,
    partner,
    product,
    overrides: {
      ...(insuranceSide === '고객직접' ? { ins: '별도' } : { ins: '포함' }),
      ...(opts?.templateFieldOverrides || {}),
    },
  });
  return {
    // 손님 여정 — 원자 4묶음 확인 → 서류 → 약관 통독 → 서명.
    consentGroups: groups,
    // 손님 화면 규격 — **1섹션 = 1화면.** 어디서 끊을지는 우리가 정해 보낸다.
    // 저쪽이 임의로 나누면 「사고·면책」 같은 섹션이 두 동강 나 앞장만 읽고 넘어간다.
    consentPages: paginateForMobile(groups),
    readThroughRows: READ_THROUGH_ROWS,
    // 계약 유형 — 문서명·당사자 호칭·만기 처리가 여기서 갈린다.
    contractKind: spec
      ? {
        key: spec.key, label: spec.label, kind: spec.kind, maturity: spec.maturity,
        title: spec.title, party: spec.party, maturityNote: spec.maturityNote,
        insuranceSide,
      }
      : null,
    // 손님에게 **받아올** 값 — 보여줄 값(consentGroups)과 짝이다.
    // 저쪽에 폼을 복제하지 않는다. 필드를 늘릴 때 우리만 고치면 되게 한다.
    // 금액을 바꾸는 항목(운전자범위 등)은 여기 절대 안 들어온다 — 약정에서 이미 굳었다.
    inputRequests: customerInputsFor(contract as Parameters<typeof customerInputsFor>[0]),
    // 묶음별로 끊은 화면 — 종이 「자동이체 신청서」 한 장이 아니라 «출금계좌» 섹션이다.
    inputGroups: customerInputGroupsFor(contract as Parameters<typeof customerInputsFor>[0]),
    // 개인정보 동의 — 항목·목적·보유기간·받는자까지. 「동의합니다」 한 줄로는 유효하지 않다.
    consentAtoms: pendingConsents(contract as Parameters<typeof pendingConsents>[0]),
    requiredDocs: policyEsignRequiredDocuments(policy),
    // ── 약관 CROSS-CHECK (오픈 종합검토) ──
    // 여기로 나가는 agreement = 손님이 착한거래에서 통독·동의하는 본문.
    // 정본 삼각: rental-contract.html ↔ esign-agreement-text.ts ↔ 이 payload.
    // isSample·version·조문 불일치면 실발송 금지. 상세:
    //   docs/CONTRACT_REPLACEMENT_REVIEW_2026-08-10.md
    //   docs/CLAUDE_OPEN_FULL_REVIEW_REQUEST_2026-08-10.md §2-4
    agreement: {
      version: SAMPLE_AGREEMENT.version,
      title: SAMPLE_AGREEMENT.title,
      isSample: SAMPLE_AGREEMENT.isSample,
      confirmLabel: AGREEMENT_CONFIRM_LABEL,
      requireReadThrough: true,
      // 조문마다 `emphasis` 가 붙는다 — 돈·차량회수·계약해지·보험제외에 걸리는 조문만 true.
      // 다 강조하면 아무것도 강조되지 않으므로 저쪽에서 임의로 늘리지 말 것.
      sections: agreementWithEmphasis(),
    },
    /**
     * 통독 뒤 **다시 한 번** 요약으로 보여주고 동의받을 주요 사항.
     * 「약관에 있었다」만으로는 «못 봤는데요»를 못 막는다 — 강조 + 재확인이 설명의무의 증거다.
     */
    keyClauses: {
      confirmLabel: KEY_CLAUSE_CONFIRM_LABEL,
      items: keyClauseSummaries(),
    },
    // 표준 3벌 중 선택한 기준서식과 업체별 파생판의 계보를 남긴다.
    templateProfile: identity.templateProfile || null,
    templateId: identity.templateId,
    memberCompany: identity.memberCompany,
    externalRef: text(contract.contract_code),
    signer: {
      name: text(contract.customer_name),
      phone: text(contract.customer_phone),
      ...(birth ? { birth } : {}),
    },
    // A4 인쇄용 — 서식 data-field 키. 화면용과 분리.
    templateFields,
    templateState,
    data: {
      contractCode: text(contract.contract_code),
      contractDate: text(contract.contract_date),
      carNumber: text(enriched.car_number_snapshot),
      vehicleName: text(enriched.vehicle_name_snapshot),
      maker: text(contract.maker_snapshot || product?.maker),
      model: text(contract.model_snapshot || product?.model),
      subModel: text(contract.sub_model_snapshot || product?.sub_model),
      variant: text(contract.variant_snapshot),
      trim: [contract.trim_name_snapshot, contract.trim_extra_snapshot].map(text).filter(Boolean).join(' '),
      modelYear: text(contract.year_snapshot),
      fuel: text(contract.fuel_type_snapshot || product?.fuel_type),
      rentMonths: Number(enriched.rent_month_snapshot) || 0,
      rentAmount: Number(enriched.rent_amount_snapshot) || 0,
      depositAmount: Number(enriched.deposit_amount_snapshot) || 0,
      providerCompanyCode: text(contract.provider_company_code),
      standardTemplateId: standardTemplate?.id || '',
      standardTemplateLabel: standardTemplate?.label || '',
      contractKind: spec?.key || '',
      contractKindLabel: spec?.label || '',
      contractTitle: spec?.title || '',
      maturity: spec?.maturity || '',
      maturityNote: spec?.maturityNote || '',
      insuranceSide,
      provider: {
        code: provider.code,
        companyName: provider.companyName,
        ceo: provider.ceo,
        businessNumber: provider.businessNumber,
        phone: provider.phone,
        address: provider.address,
      },
    },
  };
}
