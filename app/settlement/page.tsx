'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { seedIfEmpty } from '@/lib/seed';
import { SETTLEMENT_STATES, type EntityRecord } from '@/lib/intake/entities';
import { isAdminUiAllowed } from '@/lib/auth-gate';
import { parseSettlementHistory } from '@/lib/domain/settlement-import';
import { downloadSettlementReport } from '@/lib/excel-export';
import {
  Badge, Btn, C, CenterNote, DetailRow, DetailShell, FilterChips, FilterGroup,
  FS, FW, IconBtn, ListGroup, Loading, MetricRow, NUM, PaneBody, PaneHead, R, Select,
  SETTLEMENT_STATUS_TONE, won,
} from '@/components/ui';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { SettlementListRow } from '@/components/list-rows';
import { toast } from '@/components/Toaster';
import { AdminSettlementSheet } from '@/components/AdminSettlementSheet';
import { matchSettlementQuery } from '@/lib/domain/search';
import { NAV_LABEL } from '@/lib/tabbar';
import { Banknote, ChartNoAxesCombined, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { useIsMobile } from '@/lib/use-mobile';
import { retainVisibleSelection } from '@/features/work-list-display';

type SettlementSort = '' | 'date_desc' | 'customer' | 'amount_desc' | 'status';
type SettlementGroup = 'provider' | 'channel';

const monthOf = (settlement: EntityRecord) => String(settlement.contract_date || '').slice(0, 7);
const numberOf = (value: unknown) => Number(value) || 0;
const netProfitOf = (list: EntityRecord[]) => list.reduce(
  (sum, settlement) => String(settlement.settlement_status) === '정산완료'
    ? sum + numberOf(settlement.net_amount)
    : sum,
  0,
);
const rateLabel = (value: unknown) => {
  const rate = Number(value);
  if (!Number.isFinite(rate)) return '—';
  return `${Math.round(rate * 10000) / 100}%`;
};

function MoneyCard({
  label, value, tone = C.ink,
}: {
  label: string;
  value: unknown;
  tone?: string;
}) {
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, padding: '9px 11px', minWidth: 0 }}>
      <div style={{ fontSize: FS.cap, color: C.mute, fontWeight: FW.strong }}>{label}</div>
      <div style={{
        marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontSize: FS.title, fontWeight: FW.head, color: tone, fontFamily: NUM, fontVariantNumeric: 'tabular-nums',
      }}>{won(value)}</div>
    </div>
  );
}

