'use client';

import { useCallback, useEffect, useState } from 'react';
import { Btn, ButtonLabel, Message, WorkInput, WorkRow, WorkSelect, WorkTable } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { getAuthClient } from '@/lib/firebase/client';
import { Check, LoaderCircle, Plus, Power } from 'lucide-react';
import { ICON } from '@/components/ui/tokens';

type Offer = Record<string, unknown>;
type Form = {
  provider_company_code: string; policy_code: string; standard_template_id: string;
  agent_channel_code: string; product_type: string; customer_type: string;
  rent_months: string; rent_amount: string; deposit_amount: string; annual_mileage: string;
  driver_age: string; payment_timing: string; deposit_installment: string; maturity: string;
  buyout_price: string; special_terms: string;
};

const emptyForm = (): Form => ({
  provider_company_code: '', policy_code: '', standard_template_id: 'sonogong-rent-draft',
  agent_channel_code: '', product_type: '렌탈', customer_type: '개인',
  rent_months: '36', rent_amount: '', deposit_amount: '0', annual_mileage: '연 20,000km',
  driver_age: '만 26세 이상', payment_timing: '선불', deposit_installment: '일시납', maturity: '반납형',
  buyout_price: '', special_terms: '없음',
});

const TEMPLATE_OPTIONS = [
  { value: 'sonogong-rent-draft', label: '손오공 렌트 계약서' },
  { value: 'sonogong-subscription-insurance-included', label: '손오공 구독 계약서 · 보험료 포함' },
  { value: 'sonogong-subscription-insurance-separate', label: '손오공 구독 계약서 · 보험료 별도' },
];

