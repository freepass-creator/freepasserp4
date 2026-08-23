import assert from 'node:assert/strict';
import { getApps } from 'firebase-admin/app';
import { firebaseAdminDatabase } from '../../lib/server/firebase-admin';
import { SettlementIssuanceError } from '../../lib/domain/settlement-issuance';
import { issueSettlementFromServer } from '../../lib/server/settlement-issuance';

const db = firebaseAdminDatabase();
const base = `ruleprobe_settlement_${Date.now()}`;
const actor = (uid: string, role: 'agent' | 'provider' | 'admin', rawRole = role, companyCode = '', agentChannelCode = '') => ({
  uid, role, rawRole, companyCode, agentChannelCode,
});
let passed = 0;
const check = (name: string, value: boolean) => {
  assert.equal(value, true, name);
  passed += 1;
  console.log(`PASS ${name}`);
};

const complete = (code: string, extra: Record<string, unknown> = {}) => ({
  contract_code: code, contract_status: '계약요청', product_code: `P-${code}`,
  agent_uid: 'agent-a', agent_code: 'AG-A', agent_channel_code: 'CH-A', provider_company_code: 'SUP-A',
  rent_amount_snapshot: 443_000, rent_month_snapshot: 36, deposit_amount_snapshot: 0, contract_date: '2026-08-21',
  product_type_snapshot: '중고 렌트',
  agent_delivery_inquiry: 'yes', provider_delivery_response: '출고 가능',
  agent_docs_submitted: 'yes', provider_docs_review: '승인',
  provider_agreement_done: 'yes', provider_agreement_sent: 'yes',
  agent_balance_paid: 'yes', agent_final_paid: 'yes', provider_balance_confirmed: 'yes',
  agent_handover_confirmed: 'yes', provider_release_completed: 'yes',
  ...extra,
});

/** 일반 계약의 요율은 공개 계약이 아니라 서버 전용 약정 seal에만 있다. */
function genericSettlementSeal(contract: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const { status = 'sealed', ...rest } = extra;
  return {
    version: 'contract-settlement-v2',
    status,
    contractCode: String(contract.contract_code),
    productCode: String(contract.product_code),
    agentUid: String(contract.agent_uid),
    agentCode: String(contract.agent_code),
    agentChannelCode: String(contract.agent_channel_code),
    providerCompanyCode: String(contract.provider_company_code),
    rentMonth: Number(contract.rent_month_snapshot),
    rentAmount: Number(contract.rent_amount_snapshot),
    depositAmount: Number(contract.deposit_amount_snapshot || 0),
    productType: String(contract.product_type_snapshot),
    feeRate: 0.12,
    payoutRate: 0.05,
    preparedAt: 1_785_999_999_000,
    sealedAt: status === 'sealed' ? 1_786_000_000_000 : null,
    sealedByUid: 'agent-a',
    ...rest,
  };
}

