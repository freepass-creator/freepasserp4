import 'server-only';

import { hasMeaningfulFreepassSignature } from '@/lib/server/freepass-esign-signature';
import { driverAgeRange, residentIdInfo } from '@/lib/domain/esign-resident-id';
import { SIGNER_ROLES } from '@/lib/domain/esign-required-documents';

export type EsignSubmissionRecord = Record<string, unknown>;
const S = (value: unknown) => String(value ?? '').trim();
const record = (value: unknown): EsignSubmissionRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as EsignSubmissionRecord : {};

function birthDate(value: unknown): string {
  const digits = S(value).replace(/\D/g, '');
  if (!/^\d{8}$/.test(digits)) return '';
  const normalized = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return Number.isNaN(Date.parse(`${normalized}T00:00:00+09:00`)) ? '' : normalized;
}

function requiredConsentKeys(snapshot: EsignSubmissionRecord): string[] {
  const profile = record(snapshot.consentProfile);
  const keys = Array.isArray(profile.requiredKeys) ? profile.requiredKeys.map(S).filter(Boolean) : [];
  if (!keys.includes('rental_terms') || !keys.includes('privacy') || keys.length !== new Set(keys).size) throw new Error('동의 프로필이 올바르지 않아 새 링크 발행이 필요합니다.');
  const atoms = Array.isArray(profile.atoms) ? profile.atoms.map(record) : [];
  const allowed = new Set(['rental_terms', ...atoms.map((atom) => S(atom.key)).filter(Boolean)]);
  if (keys.some((key) => !allowed.has(key))) throw new Error('동의 프로필이 올바르지 않아 새 링크 발행이 필요합니다.');
  return keys;
}

