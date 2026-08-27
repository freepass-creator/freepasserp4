import { NextResponse } from 'next/server';
import { newId } from '@/lib/domain/ids';
import { approvedFreepassManualOffer } from '@/lib/domain/freepass-manual-offer';
import { findTemplate } from '@/lib/domain/esign-templates';
import { productMatchesTemplate } from '@/lib/domain/esign-vehicle-selection';
import { policyUsableBy } from '@/lib/domain/policy-access';
import { canIssueContract } from '@/lib/domain/policy-tier';
import { firebaseAdminDatabase, verifyActiveBearer } from '@/lib/server/firebase-admin';
import { loadFreepassManualOfferSource } from '@/lib/server/freepass-esign';

export const dynamic = 'force-dynamic';
const S = (v: unknown) => String(v ?? '').trim();
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' } });
async function admin(request: Request) { const actor = await verifyActiveBearer(request); return actor?.rawRole === 'admin' ? actor : null; }
function row(value: unknown) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('요청 형식이 올바르지 않습니다.'); return value as Record<string, unknown>; }
function canonical(id: string, input: Record<string, unknown>) {
  const parsed = approvedFreepassManualOffer(id, { ...input, status: 'approved' });
  if (!parsed || !findTemplate(parsed.templateId)) throw new Error('기본 계약조건 필수값을 확인해 주세요.');
  return { provider_company_code: parsed.providerCompanyCode, policy_code: parsed.policyCode, standard_template_id: parsed.templateId, agent_channel_code: parsed.agentChannelCode, product_type: parsed.productType, customer_type: parsed.customerType, rent_months: parsed.rentMonths, rent_amount: parsed.rentAmount, deposit_amount: parsed.depositAmount, annual_mileage: parsed.annualMileage, driver_age: parsed.driverAge, payment_timing: parsed.paymentTiming, deposit_installment: parsed.depositInstallment, maturity: parsed.maturity, ...(parsed.buyoutPrice != null ? { buyout_price: parsed.buyoutPrice } : {}), special_terms: parsed.specialTerms };
}
async function validateReferences(offer: NonNullable<ReturnType<typeof approvedFreepassManualOffer>>) {
  const template = findTemplate(offer.templateId);
  const source = await loadFreepassManualOfferSource(offer.providerCompanyCode, offer.policyCode);
  if (!template || !source.policy || !source.partner || !policyUsableBy(source.policy, offer.providerCompanyCode)) {
    throw new Error('공급사·계약정책 기준을 확인할 수 없습니다.');
  }
  if (!productMatchesTemplate({ product_type: offer.productType } as never, template)) {
    throw new Error('상품구분과 계약서 양식이 맞지 않습니다.');
  }
  const gate = canIssueContract(source.policy, source.partner);
  if (!gate.ok) throw new Error(`계약정책 필수값이 없습니다: ${gate.missing.map((field) => field.label).join(' · ')}`);
}
export async function GET(request: Request) { try { if (!await admin(request)) return json({ error: '관리자 권한이 필요합니다.' }, 403); const data = (await firebaseAdminDatabase().ref('v4/esign_manual_offers').get()).val() || {}; return json({ ok: true, offers: data }); } catch { return json({ error: '기본 계약조건을 읽지 못했습니다.' }, 503); } }
export async function POST(request: Request) { try { const actor = await admin(request); if (!actor) return json({ error: '관리자 권한이 필요합니다.' }, 403); const id = newId('esign'); const value = canonical(id, row(await request.json())); const offer = approvedFreepassManualOffer(id, { ...value, status: 'approved' }); if (!offer) throw new Error('기본 계약조건 필수값을 확인해 주세요.'); await validateReferences(offer); const now = Date.now(); await firebaseAdminDatabase().ref(`v4/esign_manual_offers/${id}`).set({ ...value, status: 'draft', created_at: now, created_by: actor.uid, updated_at: now }); return json({ ok: true, id }, 201); } catch (e) { return json({ error: e instanceof Error ? e.message : '기본 계약조건을 만들지 못했습니다.' }, 409); } }
export async function PATCH(request: Request) { try { const actor = await admin(request); if (!actor) return json({ error: '관리자 권한이 필요합니다.' }, 403); const body = row(await request.json()); const id = S(body.id); const action = S(body.action); if (!/^[A-Za-z0-9_-]{3,100}$/.test(id) || !['approve', 'disable'].includes(action)) throw new Error('변경 요청을 확인해 주세요.'); const ref = firebaseAdminDatabase().ref(`v4/esign_manual_offers/${id}`); const snap = await ref.get(); const current = row(snap.val()); const offer = approvedFreepassManualOffer(id, { ...current, status: 'approved' }); if (!offer) throw new Error('기본 계약조건을 확인할 수 없습니다.'); if (action === 'disable') { if (S(current.status) !== 'approved') throw new Error('승인된 기본조건만 비활성화할 수 있습니다.'); await ref.update({ status: 'disabled', disabled_at: Date.now(), disabled_by: actor.uid }); return json({ ok: true }); }
    if (S(current.status) !== 'draft') throw new Error('draft 기본조건만 승인할 수 있습니다.');
    await validateReferences(offer);
    const root = firebaseAdminDatabase().ref('v4/esign_manual_offers');
    const approvedAt = Date.now();
    const claim = await root.transaction((all) => {
      const rows = all && typeof all === 'object' && !Array.isArray(all) ? all as Record<string, unknown> : {};
      const fresh = rows[id] && typeof rows[id] === 'object' && !Array.isArray(rows[id]) ? rows[id] as Record<string, unknown> : null;
      if (!fresh || S(fresh.status) !== 'draft') return;
      const duplicate = Object.entries(rows).some(([key, value]) => {
        const other = approvedFreepassManualOffer(key, value);
        return key !== id && !!other && other.templateId === offer.templateId && other.providerCompanyCode === offer.providerCompanyCode && other.agentChannelCode === offer.agentChannelCode && other.customerType === offer.customerType;
      });
      if (duplicate) return;
      return { ...rows, [id]: { ...fresh, status: 'approved', approved_at: approvedAt, approved_by: actor.uid } };
    }, undefined, false);
    if (!claim.committed) throw new Error('같은 계약서 범위에 승인된 기본조건이 이미 있거나 상태가 변경되었습니다.');
    return json({ ok: true });
  } catch (e) { return json({ error: e instanceof Error ? e.message : '기본 계약조건을 변경하지 못했습니다.' }, 409); } }
