'use client';
/**
 * **정산관리 — 관리자가 «만드는» 곳.** 4열이다.
 *
 * ★사장님 2026-08-26 (화면 규격을 이렇게 잡았다)
 * ```
 * 접수목록   검색 + 접수상태만 거른다
 * 접수내용   입력 폼. **검색·필터 없다** — 한 건을 적는 자리다
 * 실적상태   목록. 검색 + 공급사별·영업자별·상태별
 * 청구현황   목록. 검색 + 공급사별·영업자별·상태별 + 달. 청구서는 여기서 뽑는다
 * ```
 *   「4개 패널을 용도에 맞게」 · 「접수내용 빼고는 검색창과 필터버튼이 각각 있어야겠네」
 *   · 「청구관련 필터버튼은 청구패널에 있으면 된다고」 · 「이 업무를 하기에 있어서 최소화 되는거만」
 *
 * ★★**규격은 이 페이지가 정하지 않는다**(사장님 「이 페이지만의 규격을 쓰지말고 통일된 규격 쓰라고」).
 *   목록은 전부 **`FeedListRow` 2줄 도메인 행**(`LedgerListRow`)이다 — 재고·계약·계약서관리와 같은 손.
 *   **엑셀형 표를 쓰지 않는다**(「엑셀형 없어도 돼」) — 표가 필요하면 엑셀로 내려받는다.
 * ★★**판마다 필터가 따로 논다.** 목록에서 「미완료」를 보면서 청구현황에서는 8월 전체를 볼 수 있어야 한다.
 * ★★**축이 둘이고 섞지 않는다.**
 * ```
 * 접수상태  당월접수 · 미완료 · 분납실적 · 완납실적 · 취소    계약이 어디까지 왔나
 * 청구상태  미청구 · 환수위험 · 청구예정 · 청구완료 · 환수    돈이 어디까지 갔나
 * ```
 *   완납실적인데 미청구인 건이 있다 — 합쳐 놓으면 그걸 못 찾는다. **거기가 돈이 새는 자리다.**
 *
 * ★**적는 곳은 시트 하나다.** 여기서 접수하면 시트 「접수」 탭에 줄이 더해진다.
 * ★**판정은 화면이 안 한다.** 자리·청구월·수수료는 `settlement-stage.ts`,
 *   청구 상태는 `settlement-billstate.ts` 가 정한다.
 * ⚠ **금액을 고치는 버튼은 두지 않는다.** 수수료는 요율표에서 나온다 —
 *   화면에서 손대기 시작하면 그날로 정본이 둘이 된다. 고칠 일은 시트에서 고친다.
 */
import { useEffect, useMemo, useState } from 'react';
import { ledgerFetch } from '@/lib/firebase/ledger-client';
import { BILL_STATES, BILL_TONE, BILL_WHY, type BillState } from '@/lib/domain/settlement-billstate';
import { canBill, type Confirmation } from '@/lib/domain/settlement-confirm';
import type { EntityRecord, Field } from '@/lib/intake/entities';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { LedgerListRow, SettlementCreateRow } from '@/components/list-rows';
import {
  Badge, Btn, C, CenterNote, DetailRow, FilterChips, FormGrid, FS, Input,
  ListGroup, ListRow, Loading, NUM, PaneBody, PaneHead, R_CARD, Select, won,
} from '@/components/ui';
import { toast } from '@/components/Toaster';
import { Banknote, ClipboardList, ListChecks } from 'lucide-react';

type Money = { claim: number; claimVat: number; claimTotal: number; pay: number; payVat: number; payTotal: number; margin: number; net: number };
type Row = {
  plate: string; customer: string; supplier: string; agent: string; channel: string; product: string;
  model: string; term: number; rent: number; price: number; deposit: number; payKind: string;
  receivedAt: string; deliveredAt: string; clawbackAt: string; clawbackAmount: number;
  paper: boolean; delivered: boolean; cancelled: boolean; clawback: boolean;
  stage: string; bucket: string; billingMonth: string | null; money: Money; nextRound: string;
  billState: BillState; phone: string;
};
type Payload = { ok: boolean; reason?: string; count: number; readAt: string; ledgerUrl: string; rows: Row[] };

