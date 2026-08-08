'use client';
import { useEffect, useRef, useState, Fragment, type ReactNode } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type EntityRecord } from '@/lib/intake/entities';
import { STEPS, contractStage, isContractCancelled, isContractCompleted, isDone, isRejected, needsContractFinalization, hasTermFrozen } from '@/lib/domain/contract';
import { applyStepCheck, cancelContract, finalizeContractIfReady } from '@/lib/domain/settlement-engine';
import { createContractRequest, freezeContractTerm, getRole, type Role } from '@/lib/domain/deal';
import { cheapest, priceAt, priceList } from '@/lib/domain/product';
import { Btn, ButtonLabel, IconBtn, Badge, C, R, NUM, ICON, Input, fmtPhone, actorColor, DetailRow, ListGroup, ToggleChips, FW, FS, won } from '@/components/ui';
import { ContractMemos } from '@/components/ContractMemos';
import { ChakhandealEsignButton } from '@/components/ChakhandealEsignButton';
import { confirmDialog, toast } from '@/components/Toaster';
import { useIsMobile } from '@/lib/use-mobile';
import { Ban, Check, CheckCircle2, FileSignature, RefreshCw, RotateCcw, Send } from 'lucide-react';
import { runContractMutation } from '@/features/contract/contract-mutation';

// 계약 패널 = 5단계 핸드셰이크. 출고문의(가능여부) → 서류 → 약정(기간·금액 동결) → 입금 → 출고.
// 첨부 서류는 별도 패널. 손님 연락처·기간은 약정 단계에서.

/**
 * 누구 몫인가 — 두 글자.
 *
 * 공급사는 시트로 관리한다(앱에 들어오지 않는다, 2026-08-07 사장님 결정).
 * 그래서 «공급 몫» 체크는 실제로는 **프리패스 운영자가 처리**한다 — 영업자에게 「공급 대기」라고
 * 적으면 앱에 있지도 않은 회사를 기다리는 것처럼 읽힌다. 그래서 보는 사람이 공급사 계정일 때만
 * 「공급」이고, 그 외에는 「운영」이다. **데이터의 actor 는 그대로다** — 바뀌는 건 표기뿐.
 */
function actorLabel(actor: 'agent' | 'provider', viewer: Role): ReactNode {
  const text = actor === 'agent' ? '영업' : viewer === 'provider' ? '공급' : '운영';
  return (
    <span style={{ fontSize: FS.micro, fontWeight: FW.label, color: actorColor(actor), marginRight: 6 }}>
      {text}
    </span>
  );
}

type ContractCheck = (typeof STEPS)[number]['checks'][number];

/** 화면 표기가 엔진 키와 다른 둘(레거시 키명 보정) — 라벨은 한 곳에서만 만든다. */
function checkLabel(ch: ContractCheck): string {
  if (ch.key === 'agent_delivery_inquiry') return '출고 문의';
  if (ch.key === 'provider_agreement_done') return '약정 작성완료';
  return ch.label;
}

/** 액터 칩이 없는 정보행 — 칩 자리를 비워 둔다. 안 그러면 그 행만 칩 폭만큼 왼쪽으로 튀어나와 라벨 시작선이 지그재그가 된다. */
function infoLabel(text: string): ReactNode {
  return (
    <>
      <span style={{ fontSize: FS.micro, fontWeight: FW.label, marginRight: 6, visibility: 'hidden' }} aria-hidden>영업</span>
      {text}
    </>
  );
}

/**
 * 단계 표시 방식.
 * - `all`   = 5단계 전부 펼침. 지난 기록·감독용(계약·문의 전용 화면 기본).
 * - `focus` = 보조칸용 **액션만**. 지금 단계에서 내가 누를 버튼(+기간 선택)만.
 *   점·대기목록·완료목록·메모·전체보기는 넣지 않는다(좁은 칸을 잡아먹음).
 */
export type ContractStepView = 'all' | 'focus';

