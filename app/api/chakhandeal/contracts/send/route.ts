import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { canSendChakhandealContract } from '@/lib/domain/chakhandeal-esign';
import { findContractKind } from '@/lib/domain/esign-contract-kind';
import { canIssueContract, type PolicyField } from '@/lib/domain/policy-tier';
import { applyPolicyDefaults } from '@/lib/domain/policy-defaults';
import {
  findTemplate,
  isEsignTemplateAllowed,
  standardTemplateSelectionError,
} from '@/lib/domain/esign-templates';
import { productMatchesTemplate } from '@/lib/domain/esign-vehicle-selection';
import {
  missingProviderContractIdentity,
  providerContractIdentity,
} from '@/lib/domain/esign-template-profile';
import {
  getChakhandealConfig,
  issueChakhandealContract,
} from '@/lib/server/chakhandeal-esign';

export const dynamic = 'force-dynamic';
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
const codeText = (value: unknown) => String(value ?? '').trim();
type Row = Record<string, unknown>;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function partnerFromNodes(legacyValue: unknown, overlayValue: unknown, providerCode: string): Row | null {
  const byCode = new Map<string, Row>();
  const take = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const row = raw as Row;
      const code = codeText(row.partner_code || row.provider_company_code || key).toUpperCase();
      if (!code) continue;
      byCode.set(code, { ...(byCode.get(code) || {}), ...row, _key: key });
    }
  };
  take(legacyValue);
  take(overlayValue);
  return byCode.get(codeText(providerCode).toUpperCase()) || null;
}

