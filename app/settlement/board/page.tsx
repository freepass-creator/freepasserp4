'use client';
/**
 * **정산 콕핏 — 시트 안 열고 폰에서 본다·남긴다.** 관리자만.
 *
 * ★★★사장님 2026-09-09
 *   「이거 정산만 따로 견적기처럼 페이지 만들어 줄 수 있나??」·「관리자가 볼 거야」
 *   「이제 관리자한테 **시트 기준으로 하지 말고 쉽게 남기게끔** 하는 거야」
 *   「**핸드폰에서** 할 수 있게 탭이나 이런 거에서 **간단하게 접수**하고
 *    그거 **몇 월 청구인지 기재**하고 이런 거」
 *   「니가 계산서 발행까지 해낸 거잖아」
 *
 * ★★**사슬에서 시트가 남은 곳은 「접수」 하나뿐이었다.**
 * ```
 *   접수 → 원장 → 원자 → 정산서 → 계산서 → 홈택스 거두기
 *    ↑ 여기                └─────── 도구가 다 한다 ───────┘
 * ```
 *   접수를 폰에서 받으면 **원자가 처음부터 정본**이 되고 시트를 안 열어도 된다.
 *
 * ★**숫자를 여기서 세지 않는다.** 전부 서버(`/api/settlement/board`)가 엔진으로 셈해 준다.
 *   화면이 곱하기 시작하면 그 순간 정본이 둘이 된다 — 대수가 두 군데서 세어지던 그 사고와 같다.
 *
 * ★껍데기 — 견적과 «같은 갈래»다. 상단바는 벗고 하단 홈바는 얹는다(`lib/guest-surface`).
 *   폰에서 매일 여는 업무 화면이라 다른 탭으로 오갈 길이 있어야 한다.
 * ★원자만 쓴다 — `Btn`·`Input`·`Select`·`Badge`·`C`·`R`·`NUM`. raw 컨트롤 금지(CLAUDE.md 절대원칙 ①).
 */
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAuthClient } from '@/lib/firebase/client';
import { Btn, Input, Select, Badge, CenterNote, Loading, SectionLabel } from '@/components/ui';
import { C, R, NUM } from '@/components/ui/tokens';
import { useIsMobile } from '@/lib/use-mobile';
import { toast } from '@/components/Toaster';

type Line = {
  id: string; code: string; plate: string; customer: string; supplier: string; channel: string; agent: string;
  product: string; billMonth: string; receivedAt: string; deliveredAt: string;
  claim: number; pay: number; stage: string; claimStage: string; payStage: string;
  invoiceIssued: boolean; invoiceAt: string; note: string; carryNote: string;
};
type Party = { name: string; n: number; won: number; issued: boolean };
type Carry = { id: string; plate: string; customer: string; supplier: string; month: string; to: string; claim: number; pay: number; prepaid: number; note: string };
type Board = {
  month: string; months: string[];
  sum: { claim: number; pay: number; clawSup: number; clawCh: number; net: number; rows: number };
  suppliers: Party[]; channels: Party[]; carry: Carry[]; rows: Line[]; found: Line[];
};

const won = (n: number) => Math.round(n || 0).toLocaleString('ko-KR');
const S = (v: unknown) => String(v ?? '').trim();
/** 다음 달 — 접수하면 보통 그 달이나 다음 달 청구다. 기본값을 주되 «고를 수 있게» 둔다. */
const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

async function bearer(): Promise<string | null> {
  const user = getAuthClient()?.currentUser;
  return user ? user.getIdToken() : null;
}

