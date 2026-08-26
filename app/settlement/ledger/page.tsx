'use client';
/**
 * **정산관리 — 계약을 접수하고 인도·청구까지 본다.** 관리자용.
 *
 * ★사장님 2026-08-26
 *   「계약서관리 밑에 정산관리 메뉴 만들어 주고 그 메뉴에서 관리하자」
 *   「계약접수(생성) 해서 진행할수 있게끔 하고 목록에 반영되는 형태」
 *   「사실상 담당자는 접수 계속 만들면서 미완료탭만 보면 되는거지 · 기본보기는 미완료+당월접수」
 *
 * ★**기본 보기가 「진행중」(미완료 + 당월접수)**이다. 담당자가 매일 여는 화면이라
 *   «아직 손이 필요한 것»만 먼저 보인다. 나머지 칸은 눌러서 본다.
 * ★**적는 곳은 시트 하나다.** 여기서 접수를 만들면 시트 「접수」 탭에 줄이 더해진다 —
 *   ERP 에 따로 저장하지 않는다. 두 벌이 되면 어느 쪽이 맞는지 아무도 모른다.
 * ★**판정은 화면이 안 한다.** 자리·청구월·수수료는 `lib/domain/settlement-stage.ts` 가 정한다.
 */
import { useEffect, useMemo, useState } from 'react';
import { canBill, type Confirmation } from '@/lib/domain/settlement-confirm';
import { ledgerFetch } from '@/lib/firebase/ledger-client';
import { C, FS, FW, R_CARD, NUM, won, Btn, Select, Input, CenterNote, Loading } from '@/components/ui';
import { toast } from '@/components/Toaster';

type Money = { claim: number; claimVat: number; claimTotal: number; pay: number; payVat: number; payTotal: number; margin: number; net: number };
type Row = {
  plate: string; customer: string; supplier: string; agent: string; product: string;
  term: number; rent: number; price: number; payKind: string;
  receivedAt: string; deliveredAt: string; clawbackAt: string; clawbackAmount: number;
  paper: boolean; delivered: boolean; cancelled: boolean; clawback: boolean;
  stage: string; bucket: string; billingMonth: string | null; money: Money; nextRound: string;
};
type Payload = { ok: boolean; reason?: string; count: number; readAt: string; ledgerUrl: string; rows: Row[] };

/** 「진행중」은 두 칸을 합쳐 본다 — 담당자가 매일 보는 것이 그것이다. */
const TABS = ['진행중', '당월접수', '미완료', '분납실적', '완료실적', '취소'] as const;
const inTab = (r: Row, t: string) => (t === '진행중' ? r.bucket === '당월접수' || r.bucket === '미완료' : r.bucket === t);

/** 색 규칙은 시트와 같다. 센 것이 이긴다. */
const toneOf = (r: Row) => (r.cancelled ? C.dangerBg : r.clawback ? C.warnBg : r.delivered ? C.okBg : 'transparent');
const Check = ({ on }: { on: boolean }) => <span style={{ color: on ? C.ink : C.line }}>{on ? '☑' : '☐'}</span>;

const PRODUCTS = ['장기렌트', '선출고', '견적출고', '구독', '오플구독'];
const PAY_KINDS = ['일시납', '2회분납', '3회분납'];

