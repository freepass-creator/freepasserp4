'use client';
/**
 * **계약·정산확인 — 한 페이지, 전 역할.**
 *
 * ★사장님 2026-08-26
 *   「관리자가 접수해서 계약진행확인이랑 정산확인할수 있는 페이지를 계약/정산확인 메뉴에
 *    페이지로 하나만 만들어서 범용적으로 확인할수 있게끔」
 *   「공급사 영업자는 정산확인에 계약진행과 함께 하는게 낫겟어 / 계약 정산확인 한개매뉴로」
 *   「대여료 기간 보증금같은것들만 확인하고 정산금액은 거기에서는 안보이게」
 *
 * 페이지를 역할별로 쪼개지 않는다. **하나를 만들고, 담기는 것만 갈린다** —
 * ```
 * 관리자   접수(생성) · 진행 · 금액(청구·지급·수익) · 고객연락처 · 시트 열기
 * 공급사   내 공급사 줄만.  진행 + 실적 건수.  금액 없음
 * 영업자   내 이름 줄만.    진행 + 실적 건수.  금액 없음
 * ```
 *
 * ★★**금액을 여기서 «가리는» 게 아니다. 서버가 «안 보낸다».**
 *   `role !== 'admin'` 이면 응답에 수수료 칸 자체가 없다(`/api/settlement/mine`).
 *   그래서 이 파일에 «숨김» 분기가 없고, 관리자용 칸은 있으면 그리고 없으면 안 그린다.
 * ★역할은 **서버가 준 값**을 쓴다. 화면이 스스로 정하면 그건 자물쇠가 아니다.
 */
import { useEffect, useMemo, useState } from 'react';
import { ledgerFetch } from '@/lib/firebase/ledger-client';
import type { AdminRow, PublicRow } from '@/lib/domain/settlement-view';
import { canBill, confirmLabel, confirmTone, type Confirmation } from '@/lib/domain/settlement-confirm';
import { WorkPage, type WorkPane } from '@/components/WorkPage';
import {
  Badge, Btn, C, CenterNote, DetailRow, FilterChips, FilterGroup, FS, FW, Input, ListGroup, ListRow,
  Loading, NUM, PaneBody, PaneHead, R, R_CARD, Select, won,
} from '@/components/ui';
import { toast } from '@/components/Toaster';
import { CheckCircle2, ListChecks } from 'lucide-react';

type Row = PublicRow & Partial<AdminRow>;
type Payload = {
  ok: boolean;
  role?: 'agent' | 'provider' | 'admin';
  whoami?: string;
  readAt?: string;
  ledgerUrl?: string;
  count?: number;
  counts?: { label: string; n: number }[];
  rows?: Row[];
  note?: string;
  reason?: string;
};

/** 진행중이 먼저다 — 끝난 건은 «세는» 대상이지 «보는» 대상이 아니다. */
const TABS = ['진행중', '인도완료', '분납중', '취소', '전체'] as const;
type Tab = (typeof TABS)[number];

const inTab = (r: Row, t: Tab) => {
  if (t === '전체') return true;
  if (t === '취소') return r.cancelled;
  if (r.cancelled) return false;
  if (t === '진행중') return !r.delivered;
  if (t === '분납중') return r.bucket === '분납실적';
  return r.delivered;
};

const toneOf = (r: Row): 'gray' | 'blue' | 'green' | 'red' =>
  r.cancelled ? 'red' : !r.delivered ? 'gray' : r.bucket === '분납실적' ? 'blue' : 'green';

/** 정산서를 끊는 두 축 — 공급사는 «받을 곳», 영업채널은 «줄 곳». */
type Axis = '공급사' | '영업채널';

const numTd: React.CSSProperties = {
  padding: '4px 7px', fontSize: FS.cap, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: NUM,
};

const PRODUCTS = ['장기렌트', '선출고', '견적출고', '단기렌트', '중고장기'].map((v) => ({ value: v, label: v }));
const PAY_KINDS = ['일시납', '2회분납', '3회분납'].map((v) => ({ value: v, label: v }));

