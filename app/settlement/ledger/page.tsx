'use client';
/**
 * **정산관리 — 관리자가 «만드는» 곳.**
 *
 * ★사장님 2026-08-26
 *   「계약접수 생성해서 재고관리처럼 한다고」 — 등록은 버튼이 아니라 **목록 맨 위 행**이다.
 *     재고·계약·계약서관리가 다 그 모양이라 정산만 다르면 손이 헷갈린다.
 *   「거기서 업체별로 영업자별로 필터되고 이런식으로 말야」
 *   「그리고 분납실적이랑 완료실적이랑」
 *   「미청구건이랑 청구완료건 청구했지만 환수될수 있는거 이런거 구분값 다 반영되게 해줘야지」
 *   「관리자랑 영업자 공급사가 보는 페이지가 달랐으면」 → 여기는 **관리자만**이다.
 *
 * ★★**축이 둘이고, 섞지 않는다.**
 * ```
 * 자리   당월접수 · 미완료 · 분납실적 · 완료실적 · 취소     계약이 어디까지 왔나
 * 청구   미청구 · 환수위험 · 청구완료 · 환수 · 청구예정     돈이 어디까지 갔나
 * ```
 *   완료실적인데 미청구인 건이 있고, 분납실적인데 이미 청구한 건이 있다.
 *   한 줄로 합치면 「청구 안 한 것」을 못 찾는다 — 그게 **돈이 새는 자리**다.
 *
 * ★**적는 곳은 시트 하나다.** 여기서 접수하면 시트 「접수」 탭에 줄이 더해진다 —
 *   ERP 에 따로 저장하지 않는다. 두 벌이 되면 어느 쪽이 맞는지 아무도 모른다.
 * ★**판정은 화면이 안 한다.** 자리·청구월·수수료는 `settlement-stage.ts`,
 *   청구 상태는 `settlement-billstate.ts` 가 정한다.
 */
import { useEffect, useMemo, useState } from 'react';
import { ledgerFetch } from '@/lib/firebase/ledger-client';
import { BILL_STATES, BILL_TONE, BILL_WHY, type BillState } from '@/lib/domain/settlement-billstate';
import { canBill, type Confirmation } from '@/lib/domain/settlement-confirm';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import { SettlementCreateRow } from '@/components/list-rows';
import {
  Badge, Btn, C, CenterNote, DetailRow, FilterChips, FilterGroup, FS, FW, Input, ListGroup, ListRow,
  Loading, NUM, PaneBody, PaneHead, R_CARD, Select, won,
} from '@/components/ui';
import { toast } from '@/components/Toaster';
import { Banknote, CheckCircle2, ClipboardList, ListChecks } from 'lucide-react';

type Money = { claim: number; claimVat: number; claimTotal: number; pay: number; payVat: number; payTotal: number; margin: number; net: number };
type Row = {
  plate: string; customer: string; supplier: string; agent: string; channel: string; product: string;
  model: string; term: number; rent: number; price: number; payKind: string;
  receivedAt: string; deliveredAt: string; clawbackAt: string; clawbackAmount: number;
  paper: boolean; delivered: boolean; cancelled: boolean; clawback: boolean;
  stage: string; bucket: string; billingMonth: string | null; money: Money; nextRound: string;
  billState: BillState; phone: string;
};
type Payload = { ok: boolean; reason?: string; count: number; readAt: string; ledgerUrl: string; rows: Row[] };

/** 자리 — 계약이 어디까지 왔나. 「진행중」은 담당자가 매일 보는 두 칸을 합친 것이다. */
const STAGES = ['진행중', '당월접수', '미완료', '분납실적', '완료실적', '취소'] as const;
const inStage = (r: Row, t: string) =>
  (t === '진행중' ? r.bucket === '당월접수' || r.bucket === '미완료' : r.bucket === t);

const PRODUCTS = ['장기렌트', '선출고', '견적출고', '구독', '오플구독'].map((v) => ({ value: v, label: v }));
const PAY_KINDS = ['일시납', '2회분납', '3회분납'].map((v) => ({ value: v, label: v }));
const S = (v: unknown) => String(v ?? '').trim();

