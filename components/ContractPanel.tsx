'use client';
import { useEffect, useState, Fragment, type ReactNode } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type EntityRecord } from '@/lib/intake/entities';
import { STEPS, contractTone, isDone } from '@/lib/domain/contract';
import { applyStepCheck, cancelContract, finalizeContractIfReady } from '@/lib/domain/settlement-engine';
import { createContractRequest, getRole, type Role } from '@/lib/domain/deal';
import { cheapest, priceList } from '@/lib/domain/product';
import { Btn, Badge, C, R, NUM, Input, fmtPhone, actorColor, DetailRow, ListGroup, FW, FS } from '@/components/ui';
import { ContractMemos } from '@/components/ContractMemos';
import { ContractSign } from '@/components/ContractSign';
import { confirmDialog, toast } from '@/components/Toaster';
import { useIsMobile } from '@/lib/use-mobile';
import { Check } from 'lucide-react';

// 계약 패널 = 5단계 핸드셰이크 진행. 계약 없으면 계약문의로 시작 → 서류·입금·약정·출고.
// 첨부 서류는 별도 패널(계약패널 밑, 위아래 리사이즈). 손님 연락처는 약정(계약서 발송) 단계에서.

function actorLabel(actor: 'agent' | 'provider'): ReactNode {
  return (
    <span style={{ fontSize: FS.micro, fontWeight: FW.label, color: actorColor(actor), marginRight: 6 }}>
      {actor === 'agent' ? '영업' : '공급'}
    </span>
  );
}

