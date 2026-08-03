/** OCR 응답 → canonical 상품 원자 allowlist 회귀검사. 실행: npx tsx scripts/sim-ocr-mapping.mts */
import { mapOcrToEntity } from '../lib/intake/entities';

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`PASS ${name}`); return; }
  failed++; console.error(`FAIL ${name}`, detail ?? '');
};

const current = mapOcrToEntity('product', {
  car_number: '12가3456', year: '2024', engine_cc: '1998', usage: '자가용',
  account_number: 'MUST-NOT-ENTER', provider_company_code: 'MUST-NOT-ENTER', unknown: 'x',
});
check('현재 OCR canonical key 수용',
  current.car_number === '12가3456' && current.year === '2024'
  && current.engine_cc === '1998' && current.usage === '자가용', current);
check('OCR 비대상·미선언 키 차단',
  !('account_number' in current) && !('provider_company_code' in current) && !('unknown' in current), current);

const legacy = mapOcrToEntity('product', {
  car_year_month: '2023-01', displacement: '1598', usage_type: '영업용',
});
check('과거 OCR source key 호환',
  legacy.year === '2023-01' && legacy.engine_cc === '1598' && legacy.usage === '영업용', legacy);

const preferred = mapOcrToEntity('product', { year: '2025', car_year_month: '2020' });
check('canonical key가 legacy alias보다 우선', preferred.year === '2025', preferred);

const contract = mapOcrToEntity('contract', { holder_name: '홍길동', birth_date: '900101' });
check('계약 OCR alias 유지', contract.customer_name === '홍길동' && contract.customer_birth === '900101', contract);

console.log(`\nOCR mapping: ${passed}/${passed + failed} PASS`);
if (failed) process.exitCode = 1;