/** Canonical input validation shared by final submit and no-persist contract preview. */
export function validateFreepassSubmission(payload: EsignSubmissionRecord, snapshot: EsignSubmissionRecord, options: { requireSignature?: boolean } = {}) {
  const requireSignature = options.requireSignature !== false;
  const name = S(payload.customer_name), phone = S(payload.customer_phone).replace(/\D/g, ''), signature = S(payload.signature);
  const consents = Array.isArray(payload.consents) ? payload.consents.map(S) : [];
  if (!name || name.length > 40) throw new Error('성명은 1~40자로 입력해 주세요.');
  if (phone.length < 10 || phone.length > 11) throw new Error('연락처를 정확히 입력해 주세요.');
  if (requireSignature && (!signature.startsWith('data:image/png;base64,') || signature.length > 600000)) throw new Error('전자서명을 다시 입력해 주세요.');
  if (requireSignature && !hasMeaningfulFreepassSignature(signature)) throw new Error('서명란에 성명을 또렷하게 적어 주세요. 한 점 또는 너무 짧은 표시는 사용할 수 없습니다.');
  const requiredConsents = requiredConsentKeys(snapshot), allowedConsents = new Set(requiredConsents);
  if (consents.length !== new Set(consents).size || consents.some((key) => !allowedConsents.has(key))) throw new Error('동의 항목이 현재 계약의 발행 프로필과 일치하지 않습니다. 새 링크를 확인해 주세요.');
  if (!requiredConsents.every((key) => consents.includes(key))) throw new Error('필수 약관 동의가 누락되었습니다.');
  const confirmations = record(payload.sectionConfirmations), groups = Array.isArray(snapshot.consentGroups) ? snapshot.consentGroups : [];
  if (groups.map((group) => S(record(group).key)).filter((key) => key && key !== 'identity' && !Number(confirmations[key] || 0)).length) throw new Error('확인하지 않은 계약 조건이 있습니다.');
  if (!Number(payload.summaryConfirmedAt || 0)) throw new Error('계약 요약을 먼저 확인해 주세요.');
  if (!Number(payload.agreementReadAt || 0)) throw new Error('약관을 끝까지 읽고 동의해 주세요.');
  for (const [key, limit] of [['customer_id', 30], ['customer_address', 200], ['driver_license_no', 30], ['emergency_relation', 30], ['emergency_name', 40], ['emergency_phone', 30]] as const) if (S(payload[key]).length > limit) throw new Error('입력값이 너무 깁니다.');
  const corporate = S(record(snapshot.templateState).ct) === '법인', soleProprietor = S(record(snapshot.templateState).tax) === '사업자';
  const customerId = S(payload.customer_id).replace(/\D/g, ''), templateFields = record(snapshot.templateFields);
  let customerBirth = '';
  if (corporate) {
    if (customerId.length !== 13) throw new Error('법인등록번호 13자리를 정확히 입력해 주세요.');
    if (S(payload.driver_license_no).replace(/\D/g, '').length !== 10) throw new Error('사업자등록번호 10자리를 정확히 입력해 주세요.');
  } else {
    /* ★주민등록번호에서 생년월일을 «파생»한다 — 손님에게 두 번 묻지 않는다(사장님 2026-08-29 주민번호 재수집 결정).
       residentIdInfo 가 자릿수·생년월일 유효성까지 겸한다. 원문은 여기서 밖으로 나가지 않는다 —
       저장은 암호화(encryptRrn), 봉인본을 만들 때만 푼다(decryptRrn). */
    const resident = residentIdInfo(payload.customer_id);
    if (!resident) throw new Error('주민등록번호 13자리를 정확히 입력해 주세요.');
    customerBirth = resident.birthDate;
    const ageRange = driverAgeRange(templateFields.driver_age), reference = S(templateFields.contract_start || templateFields.contract_date) || new Date().toISOString().slice(0, 10);
    const [by, bm, bd] = customerBirth.split('-').map(Number), [ry, rm, rd] = reference.slice(0, 10).split('-').map(Number), age = ry - by - ((rm < bm || (rm === bm && rd < bd)) ? 1 : 0);
    if (ageRange.min != null && age < ageRange.min) throw new Error(`이 계약은 만 ${ageRange.min}세 이상만 운전할 수 있습니다.`);
    if (ageRange.max != null && age > ageRange.max) throw new Error(`이 계약은 만 ${ageRange.max}세 이하만 운전할 수 있습니다.`);
    if (!S(payload.driver_license_no)) throw new Error('운전면허번호를 입력해 주세요.');
    if (payload.id_card_rrn_masked !== true) throw new Error('운전면허증의 주민등록번호 뒷자리를 가렸는지 확인해 주세요.');
  }
  if (!S(payload.customer_address)) throw new Error('계약서에 기재할 주소를 입력해 주세요.');
  const business = { name:S(payload.tax_biz_name), no:S(payload.tax_biz_no).replace(/\D/g,''), ceo:S(payload.tax_ceo), typeItem:S(payload.tax_biz_type_item), email:S(payload.tax_email), address:S(payload.tax_biz_address) };
  if (soleProprietor && (!business.name || business.name.length > 120 || business.no.length !== 10 || !business.ceo || business.ceo.length > 80 || !business.typeItem || business.typeItem.length > 160 || !/^\S+@\S+\.\S+$/.test(business.email) || business.email.length > 160 || !business.address || business.address.length > 200)) throw new Error('세금계산서 사업자 정보를 확인해 주세요.');
  const emergencyRelation=S(payload.emergency_relation), emergencyName=S(payload.emergency_name), emergencyPhone=S(payload.emergency_phone).replace(/\D/g,'');
  if (!emergencyRelation) throw new Error('비상연락 관계를 입력해 주세요.'); if (!emergencyName) throw new Error('비상연락 성명을 입력해 주세요.'); if (emergencyPhone.length < 10 || emergencyPhone.length > 11) throw new Error('비상연락처를 정확히 입력해 주세요.');
  const salesProofMethod=S(payload.sales_proof_method), salesProofValue=S(payload.sales_proof_value).replace(/\D/g,'');
  if (!corporate && !soleProprietor) { if (!['phone','rrn'].includes(salesProofMethod)) throw new Error('매출증빙 수단을 선택해 주세요.'); if (salesProofMethod==='phone' && !/^\d{10,11}$/.test(salesProofValue)) throw new Error('매출증빙용 휴대전화번호를 정확히 입력해 주세요.'); if (salesProofMethod==='rrn') { if (!/^\d{13}$/.test(salesProofValue)) throw new Error('매출증빙용 주민등록번호 13자리를 정확히 입력해 주세요.'); if (payload.sales_proof_rrn_consent !== true) throw new Error('매출증빙용 주민등록번호 암호화 보관 동의가 필요합니다.'); } }
  const signerName=S(payload.signer_name), signerRole=S(payload.signer_role); if (corporate && (!signerName || signerName.length > 40)) throw new Error('법인 서명자 성명을 입력해 주세요.'); if (corporate && !(SIGNER_ROLES as readonly string[]).includes(signerRole)) throw new Error('법인과의 관계를 선택해 주세요.');
  const cmsRequired=record(snapshot.consentProfile).cmsRequiredBeforeHandover===true, cms={holderName:S(payload.cms_holder_name),holderRelation:S(payload.cms_holder_relation),holderPhone:S(payload.cms_holder_phone).replace(/\D/g,''),bank:S(payload.cms_bank),accountNo:S(payload.cms_account_no).replace(/\D/g,''),holderIdentifier:S(payload.cms_holder_identifier).replace(/\D/g,'')};
  if (cmsRequired && (!cms.holderName || cms.holderName.length>80 || !cms.holderRelation || cms.holderRelation.length>40 || !/^\d{10,11}$/.test(cms.holderPhone) || !cms.bank || cms.bank.length>40 || !/^\d{6}(\d{4})?$/.test(cms.holderIdentifier) || cms.accountNo.length<6 || cms.accountNo.length>24)) throw new Error('자동이체 예금주·관계·연락처·은행·계좌번호·생년월일 또는 사업자번호를 확인해 주세요.');
  const limit=Math.max(0,Math.min(3,Number(record(snapshot.additionalDriverPolicy).limit || 0))), raw=Array.isArray(payload.additional_drivers)?payload.additional_drivers:[]; if(raw.length>limit) throw new Error(`추가 운전자는 최대 ${limit}명까지 등록할 수 있습니다.`);
  const additionalDrivers=raw.map((value,index)=>{const d=record(value), driverName=S(d.name),relation=S(d.relation),driverPhone=S(d.phone).replace(/\D/g,''),driverLicenseNo=S(d.driver_license_no); if(!driverName||driverName.length>40) throw new Error(`추가 운전자 ${index+1}의 성명을 확인해 주세요.`); if(!relation||relation.length>30) throw new Error(`추가 운전자 ${index+1}의 관계를 확인해 주세요.`); if(driverPhone.length<10||driverPhone.length>11) throw new Error(`추가 운전자 ${index+1}의 연락처를 확인해 주세요.`); if(!driverLicenseNo||driverLicenseNo.length>30) throw new Error(`추가 운전자 ${index+1}의 면허번호를 확인해 주세요.`); if(!Number(d.consentAt||0)) throw new Error(`추가 운전자 ${index+1}의 개인정보 제공 동의가 필요합니다.`); return {name:driverName,relation,phone:driverPhone,driver_license_no:driverLicenseNo,consentAt:Number(d.consentAt)};});
  return { name, phone, signature, consents, confirmations, additionalDrivers, emergencyRelation, emergencyName, emergencyPhone, business, customerBirth: corporate ? '' : customerBirth, salesProofMethod, salesProofValue, signerName, signerRole, cms: cmsRequired ? cms : null, corporate };
}