export function ContractSettlement() {
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<Tab>('진행중');
  const [sel, setSel] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ product: '장기렌트', payKind: '일시납' });
  const [month, setMonth] = useState('');
  const [axis, setAxis] = useState<Axis>('공급사');
  /** 인도일 — 체크만 켜면 청구월이 안 서니 날짜를 같이 받는다. */
  const [deliverOn, setDeliverOn] = useState('');
  /** 실적 확인 — 청구 앞에 놓인 문(사장님 2026-08-26 「거기서 한번 걸러지는구조야」). */
  const [confirm, setConfirm] = useState<{ mine?: Confirmation | null; list?: Confirmation[]; note?: string } | null>(null);
  const [disputeOn, setDisputeOn] = useState(false);
  const [disputeNote, setDisputeNote] = useState('');

  const load = async () => {
    try {
      const res = await ledgerFetch('/api/settlement/mine');
      setData(await res.json() as Payload);
    } catch (e) {
      setData({ ok: false, reason: String((e as Error)?.message || e) });
    }
  };
  useEffect(() => { load(); }, []);

  const all = useMemo(() => data?.rows || [], [data]);

  /**
   * ★들어오면 **이번 달**이 잡혀 있어야 한다. 「전체 달」로 시작하면 마감이 안 보인다 —
   *   급한 건 언제나 «이번 달 말일까지 무엇이 들어오나»다(사장님 2026-08-26).
   */
  useEffect(() => {
    if (month || !all.length) return;
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (all.some((r) => r.billingMonth === thisMonth)) setMonth(thisMonth);
  }, [all, month]);
  const rows = useMemo(() => all.filter((r) => inTab(r, tab)), [all, tab]);
  const picked = useMemo(() => all.find((r) => r.plate + r.receivedAt === sel) || null, [all, sel]);
  const admin = data?.role === 'admin';

  // ── 정산 — 관리자에게만 금액이 와 있다. 안 왔으면 애초에 그릴 것이 없다.
  const months = useMemo(
    () => [...new Set(all.map((r) => r.billingMonth || '').filter(Boolean))].sort().reverse(),
    [all],
  );
  const billable = useMemo(
    () => all.filter((r) => !r.cancelled && (!month || r.billingMonth === month)),
    [all, month],
  );
  const tot = useMemo(
    () => billable.reduce(
      (a, r) => ({ n: a.n + 1, claim: a.claim + (r.claim || 0), pay: a.pay + (r.pay || 0) }),
      { n: 0, claim: 0, pay: 0 },
    ),
    [billable],
  );
  /** 인도는 됐는데 청구가 0 — 요율도 적힌 값도 없다. 이대로 두면 «그냥 안 청구된다». */
  const blocked = useMemo(() => billable.filter((r) => !r.claim), [billable]);
  /** 아직 인도 전 — 말일까지 인도되면 이 달 청구로 들어온다. 「없다」가 아니라 「아직」이다. */
  const waiting = useMemo(() => all.filter((r) => !r.cancelled && !r.delivered), [all]);
  const waitingWorth = useMemo(() => waiting.reduce((s, r) => s + (r.claim || 0), 0), [waiting]);
  /** 공급사 = 받을 곳 · 영업채널 = 줄 곳. 정산서는 이 표의 한 줄이 된다. */
  const grouped = useMemo(() => {
    const m = new Map<string, { n: number; claim: number; pay: number }>();
    for (const r of billable) {
      const k = (axis === '공급사' ? r.supplier : r.channel) || '(미기재)';
      const c = m.get(k) || { n: 0, claim: 0, pay: 0 };
      c.n += 1; c.claim += r.claim || 0; c.pay += r.pay || 0;
      m.set(k, c);
    }
    return [...m].sort((a, b) => (b[1].claim - b[1].pay) - (a[1].claim - a[1].pay));
  }, [billable, axis]);

  /** 그 달 확인 상태를 읽는다 — 관리자는 전부, 본인은 자기 것. */
  const loadConfirm = async (m: string) => {
    if (!m) { setConfirm(null); return; }
    try {
      const res = await ledgerFetch(`/api/settlement/confirm?month=${encodeURIComponent(m)}`);
      setConfirm(await res.json());
    } catch { setConfirm(null); }
  };
  useEffect(() => { loadConfirm(month); }, [month]);

  /**
   * **확인하거나 이의를 건다 — 본인만.**
   * ★관리자는 대신 눌러 줄 수 없다(서버가 막는다). 대신 누를 수 있으면 그 문은 문이 아니다.
   */
  const sendConfirm = async (state: '확인' | '이의') => {
    setBusy(true);
    try {
      const res = await ledgerFetch('/api/settlement/confirm', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ month, state, note: state === '이의' ? disputeNote : '' }),
      });
      const body = await res.json() as { ok: boolean; reason?: string };
      if (!body.ok) { toast(body.reason || '보내지 못했습니다'); return; }
      toast(state === '확인' ? '실적을 확인했습니다' : '이의를 접수했습니다');
      setDisputeOn(false); setDisputeNote('');
      await loadConfirm(month);
    } finally { setBusy(false); }
  };

  /**
   * ★관리자가 보는 «관문» — 이 달 청구를 막고 있는 영업자들.
   *   확인이 안 끝난 사람이 있으면 그 사람 건이 든 공급사 청구서가 못 나간다.
   */
  const agentGate = useMemo(() => {
    if (!admin || !month) return [];
    const byAgent = new Map<string, number>();
    for (const r of billable) byAgent.set(r.agent || '(미기재)', (byAgent.get(r.agent || '(미기재)') || 0) + 1);
    const list = confirm?.list || [];
    const out: { agent: string; n: number; why: string }[] = [];
    for (const [agent, n] of byAgent) {
      const c = list.find((v) => (v.who || '').replace(/\s/g, '') === agent.replace(/\s/g, '')) || null;
      const { ok, why } = canBill(c, n);
      if (!ok) out.push({ agent, n, why });
    }
    return out.sort((a, b) => b.n - a.n);
  }, [admin, month, billable, confirm]);
  const confirmedAgents = useMemo(
    () => new Set(billable.map((r) => r.agent || '(미기재)')).size,
    [billable],
  );

  /**
   * 한 줄의 «진행»만 고친다. 금액은 여기서 못 고친다 — 서버가 흰 목록으로 막는다.
   * ★고친 뒤 반드시 다시 읽는다. 자리(접수/분납/완료)는 시트가 정하는 것이지 화면이 정하는 게 아니다.
   */
  const patchRow = async (patch: Record<string, string>) => {
    if (!picked) return;
    setBusy(true);
    try {
      const res = await ledgerFetch('/api/settlement/ledger', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plate: picked.plate, receivedAt: picked.receivedAt, patch }),
      });
      const body = await res.json() as { ok: boolean; reason?: string };
      if (!body.ok) { toast(body.reason || '고치지 못했습니다'); return; }
      setDeliverOn('');
      await load();
    } finally { setBusy(false); }
  };

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
      setOpen(false);
      await load();
    } finally { setBusy(false); }
  };

  if (!data) return <Loading />;
  if (!data.ok) return <CenterNote>{data.reason || '원장을 읽지 못했습니다.'}</CenterNote>;

  const card: React.CSSProperties = { border: '1px solid ' + C.line, borderRadius: R_CARD, padding: 10 };
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const list = (
    <>
      {/* 접수 — 관리자만. 적는 곳은 시트 하나다 */}
      {admin && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          <Btn onClick={() => setOpen((v) => !v)} variant={open ? 'ghost' : 'solid'}>{open ? '접기' : '계약접수'}</Btn>
          <Btn variant="ghost" onClick={load}>다시 읽기</Btn>
          {data.ledgerUrl && <Btn variant="ghost" onClick={() => window.open(data.ledgerUrl, '_blank')}>시트 열기</Btn>}
        </div>
      )}
      {admin && open && (
        <div style={{ ...card, display: 'grid', gap: 8, background: C.head, marginBottom: 10 }}>
          <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.5 }}>
            계약금이 들어온 계약을 적습니다. <b style={{ color: C.ink }}>접수일은 오늘로 박힙니다.</b>
            {' '}모델명·공급사·청구월·수수료는 기계가 채우니 비워 두세요.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
            <Input value={form.plate || ''} onChange={set('plate')} placeholder="차량번호 ★" />
            <Input value={form.customer || ''} onChange={set('customer')} placeholder="고객명" />
            <Input value={form.phone || ''} onChange={set('phone')} placeholder="고객연락처" />
            <Input value={form.channel || ''} onChange={set('channel')} placeholder="영업채널" />
            <Input value={form.agent || ''} onChange={set('agent')} placeholder="영업담당자" />
            <Select value={form.product || ''} onChange={set('product')} options={PRODUCTS} />
            <Input value={form.term || ''} onChange={set('term')} placeholder="계약기간(개월)" inputMode="numeric" />
            <Input value={form.deposit || ''} onChange={set('deposit')} placeholder="보증금" inputMode="numeric" />
            <Input value={form.rent || ''} onChange={set('rent')} placeholder="렌탈료" inputMode="numeric" />
            <Input value={form.price || ''} onChange={set('price')} placeholder="차량가액(신차만)" inputMode="numeric" />
            <Select value={form.payKind || ''} onChange={set('payKind')} options={PAY_KINDS} />
          </div>
          <Btn onClick={submit} disabled={busy}>{busy ? '접수 중…' : '접수하기'}</Btn>
        </div>
      )}

      {/* 실적 건수 — 전 역할이 본다. 정산확인이 묻는 것은 «몇 건인가»다 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(84px,1fr))', gap: 5, marginBottom: 8 }}>
        {(data.counts || []).map((c) => (
          <div key={c.label} style={{ border: '1px solid ' + C.line, borderRadius: R_CARD, padding: '6px 8px' }}>
            <div style={{ fontSize: FS.micro, color: C.mute, fontWeight: FW.label }}>{c.label}</div>
            <div style={{ fontSize: FS.title, fontWeight: FW.head, color: C.ink, fontVariantNumeric: NUM }}>
              {c.n}<span style={{ fontSize: FS.micro, color: C.mute, fontWeight: FW.body }}> 건</span>
            </div>
          </div>
        ))}
      </div>

      {/* ★실적 확인 — 청구 앞에 놓인 문(사장님 2026-08-26).
             영업자·공급사가 «내 실적이 이게 맞다»고 해야 공급사에 청구가 나간다.
             ⚠ 묻는 것은 «건»이지 «금액»이 아니다. 이 화면에는 금액이 애초에 안 온다. */}
      {!admin && month && (
        <div style={{ ...card, display: 'grid', gap: 7, marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: FS.body, fontWeight: FW.head }}>{month} 실적 확인</span>
            <Badge tone={confirmTone(confirm?.mine || null, billable.length)}>
              {confirmLabel(confirm?.mine || null, billable.length)}
            </Badge>
            <span style={{ fontSize: FS.cap, color: C.mute }}>{billable.length}건</span>
          </div>
          {confirm?.note && <div style={{ fontSize: FS.cap, color: C.danger }}>{confirm.note}</div>}
          {!canBill(confirm?.mine || null, billable.length).ok && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Btn disabled={busy} onClick={() => sendConfirm('확인')}>이 {billable.length}건이 맞습니다</Btn>
              <Btn variant="ghost" disabled={busy} onClick={() => setDisputeOn((v) => !v)}>다른 게 있습니다</Btn>
            </div>
          )}
          {disputeOn && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Input value={disputeNote} onChange={setDisputeNote} placeholder="무엇이 다른지 적어 주세요 (차량번호 등)" />
              <Btn variant="danger" disabled={busy || !disputeNote.trim()} onClick={() => sendConfirm('이의')}>이의 보내기</Btn>
            </div>
          )}
          <div style={{ fontSize: FS.micro, color: C.mute, lineHeight: 1.5 }}>
            확인하시면 공급사에 청구가 나갑니다. 수수료 금액은 이 화면에서 다루지 않습니다.
          </div>
        </div>
      )}

      {/* 정산 — 금액이 온 사람에게만 그린다(= 관리자).
          ★축이 둘이다: **공급사 = 받을 곳 · 영업채널 = 줄 곳.**
            사장님 2026-08-26 「관리자는 나중에 공급사별 영업채널별 정산서까지 만들어 낼수 있어야해」.
            정산서는 이 표에서 한 줄을 고른 것이다 — 먼저 «맞게 갈라지는지»부터 눈으로 본다. */}
      {admin && (
        <div style={{ ...card, display: 'grid', gap: 8, marginBottom: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: FS.body, fontWeight: FW.head }}>정산</span>
            <Select
              value={month}
              onChange={setMonth}
              options={[{ value: '', label: '전체 달' }, ...months.map((m) => ({ value: m, label: m }))]}
            />
            <Select
              value={axis}
              onChange={(v) => setAxis(v as Axis)}
              options={[{ value: '공급사', label: '공급사별' }, { value: '영업채널', label: '영업채널별' }]}
            />
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: FS.cap, color: C.mute, fontVariantNumeric: NUM }}>
              {tot.n}건 · 청구 <b style={{ color: C.ink }}>{won(tot.claim)}</b>
              {' '}· 지급 {won(tot.pay)} · 수익 <b style={{ color: C.ink }}>{won(tot.claim - tot.pay)}</b>
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {[axis, '건수', '청구액', '지급액', '수익', ''].map((h, i) => (
                    <th key={h} style={{
                      padding: '4px 7px', fontSize: FS.micro, color: C.mute, fontWeight: FW.meta,
                      textAlign: i === 0 ? 'left' : 'right', whiteSpace: 'nowrap', borderBottom: '1px solid ' + C.line,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grouped.map(([name, v]) => (
                  <tr key={name} style={{ borderTop: '1px solid ' + C.line }}>
                    <td style={{ padding: '4px 7px', fontSize: FS.cap, whiteSpace: 'nowrap' }}>{name}</td>
                    <td style={numTd}>{v.n}</td>
                    <td style={numTd}>{won(v.claim)}</td>
                    <td style={numTd}>{won(v.pay)}</td>
                    <td style={{ ...numTd, fontWeight: FW.head }}>{won(v.claim - v.pay)}</td>
                    <td style={{ padding: '2px 7px', textAlign: 'right' }}>
                      {/* 표의 한 줄이 곧 정산서 한 장이다 — 달을 고르지 않으면 뽑을 수 없다 */}
                      <Btn variant="bare" disabled={!month}
                        onClick={() => window.open(
                          `/settlement/invoice?month=${encodeURIComponent(month)}&axis=${encodeURIComponent(axis)}&party=${encodeURIComponent(name)}`,
                          '_blank',
                        )}>
                        {axis === '공급사' ? '청구서' : '지급명세'}
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* ★마감 — 「없다」와 「아직」을 가른다.
              사장님 2026-08-26 「이번달말일로 정산해서 9월초에 청구할거를 챙기는거」.
              인도 전은 청구가 «없는» 게 아니라 «아직»이다. 섞으면 말일에 인도될 건을 놓치고,
              놓친 건은 그대로 다음 달로 밀린다. 그래서 셋을 따로 센다. */}
          {month && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: FS.cap, borderTop: '1px solid ' + C.line, paddingTop: 7 }}>
              <span>확정 <b style={{ color: C.ink }}>{billable.length}</b>건</span>
              <span style={{ color: blocked.length ? C.danger : C.mute }}>
                막힘 <b>{blocked.length}</b>건{blocked.length ? ' — 요율도 적힌 값도 없어 그냥 안 청구된다' : ''}
              </span>
              <span style={{ color: C.mute }}>
                아직 <b>{waiting.length}</b>건 — 말일까지 인도되면 이 달로 들어온다
                {waitingWorth ? ` (${won(waitingWorth)})` : ''}
              </span>
            </div>
          )}
          {/* ★청구의 관문 — 「받아서 주는」 구조라 영업자 확인이 먼저다(사장님 2026-08-26).
                 누가 아직 안 했는지 여기서 보여야 전화를 건다. 종이 뽑고 나서 알면 늦다. */}
          {month && (
            <div style={{ borderTop: '1px solid ' + C.line, paddingTop: 7, fontSize: FS.cap, lineHeight: 1.6 }}>
              <b>영업자 실적 확인</b>{' '}
              {agentGate.length === 0
                ? <span style={{ color: C.ok }}>{confirmedAgents}명 전부 확인 — 청구해도 됩니다</span>
                : (
                  <span style={{ color: C.danger }}>
                    {agentGate.length}명이 아직입니다 —{' '}
                    {agentGate.slice(0, 6).map((g) => `${g.agent}(${g.n}건)`).join(' · ')}
                    {agentGate.length > 6 ? ` 외 ${agentGate.length - 6}명` : ''}
                  </span>
                )}
            </div>
          )}
          <div style={{ fontSize: FS.micro, color: C.mute }}>
            표의 한 줄이 정산서 한 장입니다. 확인이 안 끝나면 종이에 붉게 표시됩니다.
          </div>
        </div>
      )}

      <FilterGroup title="보기">
        <FilterChips
          options={TABS.map((t) => ({ key: t, label: t, count: all.filter((r) => inTab(r, t)).length }))}
          value={tab}
          onChange={(v) => setTab(v)}
        />
      </FilterGroup>

      {rows.length === 0
        ? <CenterNote>{data.note || '해당하는 계약이 없습니다.'}</CenterNote>
        : (
          <ListGroup>
            {rows.map((r) => (
              <ListRow
                key={r.plate + r.receivedAt}
                selected={sel === r.plate + r.receivedAt}
                onClick={() => setSel(r.plate + r.receivedAt)}
                main={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {r.plate || '차번 미정'}
                    <span style={{ fontSize: FS.cap, color: C.mute, fontWeight: FW.body }}>{r.model}</span>
                  </span>
                }
                sub={[
                  r.customer, r.supplier, r.product,
                  r.term ? r.term + '개월' : '',
                  r.rent ? '대여료 ' + won(r.rent) : '',
                  r.claim ? '청구 ' + won(r.claim) : '',
                ].filter(Boolean).join(' · ')}
                right={<Badge tone={toneOf(r)}>{r.status}</Badge>}
              />
            ))}
          </ListGroup>
        )}
    </>
  );

  const kv = (k: string, v: string) => <DetailRow key={k} label={k} value={v} valueColor={C.ink} />;

  const detail = picked ? (
    <>
      {/* 계약 조건 — 사장님이 «확인하라»고 한 대여료·기간·보증금이 여기다 */}
      <div style={{ ...card, padding: '2px 10px', marginBottom: 10 }}>
        {kv('차량번호', picked.plate)}
        {kv('모델명', picked.model)}
        {kv('고객명', picked.customer)}
        {picked.phone ? kv('연락처', picked.phone) : null}
        {kv('공급사', picked.supplier)}
        {kv('영업담당자', picked.agent)}
        {kv('상품구분', picked.product)}
        {kv('계약기간', picked.term ? picked.term + '개월' : '')}
        {kv('대여료', picked.rent ? won(picked.rent) : '')}
        {kv('보증금', picked.deposit ? won(picked.deposit) : '')}
        {kv('분납여부', picked.payKind)}
      </div>

      {/* 진행 — 계약서 → 인도. 인도가 실적의 관문이다 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 10 }}>
        {[
          { on: !!picked.receivedAt, label: '접수', at: picked.receivedAt },
          { on: picked.paper, label: '계약서 작성', at: '' },
          { on: picked.delivered, label: '인도완료', at: picked.deliveredAt },
        ].map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: FS.body }}>
            <CheckCircle2 size={15} color={s.on ? C.ink : C.line} />
            <span style={{ color: s.on ? C.ink : C.mute, fontWeight: s.on ? FW.strong : FW.body }}>{s.label}</span>
            <span style={{ marginLeft: 'auto', fontSize: FS.cap, color: C.mute }}>{s.at}</span>
          </div>
        ))}
        {picked.cancelled && <div><Badge tone="red">계약취소</Badge></div>}
      </div>

      {/* ★진행을 여기서 켠다 — 관리자만.
          사장님 2026-08-26 「이번달말일로 정산해서 9월초에 청구할거를 챙기는거」.
          **말일까지 인도가 켜져야 그 달 청구로 들어온다.** 그걸 시트에서만 켤 수 있으면
          담당자가 마감 날 시트를 열어야 한다. 그래서 여기서 켠다.
          ⚠ 켤 수 있는 것은 진행뿐이다 — 금액·요율은 여기서 못 고친다(정본이 둘이 된다). */}
      {admin && (
        <div style={{ ...card, display: 'grid', gap: 7, marginBottom: 10, background: C.head }}>
          <div style={{ fontSize: FS.cap, fontWeight: FW.head, color: C.ink }}>진행 고치기</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Btn variant={picked.paper ? 'ghost' : 'solid'} disabled={busy}
              onClick={() => patchRow({ 계약서: picked.paper ? 'FALSE' : 'TRUE' })}>
              {picked.paper ? '계약서 해제' : '계약서 완료'}
            </Btn>
            <Btn variant={picked.cancelled ? 'ghost' : 'danger'} disabled={busy}
              onClick={() => patchRow({ 계약취소: picked.cancelled ? 'FALSE' : 'TRUE' })}>
              {picked.cancelled ? '취소 해제' : '계약취소'}
            </Btn>
          </div>
          {/* ★인도는 «날짜»가 본체다. 날짜 없이 체크만 켜면 청구월이 안 선다 — 서버도 막는다. */}
          {picked.delivered ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: FS.cap, color: C.mute }}>인도 {picked.deliveredAt}</span>
              <Btn variant="ghost" disabled={busy}
                onClick={() => patchRow({ 인도완료: 'FALSE', 인도일: '' })}>인도 해제</Btn>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <Input value={deliverOn} onChange={setDeliverOn} placeholder="인도일 2026-08-31" />
              <Btn disabled={busy || !deliverOn.trim()}
                onClick={() => patchRow({ 인도완료: 'TRUE', 인도일: deliverOn.trim() })}>인도완료</Btn>
              <span style={{ fontSize: FS.micro, color: C.mute }}>인도일을 넣어야 청구월이 섭니다</span>
            </div>
          )}
        </div>
      )}

      {/* 정산 — 금액이 온 사람에게만. 안 왔으면 아래 안내가 대신 선다 */}
      {admin ? (
        <div style={{ ...card, padding: '2px 10px' }}>
          {kv('청구월', picked.billingMonth || '인도 전')}
          {kv('청구액', picked.claim ? won(picked.claim) : '')}
          {kv('지급액', picked.pay ? won(picked.pay) : '')}
          {kv('수익', picked.claim || picked.pay ? won((picked.claim || 0) - (picked.pay || 0)) : '')}
          {picked.clawback ? kv('환수', [picked.clawbackAt, picked.clawbackAmount ? won(picked.clawbackAmount) : ''].filter(Boolean).join(' · ')) : null}
        </div>
      ) : (
        <div style={{ fontSize: FS.micro, color: C.mute, lineHeight: 1.5, border: '1px solid ' + C.line, borderRadius: R, padding: '7px 9px' }}>
          수수료·정산 금액은 이 화면에서 다루지 않습니다. 정산 내역은 담당자에게 확인하세요.
        </div>
      )}
    </>
  ) : <CenterNote>목록에서 계약을 고르세요.</CenterNote>;

  const panes: WorkPane[] = [
    { key: 'one', title: '계약', icon: ListChecks, node: <><PaneHead title="계약 진행" /><PaneBody>{detail}</PaneBody></> },
  ];

  return (
    <WorkPage
      title="계약·정산확인"
      statusLabel={data.whoami || ''}
      statusCount={data.count ?? 0}
      listCount={rows.length}
      list={list}
      panes={panes}
      selected={!!picked}
      onBack={() => setSel('')}
    />
  );
}
