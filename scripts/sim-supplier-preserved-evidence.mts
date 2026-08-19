import assert from 'node:assert/strict';
import { splitSupplierPreservedEvidence } from '../lib/domain/supplier-preserved-evidence';

const split = splitSupplierPreservedEvidence(
  '원본탭: 재고 | 차명(트림): 520i M Spt | 제조사(정제): BMW | 세부모델: E34 | 구동: AWD',
);
assert.equal(split.supplierDirect, '원본탭: 재고 | 차명(트림): 520i M Spt');
assert.equal(split.normalizedTail, '제조사(정제): BMW | 세부모델: E34 | 구동: AWD');
assert.equal(split.hasNormalizedTail, true);
assert.match(split.full, /E34/);
assert.doesNotMatch(split.supplierDirect, /E34|AWD/);

const directOnly = splitSupplierPreservedEvidence(
  '원본탭: 판매차량리스트 | 모델명: A6(4세대) 40 TFSI Premium Milano | 연료: 휘발유',
);
assert.equal(directOnly.supplierDirect, directOnly.full);
assert.equal(directOnly.normalizedTail, '');
assert.equal(directOnly.hasNormalizedTail, false);

for (const variant of [
  '원문: BMW 520i M Spt|제조사(정제): BMW|세부모델: E34',
  '원문: BMW 520i M Spt | 제조사 ( 정제 ) : BMW | 세부모델: E34',
  '원문: BMW 520i M Spt | 제조사（정제）： BMW | 세부모델: E34',
]) {
  const parsed = splitSupplierPreservedEvidence(variant);
  assert.equal(parsed.supplierDirect, '원문: BMW 520i M Spt');
  assert.equal(parsed.hasNormalizedTail, true);
  assert.doesNotMatch(parsed.supplierDirect, /E34/);
}
const markerAtStart = splitSupplierPreservedEvidence('제조사(정제): BMW | 세부모델: E34');
assert.equal(markerAtStart.supplierDirect, '');
assert.equal(markerAtStart.hasNormalizedTail, true);
const duplicated = splitSupplierPreservedEvidence('원문: 직접 | 제조사(정제): BMW | 제조사(정제): 오염');
assert.equal(duplicated.supplierDirect, '원문: 직접');
assert.match(duplicated.normalizedTail, /오염/);

console.log('PASS supplier preserved evidence — direct source isolated, normalized tail retained for trace only');