export default function SettlementLedgerPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // 목록 — 자리 · 청구 · 업체 · 영업자 · 검색
  const [stage, setStage] = useState<string>('진행중');
  const [bill, setBill] = useState<string>('전체');
  const [supplier, setSupplier] = useState('');
  const [agent, setAgent] = useState('');
  const [q, setQ] = useState('');

  // 선택 · 생성
  const [sel, setSel] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ product: '장기렌트', payKind: '일시납' });
  const [agentList, setAgentList] = useState<{ code: string; name: string; channel: string; label: string }[]>([]);
  const [deliverOn, setDeliverOn] = useState('');

  // 정산 판
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

  /** 업체·영업자·검색은 «자리»와 «청구» 양쪽에 다 걸린다. */
  const narrowed = useMemo(() => rows.filter((r) => {
    if (supplier && r.supplier !== supplier) return false;
    if (agent && r.agent !== agent) return false;
    if (q.trim()) {
      const hay = `${r.plate} ${r.model} ${r.customer} ${r.supplier} ${r.agent} ${r.channel}`.toLowerCase();
      if (!hay.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  }), [rows, supplier, agent, q]);

  const shown = useMemo(
    () => narrowed.filter((r) => inStage(r, stage) && (bill === '전체' || r.billState === bill)),
    [narrowed, stage, bill],
  );
  const picked = useMemo(() => rows.find((r) => `${r.plate}|${r.receivedAt}` === sel) || null, [rows, sel]);

  // ── 정산 판 — 그 달 청구
  const billable = useMemo(
    () => narrowed.filter((r) => !r.cancelled && (!month || r.billingMonth === month)),
    [narrowed, month],
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
      const c = confirms.find((v) => S(v.who).replace(/\s/g, '') === a.replace(/\s/g, '')) || null;
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

  /** 진행만 고친다. 금액·요율은 여기서 못 고친다 — 서버가 흰 목록으로 막는다. */
  const patchRow = async (r: Row, patch: Record<string, string>) => {
    setBusy(true);
    try {
      const res = await ledgerFetch('/api/settlement/ledger', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plate: r.plate, receivedAt: r.receivedAt, patch }),
      });
      const body = await res.json() as { ok: boolean; reason?: string };
      if (!body.ok) { toast(body.reason || '고치지 못했습니다'); return; }
      setDeliverOn('');
      await load();
    } finally { setBusy(false); }
  };

  if (err) return <CenterNote>정산원장을 못 읽었습니다 — {err}</CenterNote>;
  if (!data) return <Loading />;

  const card: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: R_CARD, padding: 10 };
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const kv = (k: string, v: string) => <DetailRow key={k} label={k} value={v} valueColor={C.ink} />;
  const th: React.CSSProperties = { padding: '4px 7px', fontSize: FS.micro, color: C.mute, fontWeight: FW.meta, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.line}` };
  const numTd: React.CSSProperties = { padding: '4px 7px', fontSize: FS.cap, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: NUM };

  // ─────────────────────────────────────────── 목록
  const list = (
    <>
      {/* ★등록은 목록 맨 위 행이다 — 재고·계약·계약서관리가 다 이 모양이다 */}
      <SettlementCreateRow onClick={() => { setCreating(true); setSel(''); }} />

      {/* 업체별·영업자별 — 사장님이 짚은 두 축 */}
      <FilterGroup title="누구">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Select value={supplier} onChange={setSupplier}
            options={[{ value: '', label: '공급사 전체' }, ...suppliers.map((v) => ({ value: v, label: v }))]} />
          <Select value={agent} onChange={setAgent}
            options={[{ value: '', label: '영업담당자 전체' }, ...agents.map((v) => ({ value: v, label: v }))]} />
        </div>
      </FilterGroup>

      {/* 자리 — 계약이 어디까지 왔나 */}
      <FilterGroup title="자리">
        <FilterChips
          options={STAGES.map((t) => ({ key: t, label: t, count: narrowed.filter((r) => inStage(r, t)).length }))}
          value={stage}
          onChange={(v) => setStage(v)}
        />
      </FilterGroup>

      {/* 청구 — 돈이 어디까지 갔나. 자리와 «다른 축»이라 따로 세운다 */}
      <FilterGroup title="청구">
        <FilterChips
          options={[
            { key: '전체', label: '전체', count: narrowed.filter((r) => inStage(r, stage)).length },
            ...BILL_STATES.map((b) => ({
              key: b as string, label: b as string,
              count: narrowed.filter((r) => inStage(r, stage) && r.billState === b).length,
            })),
          ]}
          value={bill}
          onChange={(v) => setBill(v)}
        />
      </FilterGroup>

      {shown.length === 0
        ? <CenterNote>그 조건에 해당하는 계약이 없습니다.</CenterNote>
        : (
          <ListGroup>
            {shown.map((r) => (
              <ListRow
                key={`${r.plate}|${r.receivedAt}`}
                selected={sel === `${r.plate}|${r.receivedAt}`}
                onClick={() => { setSel(`${r.plate}|${r.receivedAt}`); setCreating(false); }}
                main={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {r.plate || '차번 미정'}
                    <span style={{ fontSize: FS.cap, color: C.mute, fontWeight: FW.body }}>{r.model}</span>
                  </span>
                }
                sub={[r.customer, r.supplier, r.agent, r.product, r.money.claim ? `청구 ${won(r.money.claim)}` : '']
                  .filter(Boolean).join(' · ')}
                right={<Badge tone={BILL_TONE[r.billState]}>{r.billState}</Badge>}
              />
            ))}
          </ListGroup>
        )}
    </>
  );

  // ─────────────────────────────────────────── 판 ① 계약 (선택) 또는 접수 (생성)
  const createForm = (
    <div style={{ display: 'grid', gap: 9 }}>
      <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.6 }}>
        계약금이 들어온 계약을 적습니다. <b style={{ color: C.ink }}>접수일은 오늘로 박힙니다.</b>
        {' '}모델명·공급사·청구월·수수료는 기계가 채우니 비워 두세요.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 7 }}>
        <Input value={form.plate || ''} onChange={set('plate')} placeholder="차량번호 ★" />
        <Input value={form.customer || ''} onChange={set('customer')} placeholder="고객명" />
        <Input value={form.phone || ''} onChange={set('phone')} placeholder="고객연락처" />
        {/* ★영업담당자는 «고른다» — 고르면 채널과 코드가 따라온다. 타이핑하면 동명이인을 못 가른다. */}
        <Select
          value={form.agentCode || ''}
          onChange={(v) => {
            const a = agentList.find((x) => x.code === v);
            setForm((f) => ({ ...f, agentCode: v, agent: a?.name || '', channel: a?.channel || f.channel || '' }));
          }}
          options={[{ value: '', label: agentList.length ? '영업담당자 고르기 ★' : '명부를 못 받았습니다' },
            ...agentList.map((a) => ({ value: a.code, label: a.label }))]}
        />
        <Input value={form.agent || ''} onChange={set('agent')} placeholder="영업담당자(명부에 없으면 직접)" />
        <Input value={form.agentPhone || ''} onChange={set('agentPhone')} placeholder="영업자 연락처" />
        <Input value={form.channel || ''} onChange={set('channel')} placeholder="영업채널" />
        <Select value={form.product || ''} onChange={set('product')} options={PRODUCTS} />
        <Input value={form.term || ''} onChange={set('term')} placeholder="계약기간(개월)" inputMode="numeric" />
        <Input value={form.deposit || ''} onChange={set('deposit')} placeholder="보증금" inputMode="numeric" />
        <Input value={form.rent || ''} onChange={set('rent')} placeholder="렌탈료" inputMode="numeric" />
        <Input value={form.price || ''} onChange={set('price')} placeholder="차량가액(신차만)" inputMode="numeric" />
        <Select value={form.payKind || ''} onChange={set('payKind')} options={PAY_KINDS} />
      </div>
      <div style={{ fontSize: FS.micro, color: C.mute, lineHeight: 1.6 }}>
        명부에 없는 영업자는 <b>이름과 연락처</b>를 적어 두세요 — 나중에 그분이 가입하면 번호로 붙습니다.
      </div>
      <div style={{ display: 'flex', gap: 7 }}>
        <Btn onClick={submit} disabled={busy}>{busy ? '접수 중…' : '접수하기'}</Btn>
        <Btn variant="ghost" onClick={() => setCreating(false)}>취소</Btn>
      </div>
    </div>
  );

  /**
   * ─────────────────── 판 ② 접수내용 — «무엇을 접수했나»
   * 계약 조건만 담는다. 진행·청구는 옆 판이다.
   */
  const intake = picked ? (
    <div style={{ ...card, padding: '2px 10px' }}>
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
      {kv('차량가액', picked.price ? won(picked.price) : '')}
      {kv('분납여부', picked.payKind)}
      {kv('접수일', picked.receivedAt)}
    </div>
  ) : <CenterNote>목록에서 계약을 고르거나, 맨 위 「계약접수」를 누르세요.</CenterNote>;

  /**
   * ─────────────────── 판 ③ 실적상태 — «어디까지 왔나»
   * 접수 → 계약서 → 인도. **인도가 실적의 관문**이고, 여기서 켠다.
   */
  const progress = picked ? (
    <>
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 9, flexWrap: 'wrap' }}>
        <Badge tone={picked.cancelled ? 'red' : picked.delivered ? 'green' : 'gray'}>{picked.bucket}</Badge>
        <span style={{ fontSize: FS.cap, color: C.mute }}>
          {picked.cancelled ? '취소된 계약입니다.'
            : picked.delivered ? '인도가 끝나 실적으로 섭니다.'
              : '인도가 안 됐습니다 — 실적으로 서려면 인도가 필요합니다.'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {[
          { on: !!picked.receivedAt, label: '접수', at: picked.receivedAt },
          { on: picked.paper, label: '계약서 작성', at: '' },
          { on: picked.delivered, label: '인도완료', at: picked.deliveredAt },
        ].map((st) => (
          <div key={st.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: FS.body }}>
            <CheckCircle2 size={15} color={st.on ? C.ink : C.line} />
            <span style={{ color: st.on ? C.ink : C.mute, fontWeight: st.on ? FW.strong : FW.body }}>{st.label}</span>
            <span style={{ marginLeft: 'auto', fontSize: FS.cap, color: C.mute }}>{st.at}</span>
          </div>
        ))}
      </div>

      <div style={{ ...card, padding: '2px 10px', marginBottom: 10 }}>
        {kv('분납여부', picked.payKind)}
        {kv('다음회차일', picked.nextRound)}
        {picked.clawback
          ? kv('환수', [picked.clawbackAt, picked.clawbackAmount ? won(picked.clawbackAmount) : ''].filter(Boolean).join(' · '))
          : null}
      </div>

      {/* 진행 고치기 — 말일까지 인도가 켜져야 그 달 청구로 들어온다 */}
      <div style={{ ...card, display: 'grid', gap: 7, background: C.head }}>
        <div style={{ fontSize: FS.cap, fontWeight: FW.head }}>진행 고치기</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Btn variant={picked.paper ? 'ghost' : 'solid'} disabled={busy}
            onClick={() => patchRow(picked, { 계약서: picked.paper ? 'FALSE' : 'TRUE' })}>
            {picked.paper ? '계약서 해제' : '계약서 완료'}
          </Btn>
          <Btn variant={picked.cancelled ? 'ghost' : 'danger'} disabled={busy}
            onClick={() => patchRow(picked, { 계약취소: picked.cancelled ? 'FALSE' : 'TRUE' })}>
            {picked.cancelled ? '취소 해제' : '계약취소'}
          </Btn>
        </div>
        {picked.delivered ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: FS.cap, color: C.mute }}>인도 {picked.deliveredAt}</span>
            <Btn variant="ghost" disabled={busy} onClick={() => patchRow(picked, { 인도완료: 'FALSE', 인도일: '' })}>인도 해제</Btn>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            <Input value={deliverOn} onChange={setDeliverOn} placeholder="인도일 2026-08-31" />
            <Btn disabled={busy || !deliverOn.trim()}
              onClick={() => patchRow(picked, { 인도완료: 'TRUE', 인도일: deliverOn.trim() })}>인도완료</Btn>
            <span style={{ fontSize: FS.micro, color: C.mute }}>인도일을 넣어야 청구월이 섭니다</span>
          </div>
        )}
      </div>
    </>
  ) : <CenterNote>계약을 고르면 진행이 보입니다.</CenterNote>;

  /** 그 달 마감 — 무엇을 누구에게 청구하나. 청구서는 여기서 뽑는다. */
  const settle = (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Select value={month} onChange={setMonth}
          options={[{ value: '', label: '전체 달' }, ...months.map((m) => ({ value: m, label: m }))]} />
        <span style={{ fontSize: FS.cap, color: C.mute, fontVariantNumeric: NUM }}>{tot.n}건</span>
      </div>
      <div style={{ fontSize: FS.cap, color: C.mute, fontVariantNumeric: NUM }}>
        청구 <b style={{ color: C.ink }}>{won(tot.claim)}</b> · 지급 {won(tot.pay)}
        {' '}· 수익 <b style={{ color: C.ink }}>{won(tot.claim - tot.pay)}</b>
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

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              {['공급사', '건수', '청구액', '수익', ''].map((h, i) => (
                <th key={h + i} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byParty.map(([sup, v]) => (
              <tr key={sup} style={{ borderTop: `1px solid ${C.line}` }}>
                <td style={{ padding: '4px 7px', fontSize: FS.cap, whiteSpace: 'nowrap' }}>{sup}</td>
                <td style={numTd}>{v.n}</td>
                <td style={numTd}>{won(v.claim)}</td>
                <td style={{ ...numTd, fontWeight: FW.head }}>{won(v.claim - v.pay)}</td>
                <td style={{ padding: '2px 7px', textAlign: 'right' }}>
                  {/* 표의 한 줄이 곧 청구서 한 장이다 */}
                  <Btn variant="bare" disabled={!month}
                    onClick={() => window.open(
                      `/settlement/invoice?month=${encodeURIComponent(month)}&axis=${encodeURIComponent('공급사')}&party=${encodeURIComponent(sup)}`,
                      '_blank',
                    )}>청구서</Btn>
                </td>
              </tr>
            ))}
            {!byParty.length && (
              <tr><td colSpan={5} style={{ padding: 18, fontSize: FS.cap, color: C.mute }}>그 조건에 청구할 것이 없습니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: FS.micro, color: C.mute, lineHeight: 1.7 }}>
        · <b>미청구</b> 청구월이 됐는데 청구서가 안 나갔습니다 — <b>돈이 새는 자리</b>입니다.<br />
        · <b>환수위험</b> 청구는 나갔지만 분납이 안 끝났습니다. 부러지면 돌려줘야 합니다.<br />
        · <b>청구완료</b> «청구서가 실제로 발행된» 것만입니다. 날짜가 지났다고 완료가 아닙니다.
      </div>

      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <Btn variant="ghost" onClick={load}>다시 읽기</Btn>
        <Btn variant="ghost" onClick={() => window.open(data.ledgerUrl, '_blank')}>시트 열기</Btn>
      </div>
    </div>
  );

  /**
   * ─────────────────── 판 ④ 청구내용 — «돈이 어디까지 갔나»
   * 고른 줄의 청구가 위, 그 달 마감이 아래다.
   * ★청구서는 «한 줄»이 아니라 «공급사 × 달»의 일이다 — 그래서 아무것도 안 골라도 쓸모가 있다.
   */
  const billing = (
    <div style={{ display: 'grid', gap: 12 }}>
      {picked && (
        <div>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 7, flexWrap: 'wrap' }}>
            <Badge tone={BILL_TONE[picked.billState]}>{picked.billState}</Badge>
            <span style={{ fontSize: FS.cap, color: C.mute }}>{BILL_WHY[picked.billState]}</span>
          </div>
          <div style={{ ...card, padding: '2px 10px' }}>
            {kv('청구월', picked.billingMonth || '인도 전')}
            {kv('청구액', picked.money.claim ? won(picked.money.claim) : '')}
            {kv('지급액', picked.money.pay ? won(picked.money.pay) : '')}
            {kv('우리몫', picked.money.margin ? won(picked.money.margin) : '')}
          </div>
        </div>
      )}

      <div style={{ borderTop: picked ? `1px solid ${C.line}` : 'none', paddingTop: picked ? 10 : 0 }}>
        {settle}
      </div>
    </div>
  );

  /**
   * ★★**판 넷 = 목록 + 판 셋.** 그래야 목록이 1/4 규격에 맞는다
   *   (WorkPage 는 판이 여럿이면 목록과 각 판을 같은 폭으로 나눈다 — 판 셋이면 1/4).
   * ★판을 «원자 갈래»와 같게 둔다. 정산시트의 열 묶음과 1:1 이다 —
   *   접수내용(뼈대+조건) · 실적상태(진행) · 청구내용(정산+파생).
   *   화면을 새로 짜는 게 아니라 «시트를 담는» 것이라, 시트가 나뉜 대로 나누는 게 맞다.
   */
  const panes: WorkPane[] = [
    {
      key: 'intake', title: creating ? '접수' : '접수내용', icon: ClipboardList,
      node: <><PaneHead title={creating ? '계약접수' : '접수내용'} /><PaneBody>{creating ? createForm : intake}</PaneBody></>,
    },
    { key: 'progress', title: '실적상태', icon: ListChecks, node: <><PaneHead title="실적상태" /><PaneBody>{progress}</PaneBody></> },
    { key: 'billing', title: '청구내용', icon: Banknote, node: <><PaneHead title="청구내용" /><PaneBody>{billing}</PaneBody></> },
  ];

  return (
    <WorkPage
      title="정산관리"
      statusCount={rows.length}
      listCount={shown.length}
      list={list}
      panes={panes}
      selected={!!picked || creating}
      onBack={() => { setSel(''); setCreating(false); }}
      backKind={creating ? 'cancel' : 'list'}
      contextTitle={creating ? '계약접수' : picked?.plate}
      search={{ value: q, onChange: setQ, placeholder: '차번·차명·고객·공급사·영업자…' }}
    />
  );
}