/** 접수상태 — 계약이 어디까지 왔나. 「진행중」은 담당자가 매일 보는 두 칸을 합친 것이다. */
const STAGES = ['진행중', '당월접수', '미완료', '분납실적', '완납실적', '취소'] as const;
const inStage = (r: Row, t: string) =>
  (t === '전체' ? true : t === '진행중' ? r.bucket === '당월접수' || r.bucket === '미완료' : r.bucket === t);

const PRODUCT_OPTS = ['장기렌트', '선출고', '견적출고', '구독', '오플구독'];
const PAY_KIND_OPTS = ['일시납', '2회분납', '3회분납'];

const hay = (r: Row) => `${r.plate} ${r.model} ${r.customer} ${r.supplier} ${r.agent} ${r.channel}`.toLowerCase();
const hit = (r: Row, q: string) => !q.trim() || hay(r).includes(q.trim().toLowerCase());

/**
 * 판 위에 붙는 검색·필터. **판마다 따로 논다.**
 * ★한 줄로 눌러 담는다 — 판이 1/4 폭이라 필터가 세로로 쌓이면 목록이 안 보인다(실측 2026-08-26).
 */
function PaneFilters({
  q, onQ, supplier, onSupplier, agent, onAgent, suppliers, agents, children,
}: {
  q: string; onQ: (v: string) => void;
  supplier: string; onSupplier: (v: string) => void;
  agent: string; onAgent: (v: string) => void;
  suppliers: string[]; agents: string[];
  children?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <Input value={q} onChange={onQ} placeholder="차번·고객·공급사·영업자…" />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Select value={supplier} onChange={onSupplier}
          options={[{ value: '', label: '공급사 전체' }, ...suppliers.map((v) => ({ value: v, label: v }))]} />
        <Select value={agent} onChange={onAgent}
          options={[{ value: '', label: '영업자 전체' }, ...agents.map((v) => ({ value: v, label: v }))]} />
      </div>
      {children}
    </div>
  );
}

