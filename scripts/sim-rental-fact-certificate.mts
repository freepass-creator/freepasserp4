import assert from 'node:assert/strict';
import { buildRentalFactCertificateHtml } from '../lib/server/rental-fact-certificate';

const html = buildRentalFactCertificateHtml({
  issuedAt: '2026. 08. 21.', companyName: '테스트 렌터카', companyCeoTitle: '대표', companyCeo: '홍길동', companyBizNo: '000-00-00000',
  customerName: '김고객', customerPhone: '010-0000-0000', customerAddress: '서울시 테스트구',
  rows: [
    { contractCode: 'CT-1', carNumber: '12가3456', vehicleName: '차량 A', contractStart: '2026-08-01', contractEnd: '2029-07-31' },
    { contractCode: 'CT-2', carNumber: '34나5678', vehicleName: '차량 B', contractStart: '2026-08-02', contractEnd: '2029-08-01' },
  ],
});

assert.match(html, /발급용 부속서류/);
assert.match(html, /선택 차량 2대/);
assert.match(html, /CT-1/);
assert.match(html, /CT-2/);
assert.match(html, /12가3456/);
assert.match(html, /34나5678/);
assert.match(html, /2026-08-01 ~ 2029-07-31/);
assert.doesNotMatch(html, /data-field=/);
const multipage = buildRentalFactCertificateHtml({
  issuedAt: '2026. 08. 21.', companyName: '테스트 렌터카', companyCeoTitle: '대표', companyCeo: '홍길동', companyBizNo: '000-00-00000',
  customerName: '김고객', customerPhone: '010-0000-0000', customerAddress: '서울시 테스트구',
  rows: Array.from({ length: 9 }, (_, index) => ({ contractCode: `CT-${index + 1}`, carNumber: `${index + 1}가0000`, vehicleName: `차량 ${index + 1}`, contractStart: '2026-08-01', contractEnd: '2029-07-31' })),
});
assert.equal((multipage.match(/<main class="page">/g) || []).length, 2);
assert.match(multipage, /임대차 계약 사실확인서 \(계속\)/);
console.log('✓ 임대차 계약 사실확인서: 단건·다건 차량 행과 본계약 필드 분리가 유지됩니다');
