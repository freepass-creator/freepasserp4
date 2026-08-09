/**
 * 프리패스 전자계약 «카탈로그»를 착한거래로 넘길 형태로 뽑는다.
 *
 * ★왜
 *   착한거래가 프리패스 전자계약을 수주한 것이므로, 프리패스용 약관·서류·입력항목·동의항목은
 *   **착한거래 안의 커스터마이징**으로 있어야 한다. 지금은 발행할 때마다 프리패스가 들고 간다(89KB).
 *   여기서 뽑은 것을 착한거래가 갖고 나면 프리패스는 **계약조건만 패킹해서** 보내면 된다.
 *
 * ★계약값에 의존하는 것은 뽑지 않는다
 *   `buildConsentGroups`(계약조건 조립)는 프리패스가 계속 갖는다 — 정책·보험 구조를 아는 쪽이 여기다.
 *   반대로 `paginateForMobile` 은 groups 만 받는 순수 규칙이라 착한거래로 넘긴다(로직은 그쪽에 이식).
 *
 *   npx tsx scripts/dump-esign-catalog.mts [출력경로]
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { AGREEMENT_VERSION, AGREEMENT_TITLE } from '@/lib/domain/esign-agreement-text';
import {
  READ_THROUGH_ROWS, REQUIRED_DOCS, AGREEMENT_CONFIRM_LABEL,
} from '@/lib/domain/esign-consent-doc';
import {
  agreementWithEmphasis, keyClauseSummaries, KEY_CLAUSE_CONFIRM_LABEL,
} from '@/lib/domain/esign-agreement-emphasis';
import {
  INPUT_GROUP_LABEL, CUSTOMER_INPUTS, BUSINESS_INPUTS, ADDITIONAL_DRIVER_INPUTS,
  BANK_INPUTS, ALL_CONSENTS,
} from '@/lib/domain/esign-inputs';

const out = resolve(process.argv[2] || 'C:/dev/chakhandeal/spec/freepass/catalog.json');

const catalog = {
  member: 'freepass',
  note: '프리패스 전자계약 카탈로그. 프리패스 소스에서 뽑는다 — 손으로 고치지 말 것.',
  source: 'freepasserp4 scripts/dump-esign-catalog.mts',

  /**
   * 약관은 «버전»이 정본이다. 이미 서명된 계약은 그때 버전 그대로 남아야 하므로
   * 착한거래는 버전별로 보관하고, 서명 시점 버전을 계약에 박는다.
   * 문구의 저작·법적 책임은 발행 회원사(프리패스) 것이고, 착한거래는 보관·발행만 한다.
   */
  agreement: {
    version: AGREEMENT_VERSION,
    title: AGREEMENT_TITLE,
    isSample: false,
    requireReadThrough: true,
    confirmLabel: AGREEMENT_CONFIRM_LABEL,
    // 조문마다 emphasis — 돈·차량회수·계약해지·보험제외에 걸리는 것만 true.
    sections: agreementWithEmphasis(),
  },

  /** 통독 뒤 다시 보여주고 확인받을 주요 사항. 「약관에 있었다」만으로는 «못 봤는데요»를 못 막는다. */
  keyClauses: {
    confirmLabel: KEY_CLAUSE_CONFIRM_LABEL,
    items: keyClauseSummaries(),
  },

  readThroughRows: READ_THROUGH_ROWS,
  requiredDocs: REQUIRED_DOCS,

  /**
   * 입력 항목 «풀». 어느 것을 실제로 물을지는 계약 상태(개인사업자·추가운전자·기입력)로 갈리므로
   * 발행할 때 플래그로 받는다. 풀 자체는 고정이다.
   */
  inputPools: {
    groupLabels: INPUT_GROUP_LABEL,
    customer: CUSTOMER_INPUTS,
    business: BUSINESS_INPUTS,
    driver: ADDITIONAL_DRIVER_INPUTS,
    bank: BANK_INPUTS,
  },

  /** 개인정보 동의 — 항목·목적·보유기간·받는자까지. 「동의합니다」 한 줄로는 유효하지 않다. */
  consentAtoms: ALL_CONSENTS,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

const kb = (v: unknown) => (JSON.stringify(v)?.length / 1024).toFixed(1);
console.log(`약관       ${catalog.agreement.sections.length}개조  ${kb(catalog.agreement)}KB`);
console.log(`주요조항   ${catalog.keyClauses.items.length}건`);
console.log(`서류       ${catalog.requiredDocs.length}건`);
console.log(`입력 풀    고객 ${CUSTOMER_INPUTS.length} · 사업자 ${BUSINESS_INPUTS.length} · 운전자 ${ADDITIONAL_DRIVER_INPUTS.length} · 계좌 ${BANK_INPUTS.length}`);
console.log(`동의 항목  ${catalog.consentAtoms.length}건`);
console.log(`→ ${out}  (${kb(catalog)}KB)`);
