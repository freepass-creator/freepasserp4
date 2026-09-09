'use client';
/**
 * **정산 콕핏의 «얼굴»** — 데이터를 어디서 가져오는지는 모른다.
 *
 * ★★사장님 2026-09-09 「일단 화면 디자인부터 하고 로그인에 붙이면 안 될까?」
 *   ⇒ 얼굴과 «데이터 오는 길»을 갈랐다. 같은 얼굴을 두 문이 쓴다.
 *     · `/settlement/board`          로그인 + 원자(진짜)
 *     · `/settlement/board/preview`  로그인 없이 + 샘플(지어낸 값) — 디자인을 보려고
 *   ⚠ 미리보기에 «진짜 값»을 절대 싣지 않는다. 로그인 없이 열리는 문이라
 *     고객 이름 하나만 새도 그건 사고다.
 *
 * ★숫자를 여기서 세지 않는다 — 서버가 엔진으로 셈해 준다(진짜 문에서).
 * ★원자만 쓴다(Btn·Input·Select·Badge·C·R·NUM) · 폰/웹 양립(useIsMobile).
 */
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Btn, Input, Select, Badge, CenterNote, Loading, SectionLabel } from '@/components/ui';
import { C, R, NUM } from '@/components/ui/tokens';
import { useIsMobile } from '@/lib/use-mobile';
import { toast } from '@/components/Toaster';
import './board.css';

export type Line = {
  id: string; code: string; plate: string; customer: string; supplier: string; channel: string; agent: string;
  product: string; billMonth: string; receivedAt: string; deliveredAt: string;
  claim: number; pay: number; stage: string; claimStage: string; payStage: string;
  invoiceIssued: boolean; invoiceAt: string; note: string; carryNote: string;
};
export type Party = { name: string; n: number; won: number; issued: boolean };
export type Carry = { id: string; plate: string; customer: string; supplier: string; month: string; to: string; claim: number; pay: number; prepaid: number; note: string };
export type Suggest = { suppliers: string[]; channels: string[]; agents: string[]; products: string[]; models: string[]; customers: string[]; plates: string[] };
export type Car = { plate: string; found: boolean; model?: string; supplier?: string; product?: string; year?: string; status?: string; price?: Record<string, { rent: number; deposit: number }> };
export type Board = {
  month: string; months: string[]; suggest: Suggest;
  sum: { claim: number; pay: number; clawSup: number; clawCh: number; net: number; rows: number };
  suppliers: Party[]; channels: Party[]; carry: Carry[]; rows: Line[]; found: Line[];
};

const won = (n: number) => Math.round(n || 0).toLocaleString('ko-KR');
const S = (v: unknown) => String(v ?? '').trim();
/** 다음 달 — 접수하면 보통 그 달이나 다음 달 청구다. 기본값을 주되 «고를 수 있게» 둔다. */
const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
/** 다음 달 — 분할 청구의 «남은 회차»가 갈 곳. */
const nextYm = (m: string) => { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm, 1); return ymOf(d); };


