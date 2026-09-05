'use client';
/**
 * 견적 — **완전 별도 페이지**(사장님 2026-09-06 「모바일에서 보여지는 거 그대로 · 완전 별도 페이지라고
 * 얘기할 정도로」). 설계서 §11·§12.
 *
 * ★★화면의 정본은 **사장님이 주신 목업** `C:\Users\admin\Documents\프리패스-목업-모바일계산기.html` 이다.
 *   마크업·클래스·문구·차례를 그 목업에서 그대로 옮겼다. 스타일은 `components/estimate/estimate.css`
 *   (목업 `<style>` 통째로 · `.est-root` 로만 가둠).
 *   ⚠ 2026-09-06 에 한 번 다른 소스(sonogong-estimator `MobileApp.vue`)를 옮겨 놓았다가
 *     「목업을 줬는데 그거 그대로 하라는데 이게 이렇게 힘드냐」를 들었다. **목업이 이긴다.**
 *   ⚠ 목업에 없는 칸을 여기서 «만들지» 않는다. 필요하면 목업을 먼저 고친다.
 *
 * ★이 층은 업무동 규격을 안 따른다. 전자계약(`/sign`)과 «같은 갈래»다 —
 *   자기 CSS 를 갖고, ERP 상단바·하단 홈바를 벗는다.
 *   벗기는 건 `lib/guest-surface.ts` 한 곳이 정한다(거기 한 줄이 이 페이지를 독립으로 만든다).
 *   ⚠ 로그인은 **필요하다** — `lib/public-access.ts` 에 넣지 않았다.
 *     이 화면은 원가·마진·손익을 보여준다. 손님이 우리 원가를 보면 안 된다.
 *
 * ★숫자는 **한 줄도 여기서 계산하지 않는다.** 전부 `lib/domain/estimate` 엔진이 낸다
 *   (손오공 견적기에서 무손실 이관 · 회귀 39개 = `npm run test:estimate`).
 *   ⇒ 목업 `<script>` 의 간이 계산식(`calc()`)은 **안 옮겼다.** 그건 「업계 기준선 추정」용 목업 셈이고,
 *     우리 정본은 엔진이다. 화면 구성만 목업을 따르고 숫자는 엔진에서 온다.
 *   ⇒ 그래서 목업 손익표의 「일반관리·간접비」 줄은 없다 — 엔진은 간접비를 따로 세지 않고
 *     직접비·수수료로 다 잡는다. 없는 값을 지어내느니 줄을 뺐다.
 *     대신 엔진에만 있는 「손바뀜 위험」은 값이 있을 때만 한 줄 선다(안 보이면 매출총이익이 안 맞는다).
 *
 * ★아직 안 붙은 것(설계서 §11 남은 일):
 *   ① 차종 검색(중고마스터) — 지금은 목업이 박아 둔 그 차 한 대가 기본값이다.
 *   ② 헤더 「원가」 탭 — 관리자 원가설정 화면이 없어 눌리지 않게 두었다(목업은 외부 링크였다).
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import '@/components/estimate/estimate.css';
import { COST_DEFAULTS, loadCostSettings, configFrom } from '@/lib/domain/estimate/cost-settings';
import { safeComputeTerm } from '@/lib/domain/estimate/safe-calc.js';
import { createQuoteInput } from '@/lib/domain/estimate/quote-input.js';
import { usedResidPct, newcarResidPct } from '@/lib/domain/estimate/residual-lookup.js';

/** 목업 `TERMS/PCTS/CREDIT` 그대로. */
const TERMS = [12, 24, 36, 48, 60];
const PCTS = [0, 10, 20, 30];
/** 수수료 칩 — 원가 설정의 기본값이 목록에 없으면 그 값도 함께 세운다(고른 값이 안 보이면 안 된다). */
const FEE_CHIPS = [0, 2.5, 5];
const DISCS = [0, 2, 5, 10];
const CREDIT = ['고신용', '중신용', '저신용'];

/** 목업 `TRIMS` 그대로 — 차종 검색이 붙기 전까지의 신차 트림. */
const TRIMS = [
  { n: '2.5 프리미엄', p: 34110000 },
  { n: '2.5 익스클루시브', p: 37200000 },
  { n: '2.5 캘리그래피', p: 42000000 },
];
const BRANDS = ['현대', '기아', '제네시스'];
const MODELS = ['더 뉴 캐스퍼', '아반떼 CN7', '그랜저 GN7'];

/** 목업 `DEF.used` 가 박아 둔 그 차(현대 그랜저 IG 2.5). 배기량은 엔진(취득세·자동차세)이 요구한다. */
const USED = { name: '현대 그랜저 IG 2.5', price: 27000000, year: 2021, mileage: 48000, cc: 2497 };
const NEW_CC = 2497;