export function ContractPanel({ product, roomId, linkedCode, agentCode, onChange, stepView = 'all' }: { product: EntityRecord | null; roomId?: string; linkedCode?: string; agentCode?: string; onChange?: (contractCode?: string) => void; stepView?: ContractStepView }) {
  const co = getCompanyId();
  const mobile = useIsMobile();
  const [contract, setContract] = useState<EntityRecord | null | undefined>(undefined);
  const [role, setRoleS] = useState<Role>('agent');
  const [cust, setCust] = useState({ name: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const selectionEpoch = useRef(0);
  /** 약정에서 동결할 대여기간. 미선택이면 최저가 기간을 쓴다. */
  const [period, setPeriod] = useState<number>(0);

  /** 상세·목록과 전역 메뉴 숫자를 같은 프레임에 갱신한다. */
  const notifyChange = () => {
    onChange?.(String(contract?.contract_code || linkedCode || '').trim() || undefined);
    window.dispatchEvent(new Event('fp:unread'));
  };

  const load = async (epoch = selectionEpoch.current) => {
    const all = await getStore().list('contract', co);
    let c: EntityRecord | undefined;
    // 취소계약 제외 + 같은 영업자(agentCode)로 한정 — 같은 매물 타 영업자 계약 오바인딩 방지(contractOf와 동일 기준).
    if (linkedCode) c = all.find((x) => x.contract_code === linkedCode && !isContractCancelled(x));
    else if (product) c = all.find((x) => String(x.product_code) === String(product.product_code) && (!agentCode || String(x.agent_code) === agentCode) && !isContractCancelled(x));
    if (epoch === selectionEpoch.current) setContract(c || null);
  };
  useEffect(() => {
    const epoch = ++selectionEpoch.current;
    setRoleS(getRole());
    setContract(undefined);
    setCust({ name: '', phone: '' });
    setPeriod(0);
    setBusy(false);
    void load(epoch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, product?.product_code, linkedCode, agentCode]);
  useEffect(() => { const on = (e: Event) => setRoleS((e as CustomEvent).detail as Role); window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); }, []);
  useEffect(() => { if (contract) setCust({ name: String(contract.customer_name || ''), phone: String(contract.customer_phone || '') }); /* eslint-disable-next-line */ }, [contract?.contract_code]);

  // 출고문의 = 가능 여부만. 기간·금액은 약정에서 동결.
  const doInquiry = async () => {
    if (busy) return;
    const epoch = selectionEpoch.current;
    setBusy(true);
    try {
      await runContractMutation(async () => {
        let cc = contract || null;
        if (!cc && product) {
          const code = await createContractRequest(product, { customerName: '', customerPhone: '' }, roomId || undefined);
          cc = (await getStore().get('contract', co, code)) || null;
        }
        if (cc) await applyStepCheck(cc, 'agent_delivery_inquiry', 'yes');
      }, () => load(epoch), notifyChange);
    } catch (e) { toast(String((e as Error)?.message || e), 'error'); } finally {
      if (epoch === selectionEpoch.current) setBusy(false);
    }
  };
  // 약정 작성완료 = 기간·금액 동결 + 손님 연락처 + 체크.
  const doAgreement = async () => {
    if (!contract || !product || busy) return;
    const epoch = selectionEpoch.current;
    const frozen = hasTermFrozen(contract);
    const m = period || cheapest(product)?.m || priceList(product)[0]?.m || 0;
    if (!frozen && !m) {
      toast('대여기간을 선택해 주세요.', 'error');
      return;
    }
    setBusy(true);
    try {
      await runContractMutation(async () => {
        if (!hasTermFrozen(contract)) {
          await freezeContractTerm(contract, product, m);
        }
        await getStore().update('contract', co, String(contract.contract_code), { customer_name: cust.name.trim(), customer_phone: cust.phone.trim() });
        const fresh = (await getStore().get('contract', co, String(contract.contract_code))) || contract;
        await applyStepCheck(fresh, 'provider_agreement_done', 'yes');
      }, () => load(epoch), notifyChange);
    } catch (e) { toast(String((e as Error)?.message || e), 'error'); } finally {
      if (epoch === selectionEpoch.current) setBusy(false);
    }
  };
  const setCheck = async (key: string, value: string) => {
    if (!contract || busy) return;
    if (
      value
      && (key === 'agent_balance_paid' || key === 'agent_final_paid' || key === 'provider_balance_confirmed')
      && !hasTermFrozen(contract)
    ) {
      toast('약정에서 대여기간·금액을 먼저 확정해 주세요.', 'error');
      return;
    }
    const epoch = selectionEpoch.current;
    setBusy(true);
    try {
      await runContractMutation(() => applyStepCheck(contract, key, value), () => load(epoch), notifyChange);
    } catch (e) { toast(String((e as Error)?.message || e), 'error'); }
    finally { if (epoch === selectionEpoch.current) setBusy(false); }
  };
  // 계약취소 — 어느 단계든(진행중·완료). 재고 출고가능 복원 + 완료건이면 환수. 영업자·관리자만.
  const doCancel = async () => {
    if (!contract || busy) return;
    const epoch = selectionEpoch.current;
    const target = contract;
    if (!await confirmDialog({ title: '계약 취소', message: '이 계약을 취소하시겠습니까?\n재고는 출고가능으로 복원되고, 완료 계약이면 환수가 진행됩니다.', danger: true, okLabel: '계약 취소' })) return;
    if (epoch !== selectionEpoch.current) return;
    setBusy(true);
    try { await runContractMutation(() => cancelContract(target), () => load(epoch), notifyChange); } catch (e) { toast(String((e as Error)?.message || e), 'error'); } finally {
      if (epoch === selectionEpoch.current) setBusy(false);
    }
  };
  const retryFinalize = async () => {
    if (!contract || busy) return;
    const epoch = selectionEpoch.current;
    setBusy(true);
    try {
      await runContractMutation(async () => { await finalizeContractIfReady(contract); }, () => load(epoch), notifyChange);
      toast('계약 완료·정산 처리를 마쳤습니다.', 'ok');
    } catch (e) {
      toast(String((e as Error)?.message || e), 'error');
    } finally {
      if (epoch === selectionEpoch.current) setBusy(false);
    }
  };

  // ★단계 파생값은 early return 위에서 만든다 — 훅이 조건부 아래로 내려가면 렌더마다 훅 개수가 달라져 터진다.
  const c = contract || null; // null = 아직 계약 전(출고문의로 시작)
  const cval = (k: string) => (c ? c[k] : undefined);
  const stepDoneArr = STEPS.map((s) => s.checks.every((ch) => isDone(cval(ch.key))));
  const activeIdx = stepDoneArr.findIndex((d) => !d);

  if (contract === undefined) return <div style={{ padding: 20, color: C.faint, fontSize: FS.sub }}>불러오는 중…</div>;

  const cancelled = isContractCancelled(c);
  const stage = contractStage(c);
  const doneCount = stepDoneArr.filter(Boolean).length;
  const nowIdx = activeIdx < 0 ? STEPS.length - 1 : activeIdx;
  const needsFinalize = needsContractFinalization(c);
  const agreementDone = isDone(cval('provider_agreement_done'));

  /** 체크 한 줄 — 「할 일 카드」와 「전체 보기」가 같은 원자를 쓴다. 두 벌로 갈라지면 곧 어긋난다. */
  const renderCheck = (ch: ContractCheck, stepUnlocked: boolean) => {
    const cur = cval(ch.key);
              const done = isDone(cur);
              const mine = !cancelled && (ch.actor === role || role === 'admin') && stepUnlocked;
              const label = <>{actorLabel(ch.actor, role)}{ch.key === 'agent_delivery_inquiry' ? '출고 문의' : ch.key === 'provider_agreement_done' ? '약정 작성완료' : ch.label}</>;
              // 완료 표기는 카드 전체에서 한 가지만 쓴다. 예전엔 '문의함 ✓'(초록 텍스트)와
              //  남색 채움 「완료」 버튼이 섞여, 같은 '끝났음'이 행마다 다른 모습으로 보였다.
              const doneMark = (
                <span style={{ color: C.ok, fontWeight: FW.strong, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  완료 <Check size={ICON.sm} aria-hidden />
                </span>
              );
              const waitMark = <span style={{ color: C.faint }}>대기</span>;

              if (ch.key === 'agent_delivery_inquiry') {
                // 출고문의 = 가능 여부만. 기간·금액은 약정에서.
                return (
                  <Fragment key={ch.key}>
                    <DetailRow
                      control
                      label={label}
                      value={done
                        ? doneMark
                        : mine
                          ? (
                            <Btn title="출고 문의하기" size="sm" onClick={doInquiry} disabled={busy || !product}>
                              <ButtonLabel icon={<Send size={ICON.md} aria-hidden />}>출고 문의하기</ButtonLabel>
                            </Btn>
                          )
                          : waitMark}
                    />
                  </Fragment>
                );
              }

              if (ch.key === 'provider_agreement_done') {
                const periods = product ? priceList(product) : [];
                const frozen = !!c && hasTermFrozen(c);
                const picked = frozen
                  ? Number(c?.rent_month_snapshot) || 0
                  : (period || (product ? cheapest(product)?.m : undefined) || periods[0]?.m || 0);
                const pickedPrice = frozen
                  ? {
                      rent: Number(c?.rent_amount_snapshot) || 0,
                      deposit: Number(c?.deposit_amount_snapshot) || 0,
                    }
                  : (periods.find((x) => x.m === picked) || (picked ? priceAt(product!, picked) : null));
                const canAgree = !!cust.name.trim() && !!cust.phone.trim() && (frozen || !!picked);
                return (
                  <Fragment key={ch.key}>
                    <DetailRow
                      control
                      label={label}
                      value={done ? doneMark : !mine ? waitMark : <></>}
                    />
                    {!done && mine && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 12px 10px', boxSizing: 'border-box' }}>
                        {!frozen && periods.length > 0 ? (
                          <>
                            <span style={{ fontSize: FS.micro, color: C.faint }}>
                              대여기간 — 약정 시 이 기간의 월대여료·보증금으로 <b style={{ color: C.warn }}>동결</b>
                            </span>
                            <ToggleChips
                              size="sm"
                              selected={new Set([String(picked)])}
                              options={periods.map((x) => ({ key: String(x.m), label: `${x.m}개월` }))}
                              onToggle={(k) => setPeriod(Number(k))}
                            />
                          </>
                        ) : null}
                        {pickedPrice ? (
                          <span style={{ fontSize: FS.sub, color: C.mute, fontVariantNumeric: 'tabular-nums' }}>
                            {picked}개월 · 월 {won(pickedPrice.rent)} · {pickedPrice.deposit > 0 ? `보증 ${won(pickedPrice.deposit)}` : '무보증'}
                            {frozen ? ' (확정)' : ''}
                          </span>
                        ) : (
                          <span style={{ fontSize: FS.cap, color: C.danger }}>상품에 선택 가능한 기간·가격이 없습니다.</span>
                        )}
                        <span style={{ fontSize: FS.micro, color: C.faint }}>계약서 발송 전 손님 연락처</span>
                        <div style={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', gap: 5, alignItems: mobile ? 'stretch' : 'center' }}>
                          <div style={{ display: 'flex', gap: 5, alignItems: 'center', minWidth: 0, ...(mobile ? {} : { flex: 1 }) }}>
                            <Input value={cust.name} onChange={(v) => setCust((s) => ({ ...s, name: v }))} placeholder="손님명" size="sm" width={mobile ? undefined : 82} style={mobile ? { flex: '0 1 92px', minWidth: 72 } : undefined} />
                            <Input value={cust.phone} onChange={(v) => setCust((s) => ({ ...s, phone: fmtPhone(v) }))} placeholder="연락처" inputMode="tel" size="sm" style={{ flex: '1 1 auto', minWidth: 0 }} />
                          </div>
                          <Btn title="약정 완료" size="sm" onClick={doAgreement} disabled={busy || !canAgree}>
                            <ButtonLabel icon={<FileSignature size={ICON.md} aria-hidden />}>약정완료</ButtonLabel>
                          </Btn>
                        </div>
                      </div>
                    )}
                    {done && hasTermFrozen(c) ? (
                      <DetailRow
                        control
                        label={infoLabel('동결 금액')}
                        value={`${String(c?.rent_month_snapshot)}개월 · 월 ${won(Number(c?.rent_amount_snapshot) || 0)} · ${Number(c?.deposit_amount_snapshot) > 0 ? `보증 ${won(Number(c?.deposit_amount_snapshot))}` : '무보증'}`}
                      />
                    ) : null}
                    {done && (c?.customer_name || c?.customer_phone) ? (
                      <DetailRow control label={infoLabel('손님')} value={[c?.customer_name, c?.customer_phone].filter(Boolean).join(' · ')} />
                    ) : null}
                  </Fragment>
                );
              }

              // 좁은 열(보조패널 focus)·모바일 = 버튼 라벨을 짧게(출고 가능→가능).
              //  title에는 원문 유지. 한 줄에 라벨+버튼3개가 붙으면 「출고응답」이 「출고 응…」으로 잘린다.
              const shortChoice = mobile || stepView === 'focus';
              const choiceBtns = ch.choices?.map((opt) => (
                <Btn
                  key={opt}
                  title={opt}
                  size="sm"
                  full={shortChoice}
                  // 거부(출고 불가·부결)가 선택되면 빨강. 예전엔 승인과 똑같은 남색으로 칠해져
                  //  카드를 훑을 때 '부결'이 '승인'처럼 보였다.
                  variant={cur === opt ? (isRejected(opt) ? 'danger' : 'solid') : 'ghost'}
                  haptic="select"
                  disabled={!mine || busy}
                  onClick={() => setCheck(ch.key, cur === opt ? '' : opt)}
                >{shortChoice ? String(opt).replace(/^출고\s*/, '') : opt}</Btn>
              ));

              // 내 차례가 아니면 선택지를 흐리게 늘어놓지 않는다 — 누를 수 없는 버튼 3개보다
              //  결과 한 줄이 읽기 쉽고, 행마다 버튼 수가 달라 생기던 우측 들쭉날쭉도 사라진다.
              if (ch.choices && !mine) {
                const rejected = isRejected(cur);
                return (
                  <DetailRow
                    key={ch.key}
                    control
                    label={label}
                    value={rejected
                      ? <span style={{ color: C.danger, fontWeight: FW.strong }}>{String(cur)}</span>
                      : done
                        ? <span style={{ color: C.ok, fontWeight: FW.strong, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{String(cur)} <Check size={ICON.sm} aria-hidden /></span>
                        : waitMark}
                  />
                );
              }

              // 모바일·보조패널(focus) 선택지 = 라벨 아래 전폭 균등분할.
              //  좁은 폭에서 라벨과 버튼이 한 줄을 다투면 「출고응답」이 ellipsis로 잘리고
              //  버튼이 오른쪽 끝에 짓눌린다.
              if (shortChoice && ch.choices && ch.choices.length > 1) {
                return (
                  <DetailRow
                    key={ch.key}
                    label={label}
                    stacked
                    control
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
                  control
                  label={label}
                  value={ch.choices ? <>{choiceBtns}</> : done ? (
                    // 끝난 행은 버튼이 아니라 결과다. 예전엔 남색 채움 「완료」 버튼이라
                    //  아직 눌러야 하는 「체크」와 생김새만 다르고 역할이 같아 보였다.
                    mine ? (
                      <>
                        {doneMark}
                        <Btn title="완료 해제" size="sm" variant="ghost" haptic="select" disabled={busy} onClick={() => setCheck(ch.key, '')}>
                          <ButtonLabel icon={<RotateCcw size={ICON.md} aria-hidden />}>해제</ButtonLabel>
                        </Btn>
                      </>
                    ) : doneMark
                  ) : mine ? (
                    <Btn
                      title={
                        (ch.key === 'agent_balance_paid' || ch.key === 'agent_final_paid' || ch.key === 'provider_balance_confirmed')
                        && !hasTermFrozen(c)
                          ? '약정에서 기간·금액 확정 후'
                          : '완료로 표시'
                      }
                      size="sm"
                      variant="ghost"
                      haptic="select"
                      disabled={busy || (
                        (ch.key === 'agent_balance_paid' || ch.key === 'agent_final_paid' || ch.key === 'provider_balance_confirmed')
                        && !hasTermFrozen(c)
                      )}
                      onClick={() => setCheck(ch.key, 'yes')}
                    >
                      <ButtonLabel icon={<CheckCircle2 size={ICON.md} aria-hidden />}>완료 표시</ButtonLabel>
                    </Btn>
                  ) : waitMark}
                />
              );
  };

  // focus(보조칸) = 액션만. all = 5단계·메모 전부.
  if (stepView === 'focus') {
    const focusStep = STEPS[nowIdx];
    const isMyCheck = (ch: ContractCheck) => !cancelled && (ch.actor === role || role === 'admin');
    const myTodo = focusStep.checks.filter((ch) => !isDone(cval(ch.key)) && isMyCheck(ch));
    const theirTodo = focusStep.checks.filter((ch) => !isDone(cval(ch.key)) && !isMyCheck(ch));
    if (cancelled) {
      return (
        <div style={{ padding: '8px 10px', fontSize: FS.sub, color: C.mute }}>
          계약이 취소되었습니다{c?.contract_code ? ` · ${String(c.contract_code)}` : ''}
        </div>
      );
    }
    const waitLine = theirTodo.length
      ? theirTodo.map((ch) => checkLabel(ch)).join(' · ')
      : '';
    return (
      <div style={{ padding: '6px 10px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {/* 단계 라벨(출고문의 등)은 잘리지 않게 — 보조칸이 좁아도 줄바꿈으로 보존 */}
          <span style={{ flex: 1, minWidth: 0, fontSize: FS.sub, color: C.mute, lineHeight: 1.35 }}>
            {activeIdx < 0
              ? '5단계 완료'
              : <>{nowIdx + 1}/{STEPS.length} · <b style={{ color: C.ink, fontWeight: FW.title }}>{STEPS[nowIdx].label}</b></>}
          </span>
          {c && !cancelled && (role === 'admin' || (role === 'agent' && !isContractCompleted(c))) && (
            <IconBtn title="계약 취소" onClick={doCancel} disabled={busy}><Ban size={ICON.md} aria-hidden /></IconBtn>
          )}
        </div>

        {needsFinalize && (
          <div style={{ border: `1px solid ${C.warn}`, borderRadius: R, padding: '8px 10px', background: C.warnBg, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, fontSize: FS.cap, color: C.ink, lineHeight: 1.4 }}>정산·완료 처리가 남았습니다.</span>
            {(role === 'admin' || role === 'provider') && (
              <Btn title="완료 처리 재시도" size="sm" onClick={retryFinalize} disabled={busy}>재시도</Btn>
            )}
          </div>
        )}

        {myTodo.length > 0 ? (
          // 보조칸 = 바깥 aside 테두리만. ListGroup 카드(또 박스)는 얹지 않는다.
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {myTodo.map((ch) => renderCheck(ch, true))}
          </div>
        ) : (
          <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.4 }}>
            {activeIdx < 0
              ? (needsFinalize ? null : '할 일 없음')
              : waitLine
                ? <>대기 · {waitLine}</>
                : '내 몫은 끝났습니다.'}
          </div>
        )}

        {/* 발송은 관리자만 — 서버 canSendChakhandealContract 와 같은 축. 영업자에게 보였다 403 나는 버튼을 없앤다. */}
        {c && agreementDone && !cancelled && role === 'admin' ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <ChakhandealEsignButton contractCode={String(c.contract_code)} onSent={() => load(selectionEpoch.current)} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* 히어로 — 코드·상태·진행률 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {c ? (
            <>
              <span style={{ fontSize: FS.title, fontWeight: FW.head, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', color: C.ink }}>{String(c.contract_code)}</span>
              <Badge tone={stage.tone}>{stage.label}</Badge>
            </>
          ) : (
            <span style={{ fontSize: FS.title, fontWeight: FW.title, color: C.ink }}>새 계약 — 출고문의로 시작</span>
          )}
          <span style={{ flex: 1, minWidth: 8 }} />
          {c && !cancelled && (role === 'admin' || (role === 'agent' && !isContractCompleted(c))) && (
            <Btn title="계약 취소" size="sm" variant="ghost" haptic="impact" onClick={doCancel} disabled={busy}>
              <ButtonLabel icon={<Ban size={ICON.md} aria-hidden />}>계약취소</ButtonLabel>
            </Btn>
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
          {(role === 'admin' || role === 'provider') && (
            <Btn title="완료 처리 재시도" size="sm" onClick={retryFinalize} disabled={busy}>
              <ButtonLabel icon={<RefreshCw size={ICON.md} aria-hidden />}>완료 처리 재시도</ButtonLabel>
            </Btn>
          )}
        </div>
      )}

      {STEPS.map((_, i) => {
        const s = STEPS[i];
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
            {s.checks.map((ch) => renderCheck(ch, stepUnlocked))}
          </ListGroup>
        );
      })}

      {c && agreementDone && !cancelled && (role === 'agent' || role === 'admin') ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
          <ChakhandealEsignButton contractCode={String(c.contract_code)} onSent={() => load(selectionEpoch.current)} />
        </div>
      ) : null}

      {c && <div style={{ borderTop: `1px solid ${C.line2}`, paddingTop: 9, marginTop: 8 }}><ContractMemos contractCode={String(c.contract_code)} /></div>}
    </div>
  );
}