export default function SettlementLedgerPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<string>('진행중');
  const [month, setMonth] = useState('');
  /** 실적 확인 — 청구 앞에 놓인 문. 누가 아직 안 했는지 여기서 보여야 전화를 건다. */
  const [confirms, setConfirms] = useState<Confirmation[]>([]);
  const [supplier, setSupplier] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ product: '장기렌트', payKind: '일시납' });

  const load = async () => {
    setErr('');
    try {
      const res = await ledgerFetch('/api/settlement/ledger');
      const body = await res.json() as Payload;
      if (!body.ok) { setErr(body.reason || '읽지 못했다'); return; }
      setData(body);
    } catch (e) { setErr(String((e as Error)?.message || e)); }
  };
  useEffect(() => { load(); }, []);
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

  const rows = data?.rows || [];
  const months = useMemo(() => [...new Set(rows.map((r) => r.billingMonth).filter(Boolean) as string[])].sort().reverse(), [rows]);
  const suppliers = useMemo(() => [...new Set(rows.map((r) => r.supplier).filter(Boolean))].sort(), [rows]);
  const count = (t: string) => rows.filter((r) => inTab(r, t)).length;

  /** 청구 — 월 × 공급사. 「그 달 그 공급사」가 계산서 한 장이다. */
  const billing = useMemo(() => {
    const m = new Map<string, { n: number; claim: number; pay: number }>();
    for (const r of rows) {
      if (!r.billingMonth || r.cancelled) continue;
      if (month && r.billingMonth !== month) continue;
      if (supplier && r.supplier !== supplier) continue;
      const c = m.get(r.supplier || '(빈칸)') || { n: 0, claim: 0, pay: 0 };
      c.n++; c.claim += r.money.claim; c.pay += r.money.pay;
      m.set(r.supplier || '(빈칸)', c);
    }
    return [...m].sort((a, b) => b[1].claim - a[1].claim);
  }, [rows, month, supplier]);
  /** 이 달 청구를 막고 있는 영업자들. 확인이 안 끝난 사람 건이 든 공급사 청구서는 못 나간다. */
  const gate = useMemo(() => {
    if (!month) return [] as { agent: string; n: number }[];
    const byAgent = new Map<string, number>();
    for (const r of rows) {
      if (r.cancelled || r.billingMonth !== month) continue;
      const a = r.agent || '(미기재)';
      byAgent.set(a, (byAgent.get(a) || 0) + 1);
    }
    const out: { agent: string; n: number }[] = [];
    for (const [agent, n] of byAgent) {
      const c = confirms.find((v) => (v.who || '').replace(/\s/g, '') === agent.replace(/\s/g, '')) || null;
      if (!canBill(c, n).ok) out.push({ agent, n });
    }
    return out.sort((a, b) => b.n - a.n);
  }, [month, rows, confirms]);

  const tot = billing.reduce((a, [, v]) => ({ n: a.n + v.n, claim: a.claim + v.claim, pay: a.pay + v.pay }), { n: 0, claim: 0, pay: 0 });

  const shown = useMemo(() => rows
    .filter((r) => inTab(r, tab))
    .filter((r) => !supplier || r.supplier === supplier)
    .sort((a, b) => (a.receivedAt || '').localeCompare(b.receivedAt || '')), [rows, tab, supplier]);

  const submit = async () => {
    if (!String(form.plate || '').trim()) { toast('차량번호를 적어 주세요'); return; }
    setBusy(true);
    try {
      const res = await ledgerFetch('/api/settlement/ledger', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(form),
      });
      const body = await res.json() as { ok: boolean; reason?: string; plate?: string };
      if (!body.ok) { toast(body.reason || '접수하지 못했다'); return; }
      toast(`${body.plate} 접수했습니다`);
      setForm({ product: '장기렌트', payKind: '일시납' });
      setOpen(false);
      await load();
    } finally { setBusy(false); }
  };

  /**
   * **인도완료를 켠다 — 인도일은 오늘.**
   * ★날짜 없이 체크만 켜면 청구월이 안 서고 「인도는 됐는데 청구가 없는」 줄이 조용히 생긴다.
   *   서버도 그걸 막는다. 오늘이 아닌 날짜는 시트에서 고친다.
   */
  const markDelivered = async (r: Row) => {
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (!window.confirm(`${r.plate} — 인도일 ${day} 로 인도완료 처리할까요?`)) return;
    setBusy(true);
    try {
      const res = await ledgerFetch('/api/settlement/ledger', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plate: r.plate, receivedAt: r.receivedAt, patch: { 인도완료: 'TRUE', 인도일: day } }),
      });
      const body = await res.json() as { ok: boolean; reason?: string };
      if (!body.ok) { toast(body.reason || '고치지 못했습니다'); return; }
      toast(`${r.plate} 인도완료`);
      await load();
    } finally { setBusy(false); }
  };

  if (err) return <CenterNote>정산원장을 못 읽었다 — {err}</CenterNote>;
  if (!data) return <Loading />;

  const th: React.CSSProperties = { padding: '6px 8px', fontSize: FS.cap, color: C.mute, fontWeight: FW.meta, textAlign: 'center', whiteSpace: 'nowrap', borderBottom: `1px solid ${C.line}` };
  const td: React.CSSProperties = { padding: '5px 8px', fontSize: FS.body, textAlign: 'center', whiteSpace: 'nowrap' };
  const tdNum: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: NUM };
  const card: React.CSSProperties = { border: `1px solid ${C.line}`, borderRadius: R_CARD, padding: 12 };
  const set = (k: string) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div style={{ padding: 16, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: FS.page, fontWeight: FW.head }}>정산관리</span>
        <span style={{ fontSize: FS.cap, color: C.mute }}>
          {data.count}줄 · {new Date(data.readAt).toLocaleString('ko-KR', { hour12: false })} 읽음
        </span>
        <span style={{ flex: 1 }} />
        <Btn onClick={() => setOpen((v) => !v)} variant={open ? 'ghost' : 'solid'}>{open ? '접기' : '계약접수'}</Btn>
        <Btn variant="ghost" onClick={load}>다시 읽기</Btn>
        <Btn variant="ghost" onClick={() => window.open(data.ledgerUrl, '_blank')}>시트 열기</Btn>
      </div>

      {open && (
        <div style={{ ...card, display: 'grid', gap: 10, background: C.head }}>
          <div style={{ fontSize: FS.body, color: C.mute }}>
            계약금이 들어온 계약을 적습니다. <b style={{ color: C.ink }}>접수일은 오늘로 박힙니다.</b>
            {' '}모델명·공급사·청구월·수수료는 기계가 채우니 비워 두세요.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Btn onClick={submit} disabled={busy}>{busy ? '접수 중…' : '접수하기'}</Btn>
            <span style={{ fontSize: FS.cap, color: C.mute }}>
              적는 곳은 시트 하나입니다 — 여기서 넣으면 원장 「접수」 탭에 줄이 생깁니다.
            </span>
          </div>
        </div>
      )}

      {/* 청구 — 월 × 공급사 */}
      <div style={{ ...card, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: FS.title, fontWeight: FW.head }}>청구</span>
          <Select value={month} onChange={setMonth} options={[{ value: '', label: '전체 달' }, ...months.map((m) => ({ value: m, label: m }))]} />
          <Select value={supplier} onChange={setSupplier} options={[{ value: '', label: '전체 공급사' }, ...suppliers.map((s) => ({ value: s, label: s }))]} />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: FS.body, color: C.mute }}>
            {tot.n}건 · 청구 <b style={{ color: C.ink }}>{won(tot.claim)}</b> · 지급 {won(tot.pay)} · 수익 <b style={{ color: C.ink }}>{won(tot.claim - tot.pay)}</b>
          </span>
        </div>
        {/* ★청구의 관문 — 「받아서 주는」 구조라 영업자 확인이 먼저다(사장님 2026-08-26).
               종이 뽑고 나서 알면 늦으니 표 위에 세운다. */}
        {month && (
          <div style={{ fontSize: FS.cap, lineHeight: 1.6 }}>
            <b>영업자 실적 확인</b>{' '}
            {gate.length === 0
              ? <span style={{ color: C.ok }}>막는 사람 없음 — 청구해도 됩니다</span>
              : (
                <span style={{ color: C.danger }}>
                  {gate.length}명이 아직입니다 — {gate.slice(0, 6).map((g) => `${g.agent}(${g.n}건)`).join(' · ')}
                  {gate.length > 6 ? ` 외 ${gate.length - 6}명` : ''}
                </span>
              )}
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr>{['공급사', '건수', '청구액', '지급액', '수익', ''].map((h, i) => <th key={h + i} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {billing.map(([sup, v]) => (
                <tr key={sup} style={{ borderTop: `1px solid ${C.line}` }}>
                  <td style={{ ...td, textAlign: 'left' }}>{sup}</td>
                  <td style={tdNum}>{v.n}</td>
                  <td style={tdNum}>{won(v.claim)}</td>
                  <td style={tdNum}>{won(v.pay)}</td>
                  <td style={{ ...tdNum, fontWeight: FW.head }}>{won(v.claim - v.pay)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {/* ★표의 한 줄이 곧 정산서 한 장이다. 달을 안 고르면 못 뽑는다 —
                           달 없는 정산서는 무엇을 청구하는 건지 알 수 없다. */}
                    <Btn variant="bare" disabled={!month}
                      onClick={() => window.open(
                        `/settlement/invoice?month=${encodeURIComponent(month)}&axis=${encodeURIComponent('공급사')}&party=${encodeURIComponent(sup)}`,
                        '_blank',
                      )}>청구서</Btn>
                  </td>
                </tr>
              ))}
              {!billing.length && <tr><td colSpan={6} style={{ ...td, color: C.mute, padding: 18 }}>그 조건에 청구할 것이 없다</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <Btn key={t} onClick={() => setTab(t)} variant={tab === t ? 'solid' : 'ghost'}>{t} {count(t)}</Btn>
        ))}
      </div>

      <div style={{ border: `1px solid ${C.line}`, borderRadius: R_CARD, overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>{['접수일', '차량번호', '공급사', '고객명', '담당', '상품구분', '기간', '렌탈료', '분납',
              '계약서', '인도', '인도일', '취소', '환수', '청구월', '청구액', '지급액', '우리몫', '다음회차', '진행']
              .map((h) => <th key={h} style={th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={`${r.plate}|${r.receivedAt}`} style={{ borderTop: `1px solid ${C.line}`, background: toneOf(r) }}>
                <td style={td}>{r.receivedAt || <span style={{ color: C.mute }}>모름</span>}</td>
                <td style={{ ...td, fontWeight: FW.meta }}>{r.plate}</td>
                <td style={td}>{r.supplier}</td>
                <td style={td}>{r.customer}</td>
                <td style={td}>{r.agent}</td>
                <td style={td}>{r.product}</td>
                <td style={tdNum}>{r.term || ''}</td>
                <td style={tdNum}>{r.rent ? won(r.rent) : ''}</td>
                <td style={td}>{r.payKind}</td>
                <td style={td}><Check on={r.paper} /></td>
                <td style={td}><Check on={r.delivered} /></td>
                <td style={td}>{r.deliveredAt}</td>
                <td style={td}><Check on={r.cancelled} /></td>
                <td style={td}><Check on={r.clawback} /></td>
                <td style={td}>{r.billingMonth || ''}</td>
                <td style={tdNum}>{r.money.claim ? won(r.money.claim) : ''}</td>
                <td style={tdNum}>{r.money.pay ? won(r.money.pay) : ''}</td>
                <td style={{ ...tdNum, fontWeight: FW.meta }}>{r.money.margin ? won(r.money.margin) : ''}</td>
                <td style={td}>{r.nextRound}</td>
                <td style={td}>
                  {/* ★말일까지 인도가 켜져야 그 달 청구로 들어온다(사장님 2026-08-26).
                         시트를 안 열고 여기서 켠다. 인도일은 «오늘»로 박는다 —
                         다른 날짜가 필요하면 시트에서 고친다(여기서 날짜를 받으면 표가 무거워진다). */}
                  {!r.delivered && !r.cancelled && (
                    <Btn variant="bare" disabled={busy}
                      onClick={() => markDelivered(r)}>인도완료</Btn>
                  )}
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={20} style={{ ...td, color: C.mute, padding: 20 }}>없다</td></tr>}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.7 }}>
        기본 보기는 <b>진행중</b>(미완료 + 당월접수)입니다 — 아직 손이 필요한 것만 보입니다.<br />
        붉은 줄 = 계약취소 · 주황 = 환수 · 옅은 초록 = 인도완료. 겹치면 센 것이 이깁니다.<br />
        <b>체크(계약서·인도·취소·환수)는 아직 시트에서 합니다.</b> 여기서는 접수만 만들 수 있습니다.
      </div>
    </div>
  );
}
