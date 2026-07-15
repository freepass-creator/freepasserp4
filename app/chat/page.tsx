'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { useIsMobile } from '@/lib/use-mobile';
import { type EntityRecord } from '@/lib/intake/entities';
import { getRole, actor, type Role } from '@/lib/domain/deal';
import { PaneHead, C } from '@/components/ui';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { ChatThread } from '@/components/ChatThread';
import { ProductDetail } from '@/components/ProductDetail';
import { ContractPanel } from '@/components/ContractPanel';

// 소통 = [대화 목록 | 채팅 | 상품상세 | 계약요청]. 계약은 요청까지만(진행은 계약 페이지). 역할=세션 고정.
export default function Chat() {
  const router = useRouter();
  const co = getCompanyId();
  const mobile = useIsMobile();
  const [role, setRoleS] = useState<Role>('agent');
  const [rooms, setRooms] = useState<EntityRecord[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [selRoom, setSelRoom] = useState<EntityRecord | null>(null);
  const [selProduct, setSelProduct] = useState<EntityRecord | null>(null);
  const [q, setQ] = useState('');

  const load = async (r: Role): Promise<EntityRecord[]> => {
    const all = await getStore().list('room', co);
    const me = actor(r);
    const mine = r === 'admin' ? all : r === 'provider' ? all.filter((x) => String(x.provider_company_code) === me.code) : all.filter((x) => String(x.agent_code) === me.code);
    const sorted = mine.sort((a, b) => Number(b.last_message_at || 0) - Number(a.last_message_at || 0));
    setRooms(sorted);
    return sorted;
  };
  const selectRoom = async (rm: EntityRecord) => { setSel(String(rm._key)); setSelRoom(rm); setSelProduct(await getStore().get('product', co, String(rm.product_code))); };
  const clearSel = () => { setSel(null); setSelRoom(null); setSelProduct(null); };
  useEffect(() => { (async () => {
    await seedIfEmpty(co); const r = getRole(); setRoleS(r); const s = await load(r);
    const wanted = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('room') : null;
    const target = wanted ? s.find((x) => String(x._key) === wanted) : (!mobile ? s[0] : undefined);
    if (target) selectRoom(target);
  })(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { const on = (e: Event) => { const r = (e as CustomEvent).detail as Role; setRoleS(r); (async () => { const s = await load(r); clearSel(); if (!mobile && s.length) selectRoom(s[0]); })(); }; window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); /* eslint-disable-next-line */ }, [mobile]);

  const shownRooms = (rooms || []).filter((rm) => !q || [rm.vehicle_name, rm.car_number, rm.provider_company_code, rm.agent_name, rm.last_message].join(' ').toLowerCase().includes(q.toLowerCase()));
  const roomListEl = shownRooms.length === 0
    ? <div style={{ padding: 24, textAlign: 'center', color: C.faint, fontSize: 12.5 }}>{q ? '검색 결과 없음' : role === 'provider' ? '들어온 문의가 없습니다.' : role === 'admin' ? '진행 중인 대화가 없습니다.' : '문의한 매물이 없습니다.'}</div>
    : <div>{shownRooms.map((rm) => {
        const on = String(rm._key) === sel;
        const counter = role === 'provider' ? `영업자 ${rm.agent_name}` : role === 'agent' ? `공급사 ${rm.provider_company_code}` : `${rm.agent_name} ↔ ${rm.provider_company_code}`;
        const unread = role === 'agent' ? Number(rm.unread_for_agent) || 0 : role === 'provider' ? Number(rm.unread_for_provider) || 0 : 0;
        return (
          <div key={String(rm._key)} onClick={() => selectRoom(rm)} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '11px 14px', borderBottom: `1px solid ${C.line2}`, cursor: 'pointer', background: on ? '#eef4ff' : 'transparent' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(rm.vehicle_name || '매물')}</span>
                <span style={{ fontSize: 10.5, color: C.faint, flex: '0 0 auto', fontFamily: 'var(--font-mono)' }}>{String(rm.car_number || '')}</span>
              </div>
              <div style={{ fontSize: 11.5, color: C.mute, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(rm.last_message || '대화를 시작하세요')}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flex: '0 0 auto' }}>
              {unread > 0 && <span style={{ minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: C.brand, color: '#fff', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box' }}>{unread}</span>}
              <span style={{ fontSize: 10, color: C.faint }}>{counter}</span>
            </div>
          </div>
        );
      })}</div>;

  const emptyPane = (t: string, msg: string) => <><PaneHead title={t} /><div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.faint, fontSize: 13, padding: 20, textAlign: 'center' }}>{msg}</div></>;
  const panes: WorkPane[] = [
    { key: 'chat', title: '채팅', node: sel ? <ChatThread roomId={sel} /> : emptyPane('채팅', '왼쪽에서 대화를 선택하세요.') },
    { key: 'product', title: '상품보기', node: <><PaneHead title="문의 차량" /><div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '12px 14px' }}>{selProduct ? <ProductDetail p={selProduct} /> : <div style={{ color: C.faint, fontSize: 12.5 }}>—</div>}</div></> },
    { key: 'contract', title: '계약', node: <><PaneHead title="계약" /><div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>{sel ? <ContractPanel product={selProduct} roomId={sel} linkedCode={selRoom?.linked_contract ? String(selRoom.linked_contract) : undefined} variant="request" onOpenContract={(code) => router.push(`/contract?c=${encodeURIComponent(code)}`)} /> : <div style={{ padding: 16, color: C.faint, fontSize: 12.5 }}>—</div>}</div></> },
  ];

  return <WorkPage title="소통" listCount={rooms ? rooms.length : ''} list={rooms === null ? <div style={{ padding: 24, color: C.faint }}>불러오는 중…</div> : roomListEl} panes={panes} selected={!!sel} onBack={clearSel}
    search={{ value: q, onChange: setQ, placeholder: '차량·차번·공급사·영업자' }} />;
}
