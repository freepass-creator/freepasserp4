import { NextResponse } from 'next/server';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { canSendChakhandealContract } from '@/lib/domain/chakhandeal-esign';
import {
  buildTemplateFieldsFromRecords,
  templateFieldRowsForEdit,
} from '@/lib/domain/esign-template-fields';
import {
  getChakhandealConfig,
  getChakhandealContractStatus,
  getChakhandealTemplateFields,
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

async function loadContractBundle(contractCode: string) {
  const db = firebaseAdminDatabase();
  const [legacySnap, overlaySnap] = await Promise.all([
    db.ref(`contracts/${contractCode}`).get(),
    db.ref(`v4/contracts/${contractCode}`).get(),
  ]);
  const legacy = legacySnap.val() as Row | null;
  const overlay = overlaySnap.val() as Row | null;
  const contract = { ...(legacy || {}), ...(overlay || {}) };
  if (!legacy && !overlay) return null;

  const policyCode = codeText(contract.policy_code);
  const policySnap = policyCode ? await db.ref(`v4/policies/${policyCode}`).get() : null;
  const policy = (policySnap?.val() as Row | null)
    ?? (policyCode ? ((await db.ref(`policies/${policyCode}`).get()).val() as Row | null) : null);

  const providerCode = codeText(contract.provider_company_code);
  const [legacyPartnersSnap, overlayPartnersSnap] = await Promise.all([
    db.ref('partners').get().catch(() => null),
    db.ref('v4/partners').get().catch(() => null),
  ]);
  const partner = partnerFromNodes(legacyPartnersSnap?.val(), overlayPartnersSnap?.val(), providerCode);

  // 미리보기·직접입력에서도 발행과 같은 재고 값을 쓴다. v4는 v3 위의 오버레이이므로
  // 한쪽만 고르면 배기량·색상처럼 아직 v3에만 있는 값이 빠질 수 있다.
  const productCode = codeText(contract.product_code);
  const plate = codeText(contract.car_number_snapshot || contract.car_number).replace(/\s/g, '');
  let product: Row | null = null;
  if (productCode) {
    const [legacyProductSnap, overlayProductSnap] = await Promise.all([
      db.ref(`products/${productCode}`).get().catch(() => null),
      db.ref(`v4/products/${productCode}`).get().catch(() => null),
    ]);
    const legacyProduct = legacyProductSnap?.val() as Row | null;
    const overlayProduct = overlayProductSnap?.val() as Row | null;
    if (legacyProduct || overlayProduct) product = { ...(legacyProduct || {}), ...(overlayProduct || {}) };
  }
  if (!product && plate) {
    const [legacyProductsSnap, overlayProductsSnap] = await Promise.all([
      db.ref('products').get().catch(() => null),
      db.ref('v4/products').get().catch(() => null),
    ]);
    const findByPlate = (node: unknown): Row | null => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
      for (const [key, raw] of Object.entries(node as Record<string, unknown>)) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const row = raw as Row;
        if (codeText(row.car_number).replace(/\s/g, '') === plate) return { ...row, _key: key };
      }
      return null;
    };
    const legacyProduct = findByPlate(legacyProductsSnap?.val());
    const overlayProduct = findByPlate(overlayProductsSnap?.val());
    if (legacyProduct || overlayProduct) product = { ...(legacyProduct || {}), ...(overlayProduct || {}) };
  }

  return { contract, policy, partner, product, db };
}