export default function SettlementBoardPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [month, setMonth] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  /** 화면 넷 — 폰에서 손가락 하나로 오간다. */
  const [tab, setTab] = useState<'요약' | '접수' | '찾기' | '넘길것'>('요약');
  /** ★웹은 넓게, 폰은 한 칸 — 사장님 2026-09-09 「폰이랑 웹에서 다 써야지」. */
  const mob = useIsMobile();

  const load = useCallback(async (m?: string, query?: string) => {
    setErr('');
    const t = await bearer();
    if (!t) { setErr('로그인이 필요합니다'); return; }
    const p = new URLSearchParams();
    if (m) p.set('month', m);
    if (query) p.set('q', query);
    const r = await fetch(`/api/settlement/board?${p}`, { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' });
    if (!r.ok) { setErr(r.status === 403 ? '관리자만 봅니다' : `못 읽었습니다 (${r.status})`); return; }
    const j = await r.json() as Board;
    setBoard(j); setMonth(j.month);
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* ── 접수 폼 ─────────────────────────────────────────────── */
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [f, setF] = useState<Record<string, string>>({
    plate: '', customer: '', supplier: '', channel: '', agent: '', product: '선출고',
    model: '', deposit: '', payKind: '일시납', deliveredAt: '',
    receivedAt: today, billMonth: ymOf(new Date()), term: '', rent: '', price: '', note: '',
  });
  const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v }));

  const submit = async () => {
    if (!S(f.plate) && !S(f.customer)) { toast('차량번호나 고객명 하나는 적어 주세요'); return; }
    setBusy(true);
    try {
      const t = await bearer();
      /** ★형을 «여기서» 맞춰 보낸다 — 서버가 규격으로 다시 재지만, 숫자를 글자로 보내면 그 자리에서 막힌다. */
      const patch: Record<string, unknown> = {
        plate: S(f.plate), customer: S(f.customer), supplier: S(f.supplier), channel: S(f.channel),
        agent: S(f.agent), product: S(f.product), receivedAt: S(f.receivedAt), billMonth: S(f.billMonth),
        model: S(f.model), payKind: S(f.payKind), deliveredAt: S(f.deliveredAt),
        term: Number(f.term) || 0, rent: Number(String(f.rent).replace(/[,\s]/g, '')) || 0,
        deposit: Number(String(f.deposit).replace(/[,\s]/g, '')) || 0,
        price: Number(String(f.price).replace(/[,\s]/g, '')) || 0, note: S(f.note),
      };
      const r = await fetch('/api/settlement/board', {
        method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch }),
      });
      const j = await r.json() as { ok?: boolean; error?: string; id?: string };
      if (!r.ok || !j.ok) { toast(j.error || `못 남겼습니다 (${r.status})`); return; }
      toast(`접수했습니다 — ${S(f.plate) || S(f.customer)} · ${S(f.billMonth)} 청구`);
      setF((o) => ({ ...o, plate: '', customer: '', model: '', term: '', rent: '', deposit: '', price: '', note: '' }));
      await load(month);
    } finally { setBusy(false); }
  };

  if (err) return <CenterNote>{err}</CenterNote>;
  if (!board) return <Loading />;
  const { sum } = board;

  /** 칸 하나 — 라벨을 «위»에 세운다. 시트를 보던 눈이 그대로 따라오게. */
  const Fld = ({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) => (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 12, color: strong ? C.brand : C.mute, fontWeight: strong ? 700 : 400 }}>{label}</span>
      {children}
    </label>
  );

  const Bar = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0' }}>
      <span style={{ color: C.mute, fontSize: 13 }}>{label}</span>
      <b style={{ fontFamily: NUM, fontSize: 15, color: tone || C.ink }}>{value}</b>
    </div>
  );

  return (
    <div style={{ maxWidth: mob ? 720 : 1100, margin: '0 auto', padding: mob ? '12px 14px 88px' : '16px 20px 40px' }}>
      {/* 제 머리 — ERP 상단바는 벗었다(guest-surface). */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <b style={{ fontSize: 17 }}>정산</b>
        <Select value={month} options={board.months.map((m) => ({ value: m, label: m }))}
          onChange={(v) => { setMonth(v); void load(v); }} ariaLabel="정산 달" />
        <span style={{ marginLeft: 'auto', color: C.mute, fontSize: 12 }}>{sum.rows}줄</span>
      </div>

      {/* 탭 — 폰에서 손가락 하나로 */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['요약', '접수', '찾기', '넘길것'] as const).map((t) => (
          <Btn key={t} size="sm" variant={tab === t ? 'solid' : 'ghost'} onClick={() => setTab(t)}>{t}</Btn>
        ))}
      </div>

      {tab === '요약' && (
        <>
          <div style={{ border: `1px solid ${C.line}`, borderRadius: R, padding: '10px 14px', marginBottom: 14 }}>
            <Bar label="청구 — 공급사에서 받는다" value={won(sum.claim - sum.clawSup)} />
            <Bar label="지급 — 영업채널에 준다" value={won(sum.pay - sum.clawCh)} />
            <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 4 }} />
            <Bar label="우리 몫" value={won(sum.net)} tone={C.brand} />
            {!!sum.clawSup && <Bar label="환수(공급사)" value={`−${won(sum.clawSup)}`} tone={C.danger} />}
          </div>

          <SectionLabel>공급사 — 받을 곳 · 계산서</SectionLabel>
          {board.suppliers.map((p) => (
            <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 2px', borderBottom: `1px solid ${C.line2}` }}>
              <span style={{ minWidth: 84 }}>{p.name}</span>
              <span style={{ color: C.mute, fontSize: 12 }}>{p.n}건</span>
              <b style={{ marginLeft: 'auto', fontFamily: NUM }}>{won(p.won)}</b>
              <Badge tone={p.issued ? 'green' : 'amber'}>{p.issued ? '발행' : '아직'}</Badge>
            </div>
          ))}

          <SectionLabel mt={16}>영업채널 — 줄 곳</SectionLabel>
          {board.channels.map((p) => (
            <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 2px', borderBottom: `1px solid ${C.line2}` }}>
              <span style={{ minWidth: 84 }}>{p.name}</span>
              <span style={{ color: C.mute, fontSize: 12 }}>{p.n}건</span>
              <b style={{ marginLeft: 'auto', fontFamily: NUM }}>{won(p.won)}</b>
            </div>
          ))}
        </>
      )}

      {tab === '접수' && (
        <>
          <SectionLabel>접수 — 정산서와 «같은 칸»입니다</SectionLabel>
          {/**
           * ★★**시트와 어색하지 않게** — 사장님 2026-09-09 「지금 시트랑 많이 어색하지 않게끔」·「직관적이게」.
           *   칸 이름·차례를 공급사 정산서(`settleHeadFor('공급사')`) 그대로 뒀다 —
           *   매일 보는 종이와 말이 같아야 「이게 그건가?」를 안 묻는다.
           *   접수일 · 차량번호 · 모델명 · 임차인 · 상품 구분 · 계약 기간 · 렌탈료 · 보증금 · 차량 가격 · 납입 방식 · 인도일 · 청구월
           */}
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: mob ? '1fr 1fr' : 'repeat(4, 1fr)' }}>
            <Fld label="접수일"><Input type="date" value={f.receivedAt} onChange={(v) => set('receivedAt', v)} full /></Fld>
            <Fld label="차량번호"><Input value={f.plate} onChange={(v) => set('plate', v)} placeholder="161호1543" full /></Fld>
            <Fld label="모델명"><Input value={f.model} onChange={(v) => set('model', v)} placeholder="쏘렌토" full /></Fld>
            <Fld label="임차인"><Input value={f.customer} onChange={(v) => set('customer', v)} placeholder="고객 이름" full /></Fld>

            <Fld label="상품 구분">
              <Select value={f.product} ariaLabel="상품 구분" full
                options={['선출고', '선발주', '신차발주', '매칭출고', '장기렌트', '구독', '오플구독', '오공구독'].map((p) => ({ value: p, label: p }))}
                onChange={(v) => set('product', v)} />
            </Fld>
            <Fld label="계약 기간"><Input inputMode="numeric" value={f.term} onChange={(v) => set('term', v)} placeholder="48" full /></Fld>
            <Fld label="렌탈료"><Input inputMode="numeric" value={f.rent} onChange={(v) => set('rent', v)} placeholder="1,170,000" full /></Fld>
            <Fld label="보증금"><Input inputMode="numeric" value={f.deposit} onChange={(v) => set('deposit', v)} placeholder="1,100,000" full /></Fld>

            <Fld label="차량 가격(신차)"><Input inputMode="numeric" value={f.price} onChange={(v) => set('price', v)} placeholder="54,041,912" full /></Fld>
            <Fld label="납입 방식">
              <Select value={f.payKind} ariaLabel="납입 방식" full
                options={['일시납', '2회분납', '3회분납'].map((p) => ({ value: p, label: p }))}
                onChange={(v) => set('payKind', v)} />
            </Fld>
            <Fld label="인도일"><Input type="date" value={f.deliveredAt} onChange={(v) => set('deliveredAt', v)} full /></Fld>
            {/* ★★사장님 「그거 몇 월 청구인지 기재하고」 — 접수의 핵심 칸이라 주색으로 세운다. */}
            <Fld label="청구월" strong><Input value={f.billMonth} onChange={(v) => set('billMonth', v)} placeholder="2026-09" full /></Fld>
          </div>

          <SectionLabel mt={16}>상대 — 누구에게 받고 누구에게 주나</SectionLabel>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: mob ? '1fr' : 'repeat(3, 1fr)' }}>
            <Fld label="공급사 — 받는다"><Input value={f.supplier} onChange={(v) => set('supplier', v)} placeholder="웰릭스" full /></Fld>
            <Fld label="영업채널 — 준다"><Input value={f.channel} onChange={(v) => set('channel', v)} placeholder="하허호" full /></Fld>
            <Fld label="영업담당자"><Input value={f.agent} onChange={(v) => set('agent', v)} placeholder="이태헌" full /></Fld>
          </div>

          <div style={{ marginTop: 14 }} />
          <Fld label="비고"><Input value={f.note} onChange={(v) => set('note', v)} placeholder="나중에 볼 말" full /></Fld>

          <Btn onClick={() => void submit()} disabled={busy}>{busy ? '남기는 중…' : '접수 남기기'}</Btn>
          <p style={{ color: C.mute, fontSize: 12, margin: '8px 0 0', lineHeight: 1.6 }}>
            수수료는 안 적어도 됩니다 — 요율표가 아는 것은 정산 낼 때 저절로 채워집니다.<br />
            시트에 옮겨 적지 않아도 이 줄이 그대로 <b>정산서·계산서</b>로 갑니다.
          </p>
        </>
      )}

      {tab === '찾기' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <Input placeholder="차번 · 이름 · 상대" value={q} onChange={(v) => setQ(v)} full />
            <Btn size="sm" onClick={() => void load(month, q)}>찾기</Btn>
          </div>
          {board.found.length === 0 && <CenterNote>찾을 말을 적어 주세요</CenterNote>}
          {board.found.map((r) => (
            <div key={r.id} style={{ padding: '9px 2px', borderBottom: `1px solid ${C.line2}` }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <b>{r.plate || '(차번없음)'}</b>
                <span>{r.customer}</span>
                <Badge tone="gray">{r.billMonth || '달없음'}</Badge>
                {r.invoiceIssued && <Badge tone="green">계산서 {r.invoiceAt}</Badge>}
                <span style={{ marginLeft: 'auto', fontFamily: NUM, fontSize: 13 }}>
                  청구 {won(r.claim)} · 지급 {won(r.pay)}
                </span>
              </div>
              <div style={{ color: C.mute, fontSize: 12, marginTop: 2 }}>
                {[r.supplier, r.channel, r.agent, r.product].filter(Boolean).join(' · ')}
                {r.claimStage && ` — 청구 ${r.claimStage} / 지급 ${r.payStage}`}
              </div>
              {r.note && <div style={{ color: C.mute, fontSize: 12 }}>{r.note}</div>}
            </div>
          ))}
        </>
      )}

      {tab === '넘길것' && (
        <>
          <SectionLabel>다음 달에 할 일 — 돈이 붙은 이월</SectionLabel>
          {board.carry.length === 0 && <CenterNote>넘길 것이 없습니다</CenterNote>}
          {board.carry.map((c) => (
            <div key={c.id} style={{ padding: '9px 2px', borderBottom: `1px solid ${C.line2}` }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <b>{c.plate || '(차번없음)'}</b>
                <span>{c.customer}</span>
                <Badge tone="gray">{c.month} → {c.to || '?'}</Badge>
                <span style={{ marginLeft: 'auto', fontFamily: NUM, fontSize: 13 }}>
                  {!!c.claim && `청구 ${won(c.claim)}`}{!!c.pay && ` · 지급 ${won(c.pay)}`}
                  {!!c.prepaid && ` · 선지급 ${won(c.prepaid)}`}
                </span>
              </div>
              {c.note && <div style={{ color: C.mute, fontSize: 12, marginTop: 2 }}>{c.note}</div>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