const won = (n: number) => `${Math.round(n || 0).toLocaleString('ko-KR')}원`;
const man = (n: number) => `${Math.round((n || 0) / 10000).toLocaleString('ko-KR')}만`;

type Card = {
  term: number; payVat?: number; monthlySupply?: number; months?: number;
  subtotal?: number; deposit?: number; residualRate?: number;
  cost?: Record<string, number>;
};

/** 손익 분해 — 목업 `prodRows()` 의 줄 구성 그대로. 값은 엔진이 낸 원가에서만 꺼낸다. */
function pnl(c: Card, prepay: number) {
  const co = c.cost || {};
  const rev = (c.monthlySupply || 0) * (c.months || 1);
  const direct = (co.insurance || 0) + (co.selfIns || 0) + (co.maint || 0) + (co.gps || 0)
    + (co.cartax || 0) + (co.acqTax || 0) + (co.bond || 0) + (co.regFee || 0) + (co.ew || 0) + (co.parking || 0);
  const turnover = co.turnover || 0;
  const cogs = (co.carCost || 0) + (co.interest || 0) + direct + turnover;
  return {
    rev, dep: co.carCost || 0, interest: co.interest || 0, direct, turnover,
    gp: rev - cogs, fee: co.salesFee || 0,
    opProfit: rev - (c.subtotal || 0),
    opPct: rev ? (rev - (c.subtotal || 0)) / rev : 0,
    depAmt: c.deposit || 0, preAmt: prepay,
  };
}

const IconSearch = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
);
const IconCar = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 13l1.6-4.4A2 2 0 0 1 7.5 7.2h9A2 2 0 0 1 18.4 8.6L20 13" /><path d="M3 13h18v3.4a1 1 0 0 1-1 1h-1.3a1 1 0 0 1-1-1V16H7.3v.4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" /></svg>
);
const IconChevron = () => (
  <svg className="cv" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
);

/** 목업 `.chips` — 칩 한 줄. */
function Chips<T extends string | number>({ opts, cur, unit = '', onPick }: {
  opts: readonly T[]; cur: T; unit?: string; onPick: (v: T) => void;
}) {
  return (
    <div className="chips">
      {opts.map((v) => (
        <button key={String(v)} type="button" className={v === cur ? 'on' : ''} onClick={() => onPick(v)}>{v}{unit}</button>
      ))}
    </div>
  );
}

