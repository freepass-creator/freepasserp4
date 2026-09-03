import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  A4_WEB_SECTION_ALIGNMENT,
  assertA4WebContractAlignment,
} from '../lib/domain/esign-a4-web-alignment';

const a4 = readFileSync('public/contract-template/rental-contract.html', 'utf8');
const web = readFileSync('app/sign/[token]/page.tsx', 'utf8');

assert.equal(A4_WEB_SECTION_ALIGNMENT.length, 10, 'A4 본계약 01~10 대응표가 완전하지 않습니다');
for (const section of A4_WEB_SECTION_ALIGNMENT) {
  assert.match(a4, new RegExp(`>${section.a4}<`), `A4 ${section.a4}번 섹션이 원문에 없습니다`);
  assert.match(a4, new RegExp(`>${section.title}<`), `A4 ${section.a4} ${section.title} 제목이 원문과 다릅니다`);
}
// 전자계약 작성 중에는 A4 축소본 대신, 같은 동결 원문을 웹 흐름으로 끝까지 읽고
// 명시 동의한다. 화면 카피가 변경되어도 읽기 증적과 최종 동의 가드는 빠지면 안 된다.
assert.match(web, /agreementReadAt/,
  '웹에 약관 전문 읽기 증적이 없습니다');
assert.match(web, /readThrough\.agreement/,
  '웹에 약관 끝까지 읽기 가드가 없습니다');
assert.match(web, /세부 계약과 자동차 대여약관의 전체 내용을 확인했습니다\. 전자서명으로 최종 동의합니다/,
  '웹에 세부 계약·약관 전체 최종 동의가 없습니다');
assert.match(web, /conditionsConfirmed/, '웹에 주요 계약조건 확인이 없습니다');

const core = ['vehicle', 'rental', 'payment', 'driver', 'insurance', 'accident', 'service']
  .map((key) => ({ key }));
assert.doesNotThrow(() => assertA4WebContractAlignment({
  consentGroups: core,
  agreementSectionCount: 28,
  contract: {},
}), 'A4 01~10의 기본 웹 대응이 발행을 막으면 안 됩니다');
assert.throws(() => assertA4WebContractAlignment({
  consentGroups: core,
  agreementSectionCount: 28,
  contract: { guarantor_name: '보증인' },
}), /별도 전자서명 약정/, '연대보증을 주계약 링크에 섞으면 안 됩니다');
assert.throws(() => assertA4WebContractAlignment({
  consentGroups: core.filter((group) => group.key !== 'insurance'),
  agreementSectionCount: 28,
  contract: {},
}), /대응이 불완전/, 'A4 보험 섹션이 웹에서 빠지면 발행을 막아야 합니다');

console.log('✓ A4 본계약 01~10 ↔ 웹 전자계약 대응표·발행 가드');
