export type ChakhandealActor = {
  uid: string;
  role: 'agent' | 'provider' | 'admin';
  rawRole: string;
  agentChannelCode: string;
};

type RecordValue = Record<string, unknown>;
const text = (value: unknown): string => String(value ?? '').trim();

/** 계약 발송 권한은 기존 자체 전자서명과 동일하게 영업측+플랫폼 관리자만 갖는다. */
export function canSendChakhandealContract(actor: ChakhandealActor, contract: RecordValue): boolean {
  if (actor.role === 'admin') return true;
  if (actor.role !== 'agent') return false;
  if (text(contract.agent_uid) === actor.uid) return true;
  const manager = actor.rawRole === 'agent_admin' || actor.rawRole === 'agent_manager';
  return manager
    && !!actor.agentChannelCode
    && text(contract.agent_channel_code) === actor.agentChannelCode;
}

export function chakhandealIssuePayload(
  identity: { memberCompany: string; templateId: string },
  contract: RecordValue,
): RecordValue {
  const birth = text(contract.customer_birth || contract.birth);
  return {
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
