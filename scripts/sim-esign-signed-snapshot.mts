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
  emergency_name: '홍가족',
  emergency_phone: '010-0000-0001',
};
const signed = snapshotWithPrivateSubmission(base, privateSubmission);
const fields = signed.templateFields as Record<string, string>;

const expected: Record<string, string> = {
  customer_name: '홍길동',
  customer_phone: '010-1234-5678',
  customer_id: '900101-1234567',
  customer_address: '서울특별시 샘플구 예시동 00',
  emergency_contact: '홍가족 · 010-0000-0001',
  rent_amount: '650,000원',
};
for (const [key, value] of Object.entries(expected)) {
  if (fields[key] !== value) throw new Error(`${key}: ${fields[key]} !== ${value}`);
}
if ((base.templateFields as Record<string, string>).customer_id) {
  throw new Error('발행 스냅샷 원본에 주민등록번호가 복제되었습니다.');
}
console.log('✓ 고객 본인확인값은 완료본에만 합성되고 발행 스냅샷 원본은 유지됩니다.');