async function request(path: string, init?: RequestInit) {
  const user = getAuthClient()?.currentUser;
  if (!user) throw new Error('관리자 로그인이 필요합니다.');
  const call = async (refresh = false) => fetch(path, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${await user.getIdToken(refresh)}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  let response = await call();
  if (response.status === 401) response = await call(true);
  const body = await response.json().catch(() => ({})) as { error?: string; offers?: Record<string, Offer>; id?: string };
  if (!response.ok) throw new Error(body.error || '기본 계약조건 요청에 실패했습니다.');
  return body;
}

/** 관리자만 사용하는 계약서 서버 기본조건. 직원·고객 화면에는 이 컴포넌트를 넣지 않는다. */
export function EsignManualOfferSettings() {
  const [offers, setOffers] = useState<Record<string, Offer>>({});
  const [form, setForm] = useState<Form>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const update = (key: keyof Form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const reload = useCallback(async () => {
    try { const body = await request('/api/freepass-esign/manual-offers'); setOffers(body.offers || {}); }
    catch (error) { toast(error instanceof Error ? error.message : '기본 계약조건을 읽지 못했습니다.', 'error'); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const body = await request('/api/freepass-esign/manual-offers', { method: 'POST', body: JSON.stringify({ ...form, ...(form.buyout_price ? { buyout_price: form.buyout_price } : {}) }) });
      toast(`기본 계약조건 초안을 만들었습니다. (${body.id || ''})`, 'ok');
      setForm(emptyForm());
      await reload();
    } catch (error) { toast(error instanceof Error ? error.message : '초안을 만들지 못했습니다.', 'error'); }
    finally { setBusy(false); }
  };
  const transition = async (id: string, action: 'approve' | 'disable') => {
    if (busy) return;
    setBusy(true);
    try { await request('/api/freepass-esign/manual-offers', { method: 'PATCH', body: JSON.stringify({ id, action }) }); toast(action === 'approve' ? '기본 계약조건을 승인했습니다.' : '기본 계약조건을 비활성화했습니다.', 'ok'); await reload(); }
    catch (error) { toast(error instanceof Error ? error.message : '상태를 바꾸지 못했습니다.', 'error'); }
    finally { setBusy(false); }
  };
  return <>
    <WorkTable title="전자계약 기본조건 · 새 초안">
      <WorkRow label="공급사 코드"><WorkInput value={form.provider_company_code} onChange={(v) => update('provider_company_code', v)} placeholder="ERP 공급사 코드" full /></WorkRow>
      <WorkRow label="계약정책 코드"><WorkInput value={form.policy_code} onChange={(v) => update('policy_code', v)} placeholder="ERP 정책 코드" full /></WorkRow>
      <WorkRow label="계약서 종류"><WorkSelect value={form.standard_template_id} onChange={(v) => update('standard_template_id', v)} options={TEMPLATE_OPTIONS} full /></WorkRow>
      <WorkRow label="상품구분"><WorkSelect value={form.product_type} onChange={(v) => update('product_type', v)} options={[{ value: '렌탈', label: '렌탈' }, { value: '구독', label: '구독' }]} full /></WorkRow>
      <WorkRow label="계약자 유형"><WorkSelect value={form.customer_type} onChange={(v) => update('customer_type', v)} options={[{ value: '개인', label: '개인' }, { value: '개인사업자', label: '개인사업자' }, { value: '법인', label: '법인' }]} full /></WorkRow>
      <WorkRow label="영업채널 코드"><WorkInput value={form.agent_channel_code} onChange={(v) => update('agent_channel_code', v)} placeholder="비우면 관리자 전용" full /></WorkRow>
      <WorkRow label="계약기간"><WorkInput value={form.rent_months} onChange={(v) => update('rent_months', v)} inputMode="numeric" placeholder="개월" full /></WorkRow>
      <WorkRow label="월 대여료"><WorkInput value={form.rent_amount} onChange={(v) => update('rent_amount', v)} inputMode="numeric" placeholder="원" full /></WorkRow>
      <WorkRow label="보증금"><WorkInput value={form.deposit_amount} onChange={(v) => update('deposit_amount', v)} inputMode="numeric" placeholder="원" full /></WorkRow>
      <WorkRow label="약정주행거리"><WorkInput value={form.annual_mileage} onChange={(v) => update('annual_mileage', v)} placeholder="예: 연 20,000km" full /></WorkRow>
      <WorkRow label="운전자 연령"><WorkInput value={form.driver_age} onChange={(v) => update('driver_age', v)} placeholder="예: 만 26세 이상" full /></WorkRow>
      <WorkRow label="납부 시점"><WorkSelect value={form.payment_timing} onChange={(v) => update('payment_timing', v)} options={[{ value: '선불', label: '선불' }, { value: '후불', label: '후불' }]} full /></WorkRow>
      <WorkRow label="보증금 납부"><WorkInput value={form.deposit_installment} onChange={(v) => update('deposit_installment', v)} placeholder="예: 일시납" full /></WorkRow>
      <WorkRow label="만기 기준"><WorkSelect value={form.maturity} onChange={(v) => update('maturity', v)} options={[{ value: '반납형', label: '반납형 · 만기 협의' }, { value: '인수형', label: '인수형' }]} full /></WorkRow>
      {form.maturity === '인수형' ? <WorkRow label="만기 인수가"><WorkInput value={form.buyout_price} onChange={(v) => update('buyout_price', v)} inputMode="numeric" placeholder="원" full /></WorkRow> : null}
      <WorkRow label="특약"><WorkInput value={form.special_terms} onChange={(v) => update('special_terms', v)} placeholder="없음" full /></WorkRow>
    </WorkTable>
    <div style={{ marginTop: 8 }}><Btn full onClick={() => void create()} disabled={busy} title="전자계약 기본조건 초안 만들기"><ButtonLabel icon={busy ? <LoaderCircle size={ICON.md} className="fp-spin" /> : <Plus size={ICON.md} />}>{busy ? '처리 중…' : '기본조건 초안 만들기'}</ButtonLabel></Btn></div>
    <Message variant="info">승인 전에는 고객 링크에 사용되지 않습니다. 승인된 조건은 수정할 수 없으며, 변경하려면 새 초안을 만드세요.</Message>
    <WorkTable title={loaded ? `등록된 기본조건 ${Object.keys(offers).length}건` : '기본조건 불러오는 중'}>
      {Object.entries(offers).map(([id, offer]) => {
        const status = String(offer.status || '');
        return <WorkRow key={id} label={`${String(offer.standard_template_id || '')} · ${String(offer.customer_type || '개인')}`}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{`${status || 'unknown'} · ${String(offer.provider_company_code || '')} · ${String(offer.policy_code || '')}`}</span>
            {status === 'draft' ? <Btn size="sm" onClick={() => void transition(id, 'approve')} disabled={busy} title="기본조건 승인"><ButtonLabel icon={<Check size={ICON.md} />}>승인</ButtonLabel></Btn> : null}
            {status === 'approved' ? <Btn size="sm" variant="ghost" onClick={() => void transition(id, 'disable')} disabled={busy} title="기본조건 비활성화"><ButtonLabel icon={<Power size={ICON.md} />}>비활성화</ButtonLabel></Btn> : null}
          </div>
        </WorkRow>;
      })}
    </WorkTable>
  </>;
}
