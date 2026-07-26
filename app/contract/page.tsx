'use client';
import { useEffect, useMemo, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { useIsMobile, isMobileViewport } from '@/lib/use-mobile';
import { type EntityRecord } from '@/lib/intake/entities';
import { getProgress, isContractInProgress } from '@/lib/domain/contract';
import { createSettlement } from '@/lib/domain/settlement-engine';
import { downloadSettlementsExcel } from '@/lib/excel-export';
import { Download } from 'lucide-react';
import { getRole, actor, ensureRoomForContract, type Role } from '@/lib/domain/deal';
import { getSession } from '@/lib/auth-session';
import { canAccessOwnedRecord } from '@/lib/domain/authorization';
import { man } from '@/lib/format';
import { PaneHead, PaneBody, Badge, Btn, Input, won, C, R, NUM, Loading, CenterNote, SETTLEMENT_STATUS_TONE, FilterChips, FilterGroup, Select, FW, FS } from '@/components/ui';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { ContractPanel } from '@/components/ContractPanel';
import { ContractDocs } from '@/components/ContractDocs';
import { haptic } from '@/lib/haptics';
import { ContractListRow } from '@/components/list-rows';
import { NAV_LABEL } from '@/lib/tabbar';
import { toast } from '@/components/Toaster';
import {
  CONTRACT_FILTER_OPTIONS as CONT_FILTERS,
  CONTRACT_SORT_OPTIONS as CONT_SORTS,
  contractMonthLabel as labelMonth,
  contractMonthOptions,
  contractPreviewCount,
  filterContracts,
  type ContractFilter as ContFilter,
  type ContractSort as ContSort,
} from '@/features/contract/contract-filter';
import { SettlementSummary } from '@/features/contract/SettlementSummary';

// 계약 = [목록 | 계약진행상황 | 첨부서류 | 정산상태] 4프레임.
// 진행상황은 문의(/chat) ContractPanel과 동일 SSOT. 발송·단계는 패널 안.

// R1/R2 금액 편집 원자 — blur 시 커밋. 실패하면 onCommit이 false/throw → draft를 val로 롤백.
function AmtInput({ val, onCommit }: { val: number; onCommit: (n: number) => Promise<boolean> | boolean }) {
  const [draft, setDraft] = useState(val ? val.toLocaleString() : '');
  useEffect(() => { setDraft(val ? val.toLocaleString() : ''); }, [val]);
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex' }}
      onBlur={() => {
        const n = Number(draft.replace(/[^\d]/g, '')) || 0;
        if (n === val) return;
        void (async () => {
          const ok = await onCommit(n);
          if (!ok) setDraft(val ? val.toLocaleString() : '');
        })();
      }}>
      <Input value={draft} onChange={setDraft} placeholder="0" inputMode="numeric" size="sm" full
        style={{ fontFamily: NUM, textAlign: 'right', background: C.warnBg }} />
    </div>
  );
}