export type BoardApi = {
  /** 그 달을 읽어 온다. 미리보기는 샘플을 그냥 돌려준다. */
  load: (month?: string, q?: string) => Promise<Board | null>;
  /** 접수를 남긴다. 미리보기는 «안 쓴다»고 알려 준다. */
  save: (patch: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  /** 차 한 대를 원자에서 끌어온다. */
  car: (plate: string) => Promise<Car | null>;
  /** 인증을 기다려야 하나 — 미리보기는 아니다. */
  ready: boolean;
};

export default function SettlementBoard({ api, preview = false }: { api: BoardApi; preview?: boolean }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [month, setMonth] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  /**
   * ★★**접수가 «메인»이다** — 사장님 2026-09-09
   *   「접수하면 제일 많이 쓸 거야. 그 접수 화면이 메인이 돼. 우리 지금도 접수가 메인이잖아」
   *   그래서 열면 접수부터 뜬다. 요약은 «보는 것»이고 접수는 «하는 것»이다.
   */
  const [tab, setTab] = useState<'접수' | '요약' | '찾기' | '넘길것'>('접수');
  /** ★웹은 넓게, 폰은 한 칸 — 사장님 2026-09-09 「폰이랑 웹에서 다 써야지」. */
  const mob = useIsMobile();

  const load = useCallback(async (m?: string, query?: string) => {
    setErr('');
    const j = await api.load(m, query);
    if (!j) { setErr('못 읽었습니다'); return; }
    setBoard(j); setMonth(j.month);
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  /* ── 접수 폼 ─────────────────────────────────────────────── */
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [f, setF] = useState<Record<string, string>>({
    plate: '', customer: '', supplier: '', channel: '', agent: '', product: '선출고',
    model: '', deposit: '', payKind: '일시납', deliveredAt: '', rounds: '1', round: '1',
    receivedAt: today, billMonth: ymOf(new Date()), term: '', rent: '', price: '', note: '',
  });
  const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v }));
  const [car, setCar] = useState<Car | null>(null);

  /**
   * ★★★**차번을 치면 그 차를 «원자에서» 끌어온다** — 사장님 2026-09-09
   *   「프리패스 그 원자가 차량 정보에 다 있잖아 … 몇 개만 타닥 쓰면 딱 선택」
   *
   *   ⚠ **사람이 쓴 값은 안 덮는다.** 빈 칸만 채운다 — 원자가 사람보다 낫다고 볼 근거가 없고,
   *     덮으면 「고쳐 놨는데 되돌아간다」가 된다(오늘 시트에서 그 사고를 두 번 봤다).
   *   ⚠ 못 찾으면 «가만히» 둔다. 없는 차는 직접 적으면 된다 — 지어내지 않는다.
   */
  useEffect(() => {
    const plate = S(f.plate).replace(/\s/g, '');
    if (plate.length < 4) { setCar(null); return; }
    let dead = false;
    const t = setTimeout(async () => {
      const j = await api.car(plate);
      if (dead || !j) { setCar(null); return; }
      setCar(j.found ? j : null);
      if (!j.found) return;
      setF((o) => ({
        ...o,
        model: S(o.model) || S(j.model),
        supplier: S(o.supplier) || S(j.supplier),
        product: S(o.product) === '선출고' ? (S(j.product) || o.product) : o.product,
      }));
    }, 350);
    return () => { dead = true; clearTimeout(t); };
  }, [f.plate]);

  /** 기간을 고르면 그 기간 요금이 따라온다 — 재고 원자의 «기간별 요금표» 그대로. */
  const applyTerm = (term: string) => {
    set('term', term);
    const p = car?.price || {};
    const key = Object.keys(p).find((k) => k === term || k.startsWith(`${term}_`));
    if (!key) return;
    setF((o) => ({ ...o, term, rent: String(p[key].rent || ''), deposit: String(p[key].deposit || '') }));
  };

  const submit = async () => {
    if (!S(f.plate) && !S(f.customer)) { toast('차량번호나 고객명 하나는 적어 주세요'); return; }
    setBusy(true);
    try {
      /** ★형을 «여기서» 맞춰 보낸다 — 서버가 규격으로 다시 재지만, 숫자를 글자로 보내면 그 자리에서 막힌다. */
      const rounds = Math.max(1, Number(f.rounds) || 1);
      const patch: Record<string, unknown> = {
        plate: S(f.plate), customer: S(f.customer), supplier: S(f.supplier), channel: S(f.channel),
        agent: S(f.agent), product: S(f.product), receivedAt: S(f.receivedAt), billMonth: S(f.billMonth),
        model: S(f.model), payKind: S(f.payKind), deliveredAt: S(f.deliveredAt),
        /**
         * ★★**분할 청구** — 사장님 2026-09-09 「만 청구하는 거 있잖아. 그래서 **분할 청구**도 할 수 있게끔」.
         *   회차가 둘이면 이번에 «절반»만 청구하고 나머지는 다음 달로 넘긴다.
         *   ⚠ 청구만 나누지 않는다 — 지급도 같은 비율로 나뉜다(엔진 `settleRatio` 가 둘 다에 건다).
         *     한쪽만 나누면 「받은 만큼만 주는」 균형이 깨진다.
         */
        settleRatio: rounds > 1 ? Number((1 / rounds).toFixed(4)) : 1,
        carryMonth: rounds > 1 ? nextYm(S(f.billMonth)) : '',
        carryNote: rounds > 1 ? `${rounds}회 분할 청구 — 이번이 ${f.round}회차. 남은 ${rounds - Number(f.round)}회차는 다음 달에 같은 비율로 청구·지급한다` : '',
        term: Number(f.term) || 0, rent: Number(String(f.rent).replace(/[,\s]/g, '')) || 0,
        deposit: Number(String(f.deposit).replace(/[,\s]/g, '')) || 0,
        price: Number(String(f.price).replace(/[,\s]/g, '')) || 0, note: S(f.note),
      };
      const j = await api.save(patch);
      if (!j.ok) { toast(j.error || '못 남겼습니다'); return; }
      toast(`접수했습니다 — ${S(f.plate) || S(f.customer)} · ${S(f.billMonth)} 청구`);
      setF((o) => ({ ...o, plate: '', customer: '', model: '', term: '', rent: '', deposit: '', price: '', note: '' }));
      await load(month);
    } finally { setBusy(false); }
  };

  /** 인증 복원 전·비로그인 — 우리가 «아무것도 안 그린다». 껍데기가 로그인 화면을 그린다. */
  if (!api.ready) return null;
  if (err) return <CenterNote>{err}</CenterNote>;
  if (!board) return <Loading />;
  const { sum } = board;

  /** 칸 하나 — 라벨을 «위»에 세운다. 시트를 보던 눈이 그대로 따라오게. */
  const Fld = ({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) => (
    <label className={`stl-fld${strong ? ' stl-key' : ''}`}><span>{label}</span>{children}</label>
  );

  /**
   * ★**자동완성 목록** — 「이」만 쳐도 「이태헌」이 뜬다. 자유 입력은 막지 않는다(새 이름도 받아야 한다).
   *   목록은 원자에서 온 «이미 쓴 이름»이고, 자주 쓴 것이 위에 온다.
   */
  const Opts = ({ id, list }: { id: string; list: string[] }) => (
    <datalist id={id}>{list.map((v) => <option key={v} value={v} />)}</datalist>
  );

  const Bar = ({ label, value, net }: { label: string; value: string; net?: boolean }) => (
    <div className={`stl-sum${net ? ' stl-net' : ''}`}><span>{label}</span><b>{value}</b></div>
  );

  return (
    <div className="stl-root">
      {/* 제 머리 — ERP 껍데기를 벗었으니 우리가 그린다(사장님 「프리패스랑 안 붙이고」). */}
      <div className="stl-head">
        <b>정산</b>
        {preview && <Badge tone="amber">미리보기 — 지어낸 값</Badge>}
        <select value={month} aria-label="정산 달" onChange={(e) => { setMonth(e.target.value); void load(e.target.value); }}>
          {board.months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="stl-count">{sum.rows}줄</span>
      </div>

      <div className="stl-tabs" role="tablist">
        {(['접수', '요약', '찾기', '넘길것'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className="stl-tab" onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      <div className="stl-body">
      {tab === '접수' && (
        <>
          <div className="stl-card"><h3>접수 <small>정산서와 «같은 칸»입니다</small></h3>
          {car?.found && (
            <div className="stl-car">
              <b>{car.model}</b>
              <span className="stl-sub" style={{ marginLeft: 8 }}>
                {[car.supplier, car.product, car.year && `${car.year}년`, car.status].filter(Boolean).join(' · ')}
              </span>
              <div className="stl-sub">재고 원자에서 붙였습니다 — 고치실 수 있고, 이미 쓰신 칸은 안 덮습니다.</div>
            </div>
          )}
          {/**
           * ★★**시트와 어색하지 않게** — 사장님 2026-09-09 「지금 시트랑 많이 어색하지 않게끔」·「직관적이게」.
           *   칸 이름·차례를 공급사 정산서(`settleHeadFor('공급사')`) 그대로 뒀다 —
           *   매일 보는 종이와 말이 같아야 「이게 그건가?」를 안 묻는다.
           *   접수일 · 차량번호 · 모델명 · 임차인 · 상품 구분 · 계약 기간 · 렌탈료 · 보증금 · 차량 가격 · 납입 방식 · 인도일 · 청구월
           */}
          <div className="stl-grid">
            <Fld label="접수일"><Input type="date" value={f.receivedAt} onChange={(v) => set('receivedAt', v)} full /></Fld>
            <Fld label="차량번호"><Input value={f.plate} onChange={(v) => set('plate', v)} placeholder="161호1543 — 치면 차가 붙습니다" list="fp-plates" full /></Fld>
            <Fld label="모델명"><Input value={f.model} onChange={(v) => set('model', v)} placeholder="쏘렌토" list="fp-models" full /></Fld>
            <Fld label="임차인"><Input value={f.customer} onChange={(v) => set('customer', v)} placeholder="고객 이름" list="fp-customers" full /></Fld>

            <Fld label="상품 구분">
              <Select value={f.product} ariaLabel="상품 구분" full
                options={['선출고', '선발주', '신차발주', '매칭출고', '장기렌트', '구독', '오플구독', '오공구독'].map((p) => ({ value: p, label: p }))}
                onChange={(v) => set('product', v)} />
            </Fld>
            <Fld label="계약 기간">
              {car?.price && Object.keys(car.price).length
                ? <Select value={f.term} ariaLabel="계약 기간" full
                    options={Object.keys(car.price).map((k) => ({ value: k.split('_')[0], label: `${k.replace('_', ' · ')}개월` }))}
                    onChange={applyTerm} />
                : <Input inputMode="numeric" value={f.term} onChange={(v) => set('term', v)} placeholder="48" full />}
            </Fld>
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

          </div>

          <div className="stl-card"><h3>상대 <small>누구에게 받고 누구에게 주나</small></h3>
          <div className="stl-grid stl-3">
            <Fld label="공급사 — 받는다"><Input value={f.supplier} onChange={(v) => set('supplier', v)} placeholder="웰릭스" list="fp-suppliers" full /></Fld>
            <Fld label="영업채널 — 준다"><Input value={f.channel} onChange={(v) => set('channel', v)} placeholder="하허호" list="fp-channels" full /></Fld>
            <Fld label="영업담당자"><Input value={f.agent} onChange={(v) => set('agent', v)} placeholder="이태헌 — 「이」만 쳐도 뜹니다" list="fp-agents" full /></Fld>
          </div>

          </div>

          <div className="stl-card"><h3>청구 방식 <small>나눠 청구할 수 있습니다</small></h3>
          {/**
            * ★★**분할 청구** — 사장님 2026-09-09 「만 청구하는 거 있잖아. 그래서 분할 청구도 할 수 있게끔」.
            *   ERP 라서 시트와 다른 점이 여기다 — «접수된 계약 하나»를 여러 달에 걸쳐 청구하고
            *   실적을 잡는다. 남은 회차는 「넘길것」에 저절로 서서 다음 달에 잊히지 않는다.
            */}
          <div className="stl-grid">
            <Fld label="분할 횟수">
              <Select value={f.rounds} ariaLabel="분할 횟수" full
                options={[{ value: '1', label: '한 번에 (분할 없음)' }, { value: '2', label: '2회 분할' }, { value: '3', label: '3회 분할' }]}
                onChange={(v) => set('rounds', v)} />
            </Fld>
            {Number(f.rounds) > 1 && (
              <Fld label="이번이 몇 회차">
                <Select value={f.round} ariaLabel="이번 회차" full
                  options={Array.from({ length: Number(f.rounds) }, (_, i) => ({ value: String(i + 1), label: `${i + 1}회차` }))}
                  onChange={(v) => set('round', v)} />
              </Fld>
            )}
          </div>
          {Number(f.rounds) > 1 && (
            <p style={{ color: C.mute, fontSize: 12, margin: '6px 0 0', lineHeight: 1.6 }}>
              이번 달에는 <b>{Math.round(100 / Number(f.rounds))}%</b>만 청구·지급하고,
              남은 회차는 <b>{nextYm(S(f.billMonth))}</b> 로 넘어갑니다 — 「넘길것」 탭에서 보입니다.
            </p>
          )}

          <div style={{ marginTop: 12 }} />
          <Fld label="비고"><Input value={f.note} onChange={(v) => set('note', v)} placeholder="나중에 볼 말" full /></Fld>

          <p style={{ color: C.mute, fontSize: 12, margin: '8px 0 0', lineHeight: 1.6 }}>
            수수료는 안 적어도 됩니다 — 요율표가 아는 것은 정산 낼 때 저절로 채워집니다.<br />
            시트에 옮겨 적지 않아도 이 줄이 그대로 <b>정산서·계산서</b>로 갑니다.
          </p>
          </div>
          <Opts id="fp-plates" list={board.suggest.plates} />
          <Opts id="fp-suppliers" list={board.suggest.suppliers} />
          <Opts id="fp-channels" list={board.suggest.channels} />
          <Opts id="fp-agents" list={board.suggest.agents} />
          <Opts id="fp-models" list={board.suggest.models} />
          <Opts id="fp-customers" list={board.suggest.customers} />
        </>
      )}

      {tab === '찾기' && (
        <>
          <div className="stl-card">
            <div style={{ display: 'flex', gap: 8 }}>
              <Input placeholder="차번 · 이름 · 상대" value={q} onChange={(v) => setQ(v)} onEnter={() => void load(month, q)} full />
              <Btn size="sm" onClick={() => void load(month, q)}>찾기</Btn>
            </div>
          </div>
          <div className="stl-card">
          {board.found.length === 0 && <CenterNote>찾을 말을 적어 주세요</CenterNote>}
          {board.found.map((r) => (
            <div key={r.id} className="stl-row">
              <div className="stl-top">
                <b>{r.plate || '(차번없음)'}</b>
                <span>{r.customer}</span>
                <Badge tone="gray">{r.billMonth || '달없음'}</Badge>
                {r.invoiceIssued && <Badge tone="green">계산서 {r.invoiceAt}</Badge>}
                <span className="stl-money">
                  청구 {won(r.claim)} · 지급 {won(r.pay)}
                </span>
              </div>
              <div className="stl-sub">
                {[r.supplier, r.channel, r.agent, r.product].filter(Boolean).join(' · ')}
                {r.claimStage && ` — 청구 ${r.claimStage} / 지급 ${r.payStage}`}
              </div>
              {r.note && <div className="stl-sub">{r.note}</div>}
            </div>
          ))}
          </div>
        </>
      )}

      {tab === '넘길것' && (
        <>
          <div className="stl-card"><h3>다음 달에 할 일 <small>돈이 붙은 이월</small></h3>
          {board.carry.length === 0 && <CenterNote>넘길 것이 없습니다</CenterNote>}
          {board.carry.map((c) => (
            <div key={c.id} className="stl-row">
              <div className="stl-top">
                <b>{c.plate || '(차번없음)'}</b>
                <span>{c.customer}</span>
                <Badge tone="gray">{c.month} → {c.to || '?'}</Badge>
                <span className="stl-money">
                  {!!c.claim && `청구 ${won(c.claim)}`}{!!c.pay && ` · 지급 ${won(c.pay)}`}
                  {!!c.prepaid && ` · 선지급 ${won(c.prepaid)}`}
                </span>
              </div>
              {c.note && <div className="stl-sub">{c.note}</div>}
            </div>
          ))}
          </div>
        </>
      )}
      </div>

      {/**
        * ★**하단 실행 바** — 폰에서 스크롤 끝까지 안 가도 누른다.
        *   접수 탭에서만 선다 — 볼 때는 누를 것이 없다.
        */}
      {tab === '접수' && (
        <div className="stl-dock">
          <span className="stl-hint">
            {S(f.plate) || S(f.customer) ? `${S(f.plate) || S(f.customer)} · ${S(f.billMonth)} 청구` : '차번이나 고객명을 적으면 남길 수 있습니다'}
          </span>
          <Btn onClick={() => void submit()} disabled={busy}>{busy ? '남기는 중…' : '접수 남기기'}</Btn>
        </div>
      )}
    </div>
  );
}