/** 실제 서버 predicate가 읽는 direct seal·signed session·승인 submission·handover proof 묶음. */
function directCompletionFixture(code: string) {
  const sessionHash = 'd'.repeat(64);
  const sealHash = 'e'.repeat(64);
  const documentHash = 'f'.repeat(64);
  const manualTerms = {
    deposit_installment: '일시납',
    special_terms: '없음',
    special_terms_choice: '없음',
  };
  const contract = complete(code, {
    contract_source: 'direct',
    contract_origin: '계약서직접등록',
    contract_number: `직접-${code}`,
    policy_code: `POL-${code}`,
    standard_template_id: 'freepass-rent-standard',
    contract_kind: 'rent_return',
    esign_contract_kind: 'rent_return',
    esign_maturity: '반납형',
    esign_insurance_side: '회사포함',
    deposit_amount_snapshot: 800_000,
    deposit_payment_type: '일시납',
    payment_timing_snapshot: '선불',
    driver_age_snapshot: '만 26세 이상',
    annual_mileage_snapshot: '연 3만km',
    price_variant_snapshot: 'annual-30k',
    mileage_surcharge_snapshot: 0,
    age_surcharge_snapshot: 0,
    pricing_snapshot_version: 'v1',
    special_terms_choice_snapshot: '없음',
    special_terms_snapshot: '없음',
    contract_draft: JSON.stringify(manualTerms),
    // 이 두 공개값은 intentionally forged다. direct settlement는 아래 private rateBasis만 쓴다.
    fee_rate_snapshot: 0,
    payout_rate_snapshot: 1,
    settlement_rate_status: 'sealed',
    esign_provider: 'freepass',
    sign_status: '서명완료',
    sign_signed_at: 1_786_000_000_000,
    esign_session_hash: sessionHash,
    esign_seal_hash: sealHash,
    esign_document_sha256: documentHash,
  });
  const product = { product_code: `P-${code}`, product_type: '중고 렌트' };
  const policy = { policy_code: `POL-${code}`, insurance_included: '포함' };
  const partner = { partner_code: 'SUP-A' };
  return {
    contract,
    product,
    sessionHash,
    sealHash,
    documentHash,
    seal: {
      version: 'v1', contractCode: code, createdAt: 1_786_000_000_000,
      createdByUid: 'agent-a', requestHash: `probe-${code}`,
      contract, product, policy, partner,
      templateId: 'freepass-rent-standard', contractKind: 'rent_return', manualTerms,
      settlementRateBasis: { productType: '중고 렌트', feeRate: 0.12, payoutRate: 0.05, status: 'sealed' },
    },
    session: {
      provider: 'freepass', contractCode: code, status: 'signed', sealHash,
      approvedAt: 1_786_000_000_100,
      snapshot: {
        templateState: { co: 'auto', pd: '렌트선택형', ins: '포함', ct: '개인', car: '등록완료', tax: '개인' },
        consentProfile: {
          version: 'freepass-consent-v2', requiredKeys: ['rental_terms', 'privacy'],
          atoms: [{ key: 'privacy' }], screeningCriteria: '무심사', gpsInstalled: '미장착',
          paymentMethod: '계좌이체', requiresExternalPaymentAuthorization: false, cmsRequiredBeforeHandover: false,
        },
      },
    },
    submission: {
      status: 'approved', sealHash, approvedAt: 1_786_000_000_200,
      customer_name: '승인 고객', signatureSha256: '1'.repeat(64),
      idCardSha256: '2'.repeat(64), selfieSha256: '3'.repeat(64), pdfSha256: documentHash,
      signature: 'data:image/png;base64,c2ln', idCardPath: 'private/id-card',
      selfiePath: 'private/selfie', pdfPath: 'private/completed.pdf',
    },
    verification: {
      provider: 'freepass', contractCode: code, sealHash, documentSha256: documentHash,
      signedAt: 1_786_000_000_300,
    },
    handover: {
      provider: 'freepass', contractCode: code, sessionHash, sealHash, documentSha256: documentHash,
      handover_datetime: '2026-08-21', contract_start: '2026-08-21', contract_end: '2029-08-20',
      confirmedAt: 1_786_000_000_400, confirmedBy: 'admin-a',
    },
  };
}

