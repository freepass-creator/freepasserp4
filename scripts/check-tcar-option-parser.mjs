import assert from 'node:assert/strict';
import { tcarPaidOptionsFromDescription as parse, tcarPaidOptionsFromHtml } from '../sonokong/lib/tcar-options.mjs';

assert.deepEqual(parse('▶추가옵션\n- UVO내비\n- 드라이브와이즈\n▶차량 진단 결과\n- 정상'), ['UVO내비', '드라이브와이즈']);
assert.deepEqual(parse('▶ 추가옵션 :\n+ 현대 스마트센스Ⅱ - 전방 충돌방지 보조, 고속도로 주행 보조\n✔ 차량 진단 결과'), ['현대 스마트센스Ⅱ']);
assert.deepEqual(parse('▶추가옵션\n-오토,스노우화이트펄\n1.12.3인치 내비\n설명 문장입니다\n2.하이테크'), ['스노우화이트펄', '12.3인치 내비', '하이테크']);
assert.deepEqual(parse('▶추가옵션\n+ 10.25인치 UVO 내비게이션 - 후방 모니터\n- 12.3인치 내비게이션'), ['10.25인치 UVO 내비게이션', '12.3인치 내비게이션']);
assert.deepEqual(parse('일반 설명만 있고 추가옵션 구간은 없음'), []);
const jsonData = JSON.stringify({ paidOptList: [{ PAID_OPT_NM: 'HUD팩+스마트커넥트', PAID_OPT_AMT: 1650000 }] })
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;');
assert.deepEqual(tcarPaidOptionsFromHtml(`<input type="hidden" id="jsonData" value="${jsonData}">`), {
  names: ['HUD팩+스마트커넥트'],
  raw: [{ PAID_OPT_NM: 'HUD팩+스마트커넥트', PAID_OPT_AMT: 1650000 }],
});
assert.equal(tcarPaidOptionsFromHtml('<html></html>'), null);
assert.equal(tcarPaidOptionsFromHtml('<input id="jsonData" value="{깨진JSON}">'), null);
console.log('✓ T카 선택옵션 원문 파서');