/**
 * GET — 외부 데이터 + draft 로 조립된 templateFields 미리보기(직접 입력용).
 * 발행 후 — 착한거래 발행 스냅샷 + A4 sections (읽기 전용).
 * PATCH — contract_draft 에 직접 입력 칸 저장(발행 전 보완).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ contractCode: string }> },
) {
  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '전자계약 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor) return json({ error: '로그인이 필요합니다.' }, 401);

  const resolved = await Promise.resolve(params);
  const contractCode = codeText(resolved.contractCode);
  if (!contractCode || contractCode.length > 100) return json({ error: '계약번호가 올바르지 않습니다.' }, 400);

  const bundle = await loadContractBundle(contractCode);
  if (!bundle) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
  if (!canSendChakhandealContract(actor, bundle.contract)) {
    return json({ error: '이 계약서 칸을 볼 권한이 없습니다.' }, 403);
  }

  const esignId = codeText(bundle.contract.esign_id);
  if (esignId) {
    const config = getChakhandealConfig();
    if (!config) return json({ error: '착한거래 전자계약 연동 준비 중입니다.' }, 503);
    try {
      const status = await getChakhandealContractStatus(config, esignId);
      const templateId = codeText(status.templateId) || codeText(bundle.contract.esign_template_id);
      let sections: { no: string; title: string; fields: string[] }[] = [];
      let labels: Record<string, string> = {};
      if (templateId) {
        try {
          const meta = await getChakhandealTemplateFields(config, templateId);
          sections = meta.sections;
          for (const f of meta.fields) {
            if (f.field && f.label) labels[f.field] = f.label;
          }
        } catch {
          /* sections 없이도 스냅샷은 보여 준다 */
        }
      }
      const fields = status.templateFields;
      const fieldKeys = Object.keys(fields);
      const filledCount = fieldKeys.filter((k) => fields[k]).length;
      return json({
        ok: true,
        readOnly: true,
        contractCode,
        fields,
        sections,
        labels,
        filledCount,
        totalCount: fieldKeys.length,
        rows: fieldKeys.map((field) => ({
          field,
          label: labels[field] || field,
          from: '발행스냅샷',
          value: fields[field] || '',
        })),
        emptyCount: fieldKeys.filter((k) => !fields[k]).length,
        note: '발행 당시 착한거래에 굳힌 칸입니다. 읽기 전용.',
      });
    } catch (error) {
      console.error(
        '[chakhandeal-esign] issued fields failed',
        contractCode,
        error instanceof Error ? error.message : 'unknown',
      );
      return json({ error: '발행 스냅샷을 불러오지 못했습니다.' }, 502);
    }
  }

  const { fields } = buildTemplateFieldsFromRecords({
    contract: bundle.contract,
    policy: bundle.policy,
    partner: bundle.partner,
    product: bundle.product,
  });
  const rows = templateFieldRowsForEdit(fields);
  const emptyCount = rows.filter((r) => !r.value).length;
  return json({
    ok: true,
    readOnly: false,
    contractCode,
    fields,
    rows,
    emptyCount,
    sections: [],
    note: '외부(계약·정책·파트너) 값 + contract_draft. 빈 칸은 직접 입력 후 저장·서명 링크 만들기에 반영됩니다.',
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ contractCode: string }> },
) {
  let actor;
  try { actor = await verifyActiveBearer(request); }
  catch { return json({ error: '전자계약 서버 인증을 사용할 수 없습니다.' }, 503); }
  if (!actor) return json({ error: '로그인이 필요합니다.' }, 401);

  const resolved = await Promise.resolve(params);
  const contractCode = codeText(resolved.contractCode);
  if (!contractCode || contractCode.length > 100) return json({ error: '계약번호가 올바르지 않습니다.' }, 400);

  let patch: Record<string, string> = {};
  try {
    const body = await request.json() as { templateFields?: unknown };
    if (!body.templateFields || typeof body.templateFields !== 'object' || Array.isArray(body.templateFields)) {
      return json({ error: 'templateFields 객체가 필요합니다.' }, 400);
    }
    for (const [k, v] of Object.entries(body.templateFields as Record<string, unknown>)) {
      const key = codeText(k);
      if (!key || key.length > 80) continue;
      const val = codeText(v);
      if (val.length > 500) return json({ error: `값이 너무 깁니다: ${key}` }, 400);
      patch[key] = val;
    }
  } catch {
    return json({ error: '요청 형식이 올바르지 않습니다.' }, 400);
  }

  const bundle = await loadContractBundle(contractCode);
  if (!bundle) return json({ error: '계약을 찾을 수 없습니다.' }, 404);
  if (!canSendChakhandealContract(actor, bundle.contract)) {
    return json({ error: '이 계약서 칸을 수정할 권한이 없습니다.' }, 403);
  }
  if (codeText(bundle.contract.esign_id) || codeText(bundle.contract.esign_sign_url)) {
    return json({ error: '이미 서명 링크가 만들어진 계약은 칸을 고칠 수 없습니다.' }, 409);
  }

  const { fields } = buildTemplateFieldsFromRecords({
    contract: bundle.contract,
    policy: bundle.policy,
    partner: bundle.partner,
    product: bundle.product,
    overrides: patch,
  });

  await bundle.db.ref(`v4/contracts/${contractCode}`).update({
    contract_draft: JSON.stringify(fields),
    sign_draft_at: Date.now(),
  });

  return json({
    ok: true,
    contractCode,
    fields,
    rows: templateFieldRowsForEdit(fields),
  });
}
