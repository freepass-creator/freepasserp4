'use client';
/**
 * 견적 — **화면 정본 = 웰릭스 테이블**(`C:\dev\welrixtable/index.html`).
 *
 * ★★사장님 2026-09-07 「야 일단 **웰릭스 테이블을 그대로 복사**해와봐」
 *   「거기서 **신차에서 중고차로만 변환**하고 **원가구조만 다르게** 쓰면 되는 거잖아」
 *   ⇒ 짜임·클래스·치수는 웰릭스 원본 그대로다. 우리가 바꾼 것은 **딱 둘**이다:
 *     ㉠ 왼쪽이 신차 카탈로그(제조사→모델→트림→옵션·색상)가 아니라 **중고 차종 + 시세·연식·주행**
 *     ㉡ 오른쪽 셋째 칸이 계약·채팅이 아니라 **우리 원가·손익**
 *   그 밖에는 원본을 «고치지 않는다». 스타일은 `components/estimate/welrix.css` —
 *   원본 `<style>` 을 한 글자도 안 고치고 `.wx-root` 안에만 가둔 것이다(`tmp/wx-extract.py`).
 *
 * ★이 층은 ERP «안»의 페이지다 — 상단바·전체메뉴를 입는다(사장님 2026-09-07
 *   「난 로그인해서 **내부 페이지**처럼 하자는 거였음」). 그래서 원본 상단바에는
 *   **브랜드 표식을 안 세운다**(CLAUDE.md 노브랜드) — 웰릭스 CI 레드도 남색으로 돌렸다.
 *   ⚠ 로그인은 **필요하다** — 원가·마진·손익이 보이므로 `EstimateGate` 가 관리자·공급사만 들인다.
 *
 * ★숫자는 **한 줄도 여기서 계산하지 않는다.** 전부 `lib/domain/estimate` 엔진이 낸다
 *   (회귀 39개 = `npm run test:estimate` · 로직 정본 = `docs/견적-원가-로직.md`).
 *
 * ⚠ **사고 이력 칸은 일부러 없다.** 붙였다가 실측하고 걷었다 — 중고는 «시세»를 입력받고
 *   그 시세에 사고·주행이 이미 녹아 있어 엔진이 보정을 건너뛴다(`residualAgeBaked`).
 *   웰릭스·손오공에 있다고 우리에도 있어야 하는 게 아니다. 까닭은 로직 정본 §3-4.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import EstimateGate from '@/features/estimate/EstimateGate';
import '@/components/estimate/welrix.css';
import { useAppBar } from '@/lib/appbar';
import CarPicker from '@/features/estimate/CarPicker';
import type { PickedCar } from '@/lib/domain/estimate/car-index';
import { deltaKeyFor } from '@/lib/domain/estimate/residual-by-name';
import { expectedTurnovers } from '@/lib/domain/estimate/turnover-cost.js';
import { adjustResidual, configFrom, type AcqPath } from '@/lib/domain/estimate/cost-settings';
import { cachedCost, fetchSharedCost } from '@/lib/domain/estimate/cost-client';
import { safeComputeTerm } from '@/lib/domain/estimate/safe-calc.js';
import { createQuoteInput } from '@/lib/domain/estimate/quote-input.js';
import { usedResidPct, newcarResidPct } from '@/lib/domain/estimate/residual-lookup.js';
import { useIsMobile } from '@/lib/use-mobile';

/** 목업 `TERMS/PCTS/CREDIT` 그대로. */
const TERMS = [12, 24, 36, 48, 60];
const CREDIT = ['고신용', '중신용', '저신용'];
/** 원본 왼쪽 첫 칸이 묻던 것 — 웰릭스는 「상품」 카드 줄이다(`.grid-2 > .card`). */
const SOURCES = [
  { v: 'used' as const, label: '중고', sub: '시세로 센다' },
  { v: 'new' as const, label: '신차', sub: '신차마스터 공표가' },
];
const CHANNELS = [
  { v: 'rent' as const, label: '렌트', sub: '영업용 · 자동차세 저렴' },
  { v: 'sub' as const, label: '구독', sub: '비영업용' },
];
const TYPES = [
  { v: 'return' as const, label: '반납형', sub: '만기에 돌려받는다' },
  { v: 'acquire' as const, label: '인수형', sub: '만기에 손님이 산다' },
];
/**
 * 취득 경로 — 같은 차라도 «어떻게 들여왔나»에 따라 초기비가 다르다(사장님 2026-09-06).
 * ⚠ 신차에는 안 묻는다. 신차는 언제나 사 오는 차다(등록·탁송 O · 상품화 X).
 */