try {
  const contractCode = 'C-SERVER-LIVE';
  // 공개 계약의 숫자는 신뢰하지 않는다. 첫 발행 전부터 위조값이 있어도 private seal만 쓴다.
  const liveContract = complete(contractCode, { fee_rate_snapshot: 0, payout_rate_snapshot: 1 });
  await db.ref(base).set({
    partners: { 'SUP-A': { partner_code: 'SUP-A', fee_rate: 0.2 } },
    users: { 'agent-a': { uid: 'agent-a', role: 'agent', status: 'active', user_code: 'AG-A', agent_channel_code: 'CH-A', agent_payout_rate: 0.06 } },
    v4: {
      contracts: { [contractCode]: liveContract },
      products: { [`P-${contractCode}`]: { product_code: `P-${contractCode}`, product_type: '중고 렌트' } },
      contract_settlement_seals: { [contractCode]: genericSettlementSeal(liveContract) },
      partners_private: { 'SUP-A': { fee_rate: 0.12 } },
      users_private: { 'agent-a': { agent_payout_rate: 0.05 } },
    },
  });
  // Server issuer normally reads root nodes. Point a scoped temporary app tree into the real expected roots,
  // then clean it up after the assertions to keep emulator state isolated.
  const source = await db.ref(base).get();
  await db.ref().update(source.val() as Record<string, unknown>);

  const first = await issueSettlementFromServer(db, actor('agent-a', 'agent', 'agent', '', 'CH-A'), contractCode);
  check('owner agent server issuance', first.code === `ST_${contractCode}` && !first.reused);
  const created = (await db.ref(`v4/settlements/${first.code}`).get()).val() as Record<string, unknown>;
  const provider = (await db.ref(`v4/settlements_provider_private/${first.code}`).get()).val() as Record<string, unknown>;
  const agentPrivate = (await db.ref(`v4/settlements_agent_private/${first.code}`).get()).val() as Record<string, unknown>;
  check('공개 0/1 요율이 있어도 provider private seal 요율로 정산', created.rent_amount === 443_000 && provider.fee_rate === 0.12 && provider.fee_amount === 53_160);
  check('공개 0/1 요율이 있어도 agent private seal 요율로 정산', agentPrivate.payout_rate === 0.05 && agentPrivate.agent_payout === 22_150);
  check('public settlement has no private money', !Object.hasOwn(created, 'fee_amount') && !Object.hasOwn(created, 'agent_payout'));
  await db.ref(`v4/contracts/${contractCode}`).update({ fee_rate_snapshot: 0, payout_rate_snapshot: 1 });
  const forgedRateRead = await issueSettlementFromServer(db, actor('agent-a', 'agent', 'agent', '', 'CH-A'), contractCode);
  const forgedRateProvider = (await db.ref(`v4/settlements_provider_private/${forgedRateRead.code}`).get()).val() as Record<string, unknown>;
  check('일반계약 공개 요율 위조는 private seal 정산에 영향 없음', forgedRateProvider.fee_rate === 0.12 && forgedRateProvider.fee_amount === 53_160);
  const repeated = await issueSettlementFromServer(db, actor('agent-a', 'agent', 'agent', '', 'CH-A'), contractCode);
  check('same contract is idempotent', repeated.reused && repeated.code === first.code);

  // Bare rules fixtures cannot prove the server-only direct completion predicate. Start with a
  // complete public/session/verifier bundle but no approved private submission or handover proof.
  const directCode = 'C-SERVER-DIRECT';
  const direct = directCompletionFixture(directCode);
  await db.ref('v4').update({
    [`contracts/${directCode}`]: direct.contract,
    [`products/P-${directCode}`]: direct.product,
    [`esign_contract_seals/${directCode}`]: direct.seal,
    [`esign_sessions/${direct.sessionHash}`]: direct.session,
    [`esign_verifications/${direct.sealHash}`]: direct.verification,
  });
  await assert.rejects(
    () => issueSettlementFromServer(db, actor('agent-a', 'agent', 'agent', '', 'CH-A'), directCode),
    (error: unknown) => error instanceof SettlementIssuanceError && /전자서명.*인도일/.test(error.message),
  );
  check('direct 계약은 private 승인·인도 증빙 없이는 정산 차단', !(await db.ref(`v4/settlements/ST_${directCode}`).get()).exists());
  await db.ref('v4').update({
    [`esign_private/${directCode}/${direct.sessionHash}`]: direct.submission,
    [`esign_handover_verifications/${directCode}`]: direct.handover,
  });
  const directIssued = await issueSettlementFromServer(db, actor('agent-a', 'agent', 'agent', '', 'CH-A'), directCode);
  const directPublic = (await db.ref(`v4/settlements/${directIssued.code}`).get()).val() as Record<string, unknown>;
  const directProvider = (await db.ref(`v4/settlements_provider_private/${directIssued.code}`).get()).val() as Record<string, unknown>;
  const directAgent = (await db.ref(`v4/settlements_agent_private/${directIssued.code}`).get()).val() as Record<string, unknown>;
  check('direct 정산 고객명은 승인 private submission만 사용', directPublic.customer_name === '승인 고객');
  check('direct 정산은 공개 위조 요율 대신 private seal 요율만 사용', directProvider.fee_rate === 0.12
    && directProvider.fee_amount === 53_160 && directAgent.payout_rate === 0.05 && directAgent.agent_payout === 22_150);

  await assert.rejects(
    () => issueSettlementFromServer(db, actor('other', 'agent', 'agent', '', 'CH-X'), contractCode),
    (error: unknown) => error instanceof SettlementIssuanceError && /권한/.test(error.message),
  );
  check('other agent denied', true);

  const incompleteCode = 'C-SERVER-INCOMPLETE';
  const incompleteContract = { ...complete(incompleteCode), agent_handover_confirmed: '' };
  await db.ref(`v4/contracts/${incompleteCode}`).set(incompleteContract);
  await db.ref(`v4/products/P-${incompleteCode}`).set({ product_code: `P-${incompleteCode}`, product_type: '중고 렌트' });
  await db.ref(`v4/contract_settlement_seals/${incompleteCode}`).set(genericSettlementSeal(incompleteContract));
  await assert.rejects(
    () => issueSettlementFromServer(db, actor('agent-a', 'agent', 'agent', '', 'CH-A'), incompleteCode),
    (error: unknown) => error instanceof SettlementIssuanceError && /완료 처리 전/.test(error.message),
  );
  check('incomplete contract denied', true);

  const newCarCode = 'C-SERVER-NEW';
  const newCarContract = complete(newCarCode, { product_type_snapshot: '신차렌트' });
  await db.ref(`v4/contracts/${newCarCode}`).set(newCarContract);
  await db.ref(`v4/products/P-${newCarCode}`).set({ product_code: `P-${newCarCode}`, product_type: '신차렌트' });
  await db.ref(`v4/contract_settlement_seals/${newCarCode}`).set(genericSettlementSeal(newCarContract, { productType: '신차렌트', feeRate: 0 }));
  const newCar = await issueSettlementFromServer(db, actor('provider-a', 'provider', 'provider', 'SUP-A'), newCarCode);
  const newCarPrivate = (await db.ref(`v4/settlements_provider_private/${newCar.code}`).get()).val() as Record<string, unknown>;
  check('provider owner may issue and new-car fee is zero', newCarPrivate.fee_rate === 0 && newCarPrivate.fee_amount === 0);

  // live product_type을 신차로 바꿔도 계약 시점에 동결한 중고 기준 수수료는 바뀌지 않는다.
  const productForgeCode = 'C-SERVER-PRODUCT-FORGE';
  const productForgeContract = complete(productForgeCode, { product_type_snapshot: '중고 렌트' });
  await db.ref(`v4/contracts/${productForgeCode}`).set(productForgeContract);
  await db.ref(`v4/products/P-${productForgeCode}`).set({ product_code: `P-${productForgeCode}`, product_type: '신차렌트' });
  await db.ref(`v4/contract_settlement_seals/${productForgeCode}`).set(genericSettlementSeal(productForgeContract));
  const productForge = await issueSettlementFromServer(db, actor('provider-a', 'provider', 'provider', 'SUP-A'), productForgeCode);
  const productForgePrivate = (await db.ref(`v4/settlements_provider_private/${productForge.code}`).get()).val() as Record<string, unknown>;
  check('live 상품구분 변경으로 신차 수수료 우회 불가', productForgePrivate.fee_rate === 0.12 && productForgePrivate.fee_amount === 53_160);

  const noTypeCode = 'C-SERVER-NO-TYPE';
  const noTypeContract = complete(noTypeCode, { product_type_snapshot: '' });
  await db.ref(`v4/contracts/${noTypeCode}`).set(noTypeContract);
  await db.ref(`v4/products/P-${noTypeCode}`).set({ product_code: `P-${noTypeCode}`, product_type: '중고 렌트' });
  // 상품구분도 seal binding의 일부라 공개 projection에서 비우면 정산을 재계산하지 않고 막는다.
  await db.ref(`v4/contract_settlement_seals/${noTypeCode}`).set(genericSettlementSeal(noTypeContract, { productType: '중고 렌트' }));
  await assert.rejects(
    () => issueSettlementFromServer(db, actor('agent-a', 'agent', 'agent', '', 'CH-A'), noTypeCode),
    (error: unknown) => error instanceof SettlementIssuanceError && /봉인값이 일치하지/.test(error.message),
  );
  check('상품구분 공개값 변경은 generic seal 정산 차단', true);

  const identityDriftCode = 'C-SERVER-IDENTITY-DRIFT';
  const identityDriftContract = complete(identityDriftCode, { agent_code: 'AG-FORGE' });
  await db.ref(`v4/contracts/${identityDriftCode}`).set(identityDriftContract);
  await db.ref(`v4/products/P-${identityDriftCode}`).set({ product_code: `P-${identityDriftCode}`, product_type: '중고 렌트' });
  // seal은 실제 agent code/channel로 고정돼 있으므로 공개 projection의 귀속 변경은 발행 전에 닫힌다.
  await db.ref(`v4/contract_settlement_seals/${identityDriftCode}`).set(genericSettlementSeal({ ...identityDriftContract, agent_code: 'AG-A' }));
  await assert.rejects(
    () => issueSettlementFromServer(db, actor('agent-a', 'agent', 'agent', '', 'CH-A'), identityDriftCode),
    (error: unknown) => error instanceof SettlementIssuanceError && /봉인값이 일치하지/.test(error.message),
  );
  check('공개 agent code/channel drift는 generic seal 정산 차단', !(await db.ref(`v4/settlements/ST_${identityDriftCode}`).get()).exists());

  const unsealedRateCode = 'C-SERVER-UNSEALED-RATE';
  await db.ref(`v4/contracts/${unsealedRateCode}`).set(complete(unsealedRateCode, {
    fee_rate_snapshot: '', payout_rate_snapshot: '',
  }));
  await db.ref(`v4/products/P-${unsealedRateCode}`).set({ product_code: `P-${unsealedRateCode}`, product_type: '중고 렌트' });
  await assert.rejects(
    () => issueSettlementFromServer(db, actor('agent-a', 'agent', 'agent', '', 'CH-A'), unsealedRateCode),
    (error: unknown) => error instanceof SettlementIssuanceError && /서버 정산 기준/.test(error.message),
  );
  check('server-only seal 없는 계약은 non-admin 정산 차단', true);

  const preparingCode = 'C-SERVER-PREPARING';
  const preparingContract = complete(preparingCode);
  await db.ref(`v4/contracts/${preparingCode}`).set(preparingContract);
  await db.ref(`v4/products/P-${preparingCode}`).set({ product_code: `P-${preparingCode}`, product_type: '중고 렌트' });
  await db.ref(`v4/contract_settlement_seals/${preparingCode}`).set(genericSettlementSeal(preparingContract, { status: 'preparing' }));
  await assert.rejects(
    () => issueSettlementFromServer(db, actor('agent-a', 'agent', 'agent', '', 'CH-A'), preparingCode),
    (error: unknown) => error instanceof SettlementIssuanceError && /마무리/.test(error.message),
  );
  check('preparing generic seal은 서버 정산에도 사용 불가', !(await db.ref(`v4/settlements/ST_${preparingCode}`).get()).exists());

  const deletedCode = 'C-SERVER-DELETED';
  await db.ref(`v4/contracts/${deletedCode}`).set(complete(deletedCode, { _deleted: true, deletedAt: '2026-08-21T00:00:00.000Z' }));
  await db.ref(`v4/products/P-${deletedCode}`).set({ product_code: `P-${deletedCode}`, product_type: '중고 렌트' });
  await assert.rejects(
    () => issueSettlementFromServer(db, actor('provider-a', 'provider', 'provider', 'SUP-A'), deletedCode),
    (error: unknown) => error instanceof SettlementIssuanceError && /완료 처리 전/.test(error.message),
  );
  check('soft-delete 계약 정산 차단', true);

  // v3 원장 위에 별도 v4 overlay를 써서 금액·당사자를 바꾸는 우회는 서버가 중단해야 한다.
  const legacyOverlayCode = 'C-SERVER-LEGACY-OVERLAY';
  await db.ref(`contracts/${legacyOverlayCode}`).set(complete(legacyOverlayCode));
  await db.ref(`v4/contracts/${legacyOverlayCode}`).set({
    ...complete(legacyOverlayCode),
    rent_amount_snapshot: 9_999_999,
  });
  await db.ref(`v4/products/P-${legacyOverlayCode}`).set({ product_code: `P-${legacyOverlayCode}`, product_type: '중고 렌트' });
  await assert.rejects(
    () => issueSettlementFromServer(db, actor('agent-a', 'agent', 'agent', '', 'CH-A'), legacyOverlayCode),
    (error: unknown) => error instanceof SettlementIssuanceError && /원장과 수정본/.test(error.message),
  );
  check('legacy overlay cannot replace settlement money', !(await db.ref(`v4/settlements/ST_${legacyOverlayCode}`).get()).exists());

  const legacyCancelledCode = 'C-SERVER-LEGACY-CANCELLED';
  await db.ref(`contracts/${legacyCancelledCode}`).set(complete(legacyCancelledCode, { contract_status: '계약취소' }));
  await db.ref(`v4/contracts/${legacyCancelledCode}`).set(complete(legacyCancelledCode, { contract_status: '계약요청' }));
  await db.ref(`v4/products/P-${legacyCancelledCode}`).set({ product_code: `P-${legacyCancelledCode}`, product_type: '중고 렌트' });
  await assert.rejects(
    () => issueSettlementFromServer(db, actor('agent-a', 'agent', 'agent', '', 'CH-A'), legacyCancelledCode),
    (error: unknown) => error instanceof SettlementIssuanceError && /완료 처리 전/.test(error.message),
  );
  check('v3 취소를 v4 계약요청 overlay로 되살려 정산할 수 없음', true);

  const legacyDeletedCode = 'C-SERVER-LEGACY-DELETED';
  await db.ref(`contracts/${legacyDeletedCode}`).set(complete(legacyDeletedCode, { contract_status: '계약완료' }));
  await db.ref(`v4/contracts/${legacyDeletedCode}`).set(complete(legacyDeletedCode, {
    _deleted: true, deletedAt: '2026-08-21T00:00:00.000Z',
  }));
  await db.ref(`v4/products/P-${legacyDeletedCode}`).set({ product_code: `P-${legacyDeletedCode}`, product_type: '중고 렌트' });
  await assert.rejects(
    () => issueSettlementFromServer(db, actor('admin-a', 'admin', 'admin'), legacyDeletedCode),
    (error: unknown) => error instanceof SettlementIssuanceError && /완료 처리 전/.test(error.message),
  );
  check('v3 완료라도 v4 tombstone 계약은 관리자 정산도 차단', true);

  const noUidCode = 'C-SERVER-NO-AGENT-UID';
  await db.ref(`v4/contracts/${noUidCode}`).set(complete(noUidCode, { agent_uid: '' }));
  await db.ref(`v4/products/P-${noUidCode}`).set({ product_code: `P-${noUidCode}`, product_type: '중고 렌트' });
  await assert.rejects(
    () => issueSettlementFromServer(db, actor('provider-a', 'provider', 'provider', 'SUP-A'), noUidCode),
    (error: unknown) => error instanceof SettlementIssuanceError && /영업자 UID/.test(error.message),
  );
  check('영업자 UID 없는 계약은 non-admin 정산 차단', true);

  const mismatchedCode = 'C-SERVER-MISMATCH';
  await db.ref(`v4/contracts/${mismatchedCode}`).set(complete('C-SERVER-OTHER'));
  await assert.rejects(
    () => issueSettlementFromServer(db, actor('agent-a', 'agent', 'agent', '', 'CH-A'), mismatchedCode),
    (error: unknown) => error instanceof SettlementIssuanceError && /경로와 계약번호/.test(error.message),
  );
  check('v4 contract key and code must match', true);

  console.log(`server settlement issuance: ${passed} PASS`);
} finally {
  // Only emulator data is affected. The real expected root nodes used by the probe are deleted as part of this run.
  await Promise.all([
    db.ref(base).remove(),
    db.ref('contracts/C-SERVER-LIVE').remove(), db.ref('v4/contracts/C-SERVER-LIVE').remove(), db.ref('v4/products/P-C-SERVER-LIVE').remove(), db.ref('v4/contract_settlement_seals/C-SERVER-LIVE').remove(),
    db.ref('v4/settlements/ST_C-SERVER-LIVE').remove(), db.ref('v4/settlements_provider_private/ST_C-SERVER-LIVE').remove(), db.ref('v4/settlements_agent_private/ST_C-SERVER-LIVE').remove(), db.ref('v4/settlements_admin_private/ST_C-SERVER-LIVE').remove(), db.ref('v4/settlement_issuance/ST_C-SERVER-LIVE').remove(),
    db.ref(`v4/contracts/C-SERVER-DIRECT`).remove(), db.ref(`v4/products/P-C-SERVER-DIRECT`).remove(), db.ref(`v4/esign_contract_seals/C-SERVER-DIRECT`).remove(), db.ref(`v4/esign_sessions/${'d'.repeat(64)}`).remove(), db.ref(`v4/esign_private/C-SERVER-DIRECT/${'d'.repeat(64)}`).remove(), db.ref(`v4/esign_verifications/${'e'.repeat(64)}`).remove(), db.ref(`v4/esign_handover_verifications/C-SERVER-DIRECT`).remove(), db.ref(`v4/settlements/ST_C-SERVER-DIRECT`).remove(), db.ref(`v4/settlements_provider_private/ST_C-SERVER-DIRECT`).remove(), db.ref(`v4/settlements_agent_private/ST_C-SERVER-DIRECT`).remove(), db.ref(`v4/settlements_admin_private/ST_C-SERVER-DIRECT`).remove(), db.ref(`v4/settlement_issuance/ST_C-SERVER-DIRECT`).remove(),
    db.ref('contracts/C-SERVER-INCOMPLETE').remove(), db.ref('v4/contracts/C-SERVER-INCOMPLETE').remove(), db.ref('v4/products/P-C-SERVER-INCOMPLETE').remove(), db.ref('v4/contract_settlement_seals/C-SERVER-INCOMPLETE').remove(), db.ref('v4/settlement_issuance/ST_C-SERVER-INCOMPLETE').remove(),
    db.ref('contracts/C-SERVER-NEW').remove(), db.ref('v4/contracts/C-SERVER-NEW').remove(), db.ref('v4/products/P-C-SERVER-NEW').remove(),
    db.ref('v4/settlements/ST_C-SERVER-NEW').remove(), db.ref('v4/settlements_provider_private/ST_C-SERVER-NEW').remove(), db.ref('v4/settlements_agent_private/ST_C-SERVER-NEW').remove(), db.ref('v4/settlements_admin_private/ST_C-SERVER-NEW').remove(), db.ref('v4/contract_settlement_seals/C-SERVER-NEW').remove(), db.ref('v4/settlement_issuance/ST_C-SERVER-NEW').remove(),
    db.ref('contracts/C-SERVER-PRODUCT-FORGE').remove(), db.ref('v4/contracts/C-SERVER-PRODUCT-FORGE').remove(), db.ref('v4/products/P-C-SERVER-PRODUCT-FORGE').remove(), db.ref('v4/settlements/ST_C-SERVER-PRODUCT-FORGE').remove(), db.ref('v4/settlements_provider_private/ST_C-SERVER-PRODUCT-FORGE').remove(), db.ref('v4/settlements_agent_private/ST_C-SERVER-PRODUCT-FORGE').remove(), db.ref('v4/settlements_admin_private/ST_C-SERVER-PRODUCT-FORGE').remove(), db.ref('v4/contract_settlement_seals/C-SERVER-PRODUCT-FORGE').remove(), db.ref('v4/settlement_issuance/ST_C-SERVER-PRODUCT-FORGE').remove(),
    db.ref('contracts/C-SERVER-NO-TYPE').remove(), db.ref('v4/contracts/C-SERVER-NO-TYPE').remove(), db.ref('v4/products/P-C-SERVER-NO-TYPE').remove(), db.ref('v4/settlement_issuance/ST_C-SERVER-NO-TYPE').remove(),
    db.ref('contracts/C-SERVER-UNSEALED-RATE').remove(), db.ref('v4/contracts/C-SERVER-UNSEALED-RATE').remove(), db.ref('v4/products/P-C-SERVER-UNSEALED-RATE').remove(), db.ref('v4/settlement_issuance/ST_C-SERVER-UNSEALED-RATE').remove(),
    db.ref('contracts/C-SERVER-DELETED').remove(), db.ref('v4/contracts/C-SERVER-DELETED').remove(), db.ref('v4/products/P-C-SERVER-DELETED').remove(), db.ref('v4/settlement_issuance/ST_C-SERVER-DELETED').remove(),
    db.ref('contracts/C-SERVER-LEGACY-OVERLAY').remove(), db.ref('v4/contracts/C-SERVER-LEGACY-OVERLAY').remove(), db.ref('v4/products/P-C-SERVER-LEGACY-OVERLAY').remove(), db.ref('v4/settlements/ST_C-SERVER-LEGACY-OVERLAY').remove(), db.ref('v4/settlements_provider_private/ST_C-SERVER-LEGACY-OVERLAY').remove(), db.ref('v4/settlements_agent_private/ST_C-SERVER-LEGACY-OVERLAY').remove(), db.ref('v4/settlements_admin_private/ST_C-SERVER-LEGACY-OVERLAY').remove(), db.ref('v4/settlement_issuance/ST_C-SERVER-LEGACY-OVERLAY').remove(),
    db.ref('contracts/C-SERVER-LEGACY-CANCELLED').remove(), db.ref('v4/contracts/C-SERVER-LEGACY-CANCELLED').remove(), db.ref('v4/products/P-C-SERVER-LEGACY-CANCELLED').remove(), db.ref('v4/settlement_issuance/ST_C-SERVER-LEGACY-CANCELLED').remove(),
    db.ref('contracts/C-SERVER-LEGACY-DELETED').remove(), db.ref('v4/contracts/C-SERVER-LEGACY-DELETED').remove(), db.ref('v4/products/P-C-SERVER-LEGACY-DELETED').remove(), db.ref('v4/settlement_issuance/ST_C-SERVER-LEGACY-DELETED').remove(),
    db.ref('contracts/C-SERVER-NO-AGENT-UID').remove(), db.ref('v4/contracts/C-SERVER-NO-AGENT-UID').remove(), db.ref('v4/products/P-C-SERVER-NO-AGENT-UID').remove(), db.ref('v4/settlement_issuance/ST_C-SERVER-NO-AGENT-UID').remove(),
    db.ref('contracts/C-SERVER-MISMATCH').remove(), db.ref('v4/contracts/C-SERVER-MISMATCH').remove(), db.ref('v4/settlement_issuance/ST_C-SERVER-MISMATCH').remove(),
  ]).catch(() => undefined);
  // Admin SDK keeps a database socket open in the emulator. Close only the probe's
  // in-process apps so `emulators:exec` can shut down deterministically.
  await Promise.all(getApps().map((app) => app.delete())).catch(() => undefined);
}