export default function MonthlySettlement() {
  const co = getCompanyId();
  const router = useRouter();
  const mobile = useIsMobile();
  const [ok, setOk] = useState<boolean | null>(null);
  const [rows, setRows] = useState<EntityRecord[]>([]);
  const [month, setMonth] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [queryInput, setQueryInput] = useState(''); // 검색창 즉시 반영
  const [query, setQuery] = useState(''); // 디바운스된 검색(정렬·그룹 재계산)
  const [sort, setSort] = useState<SettlementSort>('');
  const [status, setStatus] = useState('all');
  const [group, setGroup] = useState<SettlementGroup>('provider');
  const [showVatSheet, setShowVatSheet] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 검색 디바운스 — 타이핑마다 정렬·그룹 전량 재계산 방지(파인더 180ms와 동일)
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput), 180);
    return () => clearTimeout(t);
  }, [queryInput]);

  useEffect(() => {
    (async () => {
      await seedIfEmpty(co);
      if (!isAdminUiAllowed()) {
        router.replace('/contract');
        return;
      }
      const all = await getStore().list('settlement', co);
      setRows(all);
      const availableMonths = [...new Set(all.map(monthOf).filter(Boolean))].sort();
      setMonth(availableMonths.at(-1) || new Date().toISOString().slice(0, 7));
      setOk(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const importXlsx = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const XLSX = await import('xlsx');
      const buffer = await files[0].arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
      const sheets = workbook.SheetNames.map((name) => ({
        name,
        aoa: XLSX.utils.sheet_to_json(workbook.Sheets[name], {
          header: 1, raw: true, defval: null,
        }) as unknown[][],
      }));
      const { records } = parseSettlementHistory(sheets);
      if (!records.length) {
        toast('정산 데이터를 찾지 못했습니다 (계약현황 형식 확인)', 'error');
        return;
      }
      const result = await getStore().save('settlement', co, records);
      const all = await getStore().list('settlement', co);
      setRows(all);
      const availableMonths = [...new Set(all.map(monthOf).filter(Boolean))].sort();
      setMonth(availableMonths.at(-1) || month);
      setSelectedKey(null);
      toast(`정산 이력 ${result.saved}건 반영${result.duplicates ? ` · 기존 ${result.duplicates} 유지` : ''}`, 'ok');
    } catch (error) {
      toast(`가져오기 실패: ${String(error)}`, 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const months = useMemo(() => {
    const values = new Set(rows.map(monthOf).filter(Boolean));
    values.add(new Date().toISOString().slice(0, 7));
    return [...values].sort();
  }, [rows]);

  const monthRows = useMemo(
    () => rows.filter((settlement) => monthOf(settlement) === month),
    [rows, month],
  );

  const shown = useMemo(() => {
    const filtered = monthRows.filter((settlement) => (
      (status === 'all' || String(settlement.settlement_status) === status)
      && matchSettlementQuery(settlement, query)
    ));
    return [...filtered].sort((left, right) => {
      if (sort === 'customer') {
        return String(left.customer_name || '').localeCompare(String(right.customer_name || ''), 'ko');
      }
      if (sort === 'amount_desc') return numberOf(right.net_amount) - numberOf(left.net_amount);
      if (sort === 'status') {
        return String(left.settlement_status || '').localeCompare(String(right.settlement_status || ''), 'ko');
      }
      if (sort === 'date_desc') {
        return String(right.contract_date || '').localeCompare(String(left.contract_date || ''));
      }
      return String(left.settlement_code || '').localeCompare(String(right.settlement_code || ''), 'ko');
    });
  }, [monthRows, query, sort, status]);

  // 검색·상태 필터에서 사라진 행의 상세를 계속 보여주지 않는다.
  useEffect(() => {
    if (!selectedKey) return;
    const visible = shown.map((settlement) => String(settlement._key || settlement.settlement_code));
    if (retainVisibleSelection(selectedKey, visible) === selectedKey) return;
    setSelectedKey(null);
  }, [shown, selectedKey]);

  const selected = selectedKey
    ? monthRows.find((settlement) => String(settlement._key || settlement.settlement_code) === selectedKey) || null
    : null;

  const totals = useMemo(() => ({
    rent: monthRows.reduce((sum, settlement) => sum + numberOf(settlement.rent_amount), 0),
    r1: monthRows.reduce((sum, settlement) => sum + numberOf(settlement.fee_amount), 0),
    r2: monthRows.reduce((sum, settlement) => sum + numberOf(settlement.agent_payout), 0),
    net: netProfitOf(monthRows),
    clawback: monthRows.reduce((sum, settlement) => sum + numberOf(settlement.clawback_amount), 0),
  }), [monthRows]);

  const grouped = useMemo(() => {
    const field = group === 'provider' ? 'provider_company_code' : 'agent_channel_code';
    const buckets = new Map<string, EntityRecord[]>();
    for (const settlement of monthRows) {
      const name = String(settlement[field] || '(미지정)');
      const bucket = buckets.get(name);
      if (bucket) bucket.push(settlement);
      else buckets.set(name, [settlement]);
    }
    return [...buckets.entries()].map(([name, list]) => ({
      name,
      count: list.length,
      r1: list.reduce((sum, settlement) => sum + numberOf(settlement.fee_amount), 0),
      r2: list.reduce((sum, settlement) => sum + numberOf(settlement.agent_payout), 0),
      net: netProfitOf(list),
      clawback: list.reduce((sum, settlement) => sum + numberOf(settlement.clawback_amount), 0),
    })).sort((left, right) => right.net - left.net);
  }, [group, monthRows]);

  if (ok === null) return <Loading />;

  const changeMonth = (nextMonth: string) => {
    setMonth(nextMonth);
    setSelectedKey(null);
  };
  const monthIndex = months.indexOf(month);
  const stepMonth = (direction: number) => {
    const nextIndex = monthIndex + direction;
    if (nextIndex >= 0 && nextIndex < months.length) changeMonth(months[nextIndex]);
  };
  const selectSettlement = (settlement: EntityRecord) => {
    setSelectedKey(String(settlement._key || settlement.settlement_code));
  };
  const clearSelection = () => setSelectedKey(null);
  const clearConditions = () => {
    setQueryInput('');
    setQuery('');
    setSort('');
    setStatus('all');
  };
  const pendingCount = monthRows.filter((settlement) => (
    String(settlement.settlement_status) === '정산대기'
    || String(settlement.settlement_status) === '환수대기'
  )).length;

  const list = shown.length ? shown.map((settlement) => {
    const key = String(settlement._key || settlement.settlement_code);
    return (
      <SettlementListRow
        key={key}
        settlement={settlement}
        selected={key === selectedKey}
        onClick={() => selectSettlement(settlement)}
      />
    );
  }) : (
    <CenterNote>{query || status !== 'all' ? '검색 결과가 없습니다.' : '이 달 정산 내역이 없습니다.'}</CenterNote>
  );

  const detailPane = (
    <>
      {/* 모바일 스왑 = 하단 세그먼트가 이미 「상세」를 표시 → 같은 말 반복하는 헤드 생략(세로 확보). */}
      {!mobile && <PaneHead title="정산 상세" />}
      <PaneBody pad>
        {selected ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge tone={SETTLEMENT_STATUS_TONE[String(selected.settlement_status)] || 'gray'} variant="solid">
                {String(selected.settlement_status || '정산대기')}
              </Badge>
              {Number(selected.rent_amount) <= 0 ? <Badge tone="red" variant="solid">월대여료 확인 필요</Badge> : null}
              {Number(selected.rent_amount) > 0 && String(selected.fee_rate_unresolved || '') === 'yes'
                ? <Badge tone="amber" variant="solid">공급사율 확인 필요</Badge>
                : null}
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: NUM, fontSize: FS.cap, color: C.faint }}>
                {String(selected.settlement_code || '')}
              </span>
            </div>
            <ListGroup header="정산 정보">
              <DetailRow label="계약번호" value={String(selected.contract_code || '')} />
              <DetailRow label="계약일" value={String(selected.contract_date || '')} />
              <DetailRow label="계약자" value={String(selected.customer_name || '')} />
              <DetailRow label="차량번호" value={String(selected.car_number || '')} />
              <DetailRow label="공급사" value={String(selected.provider_company_code || '')} />
              <DetailRow label="영업자" value={String(selected.agent_code || '')} />
              <DetailRow label="영업채널" value={String(selected.agent_channel_code || '')} />
            </ListGroup>
          </>
        ) : <CenterNote>목록에서 정산 건을 선택하세요.</CenterNote>}
      </PaneBody>
    </>
  );

  const amountPane = (
    <>
      {!mobile && <PaneHead title="금액·지급" />}
      <PaneBody pad>
        {selected ? (
          <>
            <ListGroup
              header="금액"
              footer="공급사청구(R1)=월대여료×공급사율 · 영업지급(R2)=계약 시점 지급율 · 순수익=R1−R2"
            >
              <DetailRow label="월대여료" value={won(selected.rent_amount)} />
              <DetailRow label="공급사 청구 R1" value={won(selected.fee_amount)} />
              <DetailRow label="영업자 지급 R2" value={won(selected.agent_payout)} />
              <DetailRow label="순수익" value={won(selected.net_amount)} valueColor={C.brand} />
              <DetailRow label="환수" value={numberOf(selected.clawback_amount) ? won(selected.clawback_amount) : '—'} />
              <DetailRow label="공급사율" value={rateLabel(selected.fee_rate)} />
              <DetailRow label="정산식" value="R1 − R2" />
            </ListGroup>
          </>
        ) : <CenterNote>선택한 정산 건의 청구·지급 금액이 표시됩니다.</CenterNote>}
      </PaneBody>
    </>
  );

  const summaryPane = (
    <>
      <PaneHead title={`${month || '월'} 집계`} count={monthRows.length} />
      <PaneBody pad>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <MoneyCard label="공급사 청구 R1" value={totals.r1} />
          <MoneyCard label="영업자 지급 R2" value={totals.r2} />
          <MoneyCard label="확정 순수익" value={totals.net} tone={C.brand} />
          <MoneyCard label="환수" value={totals.clawback} tone={totals.clawback ? C.danger : C.mute} />
        </div>
        <FilterChips
          value={group}
          onChange={setGroup}
          options={[{ key: 'provider', label: '공급사별' }, { key: 'channel', label: '영업채널별' }]}
        />
        {grouped.length ? (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, overflow: 'hidden' }}>
          {grouped.map((item) => (
            <MetricRow
              key={item.name}
              main={item.name}
              sub={`${item.count}건 · 청구 ${won(item.r1)} · 지급 ${won(item.r2)}${item.clawback ? ` · 환수 ${won(item.clawback)}` : ''}`}
              right={won(item.net)}
              rightColor={item.net > 0 ? C.brand : C.mute}
            />
          ))}
        </div>
        ) : <CenterNote>집계할 정산 내역이 없습니다.</CenterNote>}
      </PaneBody>
    </>
  );

  const panes: WorkPane[] = [
    { key: 'detail', title: '상세', icon: FileText, node: detailPane },
    { key: 'amount', title: '금액', icon: Banknote, node: amountPane },
    { key: 'summary', title: '월 집계', icon: ChartNoAxesCombined, node: summaryPane },
  ];

  const actions = mobile ? undefined : (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <Btn size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>가져오기</Btn>
      <Btn size="sm" variant="ghost" onClick={() => downloadSettlementReport(monthRows, month)} disabled={!monthRows.length}>정산서</Btn>
      <Btn size="sm" onClick={() => setShowVatSheet(true)}>VAT 정산서</Btn>
    </div>
  );

  return (
    <>
      <WorkPage
        title={NAV_LABEL.settlement}
        statusLabel="정산 확인"
        statusCount={pendingCount}
        attentionLabel="월 전체"
        attentionCount={monthRows.length}
        listCount={shown.length}
        list={list}
        listHeader={(
          <div style={{
            padding: '8px 12px', borderBottom: `1px solid ${C.line2}`,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <IconBtn onClick={() => stepMonth(-1)} disabled={monthIndex <= 0} title="이전 달"><ChevronLeft size={18} /></IconBtn>
            <Select
              value={month}
              onChange={changeMonth}
              options={months.map((value) => ({ value, label: value }))}
              size="sm"
              full
              style={{ flex: 1, minWidth: 0, fontFamily: NUM }}
            />
            <IconBtn onClick={() => stepMonth(1)} disabled={monthIndex >= months.length - 1} title="다음 달"><ChevronRight size={18} /></IconBtn>
          </div>
        )}
        panes={panes}
        selected={!!selected}
        onBack={clearSelection}
        contextTitle={selected ? String(selected.customer_name || selected.car_number || selected.settlement_code || '') : undefined}
        actions={actions}
        mobileLayout="swap"
        listTools={{
          search: { value: queryInput, onChange: setQueryInput, placeholder: '정산·계약·차번·계약자·공급·영업…' },
          sort: {
            value: sort,
            onChange: (value) => setSort(value as SettlementSort),
            options: [
              { value: 'date_desc', label: '계약일 최신순' },
              { value: 'customer', label: '계약자순' },
              { value: 'amount_desc', label: '순수익 높은순' },
              { value: 'status', label: '정산상태순' },
            ],
          },
          filter: {
            count: status === 'all' ? 0 : 1,
            title: '정산상태',
            onClear: () => setStatus('all'),
            body: (
              <FilterGroup
                title="정산상태"
                count={status === 'all' ? 0 : 1}
                defaultOpen
                first
                onClear={() => setStatus('all')}
              >
                <FilterChips
                  value={status}
                  onChange={setStatus}
                  options={[
                    { key: 'all', label: '전체' },
                    ...SETTLEMENT_STATES.map((value) => ({ key: value, label: value })),
                  ]}
                />
              </FilterGroup>
            ),
          },
          hints: [
            month,
            ...(query.trim() ? [query.trim().length > 12 ? `${query.trim().slice(0, 12)}…` : query.trim()] : []),
            ...(sort ? [[
              ['date_desc', '계약일 최신순'],
              ['customer', '계약자순'],
              ['amount_desc', '순수익 높은순'],
              ['status', '정산상태순'],
            ].find(([value]) => value === sort)?.[1] || sort] : []),
            ...(status !== 'all' ? [status] : []),
          ],
          onClearHints: clearConditions,
        }}
      />
      {!mobile && (
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={(event) => { void importXlsx(event.target.files); }}
          style={{ display: 'none' }}
        />
      )}
      {showVatSheet ? (
        <DetailShell
          fixed
          title={`${month} VAT 정산서`}
          meta="청구·지급 및 부가세"
          onBack={() => setShowVatSheet(false)}
          maxWidth={1120}
        >
          <AdminSettlementSheet month={month} />
        </DetailShell>
      ) : null}
    </>
  );
}