const ACQ: { v: AcqPath; label: string }[] = [
  { v: 'own', label: '기보유' },
  { v: 'bought', label: '매입·상품화됨' },
  { v: 'prep', label: '매입·상품화필요' },
];

/**
 * 첫 화면에 서 있는 차 — 목업 `DEF.used` 가 박아 둔 그 차(현대 그랜저 IG 2.5).
 * ★차를 고르기 «전»에도 1~5년 칸이 숫자로 서 있어야 한다(설계서 §1). 빈 화면으로 시작하지 않는다.
 *   차 고르기 시트에서 고르면 이 자리가 «그 차»로 바뀐다.
 */
const DEFAULT_USED: PickedCar = {
  source: 'used', name: '현대 그랜저 IG 2.5', meta: '중고 · 2019~2022 · 가솔린 2.5',
  maker: '현대', model: '그랜저', subModel: '그랜저 IG', trim: '', powertrain: '가솔린 2.5',
  fuel: 'gasoline', cc: 2497,
};
const DEFAULT_NEW: PickedCar = {
  source: 'new', name: '신차를 고르세요', meta: '신차마스터에서 제조사 → 모델 → 트림 → 옵션',
  maker: '', model: '', subModel: '', trim: '', powertrain: '',
  fuel: 'gasoline', cc: null, price: 0,
};
const DEFAULT_USED_PRICE = 27000000;
const DEFAULT_USED_YEAR = 2021;
const DEFAULT_USED_MILEAGE = 48000;