export async function POST(request: Request) {
  // 연동 미설정 환경은 Admin SDK 인증 시도조차 하지 않고 명시적인 준비 중 상태로 닫는다.
  const config = getChakhandealConfig();
  if (!config) return json({ error: '착한거래 전자계약 연동 준비 중입니다.' }, 503);
  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '전자계약 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor) return json({ error: '로그인이 필요합니다.' }, 401);

  let contractCode = '';
  let contractKind = '';
  let standardTemplateId = '';
  let templateFieldOverrides: Record<string, string> = {};
  try {
    const body = await request.json() as {
      contractCode?: unknown;
      contractKind?: unknown;
      standardTemplateId?: unknown;
      templateFields?: unknown;
    };
    contractCode = codeText(body.contractCode);
    contractKind = codeText(body.contractKind);
    standardTemplateId = codeText(body.standardTemplateId);
    if (body.templateFields && typeof body.templateFields === 'object' && !Array.isArray(body.templateFields)) {
      for (const [k, v] of Object.entries(body.templateFields as Record<string, unknown>)) {
        const key = codeText(k);
        const val = codeText(v);
        if (key && val && key.length <= 80 && val.length <= 500) templateFieldOverrides[key] = val;
      }
    }
  } catch { return json({ error: '요청 형식이 올바르지 않습니다.' }, 400); }
  if (!contractCode || contractCode.length > 100 || /[.#$\[\]\/\u0000-\u001f\u007f]/.test(contractCode)) {
    return json({ error: '계약번호가 올바르지 않습니다.' }, 400);
  }
  // 관리자가 확정하는 것은 표준계약서 3벌 중 하나 + 인수/반납이다.
  // 실제 착한거래 ID는 서버 설정과 공급사 커스텀 장부에서만 결정한다.
  if (!standardTemplateId) return json({ error: '관리자가 표준계약서 종류를 확정해 주세요.' }, 400);
  if (!contractKind) return json({ error: '관리자가 계약유형을 확정해 주세요.' }, 400);
  const standardTemplate = findTemplate(standardTemplateId);
  if (!standardTemplate) return json({ error: '알 수 없는 표준계약서입니다.' }, 400);
  if (!isEsignTemplateAllowed(process.env.VERCEL_ENV, standardTemplateId)) {
    return json({ error: '표준계약서 최종 승인 전이라 운영 발행이 잠겨 있습니다.' }, 503);
  }
  const contractSpec = findContractKind(contractKind);
  if (!contractSpec || contractSpec.kind !== standardTemplate.contractKind) {
    return json({ error: '표준계약서 종류와 인수/반납 선택 조합이 올바르지 않습니다.' }, 400);
  }

  const db = firebaseAdminDatabase();
  const [legacySnap, overlaySnap] = await Promise.all([
    db.ref(`contracts/${contractCode}`).get(),
    db.ref(`v4/contracts/${contractCode}`).get(),
  ]);
  const legacy = legacySnap.val() as Record<string, unknown> | null;
  const overlay = overlaySnap.val() as Record<string, unknown> | null;
  const contract = { ...(legacy || {}), ...(overlay || {}) };
  if (!legacy && !overlay) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
  if (!canSendChakhandealContract(actor, contract)) return json({ error: '이 계약을 발송할 권한이 없습니다.' }, 403);
  if (codeText(contract.contract_status) === '계약취소') return json({ error: '취소된 계약은 발송할 수 없습니다.' }, 409);
  if (codeText(contract.provider_agreement_done) !== 'yes') return json({ error: '약정 작성완료 후 발송할 수 있습니다.' }, 409);
  if (!codeText(contract.customer_name) || !codeText(contract.customer_phone)) return json({ error: '고객명과 연락처를 먼저 확인하세요.' }, 409);
  const esignInputs = contract.esign_inputs && typeof contract.esign_inputs === 'object' && !Array.isArray(contract.esign_inputs)
    ? contract.esign_inputs as Record<string, unknown>
    : {};
  if (contractSpec.buyoutPriceRequired && !codeText(esignInputs.buyout_price)) {
    return json({ error: '인수 계약은 만기 인수가격을 확정해야 발행할 수 있습니다.' }, 409);
  }

  // 표준계약서의 임대인 영역은 공급사별 법정 표시값만 주입한다. 이 값이 비면
  // 표준/커스텀 어느 쪽도 당사자가 없는 계약서가 되므로 발행 전에 닫는다.
  const providerCode = codeText(contract.provider_company_code);
  const [legacyPartnersSnap, overlayPartnersSnap] = await Promise.all([
    db.ref('partners').get().catch(() => null),
    db.ref('v4/partners').get().catch(() => null),
  ]);
  const partner = partnerFromNodes(legacyPartnersSnap?.val(), overlayPartnersSnap?.val(), providerCode);
  const providerIdentity = providerContractIdentity(partner, providerCode);
  const missingProvider = missingProviderContractIdentity(providerIdentity);
  if (missingProvider.length) {
    return json({ error: `공급사 계약정보가 비어 있어 발송할 수 없습니다: ${missingProvider.join(' · ')}` }, 409);
  }

  /*
   * 정책이 「계약」 층까지 채워졌는지 본다.
   *   · 상품만 공급하는 공급사면 계약서는 그쪽이 직접 쓴다 — 우리가 보내면 안 된다.
   *   · 계약 층인데 값이 비면 **빈칸 계약서가 손님에게 나간다.**
   *     서명이 끝나면 그 빈칸은 봉인되어 고치지 못하므로, 발행이 안 되는 편이 낫다.
   * 근거: `docs/POLICY-LAYERS.md`
   */
  const policyCode = codeText(contract.policy_code);
  const policySnap = policyCode ? await db.ref(`v4/policies/${policyCode}`).get() : null;
  const storedPolicy = (policySnap?.val() as Record<string, unknown> | null)
    ?? (policyCode ? ((await db.ref(`policies/${policyCode}`).get()).val() as Record<string, unknown> | null) : null);
  const policy = applyPolicyDefaults(storedPolicy || {}).next;
  const gate = canIssueContract(policy, partner);
  if (!gate.ok) {
    return json({
      error: gate.layer !== 'contract'
        ? '이 공급사는 프리패스 전자계약을 사용하지 않습니다. 파트너사 관리에서 계약 사용 여부를 확인하세요.'
        : `정책 「전자계약」 항목이 비어 있어 발송할 수 없습니다: ${gate.missing.map((m: PolicyField) => m.label).join(' · ')}`,
    }, 409);
  }
  const selectionError = standardTemplateSelectionError(standardTemplate, contractSpec, policy);
  if (selectionError) return json({ error: selectionError }, 409);

  // 재고(상품) — 차종·차번 보강. 안 넘기면 손님 요지·A4 칸이 빈채로 굳는다.
  const productCode = codeText(contract.product_code);
  const carSnap = codeText(contract.car_number_snapshot).replace(/\s/g, '');
  let product: Row | null = null;
  if (productCode) {
    // v4 상품은 v3의 부분 오버레이일 수 있다. 한쪽만 쓰면 배기량·색상·주행거리처럼
    // 아직 v3에 남아 있는 계약 출력값이 발행본에서 빈칸으로 굳는다.
    const [legacyProductSnap, overlayProductSnap] = await Promise.all([
      db.ref(`products/${productCode}`).get().catch(() => null),
      db.ref(`v4/products/${productCode}`).get().catch(() => null),
    ]);
    const legacyProduct = legacyProductSnap?.val() as Row | null;
    const overlayProduct = overlayProductSnap?.val() as Row | null;
    if (legacyProduct || overlayProduct) product = { ...(legacyProduct || {}), ...(overlayProduct || {}) };
  }
  if (!product && carSnap) {
    const [legacyProducts, overlayProducts] = await Promise.all([
      db.ref('products').get().catch(() => null),
      db.ref('v4/products').get().catch(() => null),
    ]);
    const findByCar = (node: unknown): Row | null => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
      for (const [key, raw] of Object.entries(node as Record<string, unknown>)) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const row = raw as Row;
        const plate = codeText(row.car_number).replace(/\s/g, '');
        if (plate && plate === carSnap) return { ...row, _key: key };
      }
      return null;
    };
    const legacyProduct = findByCar(legacyProducts?.val());
    const overlayProduct = findByCar(overlayProducts?.val());
    if (legacyProduct || overlayProduct) product = { ...(legacyProduct || {}), ...(overlayProduct || {}) };
  }
  if (!carSnap && !codeText(product?.car_number)) {
    return json({ error: '차량번호가 없어 발송할 수 없습니다. 약정·재고를 확인해 주세요.' }, 409);
  }
  // body의 표준계약서 ID를 믿지 않는다. 차량 상품구분(렌트/구독)이 본문 종류를 결정한다.
  if (!product || !productMatchesTemplate(product, standardTemplate)) {
    return json({ error: '선택한 표준계약서가 차량 상품구분과 맞지 않습니다.' }, 409);
  }

  try {
    // issue = 서명 링크 만들기. 착한거래는 문자·카카오를 보내지 않는다 —
    // 관리자가 응답 signUrl을 복사해 손님에게 전달한다. (라우트 이름 send ≠ 채널 발송)
    const issue = await issueChakhandealContract(
      config,
      contract,
      standardTemplate,
      contractSpec.key,
      policy,
      partner,
      { product, templateFieldOverrides },
    );

    // 어느 양식으로 나갔는지는 계약에 박는다 — 나중에 «이 손님이 어느 판에 서명했나»를
    // 되짚을 수 있는 유일한 근거다. 발행 식별자와 함께 먼저 저장한다(발송 실패 대비).
    const templateStamp = {
      // 외부 문서 ID와 계약유형을 분리해 저장한다. 커스텀판도 표준 기준판을 함께 남긴다.
      esign_template_id: issue.templateProfile.externalTemplateId,
      esign_template_label: issue.templateProfile.label,
      esign_template_version: issue.templateProfile.version,
      esign_template_mode: issue.templateProfile.mode,
      esign_template_base_id: issue.templateProfile.baseTemplateId,
      esign_template_base_version: issue.templateProfile.baseVersion,
      esign_contract_kind: issue.contractKind,
      esign_maturity: contractSpec.maturity,
      esign_insurance_side: issue.insuranceSide,
    };
    if (Object.keys(templateFieldOverrides).length) {
      await db.ref(`v4/contracts/${contractCode}`).update({
        contract_draft: JSON.stringify({
          ...((() => {
            try {
              const raw = contract.contract_draft;
              const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
              return o && typeof o === 'object' ? o as Record<string, string> : {};
            } catch { return {}; }
          })()),
          ...templateFieldOverrides,
        }),
        sign_draft_at: Date.now(),
      });
    }
    await db.ref(`v4/contracts/${contractCode}`).update({
      esign_provider: 'chakhandeal',
      esign_id: issue.contractId,
      esign_sign_url: issue.signUrl,
      esign_verify_url: issue.verifyUrl,
      esign_seal_hash: issue.sealHash,
      sign_status: '발행',
      sign_expires_at: issue.expiresAt || null,
      esign_issued_at: Date.now(),
      ...templateStamp,
    });
    return json({
      ok: true,
      status: 'issued',
      signUrl: issue.signUrl,
      warnings: issue.warnings || null,
    });
  } catch (error) {
    console.error('[chakhandeal-esign] issue+link failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: '서명 링크 만들기에 실패했습니다. 잠시 후 다시 시도하세요.' }, 502);
  }
}
