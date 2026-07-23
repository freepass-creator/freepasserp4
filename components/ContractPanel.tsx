'use client';
import { useEffect, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type EntityRecord } from '@/lib/intake/entities';
import { STEPS, contractTone, isDone } from '@/lib/domain/contract';
import { applyStepCheck, cancelContract } from '@/lib/domain/settlement-engine';
import { createContractRequest, getRole, type Role } from '@/lib/domain/deal';
import { cheapest, priceList } from '@/lib/domain/product';
import { Btn, Badge, C, R, NUM, Input, fmtPhone, actorColor, FW, FS } from '@/components/ui';
import { ContractMemos } from '@/components/ContractMemos';
import { ContractSign } from '@/components/ContractSign';
import { toast } from '@/components/Toaster';
import { haptic } from '@/lib/haptics';

// 계약 패널 = 5단계 핸드셰이크 진행. 계약 없으면 계약문의로 시작 → 서류·입금·약정·출고.
// 첨부 서류는 별도 패널(계약패널 밑, 위아래 리사이즈). 손님 연락처는 약정(계약서 발송) 단계에서.

export function ContractPanel({ product, roomId, linkedCode, agentCode, onChange }: { product: EntityRecord | null; roomId: string; linkedCode?: string; agentCode?: string; onChange?: () => void }) {
  const co = getCompanyId();
  const [contract, setContract] = useState<EntityRecord | null | undefined>(undefined);
  const [role, setRoleS] = useState<Role>('agent');
  const [cust, setCust] = useState({ name: '', phone: '' });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const all = await getStore().list('contract', co);
    let c: EntityRecord | undefined;
    // 취소계약 제외 + 같은 영업자(agentCode)로 한정 — 같은 매물 타 영업자 계약 오바인딩 방지(contractOf와 동일 기준).
    if (linkedCode) c = all.find((x) => x.contract_code === linkedCode && x.contract_status !== '계약취소');
    if (!c && product) c = all.find((x) => String(x.product_code) === String(product.product_code) && (!agentCode || String(x.agent_code) === agentCode) && x.contract_status !== '계약취소');
    setContract(c || null);
  };
  useEffect(() => { setRoleS(getRole()); load(); /* eslint-disable-next-line */ }, [roomId, product?.product_code, linkedCode, agentCode]);
  useEffect(() => { const on = (e: Event) => setRoleS((e as CustomEvent).detail as Role); window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); }, []);
  useEffect(() => { if (contract) setCust({ name: String(contract.customer_name || ''), phone: String(contract.customer_phone || '') }); /* eslint-disable-next-line */ }, [contract?.contract_code]);

  // 계약문의 = 계약 시작. 계약 없으면 가계약 자동생성. 손님 연락처는 가부 확인 후 완료 직전(출고)에만 입력.
  const doInquiry = async () => {
    if (busy) return; setBusy(true);
    try {
      let cc = contract || null;
      if (!cc && product) {
        const m = cheapest(product)?.m || priceList(product)[0]?.m || 0;
        const code = await createContractRequest(product, { period: m, customerName: '', customerPhone: '' }, roomId);
        cc = (await getStore().get('contract', co, code)) || null;
      }
      if (cc) await applyStepCheck(cc, 'agent_delivery_inquiry', 'yes');
      await load(); onChange?.();
    } catch (e) { toast(String((e as Error)?.message || e), 'error'); } finally { setBusy(false); }
  };
  // 약정 작성완료 = 계약서(약정) 발송 직전 손님 연락처 확인 + 체크. (연락처 모르니 가부 먼저, 계약서 날리기 전에만 입력)
  const doAgreement = async () => {
    if (!contract || busy) return; setBusy(true);
    try {
      await getStore().update('contract', co, String(contract.contract_code), { customer_name: cust.name.trim(), customer_phone: cust.phone.trim() });
      await applyStepCheck(contract, 'provider_agreement_done', 'yes');
      await load(); onChange?.();
    } catch (e) { toast(String((e as Error)?.message || e), 'error'); } finally { setBusy(false); }
  };
  const setCheck = async (key: string, value: string) => {
    if (!contract) return;
    try {
      haptic.select();
      await applyStepCheck(contract, key, value);
    } catch (e) { toast(String((e as Error)?.message || e), 'error'); return; }
    await load(); onChange?.();
  };
  // 계약취소 — 어느 단계든(진행중·완료). 재고 출고가능 복원 + 완료건이면 환수. 영업자·관리자만.
  const doCancel = async () => {
    if (!contract || busy) return;
    if (typeof window !== 'undefined' && !window.confirm('이 계약을 취소하시겠습니까?\n재고는 출고가능으로 복원되고, 완료 계약이면 환수가 진행됩니다.')) return;
    setBusy(true);
    try { haptic.impact(); await cancelContract(contract); await load(); onChange?.(); } catch (e) { toast(String((e as Error)?.message || e), 'error'); } finally { setBusy(false); }
  };

  if (contract === undefined) return <div style={{ padding: 20, color: C.faint, fontSize: FS.sub }}>불러오는 중…</div>;

  const c = contract; // null = 아직 계약 전(출고문의로 시작)
  const cval = (k: string) => (c ? c[k] : undefined);
  const stepDoneArr = STEPS.map((s) => s.checks.every((ch) => isDone(cval(ch.key))));
  const activeIdx = stepDoneArr.findIndex((d) => !d);
  const doneCount = stepDoneArr.filter(Boolean).length;

  return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {c ? <><span style={{ fontSize: FS.sub, fontWeight: FW.title, fontFamily: NUM }}>{String(c.contract_code)}</span><Badge tone={contractTone(String(c.contract_status))}>{String(c.contract_status)}</Badge></>
          : <span style={{ fontSize: FS.sub, fontWeight: FW.title, color: C.ink }}>새 계약 — 출고문의로 시작</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: FS.sub, fontWeight: FW.head, color: C.brand }}>{doneCount}/{STEPS.length}</span>
        {c && String(c.contract_status) !== '계약취소' && (role === 'agent' || role === 'admin') && <Btn size="sm" variant="ghost" onClick={doCancel} disabled={busy}>계약취소</Btn>}
      </div>

      {STEPS.map((s, i) => {
        const stepDone = stepDoneArr[i];
        const active = i === activeIdx;
        const locked = !stepDone && !active;
        const stepUnlocked = role === 'admin' || active;
        return (
          <div key={s.id} style={{ border: `1px solid ${active ? C.brand : C.line}`, borderRadius: R, padding: '8px 10px', background: stepDone ? C.okBg : active ? C.selected : C.taupeBg, opacity: locked ? 0.55 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: FS.cap, fontWeight: FW.title, color: stepDone ? C.ok : C.ink }}>{i + 1}. {s.label}</span>
              {stepDone ? <span style={{ fontSize: FS.micro, color: C.ok, fontWeight: FW.label }}>완료</span> : active ? <span style={{ fontSize: FS.micro, color: C.brand, fontWeight: FW.label }}>진행 중</span> : <span style={{ fontSize: FS.micro, color: C.faint }}>잠김</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {s.checks.map((ch) => {
                const cur = cval(ch.key);
                const done = isDone(cur);
                const mine = (ch.actor === role || role === 'admin') && stepUnlocked;
                const actorTag = <span style={{ fontSize: FS.micro, fontWeight: FW.label, color: actorColor(ch.actor), width: 26, flex: '0 0 26px' }}>{ch.actor === 'agent' ? '영업' : '공급'}</span>;

                if (ch.key === 'agent_delivery_inquiry') {
                  return (
                    <div key={ch.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {actorTag}<span style={{ fontSize: FS.cap, color: C.ink, flex: 1 }}>출고 문의</span>
                      {done ? <span style={{ fontSize: FS.cap, color: C.ok, fontWeight: FW.strong }}>문의함 ✓</span>
                        : mine ? <Btn size="sm" onClick={doInquiry} disabled={busy || !product}>출고 문의하기</Btn>
                          : <span style={{ fontSize: FS.cap, color: C.faint }}>대기</span>}
                    </div>
                  );
                }
                if (ch.key === 'provider_agreement_done') {
                  return (
                    <div key={ch.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{actorTag}<span style={{ fontSize: FS.cap, color: C.ink, flex: 1 }}>약정 작성완료</span>{done && <span style={{ fontSize: FS.cap, color: C.ok, fontWeight: FW.strong }}>완료 ✓</span>}</div>
                      {!done && mine && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 32 }}>
                          <span style={{ fontSize: FS.micro, color: C.faint }}>계약서 발송 전 손님 연락처 확인</span>
                          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                            <Input value={cust.name} onChange={(v) => setCust((s) => ({ ...s, name: v }))} placeholder="손님명" size="sm" width={82} />
                            <Input value={cust.phone} onChange={(v) => setCust((s) => ({ ...s, phone: fmtPhone(v) }))} placeholder="연락처" inputMode="tel" size="sm" style={{ flex: 1, minWidth: 0 }} />
                            <Btn size="sm" onClick={doAgreement} disabled={busy || !cust.name.trim() || !cust.phone.trim()}>약정완료</Btn>
                          </div>
                        </div>
                      )}
                      {!done && !mine && <span style={{ fontSize: FS.cap, color: C.faint, paddingLeft: 32 }}>대기</span>}
                      {done && (c?.customer_name || c?.customer_phone) ? <span style={{ fontSize: FS.cap, color: C.mute, paddingLeft: 32 }}>{[c?.customer_name, c?.customer_phone].filter(Boolean).join(' · ')}</span> : null}
                      {done && c ? (
                        <div style={{ marginTop: 4, paddingLeft: 32 }}>
                          <ContractSign contractCode={String(c.contract_code)} />
                        </div>
                      ) : null}
                    </div>
                  );
                }
                return (
                  <div key={ch.key} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {actorTag}<span style={{ fontSize: FS.cap, color: C.ink }}>{ch.label}</span><span style={{ flex: 1 }} />
                    {ch.choices ? ch.choices.map((opt) => (
                      <Btn
                        key={opt}
                        size="sm"
                        variant={cur === opt ? 'solid' : 'ghost'}
                        disabled={!mine}
                        onClick={() => setCheck(ch.key, cur === opt ? '' : opt)}
                      >{opt}</Btn>
                    )) : (
                      <Btn
                        size="sm"
                        variant={done ? 'solid' : 'ghost'}
                        disabled={!mine}
                        onClick={() => setCheck(ch.key, done ? '' : 'yes')}
                      >{done ? '완료' : mine ? '체크' : '대기'}</Btn>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {c && <div style={{ borderTop: `1px solid ${C.line2}`, paddingTop: 9 }}><ContractMemos contractCode={String(c.contract_code)} /></div>}
    </div>
  );
}
