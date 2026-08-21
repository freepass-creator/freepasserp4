import { assessStatusPipeline, type StatusObservation } from '../lib/domain/status-drift';

const active = (status = '출고가능'): StatusObservation => ({ known: true, present: true, status });
const absent = (): StatusObservation => ({ known: true, present: false });
const unknown = (): StatusObservation => ({ known: false, present: false });
const erp = (status = '출고가능', locked = false): StatusObservation => ({ known: true, present: true, status, locked });

function verify(label: string, input: Record<'origin' | 'refined' | 'sales' | 'erp', StatusObservation>, expected: {
  drift?: number; review?: number; unknown?: number;
}) {
  const got = assessStatusPipeline(input);
  const actual = { drift: got.driftCount, review: got.reviewCount, unknown: got.unknownCount };
  const wanted = { drift: expected.drift || 0, review: expected.review || 0, unknown: expected.unknown || 0 };
  if (actual.drift !== wanted.drift || actual.review !== wanted.review || actual.unknown !== wanted.unknown) {
    throw new Error(label + ': expected ' + JSON.stringify(wanted) + ', got ' + JSON.stringify(actual));
  }
  console.log('✓ ' + label);
}

verify('원본 출고불가가 정제시트에 아직 안 내려감', {
  origin: active('출고불가'), refined: active(), sales: active(), erp: erp(),
}, { drift: 1 });
verify('정제시트만 출고불가', {
  origin: active(), refined: active('출고불가'), sales: active(), erp: erp(),
}, { drift: 2 });
verify('판매시트만 출고불가', {
  origin: active(), refined: active(), sales: active('출고불가'), erp: erp(),
}, { drift: 2 });
verify('ERP 단독 출고불가', {
  origin: active(), refined: active(), sales: active(), erp: erp('출고불가'),
}, { review: 1 });
verify('계약 잠금은 자동 복구가 아닌 검토', {
  origin: active(), refined: active(), sales: active(), erp: erp('계약중', true),
}, { review: 1 });
verify('출고불가 뒤 판매시트 부재는 정상', {
  origin: active('출고불가'), refined: active('출고불가'), sales: absent(), erp: erp('출고불가'),
}, {});
verify('판독 실패는 원인 미확인', {
  origin: unknown(), refined: active(), sales: active(), erp: erp(),
}, { unknown: 1 });

console.log('status-drift sim PASS');
