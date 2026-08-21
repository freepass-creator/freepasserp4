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
  const resident = residentIdInfo(submission.customer_id);
  const additionalDrivers = Array.isArray(submission.additional_drivers)
    ? submission.additional_drivers.map(record).filter((row): row is SignedSnapshotRecord => !!row).slice(0, 3)
    : [];
  const insuranceEvidence = record(submission.customer_insurance_evidence);
  const insuranceEvidenceHash = S(insuranceEvidence?.sha256);
  const confirmedFields: SignedSnapshotRecord = {
    customer_name: S(submission.customer_name),
    customer_phone: S(submission.customer_phone),
    customer_id: S(submission.customer_id),
    customer_address: S(submission.customer_address),
    customer_birth: resident?.birthDate || '',
    driver_license_no: driverLicenseNo,
    driver_or_biz_no: driverLicenseNo,
    emergency_contact: [S(submission.emergency_relation), S(submission.emergency_name), S(submission.emergency_phone)]
      .filter(Boolean)
      .join(' · '),
    additional_driver: additionalDrivers.length ? `${additionalDrivers.length}인 지정` : '없음',
    esign_signed_at: signedAtText(submission.submittedAt),
    esign_consent_status: '필수 동의·계약조건 확인 완료',
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