export default function SettlementLedgerPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // ① 접수목록 — 검색 + 접수상태만
  const [q, setQ] = useState('');
  const [stage, setStage] = useState<string>('진행중');
  const [sel, setSel] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ product: '장기렌트', payKind: '일시납' });
  const [agentList, setAgentList] = useState<{ code: string; name: string; channel: string; label: string }[]>([]);

  // ③ 실적상태 — 자기 검색·필터
  const [pQ, setPQ] = useState('');
  const [pSup, setPSup] = useState('');
  const [pAgent, setPAgent] = useState('');
  const [pStage, setPStage] = useState('전체');

  // ④ 청구현황 — 자기 검색·필터
  const [bQ, setBQ] = useState('');
  const [bSup, setBSup] = useState('');
  const [bAgent, setBAgent] = useState('');
  const [bill, setBill] = useState('전체');
  const [month, setMonth] = useState('');
  const [confirms, setConfirms] = useState<Confirmation[]>([]);

  const load = async () => {
    try {
      const res = await ledgerFetch('/api/settlement/ledger');
      const body = await res.json() as Payload;
      if (!body.ok) { setErr(body.reason || '읽지 못했습니다'); return; }
      setErr(''); setData(body);
    } catch (e) { setErr(String((e as Error)?.message || e)); }
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await ledgerFetch('/api/settlement/agents');
        const body = await res.json() as { ok: boolean; list?: { code: string; name: string; channel: string; label: string }[] };
        if (body.ok && body.list) setAgentList(body.list);
      } catch { /* 명부를 못 받아도 접수는 막지 않는다 */ }
    })();
  }, []);

  const rows = useMemo(() => data?.rows || [], [data]);
  const months = useMemo(
    () => [...new Set(rows.map((r) => r.billingMonth || '').filter(Boolean))].sort().reverse(),
    [rows],
  );
  const suppliers = useMemo(() => [...new Set(rows.map((r) => r.supplier).filter(Boolean))].sort(), [rows]);
  const agents = useMemo(() => [...new Set(rows.map((r) => r.agent).filter(Boolean))].sort(), [rows]);

  /** 들어오면 이번 달이 잡혀 있어야 한다 — 급한 건 늘 «이번 달 말일까지»다. */
  useEffect(() => {
    if (month || !rows.length) return;
    const now = new Date();
    setMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  }, [rows, month]);

  useEffect(() => {
    if (!month) { setConfirms([]); return; }
    (async () => {
      try {
        const res = await ledgerFetch(`/api/settlement/confirm?month=${encodeURIComponent(month)}`);
        const body = await res.json() as { ok: boolean; list?: Confirmation[] };
        setConfirms(body.ok ? (body.list || []) : []);
      } catch { setConfirms([]); }
    })();
  }, [month]);

  // 판마다 따로 거른다
  const shown = useMemo(() => rows.filter((r) => hit(r, q) && inStage(r, stage)), [rows, q, stage]);
  const perf = useMemo(() => rows.filter((r) => hit(r, pQ)
    && (!pSup || r.supplier === pSup) && (!pAgent || r.agent === pAgent) && inStage(r, pStage)),
  [rows, pQ, pSup, pAgent, pStage]);
  const billRows = useMemo(() => rows.filter((r) => hit(r, bQ)
    && (!bSup || r.supplier === bSup) && (!bAgent || r.agent === bAgent)
    && (bill === '전체' || r.billState === bill)),
  [rows, bQ, bSup, bAgent, bill]);

  const picked = useMemo(() => rows.find((r) => `${r.plate}|${r.receivedAt}` === sel) || null, [rows, sel]);
  const pick = (r: Row) => { setSel(`${r.plate}|${r.receivedAt}`); setCreating(false); };
  const keyOf = (r: Row) => `${r.plate}|${r.receivedAt}`;

  /** 그 달 청구 — 청구현황 판의 필터를 그대로 탄다. */
  const billable = useMemo(
    () => billRows.filter((r) => !r.cancelled && (!month || r.billingMonth === month)),
    [billRows, month],
  );
  const byParty = useMemo(() => {
    const m = new Map<string, { n: number; claim: number; pay: number }>();
    for (const r of billable) {
      const k = r.supplier || '(공급사 미기재)';
      const c = m.get(k) || { n: 0, claim: 0, pay: 0 };
      c.n += 1; c.claim += r.money.claim; c.pay += r.money.pay;
      m.set(k, c);
    }
    return [...m].sort((a, b) => (b[1].claim - b[1].pay) - (a[1].claim - a[1].pay));
  }, [billable]);
  const tot = billable.reduce(
    (a, r) => ({ n: a.n + 1, claim: a.claim + r.money.claim, pay: a.pay + r.money.pay }),
    { n: 0, claim: 0, pay: 0 },
  );

  /** 이 달 청구를 막고 있는 영업자들 — 종이 뽑고 알면 늦다. */
  const gate = useMemo(() => {
    if (!month) return [] as { agent: string; n: number }[];
    const byAgent = new Map<string, number>();
    for (const r of billable) byAgent.set(r.agent || '(미기재)', (byAgent.get(r.agent || '(미기재)') || 0) + 1);
    const out: { agent: string; n: number }[] = [];
    for (const [a, n] of byAgent) {
      const c = confirms.find((v) => String(v.who || '').replace(/\s/g, '') === a.replace(/\s/g, '')) || null;
      if (!canBill(c, n).ok) out.push({ agent: a, n });
    }
    return out.sort((x, y) => y.n - x.n);
  }, [month, billable, confirms]);

  const submit = async () => {
    if (!form.plate?.trim()) { toast('차량번호를 적어 주세요'); return; }
    setBusy(true);
    try {
      const res = await ledgerFetch('/api/settlement/ledger', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form),
      });
      const body = await res.json() as { ok: boolean; reason?: string; plate?: string };
      if (!body.ok) { toast(body.reason || '접수하지 못했습니다'); return; }
      toast(`${body.plate} 접수했습니다`);
      setForm({ product: '장기렌트', payKind: '일시납' });
      setCreating(false);
      await load();
    } finally { setBusy(false); }
  };

  /** 진행만 고친다. 금액·요율은 서버가 흰 목록으로 막는다. */
  const patchRow = async (r: Row, patch: Record<string, string>) => {
    setBusy(true);
    try {
      const res = await ledgerFetch('/api/settlement/ledger', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plate: r.plate, receivedAt: r.receivedAt, patch }),
      });
      const body = await res.json() as { ok: boolean; reason?: string };
      if (!body.ok) { toast(body.reason || '고치지 못했습니다'); return; }
      await load();
    } finally { setBusy(false); }
  };

  /**
   * 목록에서 바로 인도완료 — **인도일은 오늘**이다.
   * ★날짜 없이 체크만 켜면 청구월이 안 서고 「인도는 됐는데 청구가 없는」 줄이 조용히 생긴다.
   *   다른 날짜가 필요하면 시트에서 고친다.
   */
  const markDelivered = async (r: Row) => {
    const t = new Date();
    const day = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    if (!window.confirm(`${r.plate} — 인도일 ${day} 로 인도완료 처리할까요?`)) return;
    await patchRow(r, { 인도완료: 'TRUE', 인도일: day });
  };

  if (err) return <CenterNote>정산원장을 못 읽었습니다 — {err}</CenterNote>;
  if (!data) return <Loading />;

  const card: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: R_CARD, padding: '2px 10px' };
  const kv = (k: string, v: string) => <DetailRow key={k} label={k} value={v} valueColor={C.ink} />;

  // ─────────────────────────────── ① 접수목록
  const list = (
    <>
      <div style={{ padding: '8px 10px 0' }}>
        <FilterChips
          options={STAGES.map((t) => ({ key: t, label: t, count: rows.filter((r) => hit(r, q) && inStage(r, t)).length }))}
          value={stage}
          onChange={(v) => setStage(v)}
        />
      </div>
      <SettlementCreateRow onClick={() => { setCreating(true); setSel(''); }} />
      {shown.length === 0
        ? <CenterNote>그 조건에 해당하는 계약이 없습니다.</CenterNote>
        : (
          <ListGroup>
            {shown.map((r) => (
              <LedgerListRow key={keyOf(r)} row={{ ...r, claim: r.money.claim }}
                selected={sel === keyOf(r)} onClick={() => pick(r)} />
            ))}
          </ListGroup>
        )}
    </>
  );

  // ─────────────────────────────── ② 접수내용 — 폼. 검색·필터 없다
  const INTAKE_FIELDS: Field[] = [
    { key: 'plate', label: '차량번호', type: 'text', required: true },
    { key: 'customer', label: '고객명', type: 'text' },
    { key: 'phone', label: '고객연락처', type: 'text' },
    { key: 'agentCode', label: '영업담당자', type: 'select', options: [] },
    { key: 'agent', label: '영업담당자(직접)', type: 'text', note: '명부에 없을 때만' },
    { key: 'agentPhone', label: '영업자 연락처', type: 'text', note: '나중에 가입하면 이 번호로 붙습니다' },
    { key: 'channel', label: '영업채널', type: 'text' },
    { key: 'product', label: '상품구분', type: 'select', options: PRODUCT_OPTS },
    { key: 'term', label: '계약기간(개월)', type: 'number' },
    { key: 'deposit', label: '보증금', type: 'number' },
    { key: 'rent', label: '렌탈료', type: 'number', required: true },
    { key: 'price', label: '차량가액', type: 'number', note: '신차만' },
    { key: 'payKind', label: '분납여부', type: 'select', options: PAY_KIND_OPTS },
  ];

  const createForm = (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.6 }}>
        계약금이 들어온 계약을 적습니다. <b style={{ color: C.ink }}>접수일은 오늘로 박힙니다.</b>
        {' '}모델명·공급사·청구월·수수료는 기계가 채우니 비워 두세요.
      </div>
      <FormGrid
        fields={INTAKE_FIELDS}
        form={form as unknown as EntityRecord}
        onChange={(k, v) => {
          if (k === 'agentCode') {
            const a = agentList.find((x) => x.code === v);
            setForm((f) => ({ ...f, agentCode: v, agent: a?.name || f.agent || '', channel: a?.channel || f.channel || '' }));
            return;
          }
          setForm((f) => ({ ...f, [k]: v }));
        }}
        selectOptions={{
          agentCode: [{ value: '', label: agentList.length ? '고르기' : '명부를 못 받았습니다' },
            ...agentList.map((a) => ({ value: a.code, label: a.label }))],
        }}
        showNotes
      />
      <div style={{ display: 'flex', gap: 7 }}>
        <Btn onClick={submit} disabled={busy}>{busy ? '접수 중…' : '접수하기'}</Btn>
        <Btn variant="ghost" onClick={() => setCreating(false)}>취소</Btn>
      </div>
    </div>
  );

  const intake = picked ? (
    <>
      <div style={card}>
        {kv('차량번호', picked.plate)}
        {kv('모델명', picked.model)}
        {kv('고객명', picked.customer)}
        {picked.phone ? kv('연락처', picked.phone) : null}
        {kv('공급사', picked.supplier)}
        {kv('영업담당자', picked.agent)}
        {kv('영업채널', picked.channel)}
        {kv('상품구분', picked.product)}
        {kv('계약기간', picked.term ? `${picked.term}개월` : '')}
        {kv('렌탈료', picked.rent ? won(picked.rent) : '')}
        {kv('보증금', picked.deposit ? won(picked.deposit) : '')}
        {kv('차량가액', picked.price ? won(picked.price) : '')}
        {kv('분납여부', picked.payKind)}
        {kv('접수일', picked.receivedAt)}
      </div>
      {/* 업무에 꼭 필요한 것만 — 접수 → 계약서 → 인도 → 청구. 인도는 실적상태에서 켠다 */}
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <Btn variant={picked.paper ? 'ghost' : 'solid'} disabled={busy}
          onClick={() => patchRow(picked, { 계약서: picked.paper ? 'FALSE' : 'TRUE' })}>
          {picked.paper ? '계약서 해제' : '계약서 완료'}
        </Btn>
        <Btn variant={picked.cancelled ? 'ghost' : 'danger'} disabled={busy}
          onClick={() => patchRow(picked, { 계약취소: picked.cancelled ? 'FALSE' : 'TRUE' })}>
          {picked.cancelled ? '취소 해제' : '계약취소'}
        </Btn>
        {picked.delivered && (
          <Btn variant="ghost" disabled={busy} onClick={() => patchRow(picked, { 인도완료: 'FALSE', 인도일: '' })}>인도 해제</Btn>
        )}
      </div>
    </>
  ) : <CenterNote>목록에서 계약을 고르거나, 맨 위 「계약접수」를 누르세요.</CenterNote>;

  // ─────────────────────────────── ③ 실적상태 — 같은 2줄 행. 인도는 여기서 켠다
  const progress = (
    <div style={{ display: 'grid', gap: 10 }}>
      <PaneFilters
        q={pQ} onQ={setPQ} supplier={pSup} onSupplier={setPSup} agent={pAgent} onAgent={setPAgent}
        suppliers={suppliers} agents={agents}
      >
        <FilterChips
          options={['전체', ...STAGES].map((t) => ({ key: t, label: t, count: rows.filter((r) => inStage(r, t)).length }))}
          value={pStage}
          onChange={(v) => setPStage(v)}
        />
      </PaneFilters>
      <div style={{ fontSize: FS.cap, color: C.mute }}>
        {perf.length}건 · 인도완료 {perf.filter((r) => r.delivered).length} · 인도 전 {perf.filter((r) => !r.delivered && !r.cancelled).length}
      </div>
      {perf.length === 0
        ? <CenterNote>그 조건에 해당하는 계약이 없습니다.</CenterNote>
        : (
          <ListGroup>
            {perf.map((r) => (
              <LedgerListRow key={keyOf(r)} row={{ ...r, claim: r.money.claim }}
                selected={sel === keyOf(r)} onClick={() => pick(r)}
                right={r.delivered || r.cancelled ? undefined : (
                  <Btn variant="bare" disabled={busy} onClick={() => markDelivered(r)}>인도완료</Btn>
                )}
              />
            ))}
          </ListGroup>
        )}
    </div>
  );

  // ─────────────────────────────── ④ 청구현황 — 같은 2줄 행. 청구서는 여기서 뽑는다
  const billing = (
    <div style={{ display: 'grid', gap: 10 }}>
      <PaneFilters
        q={bQ} onQ={setBQ} supplier={bSup} onSupplier={setBSup} agent={bAgent} onAgent={setBAgent}
        suppliers={suppliers} agents={agents}
      >
        <FilterChips
          options={[
            { key: '전체', label: '전체', count: rows.length },
            ...BILL_STATES.map((b) => ({
              key: b as string, label: b as string, count: rows.filter((r) => r.billState === b).length,
            })),
          ]}
          value={bill}
          onChange={(v) => setBill(v)}
        />
      </PaneFilters>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select value={month} onChange={setMonth}
          options={[{ value: '', label: '전체 달' }, ...months.map((m) => ({ value: m, label: m }))]} />
        <span style={{ fontSize: FS.cap, color: C.mute, fontVariantNumeric: NUM }}>
          {tot.n}건 · 청구 <b style={{ color: C.ink }}>{won(tot.claim)}</b> · 수익 <b style={{ color: C.ink }}>{won(tot.claim - tot.pay)}</b>
        </span>
      </div>

      {/* ★청구의 관문 — 「받아서 주는」 구조라 영업자 확인이 먼저다 */}
      {month && (
        <div style={{ fontSize: FS.cap, lineHeight: 1.6 }}>
          <b>영업자 실적 확인</b>{' '}
          {gate.length === 0
            ? <span style={{ color: C.ok }}>막는 사람 없음 — 청구해도 됩니다</span>
            : (
              <span style={{ color: C.danger }}>
                {gate.length}명이 아직입니다 — {gate.slice(0, 4).map((g) => `${g.agent}(${g.n}건)`).join(' · ')}
                {gate.length > 4 ? ` 외 ${gate.length - 4}명` : ''}
              </span>
            )}
        </div>
      )}

      {/* 공급사별 — 한 줄이 곧 청구서 한 장이다 */}
      {byParty.length === 0
        ? <CenterNote>그 조건에 청구할 것이 없습니다.</CenterNote>
        : (
          <ListGroup>
            {byParty.map(([sup, v]) => (
              <ListRow
                key={sup}
                main={sup}
                sub={`${v.n}건 · 청구 ${won(v.claim)} · 수익 ${won(v.claim - v.pay)}`}
                right={(
                  <Btn variant="bare" disabled={!month}
                    onClick={() => window.open(
                      `/settlement/invoice?month=${encodeURIComponent(month)}&axis=${encodeURIComponent('공급사')}&party=${encodeURIComponent(sup)}`,
                      '_blank',
                    )}>청구서</Btn>
                )}
              />
            ))}
          </ListGroup>
        )}

      {picked && (
        <div>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
            <Badge tone={BILL_TONE[picked.billState]}>{picked.billState}</Badge>
            <span style={{ fontSize: FS.cap, color: C.mute }}>{BILL_WHY[picked.billState]}</span>
          </div>
          <div style={card}>
            {kv('청구월', picked.billingMonth || '인도 전')}
            {kv('청구액', picked.money.claim ? won(picked.money.claim) : '')}
            {kv('지급액', picked.money.pay ? won(picked.money.pay) : '')}
            {kv('우리몫', picked.money.margin ? won(picked.money.margin) : '')}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <Btn variant="ghost" onClick={load}>다시 읽기</Btn>
        <Btn variant="ghost" onClick={() => window.open(data.ledgerUrl, '_blank')}>시트 열기</Btn>
      </div>
    </div>
  );

  const panes: WorkPane[] = [
    {
      key: 'intake', title: creating ? '계약접수' : '접수내용', icon: ClipboardList,
      node: <><PaneHead title={creating ? '계약접수' : '접수내용'} /><PaneBody>{creating ? createForm : intake}</PaneBody></>,
    },
    { key: 'progress', title: '실적상태', icon: ListChecks, node: <><PaneHead title="실적상태" /><PaneBody>{progress}</PaneBody></> },
    { key: 'billing', title: '청구현황', icon: Banknote, node: <><PaneHead title="청구현황" /><PaneBody>{billing}</PaneBody></> },
  ];

  return (
    <WorkPage
      title="접수목록"
      statusCount={rows.length}
      listCount={shown.length}
      list={list}
      panes={panes}
      selected={!!picked || creating}
      onBack={() => { setSel(''); setCreating(false); }}
      backKind={creating ? 'cancel' : 'list'}
      contextTitle={creating ? '계약접수' : picked?.plate}
      listTools={{ search: { value: q, onChange: setQ, placeholder: '차번·고객·공급사·영업자…' } }}
    />
  );
}
