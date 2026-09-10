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
import { deliveryTransitionPatch, intakeTermMonths, localSettlementDay, sameSettlementCar } from '@/lib/domain/settlement-intake';
import './board.css';

export type Line = {
  payKind?: string; term?: number; rent?: number; ratio?: number; paper?: boolean; delivered?: boolean; model?: string;
  carryClaim?: number; carryPay?: number; prepaid?: number;
  id: string; code: string; plate: string; customer: string; supplier: string; channel: string; agent: string;
  product: string; billMonth: string; receivedAt: string; deliveredAt: string;
  claim: number; pay: number; stage: string; claimStage: string; payStage: string;
  invoiceIssued: boolean; invoiceAt: string; note: string; carryNote: string;
};
export type Party = { name: string; n: number; won: number; issued: boolean };
export type Carry = { id: string; plate: string; customer: string; supplier: string; month: string; to: string; claim: number; pay: number; prepaid: number; note: string };
export type Suggest = { suppliers: string[]; channels: string[]; agents: string[]; products: string[]; models: string[]; customers: string[]; plates: string[] };
export type Car = {
  plate: string; found: boolean; model?: string; supplier?: string; product?: string; year?: string; status?: string;
  price?: Record<string, { rent: number; deposit: number }>;
  /** 사진 한 장 — 눌러서 크게 본다. */
  photo?: string;
  /** ★원자 통째로 — 담당자가 볼 만한 밭은 다 온다(우리 내부 표시만 뺀다). */
  spec?: Record<string, string>;
};
/** 재고 한 대 — «고르는 데 필요한 것»만. 요금표는 고른 뒤에 따로 묻는다. */
export type CarLite = {
  plate: string; name: string; trim: string; maker: string; supplier: string; product: string; year: string; status: string;
  fuel: string; cls: string; km: number; seats: number; color: string;
  /** 대표 요금 — «제일 싼 기간». 손님이 먼저 묻는 것이다. */
  rent: number; deposit: number; term: string;
  /** 기간별 전부 — 조건으로 거를 때 쓴다(「48개월 70만 이하」). */
  terms: { term: string; rent: number; deposit: number }[];
  /**
   * ★우대조건 — 무보증·만21세·경력무관·무사고·분납가능.
   *   셀은 서버가 정본(`lib/domain/product-filters` 의 `hasPerk`)으로 해 둔다 —
   *   화면이 다시 짜면 같은 차가 상품찾기와 이 화면에서 다르게 보인다.
   */
  perks?: string[];
};
export type Board = {
  month: string; months: string[]; suggest: Suggest;
  sum: { claim: number; pay: number; clawSup: number; clawCh: number; net: number; rows: number };
  suppliers: Party[]; channels: Party[]; carry: Carry[]; rows: Line[]; found: Line[]; intake: Line[]; cars: CarLite[];
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
  save: (patch: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; id?: string }>;
  /** 줄 하나를 고친다 — 체크를 켜고 끄는 일. */
  edit?: (id: string, patch: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
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
  /**
   * ★★★**탭은 «정산원장» 그대로다** — 사장님 2026-09-09
   *   「요약 접수 실적 청구 이렇게 연결되잖아. 요약도 있어야겠네」
   *
   *   원장(F04) 탭이 «접수 · 취소 · 분납실적 · 완납실적 · 청구»이고, 일은 그 차례로 흐른다.
   * ```
   *   접수 → (인도되면 청구월이 박힌다) → 실적(분납·완납) → 청구 → 계산서
   * ```
   *   화면이 원장과 «같은 말»을 써야 「이게 그건가」를 안 묻는다.
   *   ⚠ 「취소」는 탭으로 안 세운다 — 일하는 표가 흐려진다(원장도 그래서 따로 뺐다).
   * ★열면 «접수»부터다 — 제일 많이 하는 일이 첫 화면이어야 한다(사장님 「접수 화면이 메인이 돼」).
   */
  const [tab, setTab] = useState<'요약' | '접수' | '실적' | '청구'>('접수');
  /** 방금 남긴 줄 — 목록에서 «그 줄»이 어디 들어갔는지 눈에 띄게 한다. */
  const [justId, setJustId] = useState('');
  /** 「자세히」 — 가끔 쓰는 칸은 접어 둔다. 한 화면을 안 넘게. */
  const [more, setMore] = useState(false);
  /** ★차 찾기 — 차번을 모를 때 모델·공급사로 좁힌다. 서버를 안 부르고 화면이 즉시 거른다. */
  const [carQ, setCarQ] = useState('');
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
  const today = useMemo(() => localSettlementDay(), []);
  const [f, setF] = useState<Record<string, string>>({
    plate: '', customer: '', supplier: '', channel: '', agent: '', product: '선출고',
    model: '', deposit: '', payKind: '일시납', deliveredAt: '', rounds: '1', round: '1',
    receivedAt: today, billMonth: '', term: '', rent: '', price: '', note: '',
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
      if (dead) return;
      if (!j || !sameSettlementCar(plate, j.plate)) { setCar(null); return; }
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
    if (S(f.billMonth) && !S(f.deliveredAt)) { toast('청구월을 넣으려면 인도일을 먼저 적어 주세요'); return; }
    setBusy(true);
    try {
      /** ★형을 «여기서» 맞춰 보낸다 — 서버가 규격으로 다시 재지만, 숫자를 글자로 보내면 그 자리에서 막힌다. */
      const rounds = Math.max(1, Number(f.rounds) || 1);
      const patch: Record<string, unknown> = {
        plate: S(f.plate), customer: S(f.customer), supplier: S(f.supplier), channel: S(f.channel),
        agent: S(f.agent), product: S(f.product), receivedAt: S(f.receivedAt), billMonth: S(f.billMonth),
        model: S(f.model), payKind: S(f.payKind), deliveredAt: S(f.deliveredAt),
        delivered: !!S(f.deliveredAt),
        /**
         * ★★**분할 청구** — 사장님 2026-09-09 「만 청구하는 거 있잖아. 그래서 **분할 청구**도 할 수 있게끔」.
         *   회차가 둘이면 이번에 «절반»만 청구하고 나머지는 다음 달로 넘긴다.
         *   ⚠ 청구만 나누지 않는다 — 지급도 같은 비율로 나뉜다(엔진 `settleRatio` 가 둘 다에 건다).
         *     한쪽만 나누면 「받은 만큼만 주는」 균형이 깨진다.
         */
        settleRatio: rounds > 1 ? Number((1 / rounds).toFixed(4)) : 1,
        carryMonth: rounds > 1 ? nextYm(S(f.billMonth)) : '',
        carryNote: rounds > 1 ? `${rounds}회 분할 청구 — 이번이 ${f.round}회차. 남은 ${rounds - Number(f.round)}회차는 다음 달에 같은 비율로 청구·지급한다` : '',
        term: intakeTermMonths(f.term), rent: Number(String(f.rent).replace(/[,\s]/g, '')) || 0,
        deposit: Number(String(f.deposit).replace(/[,\s]/g, '')) || 0,
        price: Number(String(f.price).replace(/[,\s]/g, '')) || 0, note: S(f.note),
      };
      const j = await api.save(patch);
      if (!j.ok) { toast(j.error || '못 남겼습니다'); return; }
      toast(`접수했습니다 — ${S(f.plate) || S(f.customer)} · ${S(f.billMonth) ? `${S(f.billMonth)} 청구` : '접수 대기'}`);
      setJustId(S(j.id));
      setF((o) => ({ ...o, plate: '', customer: '', model: '', term: '', rent: '', deposit: '', price: '', note: '' }));
      await load(month);
    } finally { setBusy(false); }
  };

  /** 인증 복원 전·비로그인 — 우리가 «아무것도 안 그린다». 껍데기가 로그인 화면을 그린다. */
  if (!api.ready) return null;
  if (err) return <CenterNote>{err}</CenterNote>;
  if (!board) return <Loading />;
  const { sum } = board;
  /** 접수 내역 — «최근 접수»부터. 방금 넣은 줄은 맨 위로 끌어올린다. */
  const recent = [...board.intake]
    .sort((a, b) => (a.id === justId ? -1 : b.id === justId ? 1 : `${b.receivedAt}${b.plate}`.localeCompare(`${a.receivedAt}${a.plate}`)))
    .slice(0, 12);
  /**
   * ★**실적 = 인도된 것.** 원장의 «분납실적 · 완납실적» 두 탭이 여기 하나로 온다.
   *   가르는 열쇠는 «납입 방식» — 분납이면 회차가 남아 있고, 일시납이면 끝난 것이다.
   */
  /** 친 대로 좁힌다 — 차번·모델·공급사 어디에 걸려도 된다. */
  const carHits = (() => {
    const q2 = S(carQ).replace(/\s/g, '');
    if (q2.length < 2) return [];
    return board.cars.filter((c) => `${c.plate}${c.name}${c.supplier}`.replace(/\s/g, '').includes(q2)).slice(0, 8);
  })();
  /** 고르면 접수 칸이 채워진다 — 사람이 이미 쓴 칸은 안 덮는다. */
  const pickCar = (c: CarLite) => {
    setCarQ('');
    setF((o) => ({ ...o, plate: c.plate, model: S(o.model) || c.name, supplier: S(o.supplier) || c.supplier,
      product: S(o.product) === '선출고' ? (c.product || o.product) : o.product }));
  };

  /**
   * ★★**접수 시트의 체크를 그 자리에서 켠다** — 사장님 2026-09-09
   *   「접수한 애들 **인도완료 이런 거 체크**해야 하는데 … 거기 **박스**랑 이런 것들 있는데 — 그거 그대로」
   *   계약서는 «썼나», 인도완료는 «차가 나갔나». 나가야 청구월이 박히고 실적으로 넘어간다.
   */
  const flip = async (r: Line, key: 'paper' | 'delivered', on: boolean) => {
    if (!api.edit) { toast('미리보기라 바뀌지 않습니다'); return; }
    const patch = key === 'delivered' ? deliveryTransitionPatch(on, r, today) : { paper: on };
    const res = await api.edit(r.id, patch);
    if (!res.ok) { toast(res.error || '못 바꿨습니다'); return; }
    toast(`${r.plate || r.customer} — ${key === 'paper' ? '계약서' : '인도완료'} ${on ? '켬' : '끔'}`);
    await load(month);
  };

  /**
   * ★★★**접수 줄이 지나는 «네 자리»** — 사장님 2026-09-09
   *   「접수 상태에 따라서 **색깔** 해 줘야지… **접수만 된 건지 인도 안 한 건지 계약서** 이런 거,
   *    시트를 좀 이해를 하라니까」
   *
   *   접수 시트의 체크 둘(계약서·인도완료)과 청구월이 그 줄이 어디까지 왔는지를 말한다.
   * ```
   *   ① 접수만    계약서 ✗ · 인도 ✗            회색   — 아직 아무것도 안 됐다
   *   ② 계약서     계약서 ✓ · 인도 ✗            파랑   — 썼고 차 나가기를 기다린다
   *   ③ ★할 일    인도 ✓ · 청구월 ✗           주황   — 나갔는데 달이 안 박혔다. 놓치면 사라진다
   *   ④ 넘어감     인도 ✓ · 청구월 ✓           초록   — 실적으로 간다(접수에서 빠진다)
   * ```
   *   ★주황이 «일»이다. 목록을 훑을 때 주황만 눈에 걸리면 된다.
   */
  const stateOf = (r: Line) => {
    if (r.delivered && !S(r.billMonth)) return { key: 'todo', label: '청구월 필요', tone: 'amber' as const };
    if (r.delivered) return { key: 'gone', label: '인도완료', tone: 'green' as const };
    if (r.paper) return { key: 'paper', label: '계약서 · 인도 대기', tone: 'blue' as const };
    return { key: 'new', label: '접수만', tone: 'gray' as const };
  };

  const done = board.rows.filter((r) => S(r.deliveredAt));
  const split = done.filter((r) => /분납/.test(S(r.payKind)));
  const once = done.filter((r) => !/분납/.test(S(r.payKind)));

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
        {(['요약', '접수', '실적', '청구'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className="stl-tab" onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {/**
        * ★★★**넣는 줄이 «위»에 선다** — 사장님 2026-09-09
        *   「접수화면이 좀 위에 있어야 하고 아래로 목록이 나오게 할까?? **너무 밑에 있어서**」
        *   「그리고 **접수 목록만 보이는 화면은 아니니까**」
        *
        *   이 화면의 주인공은 «넣는 일»이다. 목록은 「잘 올라갔나」를 보는 것이라 그 다음이다.
        *   ⇒ 머리 → 탭 → **입력줄** → 목록(남는 높이) 차례로 둔다.
        *   자주 쓰는 아홉 칸만 세우고, 가끔 쓰는 것은 「자세히」 뒤에 둔다.
        */}
      {tab === '접수' && (
        <div className="stl-form">
          {/**
            * ★★**차 찾기 — 한 화면 안에서.** 사장님 2026-09-09
            *   「한 페이지에서는 **차량 조회해서 바로 찾을 수 있고**」
            *   차번을 알면 아래 칸에 바로 치면 되고, 모르면 여기서 모델·공급사로 찾는다.
            */}
          <div className="stl-find">
            <Input value={carQ} onChange={setCarQ} placeholder={`차 찾기 — 모델·공급사·차번 (재고 ${board.cars.length}대)`} full />
            {carHits.length > 0 && (
              <div className="stl-hits">
                {carHits.map((c) => (
                  <button key={c.plate} type="button" className="stl-hit" onClick={() => pickCar(c)}>
                    <b>{c.plate}</b>
                    <span>{c.name}</span>
                    <small>{[c.supplier, c.product, c.year && `${c.year}년`].filter(Boolean).join(' · ')}</small>
                    {c.status && <Badge tone={c.status === '출고가능' ? 'green' : 'gray'}>{c.status}</Badge>}
                  </button>
                ))}
              </div>
            )}
          </div>
          {car?.found && (
            <div className="stl-car">
              <b>{car.model}</b>
              <span className="stl-sub" style={{ marginLeft: 8 }}>
                {[car.supplier, car.product, car.year && `${car.year}년`, car.status].filter(Boolean).join(' · ')}
              </span>
            </div>
          )}
          <div className="stl-line">
            <Fld label="차량번호"><Input value={f.plate} onChange={(v) => set('plate', v)} placeholder="치면 차가 붙습니다" list="fp-plates" full /></Fld>
            <Fld label="임차인"><Input value={f.customer} onChange={(v) => set('customer', v)} placeholder="고객 이름" list="fp-customers" full /></Fld>
            <Fld label="모델명"><Input value={f.model} onChange={(v) => set('model', v)} list="fp-models" full /></Fld>
            <Fld label="공급사"><Input value={f.supplier} onChange={(v) => set('supplier', v)} list="fp-suppliers" full /></Fld>
            <Fld label="영업채널"><Input value={f.channel} onChange={(v) => set('channel', v)} list="fp-channels" full /></Fld>
            <Fld label="영업담당자"><Input value={f.agent} onChange={(v) => set('agent', v)} placeholder="「이」만 쳐도" list="fp-agents" full /></Fld>
            <Fld label="상품 구분">
              <Select value={f.product} ariaLabel="상품 구분" full
                options={['선출고', '선발주', '신차발주', '매칭출고', '장기렌트', '구독', '오플구독', '오공구독'].map((p) => ({ value: p, label: p }))}
                onChange={(v) => set('product', v)} />
            </Fld>
            <Fld label="계약 기간">
              {car?.price && Object.keys(car.price).length
                ? <Select value={f.term} ariaLabel="계약 기간" full
                    options={Object.keys(car.price).map((k) => ({ value: k.split('_')[0], label: k.replace('_', '·') }))}
                    onChange={applyTerm} />
                : <Input inputMode="numeric" value={f.term} onChange={(v) => set('term', v)} placeholder="48" full />}
            </Fld>
            <Fld label="청구월" strong><Input value={f.billMonth} onChange={(v) => set('billMonth', v)} placeholder="비우면 접수 대기" full /></Fld>
            <div className="stl-go"><Btn onClick={() => void submit()} disabled={busy} full={mob}>{busy ? '남기는 중…' : '접수'}</Btn></div>
          </div>

          {more && (
            <div className="stl-more">
              <Fld label="접수일"><Input type="date" value={f.receivedAt} onChange={(v) => set('receivedAt', v)} full /></Fld>
              <Fld label="렌탈료"><Input inputMode="numeric" value={f.rent} onChange={(v) => set('rent', v)} full /></Fld>
              <Fld label="보증금"><Input inputMode="numeric" value={f.deposit} onChange={(v) => set('deposit', v)} full /></Fld>
              <Fld label="차량 가격"><Input inputMode="numeric" value={f.price} onChange={(v) => set('price', v)} full /></Fld>
              <Fld label="납입 방식">
                <Select value={f.payKind} ariaLabel="납입 방식" full
                  options={['일시납', '2회분납', '3회분납'].map((p) => ({ value: p, label: p }))}
                  onChange={(v) => set('payKind', v)} />
              </Fld>
              <Fld label="인도일"><Input type="date" value={f.deliveredAt} onChange={(v) => set('deliveredAt', v)} full /></Fld>
              <Fld label="분할 청구">
                <Select value={f.rounds} ariaLabel="분할 횟수" full
                  options={[{ value: '1', label: '한 번에' }, { value: '2', label: '2회 분할' }, { value: '3', label: '3회 분할' }]}
                  onChange={(v) => set('rounds', v)} />
              </Fld>
              <div style={{ gridColumn: mob ? 'span 2' : 'span 5' }}>
                <Fld label="비고"><Input value={f.note} onChange={(v) => set('note', v)} placeholder="나중에 볼 말" full /></Fld>
              </div>
            </div>
          )}

          <div className="stl-formhint">
            <Btn size="sm" variant="ghost" onClick={() => setMore(!more)}>{more ? '자세히 접기' : '자세히 — 요금·인도일·분할'}</Btn>
            <span className="stl-sub">
              {Number(f.rounds) > 1
                ? `${Math.round(100 / Number(f.rounds))}% 만 이번에 청구·지급하고 남은 회차는 ${nextYm(S(f.billMonth) || month)} 로 넘어갑니다`
                : '청구월을 비우면 «접수 대기»로 남고, 인도되면 그때 달을 박습니다. 수수료는 요율표가 채웁니다.'}
            </span>
          </div>

          <Opts id="fp-plates" list={board.suggest.plates} />
          <Opts id="fp-suppliers" list={board.suggest.suppliers} />
          <Opts id="fp-channels" list={board.suggest.channels} />
          <Opts id="fp-agents" list={board.suggest.agents} />
          <Opts id="fp-models" list={board.suggest.models} />
          <Opts id="fp-customers" list={board.suggest.customers} />
        </div>
      )}

      <div className={`stl-body${tab === '접수' ? ' stl-wide' : ''}`}>
      {tab === '접수' && (
        <>
          {/**
            * ★★★**접수 화면이 메인이고, 「내가 접수한 게 목록에 잘 올라갔나」를 보는 곳이다.**
            *   — 사장님 2026-09-09
            *   그래서 목록이 «화면을 채우고», 넣는 줄은 아래에 붙박이로 선다.
            *   넣으면 그 줄이 맨 위에 서고 초록으로 잠깐 표시된다 — 시트로 확인하러 갈 일이 없게.
            */}
          <div className="stl-card stl-fill">
            <h3>
              접수 대기
              <small>
                {board.intake.length}건 — 달로 자르지 않습니다
                {(() => {
                  const n = board.intake.reduce((a, r) => { const k = stateOf(r).key; return { ...a, [k]: (a[k] || 0) + 1 }; }, {} as Record<string, number>);
                  const parts = [n.todo && `★할 일 ${n.todo}`, n.paper && `계약서 ${n.paper}`, n.new && `접수만 ${n.new}`].filter(Boolean);
                  return parts.length ? ` · ${parts.join(' · ')}` : '';
                })()}
              </small>
            </h3>
            {recent.length === 0 && <div className="stl-sub">인도를 기다리는 줄이 없습니다.</div>}
            {recent.map((r) => (
              <div key={r.id} className={`stl-row stl-s-${stateOf(r).key}${r.id === justId ? ' stl-just' : ''}`}>
                <div className="stl-top">
                  <b>{r.plate || '(차번없음)'}</b>
                  <span>{r.customer}</span>
                  <Badge tone={stateOf(r).tone}>{stateOf(r).label}</Badge>
                  {r.id === justId && <Badge tone="green">방금 넣음</Badge>}
                  <span className="stl-money">{r.receivedAt} 접수</span>
                </div>
                <div className="stl-sub">
                  {[r.supplier, r.channel, r.agent, r.product, r.term ? `${r.term}개월` : ''].filter(Boolean).join(' · ')}
                  {r.note && ` — ${r.note}`}
                </div>
                <div className="stl-checks">
                  <label><input type="checkbox" checked={!!r.paper} onChange={(e) => void flip(r, 'paper', e.target.checked)} /> 계약서</label>
                  <label><input type="checkbox" checked={!!r.delivered} onChange={(e) => void flip(r, 'delivered', e.target.checked)} /> 인도완료</label>
                  {r.delivered && !r.billMonth && <span className="stl-warn">← 몇 월 청구인지 박아야 실적으로 넘어갑니다</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === '실적' && (
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

      {tab === '청구' && (
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

    </div>
  );
}