/** 목업 `.seg` — 세그먼트. */
function Seg<T extends string>({ tone, opts, cur, onPick }: {
  tone: 't1' | 't2' | 't3'; opts: readonly { v: T; label: string }[]; cur: T; onPick: (v: T) => void;
}) {
  return (
    <div className={`seg ${tone}`}>
      {opts.map((o) => (
        <button key={o.v} type="button" className={o.v === cur ? 'on' : ''} onClick={() => onPick(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

export default function EstimatePage() {
  const nowYear = new Date().getFullYear();
  const [cond, setCond] = useState<'used' | 'new'>('used');
  const [ch, setCh] = useState<'rent' | 'sub'>('rent');
  const [type, setType] = useState<'return' | 'acquire'>('return');
  const [credit, setCredit] = useState('중신용');
  const [trim, setTrim] = useState(0);
  const [brand, setBrand] = useState(BRANDS[0]);
  const [model, setModel] = useState(MODELS[0]);
  const [disc, setDisc] = useState(0);
  const [dep, setDep] = useState(10);
  const [pre, setPre] = useState(0);
  /** 원가 설정(`/estimate/cost`)이 정한 값 — 견적은 그것으로 계산한다. 저장이 없으면 엔진 기본값. */
  const [cost, setCost] = useState(COST_DEFAULTS);
  const [costLoaded, setCostLoaded] = useState(false);
  const [fee, setFee] = useState(COST_DEFAULTS.salesFeePct);
  const [open, setOpen] = useState<number | null>(48);
  /** 잔가는 «자동(표준+델타)»이 기본이고, 목업 STEP 4 처럼 건별로 덮어쓸 수 있다. */
  const [residOverride, setResidOverride] = useState<Record<number, number>>({});

  // 저장값은 브라우저에만 있다 → 첫 그림(SSR)과 어긋나지 않게 그린 «뒤에» 한 번만 얹는다.
  if (!costLoaded && typeof window !== 'undefined') {
    setCostLoaded(true);
    const c = loadCostSettings(); setCost(c); setFee(c.salesFeePct);
  }
  const fees = useMemo(() => Array.from(new Set([...FEE_CHIPS, cost.salesFeePct])).sort((a, b) => a - b), [cost.salesFeePct]);

  const isNew = cond === 'new';
  const listPrice = isNew ? TRIMS[trim].p : USED.price;
  const price = Math.round(listPrice * (1 - disc / 100));
  const age = isNew ? 0 : nowYear - USED.year;

  /** 자동 잔가(%) — 신차는 출고가 대비, 중고는 «현재 시세 대비». 엔진 `residual-lookup` 이 낸다. */
  const autoResid = useMemo(() => {
    const out: Record<number, number> = {};
    for (const t of TERMS) {
      out[t] = Math.round(isNew ? newcarResidPct(null, null, t / 12) : usedResidPct(null, null, age, t / 12));
    }
    return out;
  }, [isNew, age]);
  const residPct = useMemo(() => {
    const out: Record<number, number> = {};
    for (const t of TERMS) out[t] = residOverride[t] ?? autoResid[t];
    return out;
  }, [autoResid, residOverride]);

  const cards = useMemo<Card[]>(() => {
    const base = configFrom(cost);
    // 수수료 칩은 영업자가 «건별»로 고른다 — 원가 설정의 기본값을 이 견적에서만 덮는다.
    const adminCfg = { ...base, setting: { ...base.setting, salesFeeRate: { rent: fee / 100, sub: fee / 100 } } };
    const residualDefault: Record<number, number> = {};
    for (const t of TERMS) residualDefault[t] = residPct[t] / 100;
    const input = createQuoteInput({
      adminCfg, channel: ch, type,
      form: {
        price, cc: isNew ? NEW_CC : USED.cc, fuel: 'gasoline', accident: 'none',
        mileage: isNew ? 0 : USED.mileage, year: isNew ? nowYear : USED.year, credit,
      },
      conditions: { depositPct: dep, prepayPct: pre },
      residual: null, residualDefault, credit, defaultGroup: 'B', nowYear,
    });
    return TERMS.map((t) => ({ ...safeComputeTerm(t, input, { idx: t }), term: t }));
  }, [ch, type, price, isNew, credit, dep, pre, fee, residPct, nowYear, cost]);

  const prepayAmt = Math.round(price * pre / 100);
  const vehTag = `${man(listPrice)}원`;
  const vName = isNew ? `${brand} ${model} ${TRIMS[trim].n}` : USED.name;
  const vMeta = isNew
    ? `신차 · 출고가 ${man(listPrice)} · ${nowYear}년형`
    : `중고 · 매입가 ${man(USED.price)} · ${USED.year}년 · ${USED.mileage.toLocaleString('ko-KR')}km`;

  return (
    <div className="est-root">
      <div className="phone">
        <div className="hd">
          <div className="wm"><span className="a">freepass</span><span className="b">mobility</span></div>
          <div className="modesw">
            <span className="on">견적</span>
            <Link href="/estimate/cost">원가</Link>
          </div>
        </div>

        {/* STEP 1 차량 */}
        <div className="card">
          <div className="step"><span className="no">1</span>차량<span className="veh">{vehTag}</span></div>
          <Seg tone="t1" cur={cond} onPick={setCond} opts={[{ v: 'used', label: '중고' }, { v: 'new', label: '신차' }]} />
          {!isNew ? (
            <div className="vsearch">
              <IconSearch />
              {/* 차종 검색(중고마스터) 연결 전 — 목업과 같이 읽기전용. */}
              <input placeholder="차종 검색 (중고마스터)" value={USED.name} readOnly />
            </div>
          ) : (
            <div className="vsel">
              <select value={brand} onChange={(e) => setBrand(e.target.value)}>
                {BRANDS.map((b) => <option key={b}>{b}</option>)}
              </select>
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {MODELS.map((m) => <option key={m}>{m}</option>)}
              </select>
              <select value={trim} onChange={(e) => setTrim(Number(e.target.value))}>
                {TRIMS.map((t, i) => <option key={t.n} value={i}>{t.n} · {man(t.p)}원</option>)}
              </select>
            </div>
          )}
          <div className="vchip">
            <div className="ic"><IconCar /></div>
            <div><div className="nm">{vName}</div><div className="mt">{vMeta}</div></div>
          </div>
          <div className="crow" style={{ marginTop: 12 }}>
            <span className="lb">매입 할인</span>
            <Chips opts={DISCS} cur={disc} unit="%" onPick={setDisc} />
          </div>
        </div>

        {/* STEP 2 상품 조건 */}
        <div className="card">
          <div className="step"><span className="no">2</span>상품 조건</div>
          <Seg tone="t2" cur={ch} onPick={setCh} opts={[{ v: 'rent', label: '렌트' }, { v: 'sub', label: '구독' }]} />
          <Seg tone="t3" cur={type} onPick={setType} opts={[{ v: 'return', label: '반납형' }, { v: 'acquire', label: '인수형' }]} />
          {isNew ? (
            <div className="crow" style={{ marginTop: 12 }}>
              <span className="lb">신용</span>
              <Chips opts={CREDIT} cur={credit} onPick={setCredit} />
            </div>
          ) : null}
        </div>

        {/* STEP 3 영업자 책정 */}
        <div className="card">
          <div className="step"><span className="no">3</span>영업자 책정<span className="veh" style={{ color: 'var(--ink-4)' }}>보증금·선납·수수료 함께</span></div>
          <div className="crow first"><span className="lb">보증금</span><Chips opts={PCTS} cur={dep} unit="%" onPick={setDep} /></div>
          <div className="crow"><span className="lb">선납</span><Chips opts={PCTS} cur={pre} unit="%" onPick={setPre} /></div>
          <div className="crow"><span className="lb">수수료</span><Chips opts={fees} cur={fee} unit="%" onPick={setFee} /></div>
        </div>

        {/* STEP 4 연도별 잔가 */}
        <div className="card" style={{ marginTop: 12 }}>
          <div className="step"><span className="no">4</span>연도별 잔가<span className="veh" style={{ color: 'var(--ink-4)' }}>리스트에 없으면 건별 입력</span></div>
          <div className="resid-in">
            {TERMS.map((t) => (
              <div className="ri" key={t}>
                <span className="ry">{t / 12}년</span>
                <span className="pin">
                  <input
                    inputMode="numeric" value={residPct[t]}
                    onChange={(e) => setResidOverride((o) => ({ ...o, [t]: Number(String(e.target.value).replace(/[^\d]/g, '')) || 0 }))}
                  />
                  <i>%</i>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="basis">
          <span className="bi">원가 기준</span>
          <span className="bt">
            조달금리 6.5% · 국산 표준잔가 + 차종델타 · 손바뀜(신용등급) · 취득세·공채·등록비·자동차세·보험·정비 반영 ·
            {' '}<b>수익률 10% 공통</b> · 업계 기준선 추정
          </span>
        </div>

        {/* ⑤ — ①~④ 와 같은 상자. 기간 다섯 줄이 그 안에 든다(사장님 2026-09-06). */}
        <div className="card terms">
          <div className="step"><span className="no">5</span>기간별 대여료 · 수익</div>
          <div className="prods">
          {cards.map((c) => {
            const v = pnl(c, prepayAmt);
            const isOpen = open === c.term;
            return (
              <div className={`prod${isOpen ? ' open' : ''}`} key={c.term}>
                <button type="button" className="prodh" onClick={() => setOpen(isOpen ? null : c.term)}>
                  <span className="yr">{c.term / 12}년</span>
                  <span className="amt">{Math.round(c.payVat || 0).toLocaleString('ko-KR')}<small>원/월</small></span>
                  <span className="mg">수익 {man(v.opProfit)} · {(v.opPct * 100).toFixed(0)}%</span>
                  <IconChevron />
                </button>
                <div className="pd">
                  <div className="li"><span className="k">매출 <em>공급가·{c.term / 12}년</em></span><span className="v">{won(v.rev)}</span></div>
                  <div className="li sub"><span className="k">매출원가</span><span className="v" /></div>
                  <div className="li minus"><span className="k">· 차량 감가 <em>취득−잔존 · 잔가 {Math.round((c.residualRate || 0) * 100)}%</em></span><span className="v">−{won(v.dep)}</span></div>
                  <div className="li minus"><span className="k">· 금융비용 <em>조달이자</em></span><span className="v">−{won(v.interest)}</span></div>
                  <div className="li minus"><span className="k">· 직접 운영비 <em>보험·자차충당·정비·GPS·세금</em></span><span className="v">−{won(v.direct)}</span></div>
                  {v.turnover > 0 ? (
                    <div className="li minus"><span className="k">· 손바뀜 위험 <em>{credit}</em></span><span className="v">−{won(v.turnover)}</span></div>
                  ) : null}
                  <div className="li"><span className="k">매출총이익</span><span className="v">{won(v.gp)}</span></div>
                  <div className="li sub"><span className="k">판매관리비</span><span className="v" /></div>
                  <div className="li minus"><span className="k">· 영업수수료 <em>{fee}%</em></span><span className="v">−{won(v.fee)}</span></div>
                  <div className="li pay"><span className="k">영업이익 <em>{(v.opPct * 100).toFixed(1)}%</em></span><span className="v">{won(v.opProfit)}</span></div>
                  <div className="li"><span className="k">보증금 <em>{dep}%</em> · 선납 <em>{pre}%</em></span><span className="v">{won(v.depAmt)} · {won(v.preAmt)}</span></div>
                </div>
              </div>
            );
          })}
          </div>
        </div>

        <div className="foot">
          <b>업계 기준선 추정</b> — 잔가=시장 벤치마크 역산, 수익률=업계 영업이익률(SK렌터카 9.9%).
          실채택 전 엔카·KB차차차 실시세 검산 필요. 잔존가만 건별 입력.
        </div>
      </div>
    </div>
  );
}
