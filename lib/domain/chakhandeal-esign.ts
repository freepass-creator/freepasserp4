import { hasTermFrozen } from '@/lib/domain/contract';
import {
  AGREEMENT_CONFIRM_LABEL,
  REQUIRED_DOCS,
  SAMPLE_AGREEMENT,
  buildConsentGroups,
} from '@/lib/domain/esign-consent-doc';

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
 * `data` 는 착한거래 템플릿에 채워지는 기계용 값이고,
 * `consentGroups`·`requiredDocs`·`agreement` 는 **손님 화면 그 자체**다(`ESIGN…INTEGRATION.md` §3.1).
 * 손님이 볼 문자열은 여기서 굳혀 보낸다 — 저쪽이 다시 포맷하면 화면과 계약서의 숫자가 갈린다.
 *
 * ⚠ PII 는 `signer`(이름·생년·연락처)까지만 나간다. 주민번호·주소·면허번호는 우리가 갖고 있지도,
 *   보내지도 않는다 — 착한거래가 본인확인 과정에서 직접 받는다(§3).
 *   `consentGroups.identity` 의 주소는 계약에 이미 있는 값을 **확인시키는 용도**로만 실린다.
 */
export function chakhandealIssuePayload(
  identity: { memberCompany: string; templateId: string },
  contract: RecordValue,
  policy?: RecordValue | null,
): RecordValue {
  if (!hasTermFrozen(contract as Parameters<typeof hasTermFrozen>[0])) {
    throw new Error('약정에서 대여기간·금액을 먼저 확정해 주세요');
  }
  const birth = text(contract.customer_birth || contract.birth);
  return {
    // 손님 여정 — 원자 4묶음 확인 → 서류 → 약관 통독 → 서명.
    consentGroups: buildConsentGroups(contract as Parameters<typeof buildConsentGroups>[0], policy),
    requiredDocs: REQUIRED_DOCS,
    agreement: {
      version: SAMPLE_AGREEMENT.version,
      title: SAMPLE_AGREEMENT.title,
      isSample: SAMPLE_AGREEMENT.isSample,
      confirmLabel: AGREEMENT_CONFIRM_LABEL,
      requireReadThrough: true,
      sections: SAMPLE_AGREEMENT.sections,
    },
    templateId: identity.templateId,
    memberCompany: identity.memberCompany,
    externalRef: text(contract.contract_code),
    signer: {
      name: text(contract.customer_name),
      phone: text(contract.customer_phone),
      ...(birth ? { birth } : {}),
    },
    data: {
      contractCode: text(contract.contract_code),
      contractDate: text(contract.contract_date),
      carNumber: text(contract.car_number_snapshot),
      vehicleName: text(contract.vehicle_name_snapshot),
      maker: text(contract.maker_snapshot),
      model: text(contract.model_snapshot),
      subModel: text(contract.sub_model_snapshot),
      variant: text(contract.variant_snapshot),
      trim: [contract.trim_name_snapshot, contract.trim_extra_snapshot].map(text).filter(Boolean).join(' '),
      modelYear: text(contract.year_snapshot),
      fuel: text(contract.fuel_type_snapshot),
      rentMonths: Number(contract.rent_month_snapshot) || 0,
      rentAmount: Number(contract.rent_amount_snapshot) || 0,
      depositAmount: Number(contract.deposit_amount_snapshot) || 0,
      providerCompanyCode: text(contract.provider_company_code),
    },
  };
}
