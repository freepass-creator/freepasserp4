'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { useIsMobile } from '@/lib/use-mobile';
import { type EntityRecord } from '@/lib/intake/entities';
import { getProgress, contractTone } from '@/lib/domain/contract';
import { ensureRoomForContract, getRole, actor, type Role } from '@/lib/domain/deal';
import { PaneHead, Badge, C } from '@/components/ui';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { ChatThread } from '@/components/ChatThread';
import { ContractPanel } from '@/components/ContractPanel';
import { ContractDocs } from '@/components/ContractDocs';

// 계약 = [계약 목록 | 채팅 | 계약진행 5단계 + 서류]. 상품상세 없음. 그 계약의 방을 이어서 대화.
export default function Contracts() {
  const co = getCompanyId();
  const mobile = useIsMobile();
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [roomKey, setRoomKey] = useState<string | null>(null);
  const [product, setProduct] = useState<EntityRecord | null>(null);
  const [q, setQ] = useState('');

  // 역할별 자기 것만: 공급사=내 매물 계약 · 영업자=내 계약 · 관리자=전부. 공급사는 여기서 5단계 자기 쪽 응답(크로스체크).
  const load = async (r: Role): Promise<EntityRecord[]> => {
    const all = await getStore().list('contract', co);
    const me = actor(r);
    const mine = r === 'admin' ? all : r === 'provider' ? all.filter((c) => String(c.provider_company_code) === me.code) : all.filter((c) => String(c.agent_code) === me.code);
    setRows(mine); return mine;
  };
  const selectContract = async (c: EntityRecord) => {
    setSel(String(c.contract_code));
    setProduct(await getStore().get('product', co, String(c.product_code)));
    setRoomKey(await ensureRoomForContract(c));
  };
  const clearSel = () => { setSel(null); setRoomKey(null); setProduct(null); };
  useEffect(() => { (async () => {
    await seedIfEmpty(co); const all = await load(getRole());
    const wanted = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('c') : null;
    const target = wanted ? all.find((x) => String(x.contract_code) === wanted) : (!mobile ? all[0] : undefined);
    if (target) selectContract(target);
  })(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { const on = (e: Event) => { const r = (e as CustomEvent).detail as Role; (async () => { const all = await load(r); clearSel(); if (!mobile && all.length) selectContract(all[0]); })(); }; window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); /* eslint-disable-next-line */ }, [mobile]);

  const shown = (rows || []).filter((c) => !q || [c.contract_code, c.customer_name, c.car_number_snapshot, c.sub_model_snapshot, c.contract_status].join(' ').toLowerCase().includes(q.toLowerCase()));
  const listEl = shown.length === 0
    ? <div style={{ padding: 24, textAlign: 'center', color: C.faint, fontSize: 12.5 }}>{q ? '검색 결과 없음' : '계약 없음'}</div>
    : <div>{shown.map((c) => {
        const on = String(c.contract_code) === sel; const pr = getProgress(c);
        return (
          <div key={String(c.contract_code)} onClick={() => selectContract(c)} style={{ padding: '11px 14px', borderBottom: `1px solid ${C.line2}`, cursor: 'pointer', background: on ? '#eef4ff' : 'transparent' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 12, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{String(c.contract_code)}</span>
              <Badge tone={contractTone(String(c.contract_status))}>{String(c.contract_status)}</Badge>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, fontWeight: 800, color: C.brand }}>{pr.done}/{pr.total}</span>
            </div>
            <div style={{ fontSize: 11.5, color: C.mute, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[c.customer_name, c.car_number_snapshot, c.sub_model_snapshot].filter(Boolean).join(' · ')}</div>
          </div>
        );
      })}</div>;

  const emptyPane = (t: string, msg: string) => <><PaneHead title={t} /><div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.faint, fontSize: 13, padding: 20, textAlign: 'center' }}>{msg}</div></>;
  const panes: WorkPane[] = [
    { key: 'chat', title: '채팅', node: roomKey ? <ChatThread roomId={roomKey} /> : emptyPane('채팅', '계약을 선택하세요.') },
    { key: 'progress', title: '계약 진행', node: <><PaneHead title="계약 진행" /><div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>{sel ? <ContractPanel product={product} roomId={roomKey || sel} linkedCode={sel} variant="progress" /> : <div style={{ padding: 16, color: C.faint, fontSize: 12.5 }}>계약을 선택하세요.</div>}</div></> },
    { key: 'docs', title: '첨부 서류', node: <><PaneHead title="첨부 서류" /><div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>{sel ? <ContractDocs contractCode={sel} /> : <div style={{ padding: 16, color: C.faint, fontSize: 12.5 }}>계약을 선택하세요.</div>}</div></> },
  ];

  return <WorkPage title="계약" listCount={rows ? rows.length : ''} list={rows === null ? <div style={{ padding: 24, color: C.faint }}>불러오는 중…</div> : listEl} panes={panes} selected={!!sel} onBack={clearSel}
    search={{ value: q, onChange: setQ, placeholder: '계약코드·계약자·차번·상태' }} />;
}
