'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type EntityRecord } from '@/lib/intake/entities';
import { STEPS, getProgress, contractTone } from '@/lib/domain/contract';
import { applyStepCheck } from '@/lib/domain/settlement-engine';
import { getRole, type Role } from '@/lib/domain/deal';
import { Btn, Badge, C } from '@/components/ui';
import { ContractRequestForm } from '@/components/ContractRequestForm';

// 계약 패널 = 소통 4단의 우측. 연결계약 없으면 [계약 요청], 있으면 5단계 핸드셰이크 진행(역할별 체크).
const DONE_VALS = ['가능', '승인', '출고 가능', '출고 협의'];
const isDone = (v: unknown) => v === true || v === 'yes' || (typeof v === 'string' && DONE_VALS.includes(v));

export function ContractPanel({ product, roomId, linkedCode, onOpenContract, variant = 'progress' }: { product: EntityRecord | null; roomId: string; linkedCode?: string; onOpenContract?: (code: string) => void; variant?: 'request' | 'progress' }) {
  const co = getCompanyId();
  const [contract, setContract] = useState<EntityRecord | null | undefined>(undefined);
  const [room, setRoom] = useState<EntityRecord | null>(null);
  const [modal, setModal] = useState(false);
  const [role, setRoleS] = useState<Role>('agent');

  const load = async () => {
    const all = await getStore().list('contract', co);
    let c: EntityRecord | undefined;
    if (linkedCode) c = all.find((x) => x.contract_code === linkedCode);
    if (!c && product) c = all.find((x) => x.product_code === product.product_code && x.contract_status !== '계약취소');
    setContract(c || null);
    setRoom(roomId ? await getStore().get('room', co, roomId) : null);
  };
  const setInquiry = async (patch: EntityRecord) => { await getStore().update('room', co, roomId, patch); await load(); };
  useEffect(() => { setRoleS(getRole()); load(); /* eslint-disable-next-line */ }, [roomId, product?.product_code, linkedCode]);
  useEffect(() => { const on = (e: Event) => setRoleS((e as CustomEvent).detail as Role); window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); }, []);

  const setCheck = async (key: string, value: string) => {
    if (!contract) return;
    await applyStepCheck(contract, key, value); // 단일 writer → 완료 시 계약완료·출고불가·정산 자동
    await load();
  };

  if (contract === undefined) return <div style={{ padding: 20, color: C.faint, fontSize: 12.5 }}>불러오는 중…</div>;

  if (!contract) {
    if (variant === 'progress') return <div style={{ padding: 16, color: C.faint, fontSize: 12.5 }}>계약을 선택하세요.</div>;
    // 소통(request): 출고 문의 → 공급사 응답 → (가능/협의) 계약 요청 순서
    const inqAgent = String(room?.inquiry_agent || '') === 'yes';
    const resp = String(room?.inquiry_response || '');
    const respOk = resp === '출고 가능' || resp === '출고 협의';
    const respReject = resp === '출고 불가';
    const RESP = ['출고 가능', '출고 협의', '출고 불가'];
    const chip = (on: boolean): CSSProperties => ({ height: 24, padding: '0 9px', fontSize: 11, borderRadius: 4, border: `1px solid ${on ? C.brand : C.line}`, background: on ? C.brand : '#fff', color: on ? '#fff' : C.mute, cursor: 'pointer' });
    return (
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 4, padding: '9px 11px' }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: C.ink, marginBottom: 7 }}>1. 출고 문의</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#1d4ed8', width: 26, flex: '0 0 26px' }}>영업</span>
            <span style={{ fontSize: 11.5, color: C.ink, flex: 1 }}>출고 문의</span>
            {inqAgent ? <span style={{ fontSize: 11, color: C.ok, fontWeight: 700 }}>문의함 ✓</span>
              : (role === 'agent' || role === 'admin') ? <Btn size="sm" onClick={() => setInquiry({ inquiry_agent: 'yes' })}>출고 문의하기</Btn>
                : <span style={{ fontSize: 11, color: C.faint }}>대기</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#15803d', width: 26, flex: '0 0 26px' }}>공급</span>
            <span style={{ fontSize: 11.5, color: C.ink }}>출고 응답</span>
            <span style={{ flex: 1 }} />
            {!inqAgent ? <span style={{ fontSize: 11, color: C.faint }}>문의 대기</span>
              : (role === 'provider' || role === 'admin') ? RESP.map((r) => <button key={r} onClick={() => setInquiry({ inquiry_response: resp === r ? '' : r })} style={chip(resp === r)}>{r}</button>)
                : resp ? <span style={{ fontSize: 11, fontWeight: 700, color: respReject ? C.danger : C.ok }}>{resp}</span>
                  : <span style={{ fontSize: 11, color: C.faint }}>응답 대기</span>}
          </div>
        </div>
        {respReject ? <div style={{ fontSize: 12.5, color: C.danger, padding: '4px 2px' }}>출고 불가 — 계약을 진행할 수 없습니다.</div>
          : respOk ? (
            !modal ? <div><div style={{ fontSize: 11.5, color: C.faint, marginBottom: 8 }}>출고 {resp === '출고 협의' ? '협의' : '가능'} — 계약을 요청하세요.</div><Btn onClick={() => setModal(true)} disabled={!product}>계약 요청</Btn></div>
              : product ? <ContractRequestForm p={product} roomId={roomId} deliveryResponse={resp} onDone={() => { setModal(false); load(); }} onCancel={() => setModal(false)} /> : null
          ) : <div style={{ fontSize: 11.5, color: C.faint, padding: '4px 2px' }}>공급사 출고 응답을 기다리는 중입니다.</div>}
      </div>
    );
  }

  const pr = getProgress(contract);
  // 소통(request) = 요청됨 요약 + 계약 페이지 이동만. 진행 편집은 계약 페이지(progress)에서.
  if (variant === 'request') {
    return (
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{String(contract.contract_code)}</span>
          <Badge tone={contractTone(String(contract.contract_status))}>{String(contract.contract_status)}</Badge>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, fontWeight: 800, color: C.brand }}>{pr.done}/{pr.total}</span>
        </div>
        <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.6 }}>계약이 요청되었습니다.<br />진행·서류 첨부는 계약 페이지에서 이어집니다.</div>
        {onOpenContract && <Btn onClick={() => onOpenContract(String(contract.contract_code))}>계약 페이지 열기</Btn>}
      </div>
    );
  }
  // 순차 잠금: 현재 진행 단계(frontier)만 편집. 완료·미래 단계는 잠김(관리자만 되돌리기). 거절(불가/부결)이면 그 단계에 멈춤.
  const stepDoneArr = STEPS.map((s) => s.checks.every((ch) => isDone(contract[ch.key])));
  const activeIdx = stepDoneArr.findIndex((d) => !d); // 현재 단계(-1 = 전부 완료)
  return (
    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{String(contract.contract_code)}</span>
        <Badge tone={contractTone(String(contract.contract_status))}>{String(contract.contract_status)}</Badge>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, fontWeight: 800, color: C.brand }}>{pr.done}/{pr.total}</span>
        {onOpenContract && <Btn variant="ghost" size="sm" onClick={() => onOpenContract(String(contract.contract_code))}>계약 페이지</Btn>}
      </div>
      {STEPS.map((s, i) => {
        const stepDone = stepDoneArr[i];
        const active = i === activeIdx;
        const locked = !stepDone && !active;               // 미래 단계 = 잠김
        const stepUnlocked = role === 'admin' || active;   // 관리자 아니면 현재 단계만
        return (
          <div key={s.id} style={{ border: `1px solid ${active ? C.brand : C.line}`, borderRadius: 4, padding: '8px 10px', background: stepDone ? '#f0fdf4' : active ? '#f8fbff' : '#fff', opacity: locked ? 0.55 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: stepDone ? C.ok : C.ink }}>{i + 1}. {s.label}</span>
              {stepDone ? <span style={{ fontSize: 10, color: C.ok, fontWeight: 800 }}>완료</span> : active ? <span style={{ fontSize: 10, color: C.brand, fontWeight: 800 }}>진행 중</span> : <span style={{ fontSize: 10, color: C.faint }}>잠김</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {s.checks.map((ch) => {
                const cur = contract[ch.key];
                const done = isDone(cur);
                const mine = (ch.actor === role || role === 'admin') && stepUnlocked;
                return (
                  <div key={ch.key} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: ch.actor === 'agent' ? '#1d4ed8' : '#15803d', width: 26, flex: '0 0 26px' }}>{ch.actor === 'agent' ? '영업' : '공급'}</span>
                    <span style={{ fontSize: 11.5, color: C.ink }}>{ch.label}</span>
                    <span style={{ flex: 1 }} />
                    {ch.choices ? ch.choices.map((opt) => (
                      <button key={opt} disabled={!mine} onClick={() => setCheck(ch.key, cur === opt ? '' : opt)}
                        style={{ height: 22, padding: '0 8px', fontSize: 10.5, borderRadius: 3, cursor: mine ? 'pointer' : 'default', border: `1px solid ${cur === opt ? C.brand : C.line}`, background: cur === opt ? C.brand : '#fff', color: cur === opt ? '#fff' : C.mute, opacity: mine ? 1 : 0.55 }}>{opt}</button>
                    )) : (
                      <button disabled={!mine} onClick={() => setCheck(ch.key, done ? '' : 'yes')}
                        style={{ height: 22, padding: '0 10px', fontSize: 10.5, borderRadius: 3, cursor: mine ? 'pointer' : 'default', border: `1px solid ${done ? C.brand : C.line}`, background: done ? C.brand : '#fff', color: done ? '#fff' : C.mute, opacity: mine ? 1 : 0.55 }}>{done ? '완료' : mine ? '체크' : '대기'}</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