export function ContractPanel({ product, roomId, linkedCode, agentCode, onChange }: { product: EntityRecord | null; roomId: string; linkedCode?: string; agentCode?: string; onChange?: () => void }) {
  const co = getCompanyId();
  const mobile = useIsMobile();
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
    if (!contract || busy) return;
    setBusy(true);
    try {
      await applyStepCheck(contract, key, value);
      await load(); onChange?.();
    } catch (e) { toast(String((e as Error)?.message || e), 'error'); }
    finally { setBusy(false); }
  };
  // 계약취소 — 어느 단계든(진행중·완료). 재고 출고가능 복원 + 완료건이면 환수. 영업자·관리자만.
  const doCancel = async () => {
    if (!contract || busy) return;
    if (!await confirmDialog({ title: '계약 취소', message: '이 계약을 취소하시겠습니까?\n재고는 출고가능으로 복원되고, 완료 계약이면 환수가 진행됩니다.', danger: true, okLabel: '계약 취소' })) return;
    setBusy(true);
    try { await cancelContract(contract); await load(); onChange?.(); } catch (e) { toast(String((e as Error)?.message || e), 'error'); } finally { setBusy(false); }
  };
  const retryFinalize = async () => {
    if (!contract || busy) return;
    setBusy(true);
    try {
      await finalizeContractIfReady(contract);
      await load(); onChange?.();
      toast('계약 완료·정산 처리를 마쳤습니다.', 'ok');
    } catch (e) {
      toast(String((e as Error)?.message || e), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (contract === undefined) return <div style={{ padding: 20, color: C.faint, fontSize: FS.sub }}>불러오는 중…</div>;

  const c = contract; // null = 아직 계약 전(출고문의로 시작)
  const cval = (k: string) => (c ? c[k] : undefined);
  const stepDoneArr = STEPS.map((s) => s.checks.every((ch) => isDone(cval(ch.key))));
  const activeIdx = stepDoneArr.findIndex((d) => !d);
  const doneCount = stepDoneArr.filter(Boolean).length;
  const needsFinalize = Boolean(c && doneCount === STEPS.length && String(c.contract_status) !== '계약완료');
  const agreementDone = isDone(cval('provider_agreement_done'));

  return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* 히어로 — 코드·상태·진행률 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {c ? (
            <>
              <span style={{ fontSize: FS.title, fontWeight: FW.head, fontFamily: NUM, color: C.ink }}>{String(c.contract_code)}</span>
              <Badge tone={contractTone(String(c.contract_status))}>{String(c.contract_status)}</Badge>
            </>
          ) : (
            <span style={{ fontSize: FS.title, fontWeight: FW.title, color: C.ink }}>새 계약 — 출고문의로 시작</span>
          )}
          <span style={{ flex: 1, minWidth: 8 }} />
          {c && String(c.contract_status) !== '계약취소' && (role === 'agent' || role === 'admin') && (
            <Btn title="계약 취소" size="sm" variant="ghost" haptic="impact" onClick={doCancel} disabled={busy}>계약취소</Btn>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: FS.page, fontWeight: FW.head, color: C.brand, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{doneCount}</span>
          <span style={{ fontSize: FS.cap, color: C.faint }}>/ {STEPS.length} 단계 완료</span>
        </div>
      </div>

      {needsFinalize && (
        <div style={{ border: `1px solid ${C.warn}`, borderRadius: R, padding: '9px 10px', background: C.warnBg, display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <span style={{ flex: 1, fontSize: FS.cap, color: C.ink, lineHeight: 1.5 }}>5단계 체크는 끝났지만 정산·완료 처리가 남았습니다.</span>
          {(role === 'admin' || role === 'provider') && <Btn title="완료 처리 재시도" size="sm" onClick={retryFinalize} disabled={busy}>완료 처리 재시도</Btn>}
        </div>
      )}

      {STEPS.map((s, i) => {
        const stepDone = stepDoneArr[i];
        const active = i === activeIdx;
        const locked = !stepDone && !active;
        const stepUnlocked = role === 'admin' || active;
        const statusNote = stepDone ? '완료' : active ? '진행 중' : '잠김';
        return (
          <ListGroup
            key={s.id}
            header={`${i + 1}. ${s.label}`}
            footer={statusNote}
            style={{ opacity: locked ? 0.55 : 1 }}
          >
            {s.checks.map((ch) => {
              const cur = cval(ch.key);
              const done = isDone(cur);
              const mine = (ch.actor === role || role === 'admin') && stepUnlocked;
              const label = <>{actorLabel(ch.actor)}{ch.key === 'agent_delivery_inquiry' ? '출고 문의' : ch.key === 'provider_agreement_done' ? '약정 작성완료' : ch.label}</>;

              if (ch.key === 'agent_delivery_inquiry') {
                return (
                  <DetailRow
                    key={ch.key}
                    label={label}
                    value={done
                      ? <span style={{ color: C.ok, fontWeight: FW.strong, display: 'inline-flex', alignItems: 'center', gap: 4 }}>문의함 <Check size={14} aria-hidden /></span>
                      : mine
                        ? <Btn title="출고 문의하기" size="sm" onClick={doInquiry} disabled={busy || !product}>출고 문의하기</Btn>
                        : <span style={{ color: C.faint }}>대기</span>}
                  />
                );
              }

              if (ch.key === 'provider_agreement_done') {
                return (
                  <Fragment key={ch.key}>
                    <DetailRow
                      label={label}
                      value={done
                        ? <span style={{ color: C.ok, fontWeight: FW.strong, display: 'inline-flex', alignItems: 'center', gap: 4 }}>완료 <Check size={14} aria-hidden /></span>
                        : !mine
                          ? <span style={{ color: C.faint }}>대기</span>
                          : <></>}
                    />
                    {!done && mine && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 12px 10px', boxSizing: 'border-box' }}>
                        <span style={{ fontSize: FS.micro, color: C.faint }}>계약서 발송 전 손님 연락처 확인</span>
                        <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', gap: 5, alignItems: mobile ? 'stretch' : 'center' }}>
                          <div style={{ display: 'flex', gap: 5, alignItems: 'center', minWidth: 0, ...(mobile ? {} : { flex: 1 }) }}>
                            {/* 손님명 = 3~4자면 충분 → 폭 고정. 남는 폭은 전부 연락처(010-1234-5678 13자)로. */}
                            <Input value={cust.name} onChange={(v) => setCust((s) => ({ ...s, name: v }))} placeholder="손님명" size="sm" width={mobile ? undefined : 82} style={mobile ? { flex: '0 1 92px', minWidth: 72 } : undefined} />
                            <Input value={cust.phone} onChange={(v) => setCust((s) => ({ ...s, phone: fmtPhone(v) }))} placeholder="연락처" inputMode="tel" size="sm" style={{ flex: '1 1 auto', minWidth: 0 }} />
                          </div>
                          <Btn title="약정 완료" size="sm" onClick={doAgreement} disabled={busy || !cust.name.trim() || !cust.phone.trim()}>약정완료</Btn>
                        </div>
                      </div>
                    )}
                    {done && (c?.customer_name || c?.customer_phone) ? (
                      <DetailRow label="손님" value={[c?.customer_name, c?.customer_phone].filter(Boolean).join(' · ')} />
                    ) : null}
                  </Fragment>
                );
              }

              const choiceBtns = ch.choices?.map((opt) => (
                <Btn
                  key={opt}
                  title={opt}
                  size="sm"
                  full={mobile}
                  variant={cur === opt ? 'solid' : 'ghost'}
                  haptic="select"
                  disabled={!mine || busy}
                  onClick={() => setCheck(ch.key, cur === opt ? '' : opt)}
                >{mobile ? String(opt).replace(/^출고\s*/, '') : opt}</Btn>
              ));

              // 모바일 선택지(가능·협의·불가 등) = 라벨 아래 전폭 균등분할.
              //  좁은 폭에서 라벨과 버튼이 한 줄을 다투면 버튼이 오른쪽 끝에 짓눌려 붙고,
              //  행마다 버튼 수(1~3)가 달라 오른쪽 끝이 들쭉날쭉해진다.
              if (mobile && ch.choices && ch.choices.length > 1) {
                return (
                  <DetailRow
                    key={ch.key}
                    label={label}
                    stacked
                    value={(
                      <span style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${ch.choices.length}, 1fr)`,
                        gap: 6, width: '100%',
                      }}>
                        {choiceBtns}
                      </span>
                    )}
                  />
                );
              }

              return (
                <DetailRow
                  key={ch.key}
                  label={label}
                  value={ch.choices ? <>{choiceBtns}</> : (
                    <Btn
                      title={done ? '완료 해제' : mine ? '체크' : '대기'}
                      size="sm"
                      variant={done ? 'solid' : 'ghost'}
                      haptic="select"
                      disabled={!mine || busy}
                      onClick={() => setCheck(ch.key, done ? '' : 'yes')}
                    >{done ? '완료' : mine ? '체크' : '대기'}</Btn>
                  )}
                />
              );
            })}
          </ListGroup>
        );
      })}

      {c && agreementDone ? <ContractSign contractCode={String(c.contract_code)} /> : null}

      {c && <div style={{ borderTop: `1px solid ${C.line2}`, paddingTop: 9, marginTop: 8 }}><ContractMemos contractCode={String(c.contract_code)} /></div>}
    </div>
  );
}
