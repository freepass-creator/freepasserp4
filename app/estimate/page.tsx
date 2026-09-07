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
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import EstimateGate from '@/features/estimate/EstimateGate';
import '@/components/estimate/estimate.css';
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
const PCTS = [0, 10, 20, 30];
/** 수수료 칩 — 원가 설정의 기본값이 목록에 없으면 그 값도 함께 세운다(고른 값이 안 보이면 안 된다). */
const FEE_CHIPS = [0, 2.5, 5];
const DISCS = [0, 2, 5, 10];
const CREDIT = ['고신용', '중신용', '저신용'];
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
  /* 넓은 화면에서는 기간을 «열»로 편다 — 아래 손익표(`.qmx`). 폰은 목업 그대로 아코디언. */
  const mobile = useIsMobile();
  /**
   * 손익표는 **다 들어가는 폭**에서만 편다. 표가 요구하는 최소폭이 760px 인데(항목 150 +
   * 기간 112×5 + 간격 10×5), 두 칸을 써도 화면이 1,600 은 돼야 그만큼이 나온다(1,560 에서는 다섯째 해가 잘렸다 — 실측).
   * 그 아래에서는 폰과 같은 **아코디언**을 쓴다 — 반쪽만 보이는 표는 안 편 것만 못하다
   * (2026-09-07 코덱스 실측: 1600 화면 한 칸에서 표시폭이 388px 이었다).
   */
  const narrow = useIsMobile(1600);
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

  // 회사 값을 받아 덮는다 — 사장님이 정한 원가가 있으면 그것이 이긴다.
  useEffect(() => {
    let alive = true;
    fetchSharedCost().then((r) => { if (alive) { setCost(r.cost); setFee(r.cost.salesFeePct); } }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const fees = useMemo(() => Array.from(new Set([...FEE_CHIPS, cost.salesFeePct])).sort((a, b) => a - b), [cost.salesFeePct]);

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

  const cards = useMemo<Card[]>(() => {
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
      conditions: { depositPct: dep, prepayPct: pre },
      residual: null, residualDefault, credit, defaultGroup: 'B', nowYear,
    });
    return TERMS.map((t) => ({ ...safeComputeTerm(t, input, { idx: t }), term: t }));
  }, [ch, type, price, isNew, credit, dep, pre, fee, residPct, nowYear, cost, cc, picked.fuel, usedMileage, usedYear, acq]);

  /** 손바뀜을 «몇 번»으로 풀어 보여 주기 위한 값 — 원가 설정의 반납률에서 온다. */
  const retentionPct = credit === '저신용' ? cost.retentionLowPct
    : credit === '중신용' ? cost.retentionMidPct : cost.retentionNormalPct;
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
    <div className="est-root">
      <div className="phone">
        <div className="hd">
          <div className="wm"><span className="a">freepass</span><span className="b">mobility</span></div>
          <div className="modesw">
            <span className="on">견적</span>
            <Link href="/estimate/cost">원가</Link>
          </div>
        </div>

        {/* ★웹에서 두 기둥으로 서기 위한 감싸개 — **폰에서는 없는 셈**이다(`.col{display:contents}`).
            사장님 2026-09-06 「웹 전용 화면은 없네, 견적기가」. 폰 화면을 한 픽셀도 안 건드리려고
            감싸개를 CSS 로만 켠다 — 마크업은 폰·웹이 같고, 넓은 화면에서만 두 기둥이 된다. */}
        <div className="col c1">

        {/* STEP 1 차량 */}
        <div className="card">
          <div className="step"><span className="no">1</span>차량<span className="veh">{vehTag}</span></div>
          <Seg tone="t1" cur={cond} onPick={setCond} opts={[{ v: 'used', label: '중고' }, { v: 'new', label: '신차' }]} />
          {/* 차 고르기 — 목업은 중고=읽기전용 검색칸 · 신차=select 셋이었다.
              둘을 «한 줄»로 합치고 시트를 연다(옵션·조합규칙은 select 로 못 담는다 · CarPicker 머리말). */}
          {/* 폰에서만 «고르기 버튼»이 선다 — 웹은 이 카드 밑에 피커가 통째로 박힌다(아래). */}
          {mobile ? (
            <button type="button" className="vsearch" onClick={() => setPickerOpen(true)}>
              <IconSearch />
              <span className="vt">{picked.name}</span>
              <span className="vg">{isNew ? '신차 고르기' : '차종 고르기'}</span>
            </button>
          ) : null}
          <div className="vchip">
            <div className="ic"><IconCar /></div>
            <div><div className="nm">{picked.name}</div><div className="mt">{vMeta}</div></div>
          </div>

          {/* 마스터가 못 주는 값은 사람이 넣는다 — 중고 시세·연식·주행은 마스터에 없다. */}
          {!isNew ? (
            <>
              {/* 취득 경로 — 기보유/매입, 상품화 여부. 초기비가 여기서 켜지고 꺼진다. */}
              <div className="crow" style={{ marginTop: 12 }}>
                <span className="lb">취득</span>
                <Chips opts={ACQ.map((a) => a.label)} cur={ACQ.find((a) => a.v === acq)!.label}
                  onPick={(l) => setAcq(ACQ.find((a) => a.label === l)!.v)} />
              </div>
              <div className="crow">
                {/* ★중고는 «무조건 시세를 입력»한다(사장님 2026-09-06). 장부가·최초매입가가 아니다 —
                    「지금부터 이 차를 굴리면 얼마 까먹나」가 맞게 나오려면 지금 값이어야 한다. */}
                <span className="lb">시세</span>
                <span className="pin w"><input inputMode="numeric" value={man(usedPrice)}
                  onChange={(e) => setUsedPrice(digits(e.target.value) * 10000)} /><i>만원</i></span>
              </div>
              <div className="crow">
                <span className="lb">연식</span>
                <span className="pin"><input inputMode="numeric" value={usedYear}
                  onChange={(e) => setUsedYear(digits(e.target.value))} /><i>년</i></span>
              </div>
              <div className="crow">
                <span className="lb">주행</span>
                <span className="pin w"><input inputMode="numeric" value={usedMileage.toLocaleString('ko-KR')}
                  onChange={(e) => setUsedMileage(digits(e.target.value))} /><i>km</i></span>
              </div>
            </>
          ) : (
            <div className="crow" style={{ marginTop: 12 }}>
              <span className="lb">차량가</span>
              <span className="pin w"><input value={man(listPrice)} disabled /><i>만원</i></span>
              <span className="hint">공표가 + 옵션</span>
            </div>
          )}
          {needCc ? (
            <div className="crow">
              <span className="lb">배기량</span>
              <span className="pin w"><input inputMode="numeric" value={manualCc ? manualCc.toLocaleString('ko-KR') : ''}
                placeholder="0" onChange={(e) => setManualCc(digits(e.target.value))} /><i>cc</i></span>
              <span className="hint">마스터에 없음</span>
            </div>
          ) : null}

          <div className="crow">
            <span className="lb">매입 할인</span>
            <Chips opts={DISCS} cur={disc} unit="%" onPick={setDisc} />
          </div>
        </div>

        {/*
          * ★★**차 고르기는 좌 기둥 «안»에 박힌다**(웹) — 사장님 2026-09-07
          *   「차량 고르는 거 좌측에서 다 골랐잖아 … **왜 패널이 새로 뜨니**」.
          *   원본 둘 다 그렇다: 손오공 `.vside`(400) 에 차종검색·캐스케이드·차량정보가 박혀 있고,
          *   웰릭스 `.wrap`(400) 에 제조사→모델→트림→옵션이 박혀 있다.
          *   모달은 «바구니·견적서·공지» 같은 **결과물**에만 쓰고, «고르는 일»에는 안 쓴다.
          * ⚠ 폰은 시트 그대로다 — 좌 기둥이 없으니 띄울 수밖에 없다. 그래서 `open` 이 갈린다.
          */}
        <CarPicker open={mobile ? pickerOpen : true} inline={!mobile} mode={cond}
          onClose={() => setPickerOpen(false)}
          onPick={(c) => {
            setPicked(c);
            // 신차는 공표가가 곧 차량가다. 연식·주행은 새 차니 올해·0.
            if (c.source === 'new') { setUsedMileage(0); setUsedYear(nowYear); }
          }} />

        </div>{/* .col.c1 — 차량 고르기(사장님 2026-09-07 「좌측에서는 차량만 선택」) */}

        <div className="col c2">

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

        </div>{/* .col.c2 — 조건 · 잔가 · 원가기준 */}

        <div className="col c3 wide">

        {/* ⑤ — ①~④ 와 같은 상자. 기간 다섯 줄이 그 안에 든다(사장님 2026-09-06). */}
        <div className="card terms">
          <div className="step"><span className="no">5</span>기간별 대여료 · 수익</div>
          {/* ⚠ 배기량이 없으면 자동차세가 «조용히 0» 으로 잡힌다. 화면이 그 사실을 말해야 한다
              (2026-09-07 — 신차 79쌍 중 32이 배기량 null 이었고 아무도 몰랐다). */}
          {cards.some((c) => (c as { incompleteCc?: boolean }).incompleteCc) ? (
            <div className="byrow" style={{ marginBottom: 10 }}>
              <b>배기량을 넣어야 정확합니다</b> — 지금은 <b>자동차세가 0</b> 으로 잡혀 있어 원가가 실제보다 적습니다.
              위 <b>차량</b> 칸의 배기량을 채워 주세요.
            </div>
          ) : null}
          {/*
            * ★★넓은 화면에서는 기간을 «열», 항목을 «행»으로 놓는다
            *   (사장님 2026-09-07 「총 4개 패널 중 1개를 차량 선택하는 패널로 쓰고, 나머지 조건과
            *    **1년부터 5년까지 견적 나오는 거는 우측 패널에서 상세하게** 나온다고 —
            *    이걸 어떻게 구현할 건가가 관건임」).
            *
            *   왜 표인가 — 기간마다 카드를 세우면 「매출·감가·이자·수수료…」 라벨이 **다섯 번 반복**된다.
            *   폭을 그만큼 버리고, 정작 «3년과 4년의 감가가 얼마나 다른지»는 눈으로 못 맞춘다.
            *   행으로 세우면 같은 항목이 한 줄에 서서 다섯 해가 그 자리에서 견줘진다.
            *   ⇒ 손오공 원본 `.qcols`(열마다 반복)보다 한 발 더 간 것이다. 원본은 기간이 넷이고
            *     항목이 셋뿐이라 반복이 견딜 만했지만, 우리는 기간 다섯 × 항목 열이다.
            *
            * ⚠ **폰은 목업 그대로 아코디언**이다. 표는 폰에서 여섯 열이 되어 못 읽는다.
            *   그래서 여기만 `useIsMobile()` 로 갈린다 — 색이 아니라 «짜임»이라 첫 그림이 한 번
            *   바뀌어도 번쩍이지 않는다(색을 JS 로 가르면 흰 띠가 번쩍인다 — CLAUDE.md 상단바 항목).
            */}
          {narrow ? (
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
                    <div className="li minus">
                      <span className="k">· 손바뀜 위험 <em>{credit} · 유지율 {retentionPct}% → {turnovers.toFixed(2)}회 × {man(v.turnover / turnovers)}</em></span>
                      <span className="v">−{won(v.turnover)}</span>
                    </div>
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
          ) : (
          <div className="qmxw">
          <div className="qmx" style={{ gridTemplateColumns: `minmax(150px,1.1fr) repeat(${cards.length}, minmax(112px,1fr))` }}>
            <span className="qk hd" />
            {cards.map((c) => <span className="qc hd" key={`h${c.term}`}>{c.term / 12}년</span>)}

            <span className="qk big">월 납입금 <em>VAT 포함</em></span>
            {cards.map((c) => (
              <span className="qc big" key={`p${c.term}`}>{Math.round(c.payVat || 0).toLocaleString('ko-KR')}</span>
            ))}

            <span className="qk">매출 <em>공급가</em></span>
            {cards.map((c) => <span className="qc" key={`r${c.term}`}>{won(pnl(c, prepayAmt).rev)}</span>)}

            <span className="qk sub">매출원가</span>
            {cards.map((c) => <span className="qc sub" key={`cg${c.term}`} />)}

            <span className="qk in">· 차량 감가 <em>취득−잔존</em></span>
            {cards.map((c) => <span className="qc minus" key={`d${c.term}`}>−{won(pnl(c, prepayAmt).dep)}</span>)}

            <span className="qk in">· 금융비용 <em>조달이자</em></span>
            {cards.map((c) => <span className="qc minus" key={`i${c.term}`}>−{won(pnl(c, prepayAmt).interest)}</span>)}

            <span className="qk in">· 직접 운영비 <em>보험·자차·정비·GPS·세금</em></span>
            {cards.map((c) => <span className="qc minus" key={`o${c.term}`}>−{won(pnl(c, prepayAmt).direct)}</span>)}

            <span className="qk in">· 손바뀜 위험 <em>{credit} · 유지율 {retentionPct}% → {turnovers.toFixed(2)}회</em></span>
            {cards.map((c) => {
              const t = pnl(c, prepayAmt).turnover;
              return <span className="qc minus" key={`t${c.term}`}>{t > 0 ? `−${won(t)}` : '—'}</span>;
            })}

            <span className="qk">매출총이익</span>
            {cards.map((c) => <span className="qc" key={`g${c.term}`}>{won(pnl(c, prepayAmt).gp)}</span>)}

            <span className="qk sub">판매관리비</span>
            {cards.map((c) => <span className="qc sub" key={`s${c.term}`} />)}

            <span className="qk in">· 영업수수료 <em>{fee}%</em></span>
            {cards.map((c) => <span className="qc minus" key={`f${c.term}`}>−{won(pnl(c, prepayAmt).fee)}</span>)}

            <span className="qk pay">영업이익</span>
            {cards.map((c) => {
              const v = pnl(c, prepayAmt);
              return <span className="qc pay" key={`op${c.term}`}>{won(v.opProfit)}<em>{(v.opPct * 100).toFixed(1)}%</em></span>;
            })}

            <span className="qk">잔가율</span>
            {cards.map((c) => <span className="qc" key={`rr${c.term}`}>{Math.round((c.residualRate || 0) * 100)}%</span>)}

            <span className="qk">보증금 <em>{dep}%</em> · 선납 <em>{pre}%</em></span>
            {cards.map((c) => {
              const v = pnl(c, prepayAmt);
              return <span className="qc" key={`dp${c.term}`}>{won(v.depAmt)} · {won(v.preAmt)}</span>;
            })}
          </div>
          </div>
          )}
        </div>

        </div>{/* .col.c3.wide — 손익표. **두 칸**을 쓴다(아래 CSS) — 표가 760px 를 요구한다 */}

        <div className="foot">
          <b>업계 기준선 추정</b> — 잔가=시장 벤치마크 역산, 수익률=업계 영업이익률(SK렌터카 9.9%).
          실채택 전 엔카·KB차차차 실시세 검산 필요. 잔존가만 건별 입력.
        </div>
      </div>
    </div>
  );
}