const digits = (v: string) => Number(String(v).replace(/[^\d]/g, '')) || 0;
/** 원본 `src/lib/format.js` 의 `fmt` — 견적 카드 금액은 전부 이걸 탄다. */
const fmtNum = (n: number | undefined) => Math.round(n || 0).toLocaleString('ko-KR');
/** 원본 `src/lib/format.js` 의 `fmtTel` — 치는 도중에도 하이픈이 붙는다. */
function fmtTel(tel: string) {
  const d = String(tel || '').replace(/\D/g, '').slice(0, 11);
  if (!d) return '';
  if (/^01[016789]/.test(d)) {
    if (d.length <= 3) return d;
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  }
  if (d.startsWith('02')) {
    if (d.length <= 2) return d;
    if (d.length <= 6) return `${d.slice(0, 2)}-${d.slice(2)}`;
    if (d.length <= 9) return `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;
    return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
  }
  if (/^0[3-6]/.test(d)) {
    if (d.length <= 3) return d;
    if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  }
  if (/^1[5-9]/.test(d)) return d.length <= 4 ? d : `${d.slice(0, 4)}-${d.slice(4)}`;
  return d;
}
const won = (n: number) => `${Math.round(n || 0).toLocaleString('ko-KR')}원`;
const man = (n: number) => `${Math.round((n || 0) / 10000).toLocaleString('ko-KR')}만`;

type Card = {
  term: number; payVat?: number; monthlySupply?: number; months?: number;
  /** 엔진이 세우는 깃발 — 배기량을 모르면 자동차세가 «조용히 0» 이 된다. 화면이 말해야 한다. */
  incompleteCc?: boolean;
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

/** ★문지기(`EstimateGate`)가 관리자·공급사만 들여보낸다 — 메뉴에서 숨기는 것만으로는 막은 게 아니다. */
export default function EstimatePagePage() {
  return <EstimateGate><EstimatePageInner /></EstimateGate>;
}

function EstimatePageInner() {
  const nowYear = new Date().getFullYear();
  const [cond, setCond] = useState<'used' | 'new'>('used');
  const [ch, setCh] = useState<'rent' | 'sub'>('rent');
  const [type, setType] = useState<'return' | 'acquire'>('return');
  const [credit, setCredit] = useState('중신용');
  /** 고른 차 한 대 — 중고는 차종마스터, 신차는 신차마스터에서 온다(`features/estimate/CarPicker`). */
  const [picked, setPicked] = useState<PickedCar>(DEFAULT_USED);
  /* 차 고르기가 «어디에 서는가»를 가른다 — 웹은 좌패널에 박히고(원본 캐스케이드 자리),
     폰은 시트로 뜬다. 원본도 ≤1024px 에서는 한 줄로 접힌다. */
  const mobile = useIsMobile();
  const [pickerOpen, setPickerOpen] = useState(false);
  /** 중고 시세는 마스터에 없다 — 사람이 넣는다. 신차는 공표가라 자동으로 찬다. */
  const [usedPrice, setUsedPrice] = useState(DEFAULT_USED_PRICE);
  const [usedYear, setUsedYear] = useState(DEFAULT_USED_YEAR);
  const [usedMileage, setUsedMileage] = useState(DEFAULT_USED_MILEAGE);
  /** 마스터가 배기량을 안 주면 여기서 묻는다 — 0 으로 떨어뜨리면 자동차세가 «조용히» 0 이 된다. */
  const [manualCc, setManualCc] = useState(0);
  /** 중고 취득 경로 — 기보유면 등록·탁송·상품화가 원가에서 빠진다. */
  const [acq, setAcq] = useState<AcqPath>('prep');
  const [disc, setDisc] = useState(0);
  const [dep, setDep] = useState(10);
  const [pre, setPre] = useState(0);
  /**
   * 원가 설정(`/estimate/cost`)이 정한 값 — 견적은 그것으로 계산한다.
   * ★첫 그림은 «캐시»로 즉시 그리고(대여료가 서 있어야 한다), 곧바로 **회사 값**을 받아 덮는다.
   */
  const [cost, setCost] = useState(() => cachedCost());
  const [fee, setFee] = useState(() => cachedCost().salesFeePct);
  const [open, setOpen] = useState<number | null>(48);
  /** 잔가는 «자동(표준+델타)»이 기본이고, 목업 STEP 4 처럼 건별로 덮어쓸 수 있다. */
  const [residOverride, setResidOverride] = useState<Record<number, number>>({});
  /** 손님·담당자 — 원본 `CustomerStaffForm`. 견적서에 찍혀 나갈 이름이라 견적 화면이 묻는다. */
  const [custName, setCustName] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffTel, setStaffTel] = useState('');
  /**
   * 손님 발송용 견적 — 원본 `TermsGrid`. 「기본 견적」과 달리 **열마다** 기간·보증금·선납이 따로 논다.
   * 체크한 열만 손님에게 나간다(발송 자체는 아직 안 붙었다 — 다음 일감).
   */
  const [scen, setScen] = useState([
    { term: 36, dep: 10, pre: 0, send: true },
    { term: 48, dep: 10, pre: 0, send: true },
    { term: 60, dep: 10, pre: 0, send: true },
  ]);

  // 회사 값을 받아 덮는다 — 사장님이 정한 원가가 있으면 그것이 이긴다.
  useEffect(() => {
    let alive = true;
    fetchSharedCost().then((r) => { if (alive) { setCost(r.cost); setFee(r.cost.salesFeePct); } }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const isNew = cond === 'new';
  // 갈래를 바꾸면 고른 차도 그 갈래의 것으로 돌아간다 — 중고를 고른 채 신차 값이 계산되면 안 된다.
  useEffect(() => { setPicked(cond === 'new' ? DEFAULT_NEW : DEFAULT_USED); setManualCc(0); }, [cond]);

  const listPrice = isNew ? (picked.price ?? 0) : usedPrice;
  const price = Math.round(listPrice * (1 - disc / 100));
  const age = isNew ? 0 : Math.max(0, nowYear - (usedYear || nowYear));
  const cc = picked.cc ?? (manualCc || null);
  const needCc = !picked.cc;

  /**
   * 자동 잔가(%) — 신차는 출고가 대비, 중고는 «현재 시세 대비». 엔진 `residual-lookup` 이 낸다.
   * ★2026-09-06 부터 **그 차의 곡선**을 쓴다 — 차종델타(±%p)를 이름으로 되짚어 건다.
   *   그 전에는 `(null, null)` 로 불러 모든 차가 국산 표준 하나였다(그랜저도 쏘나타와 같은 잔가).
   */
  const delta = useMemo(() => deltaKeyFor(picked.maker, picked.model), [picked.maker, picked.model]);
  const autoResid = useMemo(() => {
    const mk = delta?.makerId ?? null; const md = delta?.modelCode ?? null;
    const out: Record<number, number> = {};
    for (const t of TERMS) {
      out[t] = Math.round(isNew ? newcarResidPct(mk, md, t / 12) : usedResidPct(mk, md, age, t / 12));
    }
    return out;
  }, [isNew, age, delta]);
  const residPct = useMemo(() => {
    const out: Record<number, number> = {};
    for (const t of TERMS) out[t] = residOverride[t] ?? autoResid[t];
    return out;
  }, [autoResid, residOverride]);

  const mk = useCallback((t: number, d: number, p: number): Card => {
    // 신차는 «출고가»라 업금액을 안 얹는다(중고는 매입가에 얹는다) — `configFrom` 이 갈래로 고른다.
    // 신용 구간(A/B/C)에 따라 금리·대출비율이 갈린다 — 항목은 같고 값만 다르다.
    const base = configFrom(cost, { newCar: isNew, path: acq, credit });
    // 수수료 칩은 영업자가 «건별»로 고른다 — 원가 설정의 기본값을 이 견적에서만 덮는다.
    const adminCfg = { ...base, setting: { ...base.setting, salesFeeRate: { rent: fee / 100, sub: fee / 100 } } };
    const raw: Record<number, number> = {};
    for (const t of TERMS) raw[t] = residPct[t] / 100;
    // 「잔가로 조정」 — 원가 설정의 가감(±%p)을 곡선 전체에 얹는다(사장님 2026-09-06).
    const residualDefault = adjustResidual(raw, cost.residualAdjustPct);
    const input = createQuoteInput({
      adminCfg, channel: ch, type,
      form: {
        price, cc, fuel: picked.fuel, accident: 'none',
        mileage: isNew ? 0 : usedMileage, year: isNew ? nowYear : usedYear, credit,
      },
      conditions: { depositPct: d, prepayPct: p },
      residual: null, residualDefault, credit, defaultGroup: 'B', nowYear,
    });
    return { ...safeComputeTerm(t, input, { idx: t }), term: t };
  }, [ch, type, price, isNew, credit, fee, residPct, nowYear, cost, cc, picked.fuel, usedMileage, usedYear, acq]);

  /** 손익 칸이 쓰는 다섯 기간 — 조건은 위 폼에서 온다. */
  const cards = useMemo<Card[]>(() => TERMS.map((t) => mk(t, dep, pre)), [mk, dep, pre]);
  /** 「기본 견적」 — 원본대로 60·48·36 세 장 고정, 조건은 위 폼 그대로(편집 X). */
  const refCards = useMemo<Card[]>(() => [60, 48, 36].map((t) => mk(t, dep, pre)), [mk, dep, pre]);
  /** 「손님 발송용 견적」 — 열마다 제 조건으로 따로 센다. */
  const scenCards = useMemo<Card[]>(() => scen.map((x) => mk(x.term, x.dep, x.pre)), [mk, scen]);

  /** 손바뀜을 «몇 번»으로 풀어 보여 주기 위한 값 — 원가 설정의 반납률에서 온다. */
  const retentionOf = useCallback((c: string) => (c === '저신용' ? cost.retentionLowPct
    : c === '중신용' ? cost.retentionMidPct : cost.retentionNormalPct), [cost]);
  const retentionPct = retentionOf(credit);
  const turnovers = expectedTurnovers(retentionPct / 100);

  const prepayAmt = Math.round(price * pre / 100);
  const vehTag = listPrice ? `${man(listPrice)}원` : '차를 고르세요';
  const vMeta = isNew
    ? [picked.meta, listPrice ? `출고가 ${man(listPrice)}` : null].filter(Boolean).join(' · ')
    : [picked.meta, `시세 ${man(usedPrice)}`, `${usedYear}년`, `${usedMileage.toLocaleString('ko-KR')}km`,
      ACQ.find((a) => a.v === acq)!.label].filter(Boolean).join(' · ');

  // 하단 「검색」 탭이 이 화면에서는 «차 고르기»를 연다(lib/tabbar — 검색은 라우트가 아니라 행동이다).
  useAppBar({ search: { onOpen: () => setPickerOpen(true), active: picked !== DEFAULT_USED && picked !== DEFAULT_NEW } },
    [picked, cond]);

  return (
    <div className="wx-root">
      {/* ══ 상단바 — 원본 `.global-topbar`. ★브랜드 표식은 안 세운다(CLAUDE.md 노브랜드).
             원본의 CI 이미지·워드마크 자리는 비웠고, 위에는 ERP 상단바가 따로 선다. ══ */}
      <div className="global-topbar">
        <span className="global-topbar__hint">{isNew ? '신차' : '중고'} 장기렌터카 견적</span>
        <span className="spacer" />
        <div className="global-topbar__actions">
          <button type="button" className="gt-btn outline" onClick={() => setPickerOpen(true)}>
            {isNew ? '신차 고르기' : '차종 고르기'}
          </button>
          <span className="gt-divider" aria-hidden="true" />
          <Link className="gt-btn outline" href="/estimate/cost">원가 설정</Link>
        </div>
      </div>

      {/* ══ 좌 400px — 차량 (원본 `.wrap`) ══════════════════════════════════ */}
      <div className="wrap">
        <section id="sec-source">
          <div className="step-title">상품</div>
          <div className="grid-1">
            <div className="grid-2">
              {SOURCES.map((o) => (
                <button key={o.v} type="button" className={`card${cond === o.v ? ' active' : ''}`}
                  onClick={() => setCond(o.v)}>
                  <div className="name">{o.label}</div><div className="sub">{o.sub}</div>
                </button>
              ))}
            </div>
            <div className="grid-2">
              {CHANNELS.map((o) => (
                <button key={o.v} type="button" className={`card${ch === o.v ? ' active' : ''}`}
                  onClick={() => setCh(o.v)}>
                  <div className="name">{o.label}</div><div className="sub">{o.sub}</div>
                </button>
              ))}
            </div>
            <div className="grid-2">
              {TYPES.map((o) => (
                <button key={o.v} type="button" className={`card${type === o.v ? ' active' : ''}`}
                  onClick={() => setType(o.v)}>
                  <div className="name">{o.label}</div><div className="sub">{o.sub}</div>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section id="sec-credit">
          <div className="step-title">신용</div>
          <div className="grid-1">
            {CREDIT.map((c) => (
              <button key={c} type="button" className={`trim-row${credit === c ? ' active' : ''}`}
                onClick={() => setCredit(c)}>
                <span className="info">
                  <span className="name">{c}</span>
                  <span className="meta">유지율 {retentionOf(c)}% · 손바뀜 {expectedTurnovers(retentionOf(c) / 100).toFixed(2)}회</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section id="sec-vehicle">
          <div className="step-title">차종</div>
          {/* 폰은 시트로 열고, 웹은 좌패널에 통째로 박는다 — 원본 좌측 캐스케이드가 서던 자리다. */}
          {mobile ? (
            <button type="button" className="card" onClick={() => setPickerOpen(true)}>
              <div className="name">{picked.name}</div>
              <div className="sub">{picked.meta}</div>
            </button>
          ) : (
            <CarPicker open inline mode={cond} onClose={() => setPickerOpen(false)}
              onPick={(c) => { setPicked(c); if (c.source === 'new') { setUsedMileage(0); setUsedYear(nowYear); } }} />
          )}
        </section>

        <section id="sec-carinfo">
          <div className="step-title">차량 정보</div>
          <div className="vfields">
            {isNew ? (
              <div className="cs-field cs-field--wide">
                <label>차량가</label>
                <span className="qc-pct"><input value={man(listPrice)} disabled /><em>만원</em></span>
              </div>
            ) : (
              <>
                {/* 취득 경로 — 기보유면 등록·탁송·상품화가 원가에서 빠진다. */}
                <div className="cs-field cs-field--wide">
                  <label>취득</label>
                  <select value={acq} onChange={(e) => setAcq(e.target.value as AcqPath)}>
                    {ACQ.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
                  </select>
                </div>
                {/* ★중고는 «무조건 시세»다(사장님 2026-09-06) — 장부가·최초매입가가 아니다. */}
                <div className="cs-field">
                  <label>시세</label>
                  <span className="qc-pct"><input inputMode="numeric" value={man(usedPrice)}
                    onChange={(e) => setUsedPrice(digits(e.target.value) * 10000)} /><em>만원</em></span>
                </div>
                <div className="cs-field">
                  <label>연식</label>
                  <span className="qc-pct"><input inputMode="numeric" value={usedYear}
                    onChange={(e) => setUsedYear(digits(e.target.value))} /><em>년</em></span>
                </div>
                <div className="cs-field">
                  <label>주행</label>
                  <span className="qc-pct"><input inputMode="numeric" value={usedMileage.toLocaleString('ko-KR')}
                    onChange={(e) => setUsedMileage(digits(e.target.value))} /><em>km</em></span>
                </div>
              </>
            )}
            {/* 마스터가 배기량을 안 주면 여기서 묻는다 — 0 으로 두면 자동차세가 «조용히» 0 이 된다. */}
            {needCc ? (
              <div className="cs-field">
                <label>배기량</label>
                <span className="qc-pct"><input inputMode="numeric" placeholder="0"
                  value={manualCc ? manualCc.toLocaleString('ko-KR') : ''}
                  onChange={(e) => setManualCc(digits(e.target.value))} /><em>cc</em></span>
              </div>
            ) : null}
            {cards[0]?.incompleteCc ? (
              <div className="wx-warn">배기량이 없어 자동차세가 0 으로 섭니다 — 위 칸에 넣어 주세요.</div>
            ) : null}
            <div className="cs-field">
              <label>매입 할인</label>
              <span className="qc-pct"><input inputMode="numeric" value={disc}
                onChange={(e) => setDisc(Math.max(0, Math.min(50, digits(e.target.value))))} /><em>%</em></span>
            </div>
          </div>
        </section>

        <section id="sec-resid">
          <div className="step-title">연도별 잔가 <b>{delta ? '차종곡선' : '표준곡선'}</b></div>
          <div className="vfields">
            {TERMS.map((t) => (
              <div className="cs-field" key={t}>
                <label>{t / 12}년</label>
                <span className="qc-pct"><input inputMode="numeric" value={residPct[t]}
                  onChange={(e) => setResidOverride((o) => ({ ...o, [t]: digits(e.target.value) }))} /><em>%</em></span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ══ 하단 총액 띠 — 원본 `.total-bar` (≤1024px 에서는 원본대로 숨는다) ══ */}
      <div className="total-bar">
        <div className="inner">
          <div className="total-row sub"><span>{picked.name} · {vMeta}</span></div>
          <div className="total-row main">
            <span className="label">차량가{disc ? ` · 매입할인 ${disc}%` : ''}</span>
            <span className="v">{man(price)}원</span>
          </div>
        </div>
      </div>

      {/* ══ 가운데 — 조건과 견적 (원본 `.quote-panel`) ══════════════════════ */}
      <section className="quote-panel">
        <div className="qp-summary-mini">
          <div className="qp-summary-mini__row">
            <span className={`qp-vehicle${listPrice ? '' : ' empty'}`}>{picked.name}</span>
            {listPrice ? (
              <span className="qp-formula">
                {isNew ? '출고가' : '시세'} <b>{man(listPrice)}</b>
                {disc ? <> − 할인 <b>{disc}%</b></> : null}
                {' = 차량가 '}<b className="total">{man(price)}원</b>
              </span>
            ) : null}
          </div>
        </div>

        {/* 손님·담당자 — 원본 `CustomerStaffForm`. 견적서로 나갈 이름이라 견적 화면이 묻는다. */}
        <div className="cs-form">
          <div className="cs-field">
            <label>손님</label>
            <input value={custName} onChange={(e) => setCustName(e.target.value)} placeholder="VIP 고객" />
          </div>
          <div className="cs-field">
            <label>담당자</label>
            <input value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="홍길동 과장" />
          </div>
          <div className="cs-field">
            <label>연락처</label>
            <input value={staffTel} onChange={(e) => setStaffTel(fmtTel(e.target.value))}
              placeholder="010-0000-0000" inputMode="tel" />
          </div>
          <div className="cs-field">
            <label>수수료</label>
            <span className="qc-pct"><input inputMode="numeric" value={fee}
              onChange={(e) => setFee(Math.max(0, Math.min(20, Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)))} /><em>%</em></span>
          </div>
        </div>

        {/* 견적 조건 — 원본 `ConditionsForm`. 여기 보증금·선납이 「기본 견적」 세 장을 움직인다. */}
        <div className="qp-form qp-form--conds">
          <div className="qc-field">
            <label>보증금</label>
            <span className="qc-pct"><input type="number" min={0} max={100} value={dep}
              onChange={(e) => setDep(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} /><em>%</em></span>
          </div>
          <div className="qc-field">
            <label>선납금</label>
            <span className="qc-pct"><input type="number" min={0} max={100} value={pre}
              onChange={(e) => setPre(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} /><em>%</em></span>
          </div>
        </div>

        <div className="qp-terms__title">기본 견적</div>
        <div className="reference-grid">
          {refCards.map((c) => (
            <div className={`term-card term-card--ref${c.payVat ? '' : ' term-card--empty'}`} key={c.term}>
              <div className="term-card__head"><span className="ref-term-label">{c.term}개월</span></div>
              <div className="term-card__monthly">{c.payVat ? fmtNum(c.payVat) : '—'}<em>원</em></div>
              <div className="term-card__row"><span>보증금 <em className="ref-pct">{dep}%</em></span><b>{fmtNum(c.deposit)}</b></div>
              <div className="term-card__row"><span>선납금 <em className="ref-pct">{pre}%</em></span><b>{fmtNum(prepayAmt)}</b></div>
            </div>
          ))}
        </div>

        {/* 손님 발송용 견적 — 원본 `TermsGrid`. 열마다 기간·보증금·선납을 따로 잡고, 체크한 것만 보낸다. */}
        <div className="qp-terms__title qp-terms__title--customer">손님 발송용 견적 <small>· 자유 조합 + 발송 체크</small></div>
        <div className="terms-grid">
          {scen.map((s, i) => {
            const c = scenCards[i];
            return (
              <div className={`term-card${s.send ? '' : ' unchecked'}`} key={i}>
                <div className="term-card__head">
                  <select className="term-card__term-dd" value={s.term}
                    onChange={(e) => setScen((a) => a.map((x, j) => (j === i ? { ...x, term: Number(e.target.value) } : x)))}>
                    {TERMS.map((t) => <option key={t} value={t}>{t}개월</option>)}
                  </select>
                  <label className={`term-card__check${s.send ? ' is-checked' : ''}`}>
                    <input type="checkbox" checked={s.send}
                      onChange={(e) => setScen((a) => a.map((x, j) => (j === i ? { ...x, send: e.target.checked } : x)))} />
                    <span className="term-card__check-cap">견적서에 포함</span>
                  </label>
                </div>
                <div className="term-card__monthly">{c.payVat ? fmtNum(c.payVat) : '—'}<em>원</em></div>
                <div className="term-card__cond">
                  <label><span>보증금</span><span className="pct-cell"><input type="text" inputMode="numeric" maxLength={3} value={s.dep}
                    onChange={(e) => setScen((a) => a.map((x, j) => (j === i ? { ...x, dep: Math.min(100, digits(e.target.value)) } : x)))} />%</span></label>
                  <label><span>선납금</span><span className="pct-cell"><input type="text" inputMode="numeric" maxLength={3} value={s.pre}
                    onChange={(e) => setScen((a) => a.map((x, j) => (j === i ? { ...x, pre: Math.min(100, digits(e.target.value)) } : x)))} />%</span></label>
                </div>
                <div className="term-card__row">
                  <span>만기인수<em className="resid-pct">{Math.round((c.residualRate || 0) * 100)}%</em></span>
                  <b>{fmtNum(Math.round(price * (c.residualRate || 0)))}</b>
                </div>
                <div className="term-card__row"><span>보증금</span><b>{fmtNum(c.deposit)}</b></div>
                <div className="term-card__row"><span>선납금</span><b>{fmtNum(Math.round(price * s.pre / 100))}</b></div>
              </div>
            );
          })}
        </div>

        <div className="footnote">
          금액은 부가세 포함 월 대여료 · 잔가는 국산 표준곡선 + 차종델타 · 원가는 <Link href="/estimate/cost">원가 설정</Link>이 정한 값<br />
          조달금리·손바뀜·취득세·공채·등록비·자동차세·보험·정비 반영 · 업계 기준선 추정<br />
          실채택 전 엔카·KB차차차 실시세 검산 필요
        </div>
      </section>

      {/* ══ 우 — 원가·손익 (원본이 계약·채팅을 놓던 셋째 칸) ═══════════════
             ★사장님 2026-09-07 「신차에서 중고차로만 «변환»하고 «원가구조»만 다르게 쓰면 된다」.
               짜임은 웰릭스 그대로 두고, 이 칸에만 우리 원가가 선다. ══ */}
      <aside className="contract-panel">
        <div className="qp-terms__title">원가 · 손익</div>
        <div className="pnl-tabs">
          {TERMS.map((t) => (
            <button key={t} type="button" className={open === t ? 'on' : ''} onClick={() => setOpen(t)}>{t / 12}년</button>
          ))}
        </div>
        {(() => {
          const c = cards.find((x) => x.term === open) ?? cards[0];
          const v = pnl(c, prepayAmt);
          return (
            <>
              <div className="pnl-row sum"><span className="k">매출 <em>공급가 · {c.term / 12}년</em></span><span className="v">{won(v.rev)}</span></div>
              <div className="pnl-row head"><span className="k">매출원가</span><span className="v" /></div>
              <div className="pnl-row minus"><span className="k">차량 감가 <em>취득 − 잔존 · 잔가 {Math.round((c.residualRate || 0) * 100)}%</em></span><span className="v">−{won(v.dep)}</span></div>
              <div className="pnl-row minus"><span className="k">금융비용 <em>조달이자</em></span><span className="v">−{won(v.interest)}</span></div>
              <div className="pnl-row minus"><span className="k">직접 운영비 <em>보험·자차충당·정비·GPS·세금</em></span><span className="v">−{won(v.direct)}</span></div>
              {v.turnover > 0 ? (
                <div className="pnl-row minus">
                  <span className="k">손바뀜 위험 <em>{credit} · 유지율 {retentionPct}% → {turnovers.toFixed(2)}회 × {man(v.turnover / turnovers)}원</em></span>
                  <span className="v">−{won(v.turnover)}</span>
                </div>
              ) : null}
              <div className="pnl-row sum"><span className="k">매출총이익</span><span className="v">{won(v.gp)}</span></div>
              <div className="pnl-row head"><span className="k">판매관리비</span><span className="v" /></div>
              <div className="pnl-row minus"><span className="k">영업수수료 <em>{fee}%</em></span><span className="v">−{won(v.fee)}</span></div>
              <div className="pnl-row pay"><span className="k">영업이익 <em>{(v.opPct * 100).toFixed(1)}%</em></span><span className="v">{won(v.opProfit)}</span></div>
              <div className="pnl-row"><span className="k">보증금 <em>{dep}%</em> · 선납 <em>{pre}%</em></span><span className="v">{won(v.depAmt)} · {won(v.preAmt)}</span></div>
            </>
          );
        })()}
      </aside>

      {/* 폰에서만 시트로 뜬다 — 웹은 좌패널에 박혀 있어 이 시트가 필요 없다. */}
      {mobile ? (
        <CarPicker open={pickerOpen} mode={cond} onClose={() => setPickerOpen(false)}
          onPick={(c) => { setPicked(c); if (c.source === 'new') { setUsedMileage(0); setUsedYear(nowYear); } }} />
      ) : null}
    </div>
  );
}
