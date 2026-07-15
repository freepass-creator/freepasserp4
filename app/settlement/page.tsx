'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { useIsMobile } from '@/lib/use-mobile';
import { type EntityRecord } from '@/lib/intake/entities';
import { createSettlement } from '@/lib/domain/settlement-engine';
import { getRole, actor } from '@/lib/domain/deal';
import { PaneHead, Badge, Btn, won, C } from '@/components/ui';
import { WorkPage, type WorkPane } from '@/components/WorkPage';

// 정산 = 수수료정산. [정산 목록 | 정산 상세]. 계약완료 시 정산 자동생성(누락분 로드 시 복구).
// 프리패스 마진 숨김 — 공급사 청구 + 영업자 지급 두 금액만. 중도취소 시 환수(경과비례).
const ST_TONE: Record<string, 'gray' | 'green' | 'amber' | 'red'> = { '정산대기': 'amber', '정산완료': 'green', '정산보류': 'gray', '환수대기': 'red', '환수결정': 'red' };

export default function Settlements() {
  const co = getCompanyId();
  const mobile = useIsMobile();
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [selS, setSelS] = useState<EntityRecord | null>(null);
  const [q, setQ] = useState('');

  const load = async (): Promise<EntityRecord[]> => {
    const contracts = await getStore().list('contract', co);
    const done = contracts.filter((c) => c.contract_status === '계약완료');
    let setts = await getStore().list('settlement', co);
    const have = new Set(setts.map((s) => String(s.settlement_code)));
    const missing = done.filter((c) => !have.has(`ST_${c.contract_code}`));
    if (missing.length) { for (const c of missing) await createSettlement(c); setts = await getStore().list('settlement', co); }
    // 역할별 자기 것만: 공급사=내 정산·영업자=내 정산·관리자=전부(관장)
    const r = getRole();
    if (r !== 'admin') { const me = actor(r); setts = setts.filter((s) => r === 'provider' ? String(s.provider_company_code) === me.code : String(s.agent_code) === me.code); }
    setts.sort((a, b) => String(b.contract_date || '').localeCompare(String(a.contract_date || '')));
    setRows(setts); return setts;
  };
  const selectS = (s: EntityRecord) => { setSel(String(s.settlement_code)); setSelS(s); };
  const clearSel = () => { setSel(null); setSelS(null); };
  useEffect(() => { (async () => { await seedIfEmpty(co); const l = await load(); if (!mobile && l.length) selectS(l[0]); })(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { const on = () => { (async () => { const l = await load(); clearSel(); if (!mobile && l.length) selectS(l[0]); })(); }; window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); /* eslint-disable-next-line */ }, [mobile]);

  const setStatus = async (to: string) => {
    if (!selS) return;
    await getStore().update('settlement', co, String(selS.settlement_code), { settlement_status: to });
    const l = await load(); const s = l.find((x) => String(x.settlement_code) === sel); if (s) setSelS(s);
  };

  const shown = (rows || []).filter((s) => !q || [s.settlement_code, s.customer_name, s.car_number, s.sub_model_snapshot, s.settlement_status].join(' ').toLowerCase().includes(q.toLowerCase()));
  const listEl = shown.length === 0
    ? <div style={{ padding: 24, textAlign: 'center', color: C.faint, fontSize: 12.5 }}>{q ? '검색 결과 없음' : '정산 없음 · 계약 출고완료 시 자동 생성'}</div>
    : <div>{shown.map((s) => {
        const on = String(s.settlement_code) === sel;
        return (
          <div key={String(s.settlement_code)} onClick={() => selectS(s)} style={{ padding: '11px 14px', borderBottom: `1px solid ${C.line2}`, cursor: 'pointer', background: on ? '#eef4ff' : 'transparent' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: 12, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{String(s.settlement_code)}</span>
              <Badge tone={ST_TONE[String(s.settlement_status)] || 'gray'}>{String(s.settlement_status)}</Badge>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: C.brand, fontFamily: 'var(--font-mono)' }}>{won(s.fee_amount)}</span>
            </div>
            <div style={{ fontSize: 11.5, color: C.mute, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[s.customer_name, s.car_number, s.sub_model_snapshot].filter(Boolean).join(' · ')}</div>
          </div>
        );
      })}</div>;

  const detail = () => {
    if (!selS) return <div style={{ padding: 16, color: C.faint, fontSize: 12.5 }}>정산을 선택하세요.</div>;
    const st = String(selS.settlement_status);
    const cb = Number(selS.clawback_amount) || 0;
    const row = (k: string, v: ReactNode, strong?: boolean) => (
      <div style={{ display: 'flex', padding: '8px 14px', borderTop: `1px solid ${C.line2}`, fontSize: 12.5 }}>
        <span style={{ width: 120, flex: '0 0 120px', color: C.mute }}>{k}</span>
        <span style={{ fontWeight: strong ? 800 : 600, color: strong ? C.brand : C.ink, fontFamily: 'var(--font-mono)' }}>{v}</span>
      </div>
    );
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px' }}>
          <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{String(selS.settlement_code)}</span>
          <Badge tone={ST_TONE[st] || 'gray'}>{st}</Badge>
          <span style={{ flex: 1 }} />
          {st === '정산대기' && <Btn size="sm" onClick={() => setStatus('정산완료')}>정산 확정</Btn>}
          {st === '환수대기' && <Btn size="sm" onClick={() => setStatus('환수결정')}>환수 확정</Btn>}
        </div>
        <div style={{ margin: '0 14px', border: `1px solid ${C.line}`, borderRadius: 4, background: '#fff', overflow: 'hidden' }}>
          {row('계약', String(selS.contract_code || '—'))}
          {row('계약자', String(selS.customer_name || '—'))}
          {row('차량', [selS.car_number, selS.sub_model_snapshot].filter(Boolean).join(' · ') || '—')}
          {row('공급사 청구', `${won(selS.fee_amount)}원`, true)}
          {row('영업자 지급', `${won(selS.agent_payout)}원`, true)}
          {cb > 0 ? row('환수액', `${won(cb)}원`) : null}
        </div>
        <div style={{ padding: '10px 14px', fontSize: 11.5, color: C.faint, lineHeight: 1.6 }}>
          정산대기 → 정산 확정 → 지급. 중도취소 시 환수대기(경과비례) → 환수 확정. 공급사 청구 = 대여료 × 공급사율(신차 0%), 영업자 지급 = 대여료 × 영업자율.
        </div>
      </div>
    );
  };

  const panes: WorkPane[] = [{ key: 'detail', title: '정산', node: <><PaneHead title="정산 상세" /><div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>{detail()}</div></> }];
  return <WorkPage title="정산" listCount={rows ? rows.length : ''} list={rows === null ? <div style={{ padding: 24, color: C.faint }}>불러오는 중…</div> : listEl} panes={panes} selected={!!sel} onBack={clearSel}
    search={{ value: q, onChange: setQ, placeholder: '정산코드·계약자·차번·상태' }} />;
}
