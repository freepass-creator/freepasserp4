
import { residentIdInfo } from '@/lib/domain/esign-resident-id';

export type SignedSnapshotRecord = Record<string, unknown>;

const S = (value: unknown) => String(value ?? '').trim();

function record(value: unknown): SignedSnapshotRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as SignedSnapshotRecord
    : null;
}

function signedAtText(value: unknown): string {
  const at = Number(value || 0);
  if (!Number.isFinite(at) || at <= 0) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(at)).replace(/\. /g, '.').replace(/\.$/, '').replace(',', '');
}

function frozenConsentEvidence(snapshot: SignedSnapshotRecord, submission: SignedSnapshotRecord) {
  const profile = record(snapshot.consentProfile);
  const keys = Array.isArray(profile?.requiredKeys)
    ? profile!.requiredKeys.map(S).filter(Boolean)
    : [];
  const times = record(submission.consentTimes) || {};
  // 제출 API가 이미 이 값들을 검증하지만, 완료 PDF를 만드는 마지막 경계에서도
  // 누락된 동의를 "완료"로 표기하지 않는다.
  if (!keys.length || keys.some((key) => !Number(times[key] || 0))) {
    return { keys: '', status: '', summary: '' };
  }
  const atoms = Array.isArray(profile?.atoms) ? profile!.atoms.map(record).filter((row): row is SignedSnapshotRecord => !!row) : [];
  const labels = keys.map((key) => key === 'rental_terms'
    ? '자동차 임대차 계약 약관'
    : S(atoms.find((atom) => S(atom.key) === key)?.label) || key);
  return {
    keys: keys.join(','),
    status: `${keys.length}건 필수 동의·계약조건 확인 완료`,
    summary: labels.join(' · '),
  };
}

/**
 * 발행 시점의 조건 스냅샷은 그대로 두되, 고객이 본인확인 단계에서 직접 확정한
 * 계약자 정보는 완료본을 만들 때만 합성한다. 주민등록번호·주소를 공개 계약 노드나
 * 세션 스냅샷으로 복제하지 않고도 서명 완료 PDF에는 빠짐없이 넣기 위한 경계다.
 */
export function snapshotWithPrivateSubmission(
  snapshot: SignedSnapshotRecord,
  submission: SignedSnapshotRecord | null | undefined,
): SignedSnapshotRecord {
  if (!submission) return snapshot;
  const currentFields = record(snapshot.templateFields) || {};
  const driverLicenseNo = S(submission.driver_license_no);
  const submittedCustomerId = S(submission.customer_id);
  // 제출 경로에서 개인 주민번호는 암호화 보관되고, 승인·봉인 직전에만 복호화되어
  // 이 함수로 전달된다. 완료 문서에는 원본 계약자번호와 함께 파생 생년월일을 일관되게
  // 남긴다. 법인등록번호나 비정상 입력값에서 생년월일을 추정하지 않는다.
  const derivedCustomerBirth = residentIdInfo(submittedCustomerId)?.birthDate || '';
  const additionalDrivers = Array.isArray(submission.additional_drivers)
    ? submission.additional_drivers.map(record).filter((row): row is SignedSnapshotRecord => !!row).slice(0, 3)
    : [];
  const insuranceEvidence = record(submission.customer_insurance_evidence);
  const insuranceEvidenceHash = S(insuranceEvidence?.sha256);
  const consentEvidence = frozenConsentEvidence(snapshot, submission);
  const confirmedFields: SignedSnapshotRecord = {
    customer_name: S(submission.customer_name),
    customer_phone: S(submission.customer_phone),
    customer_id: submittedCustomerId || S(submission.customer_birth),
    customer_address: S(submission.customer_address),
    // 개인 계약의 주민번호는 private node에 암호문으로만 보관한다. 승인·봉인 시에만
    // 복호화한 원문에서 생년월일을 보강하며, 공개 계약 노드에는 복제하지 않는다.
    customer_birth: S(submission.customer_birth) || derivedCustomerBirth,
    driver_license_no: driverLicenseNo,
    driver_or_biz_no: driverLicenseNo,
    tax_biz_name: S(submission.tax_biz_name), tax_biz_no: S(submission.tax_biz_no), tax_ceo: S(submission.tax_ceo),
    tax_biz_type_item: S(submission.tax_biz_type_item), tax_email: S(submission.tax_email), tax_biz_address: S(submission.tax_biz_address),
    tax_issue_type: S(submission.tax_issue_type),
    signer_name: S(submission.signer_name),
    signer_role: S(submission.signer_role),
    emergency_contact: [S(submission.emergency_relation), S(submission.emergency_name), S(submission.emergency_phone)]
      .filter(Boolean)
      .join(' · '),
    additional_driver: additionalDrivers.length ? `${additionalDrivers.length}인 지정` : '없음',
    esign_signed_at: signedAtText(submission.submittedAt),
    esign_consent_status: consentEvidence.status,
    esign_consent_keys: consentEvidence.keys,
    esign_consent_summary: consentEvidence.summary,
    esign_supporting_document_count: String(Array.isArray(submission.supporting_documents) ? submission.supporting_documents.length : 0),
    customer_insurance_evidence: insuranceEvidenceHash
      ? `가입증명서 제출·관리자 확인 (${insuranceEvidenceHash.slice(0, 12)})`
      : '',
  };
  additionalDrivers.forEach((driver, index) => {
    const slot = index + 1;
    confirmedFields[`drv${slot}_name`] = S(driver.name);
    confirmedFields[`drv${slot}_relation`] = S(driver.relation);
    confirmedFields[`drv${slot}_phone`] = S(driver.phone);
  });
  const templateFields = { ...currentFields };
  for (const [key, value] of Object.entries(confirmedFields)) {
    if (S(value)) templateFields[key] = value;
  }
  return { ...snapshot, templateFields };
}
