import assert from 'node:assert/strict';
import { makeCell } from '../lib/domain/sales-atom-row';
const cell = makeCell({policyOf:()=>({}),nameByProvider:new Map(),acctByProvider:new Map(),unnamedProviders:new Map()});
const price={'12':{rent:1000000,deposit:1000000},'60':{rent:700000,deposit:2100000},'60_인수형':{rent:900000,deposit:2700000}};
for(const product_type of ['오공구독','픽업구독']) {
 const p={provider_company_code:'RP012',product_type,price};
 for(const col of ['보증금 반납형','반납형보증금','보증금 인수형','인수형보증금']) assert.equal(cell(col,p),'연수×월대여료(최대 ×3)');
 assert.equal(cell('60개월 반납형',p),'700,000');
 assert.equal(cell('60개월 인수형',p),'900,000');
}
assert.equal(cell('보증금 반납형',{provider_company_code:'RP012',product_type:'중고렌트',price}),'2,100,000');
assert.equal(cell('보증금 반납형',{provider_company_code:'RP004',product_type:'오공구독',price}),'2,100,000');
assert.equal(price['60'].deposit,2100000);
console.log('PASS: RP012 subscription deposit rules, period rent, unrelated products, numeric preservation');
