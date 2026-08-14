import { snapshotWithPrivateSubmission } from '../lib/domain/esign-signed-snapshot';

const base = {
  templateFields: {
    customer_name: '발행 전 이름',
    customer_phone: '010-0000-0000',
    rent_amount: '650,000원',
  },
};
const privateSubmission = {
  customer_name: '홍길동',
  customer_phone: '010-1234-5678',
  customer_id: '900101-1234567',
  customer_address: '서울특별시 샘플구 예시동 00',
  driver_license_no: '11-22-345678-90',
  emergency_name: '홍가족',
  emergency_phone: '010-0000-0001',
  additional_drivers: [
    { name: '김운전', relation: '배우자', phone: '010-1111-2222', driver_license_no: '서울-01-000000-00' },
  ],
};
const signed = snapshotWithPrivateSubmission(base, privateSubmission);
const fields = signed.templateFields as Record<string, string>;

const expected: Record<string, string> = {
  customer_name: '홍길동',
  customer_phone: '010-1234-5678',
  customer_id: '900101-1234567',
  customer_address: '서울특별시 샘플구 예시동 00',
  customer_birth: '1990-01-01',
  driver_license_no: '11-22-345678-90',
  driver_or_biz_no: '11-22-345678-90',
  emergency_contact: '홍가족 · 010-0000-0001',
  additional_driver: '1인 지정',
  drv1_name: '김운전',
  drv1_relation: '배우자',
  drv1_phone: '010-1111-2222',
  rent_amount: '650,000원',
};
for (const [key, value] of Object.entries(expected)) {
  if (fields[key] !== value) throw new Error(`${key}: ${fields[key]} !== ${value}`);
}
if ((base.templateFields as Record<string, string>).customer_id) {
  throw new Error('발행 스냅샷 원본에 주민등록번호가 복제되었습니다.');
}
if ((base.templateFields as Record<string, string>).driver_license_no) {
  throw new Error('발행 스냅샷 원본에 운전면허번호가 복제되었습니다.');
}
console.log('✓ 고객 본인확인값은 완료본에만 합성되고 발행 스냅샷 원본은 유지됩니다.');