export default function ContractsSettlement() {
  const co = getCompanyId();
  const mobile = useIsMobile();
  const [rows, setRows] = useState<EntityRecord[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [selC, setSelC] = useState<EntityRecord | null>(null);
  const [selS, setSelS] = useState<EntityRecord | null>(null);
  const [selProduct, setSelProduct] = useState<EntityRecord | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [setts, setSetts] = useState<EntityRecord[]>([]);
  const [role, setRoleS] = useState<Role>('agent');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<ContSort | ''>('');
  const [flt, setFlt] = useState<ContFilter>('진행');
  const [draftFlt, setDraftFlt] = useState<ContFilter>('진행');
  /** '' = 전체 월. contract_date YYYY-MM */
  const [monthFlt, setMonthFlt] = useState('');
  const [draftMonthFlt, setDraftMonthFlt] = useState('');
  /** 모바일 스왑 — 진행중=계약진행상황 · 계약완료=정산 */
  const [swapKey, setSwapKey] = useState('progress');

  const monthOptions = useMemo(() => contractMonthOptions(rows || []), [rows]);

  const load = async (r: Role): Promise<EntityRecord[]> => {
    setRoleS(r);
    const [all, allS] = await Promise.all([getStore().list('contract', co), getStore().list('settlement', co)]);
    const mine = all.filter((c) => canAccessOwnedRecord(getSession(), c));
    mine.sort((a, b) => String(b.contract_date || '').localeCompare(String(a.contract_date || '')));
    const mineS = allS.filter((s) => canAccessOwnedRecord(getSession(), s));
    setRows(mine); setSetts(mineS); return mine;
  };
  const selectContract = async (c: EntityRecord) => {
    setSel(String(c.contract_code)); setSelC(c);
    setSwapKey(String(c.contract_status || '') === '계약완료' ? 'settle' : 'progress');
    const [settsList, prod, room] = await Promise.all([
      getStore().list('settlement', co),
      getStore().get('product', co, String(c.product_code)),
      ensureRoomForContract(c),
    ]);
    let s = settsList.find((x) => String(x.contract_code) === String(c.contract_code)) || null;
    // lazy create = admin·소유 공급사만(영업자 채널 불일치 시 permission_denied로 pane abort 방지)
    if (!s && c.contract_status === '계약완료') {
      const r = getRole();
      const canCreate = r === 'admin'
        || (r === 'provider' && String(c.provider_company_code) === actor('provider').code);
      if (canCreate) {
        try {
          await createSettlement(c);
          const again = await getStore().list('settlement', co);
          s = again.find((x) => String(x.contract_code) === String(c.contract_code)) || null;
        } catch (e) {
          toast(`정산 생성 실패: ${String((e as Error)?.message || e)}`, 'error');
        }
      }
    }
    setSelS(s);
    setSelProduct(prod || null);
    setRoomId(room);
  };
  const clearSel = () => { setSel(null); setSelC(null); setSelS(null); setSelProduct(null); setRoomId(null); setSwapKey('progress'); };
  const reloadSel = async () => {
    if (!sel) return;
    const all = await load(getRole());
    const c = all.find((x) => String(x.contract_code) === sel);
    if (c) {
      setSelC(c);
      if (String(c.contract_status || '') === '계약완료') setSwapKey('settle');
      const settsList = await getStore().list('settlement', co);
      let s = settsList.find((x) => String(x.contract_code) === sel) || null;
      if (!s && c.contract_status === '계약완료') {
        const r = getRole();
        const canCreate = r === 'admin'
          || (r === 'provider' && String(c.provider_company_code) === actor('provider').code);
        if (canCreate) {
          try {
            await createSettlement(c);
            const again = await getStore().list('settlement', co);
            s = again.find((x) => String(x.contract_code) === sel) || null;
          } catch (e) {
            toast(`정산 생성 실패: ${String((e as Error)?.message || e)}`, 'error');
          }
        }
      }
      setSelS(s);
    }
  };

  useEffect(() => { (async () => {
    await seedIfEmpty(co); const all = await load(getRole());
    const wanted = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('c') : null;
    const first = all.find((c) => isContractInProgress(c)) || all[0];
    // 모바일은 '목록 먼저' — 첫 계약 자동선택은 웹만. mobile 첫 렌더 스테일 회피(isMobileViewport).
    const target = wanted ? all.find((x) => String(x.contract_code) === wanted) : (!isMobileViewport() ? first : undefined);
    if (target) selectContract(target);
  })(); /* eslint-disable-next-line */ }, []);
  useEffect(() => { const on = (e: Event) => { const r = (e as CustomEvent).detail as Role; (async () => { const all = await load(r); clearSel(); if (!mobile && all.length) selectContract(all.find((c) => isContractInProgress(c)) || all[0]); })(); }; window.addEventListener('fp:role', on); return () => window.removeEventListener('fp:role', on); /* eslint-disable-next-line */ }, [mobile]);

  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === '/contract') clearSel();
    };
    window.addEventListener('fp:work-list', on);
    return () => window.removeEventListener('fp:work-list', on);
  }, []);

  const shown = filterContracts({
    contracts: rows || [], query: q, filter: flt, month: monthFlt, sort,
  });
  const draftPreviewCount = contractPreviewCount({
    contracts: rows || [], query: q, filter: draftFlt, month: draftMonthFlt,
  });
  const filterActive = (flt !== '진행' ? 1 : 0) + (monthFlt ? 1 : 0);
  const uiFlt = mobile ? draftFlt : flt;
  const uiMonth = mobile ? draftMonthFlt : monthFlt;
  const listEl = shown.length === 0
    ? (
      <CenterNote>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <span>{q || filterActive > 0 ? '검색 결과 없음' : '진행·완료 계약이 없습니다.'}</span>
          {(q || filterActive > 0) ? (
            <Btn size="sm" variant="ghost" onClick={() => { setQ(''); setFlt('진행'); setMonthFlt(''); }}>조건 해제</Btn>
          ) : null}
        </div>
      </CenterNote>
    )
    : <div>{shown.map((c) => (
      <ContractListRow
        key={String(c.contract_code)}
        c={c}
        selected={String(c.contract_code) === sel}
        onClick={() => { haptic.tap(); selectContract(c); }}
      />
    ))}</div>;

  const kv = (k: string, v: React.ReactNode, strong?: boolean) => (
    <div style={{ display: 'flex', padding: '8px 14px', borderTop: `1px solid ${C.line2}`, fontSize: FS.sub }}>
      <span style={{ width: 110, flex: '0 0 110px', color: C.mute }}>{k}</span>
      <span style={{ fontWeight: strong ? FW.head : FW.strong, color: strong ? C.brand : C.ink, fontFamily: NUM }}>{v}</span>
    </div>
  );

  const setStatus = async (to: string) => {
    if (!selS || role !== 'admin') return;
    try {
      await getStore().update('settlement', co, String(selS.settlement_code), { settlement_status: to });
    } catch (e) {
      toast(`정산 상태 변경 실패: ${String((e as Error)?.message || e)}`, 'error');
      return;
    }
    const allS = await getStore().list('settlement', co);
    setSetts(allS.filter((s) => canAccessOwnedRecord(getSession(), s)));
    setSelS(allS.find((x) => String(x.settlement_code) === String(selS.settlement_code)) || null);
  };
  const setAmount = async (field: 'fee_amount' | 'agent_payout', value: number): Promise<boolean> => {
    if (!selS) return false;
    const fee = field === 'fee_amount' ? value : Number(selS.fee_amount) || 0;
    const payout = field === 'agent_payout' ? value : Number(selS.agent_payout) || 0;
    try {
      await getStore().update('settlement', co, String(selS.settlement_code), { [field]: value, net_amount: fee - payout });
    } catch (e) {
      toast(`정산 금액 저장 실패: ${String((e as Error)?.message || e)}`, 'error');
      return false;
    }
    const allS = await getStore().list('settlement', co);
    setSetts(allS.filter((s) => canAccessOwnedRecord(getSession(), s)));
    setSelS(allS.find((x) => String(x.settlement_code) === String(selS.settlement_code)) || null);
    return true;
  };
  const amtRow = (label: string, field: 'fee_amount' | 'agent_payout', val: number, code: string) => (
    <div style={{ display: 'flex', alignItems: 'center', padding: '7px 14px', borderTop: `1px solid ${C.line2}`, fontSize: FS.sub }}>
      <span style={{ width: 120, flex: '0 0 120px', color: C.mute }}>{label}</span>
      {role === 'admin'
        ? <AmtInput key={`${code}-${field}`} val={val} onCommit={(n) => setAmount(field, n)} />
        : <span style={{ fontWeight: FW.head, color: C.brand, fontFamily: NUM }}>{won(val)}원</span>}
    </div>
  );
  const detailSettle = () => {
    if (!selS) return <CenterNote>{selC?.contract_status === '계약완료' ? '정산 기록 없음' : '계약 완료 시 정산이 자동 생성됩니다.'}</CenterNote>;
    const s = selS; const st = String(s.settlement_status); const cb = Number(s.clawback_amount) || 0;
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px' }}>
          <span style={{ fontSize: FS.body, fontWeight: FW.title, fontFamily: NUM }}>{String(s.settlement_code)}</span>
          <Badge tone={SETTLEMENT_STATUS_TONE[st] || 'gray'}>{st}</Badge>
          <span style={{ flex: 1 }} />
          {role === 'admin' && st === '정산대기' && <Btn variant="ghost" size="sm" onClick={() => setStatus('정산보류')}>보류</Btn>}
          {role === 'admin' && st === '정산대기' && <Btn size="sm" onClick={() => setStatus('정산완료')}>정산 확정</Btn>}
          {role === 'admin' && st === '정산보류' && <Btn size="sm" onClick={() => setStatus('정산대기')}>대기로</Btn>}
          {role === 'admin' && st === '환수대기' && <Btn size="sm" onClick={() => setStatus('환수결정')}>환수 확정</Btn>}
        </div>
        <div style={{ margin: '0 14px', border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, overflow: 'hidden' }}>
          {role !== 'agent' && amtRow('공급사 청구 (R1)', 'fee_amount', Number(s.fee_amount) || 0, String(s.settlement_code))}
          {role !== 'provider' && amtRow('영업자 지급 (R2)', 'agent_payout', Number(s.agent_payout) || 0, String(s.settlement_code))}
          {role === 'admin' && kv('순수익 (R1−R2)', `${won((Number(s.fee_amount) || 0) - (Number(s.agent_payout) || 0))}원`, true)}
          {cb > 0 ? kv('환수액', `${won(cb)}원`) : null}
        </div>
        <div style={{ padding: '10px 14px', fontSize: FS.cap, color: C.faint, lineHeight: 1.6 }}>공급사에서 <b>받은 금액(R1)</b>·영업자에 <b>준 금액(R2)</b>을 실측 기록(관리자 편집, 율=기본값). 순수익=R1−R2. 중도취소 시 환수(경과비례).</div>
      </div>
    );
  };

  const progressBody = sel && roomId
    ? <ContractPanel
        product={selProduct}
        roomId={roomId}
        linkedCode={sel}
        agentCode={selC ? String(selC.agent_code || '') : undefined}
        onChange={reloadSel}
      />
    : <CenterNote>계약을 선택하세요.</CenterNote>;

  const docsBody = sel
    ? <ContractDocs contractCode={sel} roomId={roomId || undefined} />
    : <CenterNote>계약을 선택하세요.</CenterNote>;

  // 웹·모바일 공통 3패널(+목록 = 4프레임).
  // 모바일 스왑: 진행중→진행 · 계약완료→정산(하단 탭으로 서류·나머지 이동).
  const panes: WorkPane[] = [
    { key: 'progress', title: '진행', node: <><PaneHead title="계약 진행상황" /><PaneBody>{progressBody}</PaneBody></> },
    { key: 'docs', title: '서류', node: <><PaneHead title="첨부 서류" /><PaneBody>{docsBody}</PaneBody></> },
    { key: 'settle', title: '정산', node: <><PaneHead title="정산상태" /><PaneBody>{detailSettle()}</PaneBody></> },
  ];

  const summaryBar = <SettlementSummary settlements={setts} role={role} />;

  return (
    <>
      <WorkPage title={NAV_LABEL.contract || '계약'} statusLabel="계약진행중"
        statusCount={rows?.filter((c) => isContractInProgress(c)).length ?? 0}
        listCount={shown.length}
        list={rows === null ? <Loading /> : <>{summaryBar}{listEl}</>} panes={panes} selected={!!sel} onBack={clearSel}
        contextTitle={selC ? String(selC.customer_name || selC.vehicle_name || selC.car_number || selC.contract_code || '') : undefined}
        search={{ value: q, onChange: setQ, placeholder: '계약·차번·계약자·전화·영업·공급…' }}
        mobileLayout="swap"
        mobileSwapKey={swapKey}
        onMobileSwapKeyChange={setSwapKey}
        listTools={{
          search: { value: q, onChange: setQ, placeholder: '계약·차번·계약자·전화·영업…' },
          action: setts.length ? { label: '엑셀', icon: Download, onClick: () => downloadSettlementsExcel(setts, new Date().toISOString().slice(0, 10), role) } : undefined,
          sort: { value: sort, onChange: (v) => setSort(v as ContSort | ''), options: CONT_SORTS },
          filter: {
            count: filterActive,
            title: '조건 검색',
            previewCount: draftPreviewCount,
            previewUnit: '건',
            dirty: draftFlt !== flt || draftMonthFlt !== monthFlt,
            capture: () => { setDraftFlt(flt); setDraftMonthFlt(monthFlt); },
            restore: () => { setDraftFlt(flt); setDraftMonthFlt(monthFlt); },
            commit: () => { setFlt(draftFlt); setMonthFlt(draftMonthFlt); },
            onClear: () => {
              if (mobile) { setDraftFlt('진행'); setDraftMonthFlt(''); }
              else { setFlt('진행'); setMonthFlt(''); }
            },
            body: (
              <>
                <FilterGroup
                  title="계약월"
                  count={uiMonth ? 1 : 0}
                  defaultOpen
                  first={!mobile}
                  onClear={() => mobile ? setDraftMonthFlt('') : setMonthFlt('')}
                >
                  <div style={{ flex: '1 1 100%', width: '100%', minWidth: 0 }}>
                    <Select
                      full
                      value={uiMonth}
                      onChange={(v) => mobile ? setDraftMonthFlt(v) : setMonthFlt(v)}
                      placeholder="전체"
                      options={monthOptions}
                    />
                  </div>
                </FilterGroup>
                <FilterGroup
                  title="계약상태"
                  count={uiFlt === '진행' ? 0 : 1}
                  defaultOpen
                  onClear={() => mobile ? setDraftFlt('진행') : setFlt('진행')}
                >
                  <FilterChips value={uiFlt} onChange={mobile ? setDraftFlt : setFlt} options={CONT_FILTERS} />
                </FilterGroup>
              </>
            ),
          },
          hints: [
            ...(q.trim() ? [q.trim().length > 12 ? `${q.trim().slice(0, 12)}…` : q.trim()] : []),
            ...(sort ? [CONT_SORTS.find((o) => o.value === sort)?.label || sort] : []),
            ...(monthFlt ? [labelMonth(monthFlt)] : []),
            ...(flt !== '진행' ? [flt === 'all' ? '전체' : flt] : []),
          ],
          onClearHints: () => { setQ(''); setSort(''); setFlt('진행'); setMonthFlt(''); },
        }}
      />
    </>
  );
}
