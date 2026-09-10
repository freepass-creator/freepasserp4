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
/* ★기존 견적기 규격을 그대로 쓴다 — 사장님 2026-09-08 「기존거 활용하라고 했는데」.
   칩·세그·숫자칸(`.chips`·`.seg`·`.pin`)과 **사선 0**(`tabular-nums slashed-zero`)이 여기 있다.
   ⚠ 웰릭스 뒤에 실어야 한다 — 같은 이름 토큰은 «뒤엣것»이 이긴다(글꼴·사선·색을 기존 것으로 맞춘다). */
import '@/components/estimate/estimate.css';
import '@/components/estimate/picker.css';
import { useAppBar } from '@/lib/appbar';
/* 색은 화면이 지어내지 않는다 — 규격색·색칩은 색상마스터(SSOT)에서만 당긴다. */
import { EXT_COLORS, INT_COLORS, colorSwatch } from '@/lib/domain/color-master';
import CarPicker from '@/features/estimate/CarPicker';
import VehicleCascade from '@/features/estimate/VehicleCascade';
import QuotePreview, { type QuoteDoc } from '@/features/estimate/QuotePreview';
import EstimateWizard from '@/features/estimate/EstimateWizard';
import { hasRules, isEnabled, optionList, optionSum, toggleOption, whyBlocked, groupOf, type OptionSpec }
  from '@/lib/domain/estimate/option-rules';

import { guessMarketPrice, loadCarIndex, loadNewModels, koModel, type PickedCar, type NewModel, type CarIndex } from '@/lib/domain/estimate/car-index';
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

/**
 * 세그 — **기존 것**(`estimate.css .seg`). 두셋 중 하나를 고르는 칸.
 * ★사장님 2026-09-08 「기존거 활용하라고 했는데」 — 새로 만들지 않는다.
 */
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

/** 칩 줄 — **기존 것**(`estimate.css .chips`). 칸을 같은 폭으로 나눠 가진다. */
function Chips<T extends string | number>({ opts, cur, onPick }: {
  opts: readonly { v: T; label: string }[]; cur: T; onPick: (v: T) => void;
}) {
  return (
    <div className="chips">
      {opts.map((o) => (
        <button key={String(o.v)} type="button" className={o.v === cur ? 'on' : ''} onClick={() => onPick(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

/**
 * 고를 것이 많은 칸 — **기존 것**(`picker.css .tchips`). 접히는 칩이라 열일곱·수십도 받는다.
 * 긴 칸은 `scroll` 로 키를 묶는다(안 묶으면 왼쪽을 통째로 민다).
 */
function TChips<T extends string>({ opts, cur, onPick, scroll, empty }: {
  opts: { v: T; label: string; sub?: string; swatch?: string }[];
  cur: T | ''; onPick: (v: T) => void; scroll?: boolean; empty?: string;
}) {
  if (!opts.length) return <div className="empty-state">{empty ?? '고를 것이 없습니다'}</div>;
  return (
    <div className={`tchips${scroll ? ' scroll' : ''}`}>
      {opts.map((o) => (
        <button key={o.v} type="button" className={String(o.v) === String(cur) ? 'on' : ''} onClick={() => onPick(o.v)}>
          {o.swatch ? <span className="sw" style={{ background: o.swatch }} /> : null}
          {o.label}{o.sub ? <em>{o.sub}</em> : null}
        </button>
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
  /**
   * 시세를 **사람이 손댔나** — 손대면 그 값이 이긴다(자동 채움이 덮지 않는다).
   * ★사장님 2026-09-08 「평균시세는 **틀릴 수 있으니까**」 — 그래서 채워는 주되 **잠그지 않는다**.
   */
  const [priceTyped, setPriceTyped] = useState(false);
  /**
   * 지금 시세가 **우리가 짚은 값인가**. 「추정」 표시는 이것에만 붙는다.
   * ⚠ 첫 화면의 박아 둔 차(그랜저 2,700만)는 «짚은 값»이 아니라 «박은 값»이다 — 붙이면 거짓말이다
   *   (2026-09-08 눌러 보고 잡음).
   */
  const [priceSeeded, setPriceSeeded] = useState(false);
  /** 신차 공표가 — 중고 시세를 짚는 씨앗이다(우리에게 시세 원장이 없다). */
  const [newModels, setNewModels] = useState<NewModel[] | null>(null);
  /** 이름 사전 — 신차마스터가 기아를 영문 슬러그로 주므로 한글로 되짚어야 한다. */
  const [carIdx, setCarIdx] = useState<CarIndex | null>(null);
  /** 중고 취득 경로 — 기보유면 등록·탁송·상품화가 원가에서 빠진다. */
  const [acq, setAcq] = useState<AcqPath>('prep');
  const [disc, setDisc] = useState(0);
  const [dep, setDep] = useState(10);
  const [pre, setPre] = useState(0);
  /* 위 조건 칸은 «다섯 줄을 한꺼번에» 바꾸는 손잡이다. 줄마다 따로 잡고 싶으면 그 줄에서 고친다. */
  /**
   * 원가 설정(`/estimate/cost`)이 정한 값 — 견적은 그것으로 계산한다.
   * ★첫 그림은 «캐시»로 즉시 그리고(대여료가 서 있어야 한다), 곧바로 **회사 값**을 받아 덮는다.
   */
  const [cost, setCost] = useState(() => cachedCost());
  const [fee, setFee] = useState(() => cachedCost().salesFeePct);
  const [open, setOpen] = useState<number | null>(48);
  /** 잔가는 «자동(표준+델타)»이 기본이고, 목업 STEP 4 처럼 건별로 덮어쓸 수 있다. */
  /**
   * ★★잔가는 **둘**이다 — 사장님 2026-09-08 「잔가는 내부에서 **견적용 잔가와 손님 인수용 잔가가 2개**가 있음」.
   *
   *   ㉠ **견적용**(`residOverride`) — 우리가 «얼마에 팔릴까»로 잡는 값. **대여료를 만든다.**
   *      보수적으로 낮게 잡을수록 대여료가 올라가고 우리 위험이 줄어든다.
   *   ㉡ **인수용**(`buyoutOverride`) — 만기에 **손님이 사 가는 값**. 견적서에 「만기인수」로 찍힌다.
   *      ⇒ **대여료에는 안 들어간다.** 둘을 한 값으로 묶으면 「손님에게 싸게 넘기려고 잔가를 올렸더니
   *        대여료가 같이 싸지는」 사고가 난다.
   *   기본은 둘 다 곡선(표준+차종델타)이고, 칸마다 직접 넣을 수 있다.
   */
  const [residOverride, setResidOverride] = useState<Record<number, number>>({});
  const [buyoutOverride, setBuyoutOverride] = useState<Record<number, number>>({});
  /** 손님·담당자 — 원본 `CustomerStaffForm`. 견적서에 찍혀 나갈 이름이라 견적 화면이 묻는다. */
  const [custName, setCustName] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffTel, setStaffTel] = useState('');
  /**
   * 신차 옵션 — 웰릭스 원본은 왼쪽에 «선택 옵션» 칸을 따로 세운다(사장님 2026-09-08 「1번으로」).
   * 그 전에는 차 고르기 시트 «안»에 있었다. 밖으로 꺼냈으니 고른 값도 여기서 쥔다.
   */
  const [optSel, setOptSel] = useState<Record<string, boolean>>({});
  /**
   * 색상 — 원본 `ColorSection`. ⚠ **값에는 영향이 없다.**
   *   원본은 제조사 색상표(펄·매트 유료색·투톤 +50만)를 들고 있어 차량가에 더하지만,
   *   우리 신차마스터에는 **색상별 가격이 없다.** 없는 값을 지어내느니 「고른 것을 적어만 둔다」로 둔다
   *   (견적서에 나갈 항목이다). 색 이름·색칩은 색상마스터 규격색을 쓴다.
   */
  const [colorExt, setColorExt] = useState('');
  const [colorInt, setColorInt] = useState('');
  /** 손님 견적서를 펼쳤나 — 체크한 기간만 담아 보여 준다(사장님 2026-09-08 「다음 ㄱㄱㄱ」). */
  const [docOpen, setDocOpen] = useState(false);
  /**
   * 손님 발송용 견적 — 원본 `TermsGrid`. 「기본 견적」과 달리 **열마다** 기간·보증금·선납이 따로 논다.
   * 체크한 열만 손님에게 나간다(발송 자체는 아직 안 붙었다 — 다음 일감).
   */
  /** 다섯 해 각각의 조건 — 보증금·선납은 «줄마다» 잡는다(그게 「설계」다). */
  const [scen, setScen] = useState(() => TERMS.map((term) => ({
    term, dep: 10, pre: 0, send: term >= 36,
  })));
  /** 어느 해의 «속»을 펼쳐 봤나 — 줄을 누르면 그 해의 원가 분해가 그 자리에서 열린다. */
  const [openTerm, setOpenTerm] = useState<number | null>(48);

  /* 신차 공표가 — 중고 시세를 짚는 데 쓴다. 견적 첫 그림을 막지 않게 뒤늦게 받는다. */
  useEffect(() => {
    let alive = true;
    loadNewModels().then((m) => alive && setNewModels(m)).catch(() => {});
    loadCarIndex().then((j) => alive && setCarIdx(j)).catch(() => {});
    return () => { alive = false; };
  }, []);

  // 회사 값을 받아 덮는다 — 사장님이 정한 원가가 있으면 그것이 이긴다.
  useEffect(() => {
    let alive = true;
    fetchSharedCost().then((r) => { if (alive) { setCost(r.cost); setFee(r.cost.salesFeePct); } }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const isNew = cond === 'new';
  // 갈래를 바꾸면 고른 차도 그 갈래의 것으로 돌아간다 — 중고를 고른 채 신차 값이 계산되면 안 된다.
  useEffect(() => { setPicked(cond === 'new' ? DEFAULT_NEW : DEFAULT_USED); setManualCc(0); }, [cond]);
  /* ⚠ 차(트림)가 바뀌면 옵션·색을 «비운다». 안 비우면 딴 차의 옵션값이 남아 차량가가 조용히 틀어진다. */
  useEffect(() => { setOptSel({}); setColorExt(''); setColorInt(''); }, [picked]);

  /**
   * ★★차를 바꾸면 **연식과 시세를 채워 준다** — 사장님 2026-09-08
   *   「없으면 **평균시세는 입력해주고 바꿀 수 있게끔**. 평균시세는 틀릴 수 있으니까」.
   *
   *   전에는 차를 바꿔도 앞 차의 시세가 그대로 남았다 — 레이를 골라도 2,700만원(그랜저 값)이라
   *   대여료가 엉뚱하게 나왔다(2026-09-08 실측).
   *
   *   ⚠ **사람이 시세를 손댔으면 안 덮는다.** 채워 주는 것이지 정해 주는 것이 아니다.
   *   ⚠ 못 짚으면 **0 으로 두고 화면이 「모른다」고 말한다.** 지어낸 시세로 견적을 내면 그게 더 위험하다.
   */
  useEffect(() => {
    if (isNew || picked === DEFAULT_USED) return;
    // 연식 — 그 세부모델 생산기간의 «가운데». 2019~2022 면 2020, 2022~현재면 (2022+올해)/2.
    const from = Number(picked.ys) || 0;
    const to = /현재|now/i.test(String(picked.ye)) ? nowYear : (Number(picked.ye) || from);
    const year = from ? Math.round((from + to) / 2) : nowYear - 3;
    setUsedYear(year);
    setPriceTyped(false);
    setPriceSeeded(false);
  }, [picked, isNew, nowYear]);

  /** 채워 넣을 시세 — 신차 공표가(가운데 트림) × 연식 잔가곡선. 사람이 손대면 멈춘다. */
  useEffect(() => {
    if (isNew || priceTyped || picked === DEFAULT_USED) return;
    const k = deltaKeyFor(picked.maker, picked.model);
    const age = Math.max(0, nowYear - (usedYear || nowYear));
    const seed = guessMarketPrice(newModels, picked.maker, picked.model, age,
      (y) => newcarResidPct(k?.makerId ?? null, k?.modelCode ?? null, y), carIdx?.al,
      picked.powertrain);
    setUsedPrice(seed);
    setPriceSeeded(seed > 0);
  }, [picked, isNew, priceTyped, newModels, carIdx, usedYear, nowYear]);

  /** 고른 트림의 옵션 줄 — 원본 규격대로 «가격 0 = 기본 포함»은 고르는 대상이 아니다. */
  /**
   * ★★옵션 «조합 규칙» — 배타(택1)·선행필수·배제. 사장님 2026-09-09
   *   「야 **옵션은 명확하게 다 구현하는 게 웰릭스 테이블에 있는데**」.
   *   여태는 규칙을 «글»로만 보여 주고 안 막았다 — 그러면 «있을 수 없는 차»의 값이 견적서에 찍힌다.
   * ⚠ 규칙이 있는 트림만 막는다(272줄). 없는 트림은 지금처럼 평면 목록이다 —
   *   규칙이 없다고 못 고르게 만들면 «못 받은 것»이 «없는 것»이 된다.
   */
  const optSpec = useMemo<OptionSpec>(() => ({
    optionsMaster: picked.newTrim?.optionsMaster,
    exclusiveGroups: picked.newTrim?.exclusiveGroups,
    optionExcludes: picked.newTrim?.optionExcludes,
    availableOptions: picked.newTrim?.availableOptions,
    impliedOptions: picked.newTrim?.impliedOptions,
  }), [picked]);
  const ruled = hasRules(optSpec);
  /** 규칙판에서 고른 것들 — 이름이 아니라 «옵션 id» 다. */
  const [optIds, setOptIds] = useState<ReadonlySet<string>>(() => new Set());
  const ruledRows = useMemo(() => (ruled ? optionList(optSpec) : []), [ruled, optSpec]);

  const optionRows = useMemo(() => (picked.newTrim?.options ?? []).filter((o) => o && o.name), [picked]);
  /**
   * ⚠⚠ 옵션은 **이름이 아니라 «줄»로 센다.**
   *   같은 이름이 두 줄인 트림이 있다(2026-09-08 실측 423개 중 5개 · 제네시스 G80 은
   *   「AWD」가 280만/0원 두 줄, 「파노라마 선루프」가 110만/140만 두 줄이다 —
   *   BTO 에서 엔진마다 값이 다른 것이 한 트림으로 합쳐진 탓이다).
   *   이름으로 세면 두 줄이 **한 칸을 같이 쥐어** 하나를 누르면 둘이 켜지고, 값도 어느 쪽인지 모른다.
   *   (React 도 같은 key 라고 콘솔에 경고했다 — 「둘 중 하나가 빠질 수 있다」.)
   */
  const optKey = (o: { name: string }, i: number) => `${i}|${o.name}`;
  /**
   * ⚠ 차를 바꾸면 고른 옵션은 **버린다.** 안 버리면 그랜저에서 켠 「파노라마 선루프」가
   *   G80 으로 넘어가 붙는다 — 줄 번호가 키라 이름이 달라도 «자리»가 겹친다.
   *   ⇒ 트림이 바뀌는 순간이 버리는 자리다.
   */
  const trimSig = [picked.source, picked.maker, picked.subModel, picked.powertrain, picked.trim].join('|');
  useEffect(() => { setOptSel({}); setOptIds(new Set()); }, [trimSig]);
  const optChosen = useMemo(
    () => optionRows.filter((o, i) => Number(o.price) > 0 && optSel[optKey(o, i)]),
    [optionRows, optSel],
  );
  const optSum = ruled ? optionSum(optSpec, optIds) : optChosen.reduce((n, o) => n + (Number(o.price) || 0), 0);
  /** 기아는 가격표를 «좌표»로 읽어 옵션 «이름»이 조각으로 온다(「옵션3」) — 값은 정확하다. 숨기지도 지어내지도 않는다. */
  const optNamesPartial = useMemo(() => optionRows.some((o) => /^옵션\s*\d+$/.test(o.name.trim())), [optionRows]);

  /** 제조사 색상 — 고를 수 있는 것만(`choiceYn`). 없으면 빈 목록이고 화면이 그렇다고 말한다. */
  const extColors = useMemo(
    () => (picked.newTrim?.extColors ?? []).filter((c) => c?.name && c.ok !== 'N'), [picked]);
  const intColors = useMemo(
    () => (picked.newTrim?.intColors ?? []).filter((c) => c?.name && c.ok !== 'N'), [picked]);
  /**
   * ★값이 붙는 색은 «차량가»에 더한다 — 옵션과 같다(「클라우드 펄 +30만」).
   * ★★**내장도 더한다**(사장님 2026-09-09 「제조사에서 **차량 가격 산출까지** 그 로직을 동일하게」) —
   *   제네시스 「시그니쳐 디자인 셀렉션Ⅰ +150만」처럼 **내장에도 값이 붙는다.**
   *   2026-09-08 판은 외장만 더해서, 유료 내장을 골라도 차량가가 그대로였다.
   */
  const colorAdd = useMemo(() => {
    if (!isNew) return 0;
    const e = Math.max(0, Number(extColors.find((c) => c.name === colorExt)?.price) || 0);
    const i = Math.max(0, Number(intColors.find((c) => c.name === colorInt)?.price) || 0);
    return e + i;
  }, [isNew, extColors, colorExt, intColors, colorInt]);

  /* ★신차 차량가 = «트림값 + 고른 옵션». 옵션을 밖에서 고르므로 더하는 일은 화면 몫이다. */
  const listPrice = isNew ? (picked.price ?? 0) + optSum + colorAdd : usedPrice;
  const price = Math.round(listPrice * (1 - disc / 100));
  /**
   * ★★**판매가격 세제감면**(개소세·교육세) — 제조사가 준 「세제혜택 전 − 후」.
   *   손님 표시가(`price`)는 「전」 그대로 두고, **돈이 도는 값**은 감면 후(`netPrice`)로 잇는다.
   *   ⚠ 안 이으면 또 갈린다 — 보증금은 엔진이 감면 후로 세는데 선납·인수는 표시가로 세어,
   *     손님이 「차량가 × 인수율」을 두드리면 안 맞는다(2026-09-09).
   *   ⚠ 할인율만큼 감면도 같이 줄인다 — 할인된 차의 감면은 그 값 기준이다.
   */
  const taxCredit = isNew && listPrice > 0
    ? Math.round((picked.saleTaxCredit ?? 0) * (price / listPrice)) : 0;
  /** 돈이 도는 값 — 보증금·선납·인수·원가가 다 이 위에 선다.
   *  ⚠⚠ **화면과 견적서가 «같은 값»을 써야 한다.** 2026-09-09 에 견적서만 여기로 옮기고
   *    화면 카드(선납·만기인수·손익)를 `price` 로 남겨, 한 견적에서 인수가가 **239만** 갈렸다
   *    (EV9 48개월 · 개발센터 4-AI 관문 Codex 발견 1·2). 세 자리를 한꺼번에 옮긴다. */
  /* ⚠⚠ **엔진이 딛는 값과 «똑같아야» 한다.** `calc.js` 의 netPrice 는
       `price − 전기차보조금 − 판매가격세제감면` 이고, 보증금이 그 위에서 나온다.
       화면이 보조금을 안 빼면 보증금만 엔진 기준, 선납·인수는 화면 기준이 되어 또 갈린다
       (2026-09-10 개발센터 4-AI 관문 · Codex 발견 1 — 선납금이 412,000원 어긋나 월납이 9,000원 낮았다). */
  const evSub = isNew && picked.fuel === 'ev' ? Math.max(0, Number(cost.evSubsidy) || 0) : 0;
  const netPrice = Math.max(0, price - evSub - taxCredit);
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
  /** 견적용 — 엔진이 이 값으로 대여료를 만든다. */
  const residPct = useMemo(() => {
    const out: Record<number, number> = {};
    for (const t of TERMS) out[t] = residOverride[t] ?? autoResid[t];
    return out;
  }, [autoResid, residOverride]);
  /**
   * 인수용 — 손님이 만기에 사 가는 값. 기본은 견적용과 같다(지금까지의 동작 그대로).
   * ⚠ 이 값은 **대여료에 안 들어간다.** 올려도 월납은 안 움직인다 — 만기에 받는 돈만 달라진다.
   */
  const buyoutPct = useMemo(() => {
    const out: Record<number, number> = {};
    for (const t of TERMS) out[t] = buyoutOverride[t] ?? residPct[t];
    return out;
  }, [buyoutOverride, residPct]);

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
        /* ★판매가격 세제감면(개소세·교육세) — 손님 표시가는 「세제혜택 전」 그대로 두고
           **원가에서만** 뺀다. 할인율만큼 감면도 같이 줄인다(할인된 차의 감면은 그 값 기준이다). */
        saleTaxCredit: taxCredit,
        /* 선납금은 화면이 보여 준 그 값으로 — 엔진이 다시 세지 않는다. */
        netPrice,
      },
      conditions: { depositPct: d, prepayPct: p },
      residual: null, residualDefault, credit, defaultGroup: 'B', nowYear,
    });
    return { ...safeComputeTerm(t, input, { idx: t }), term: t };
  }, [ch, type, price, listPrice, isNew, credit, fee, residPct, nowYear, cost, cc,
    picked.fuel, picked.saleTaxCredit, usedMileage, usedYear, acq]);

  /**
   * ★다섯 해가 «각자 제 조건»으로 선다 — 이 한 벌이 화면의 전부다.
   *   그 전에는 「기본 견적(고정 3장)」과 「손님 발송용(자유 3열)」과 「손익(오른쪽 탭)」 셋이 따로 있었다.
   *   같은 숫자를 세 군데서 세니 어디를 봐야 하는지가 흐려졌다(사장님 2026-09-08 「우측에 따로 놓지 말고」).
   */
  const lines = useMemo<Card[]>(() => scen.map((x) => mk(x.term, x.dep, x.pre)), [mk, scen]);

  /**
   * ★★시세를 모르면 **견적을 안 낸다.**
   *   2026-09-08 눌러 보고 잡았다 — 시세 0 인 차에 「274,000원」이 섰다. 감가만 0 이고
   *   보험·정비·세금 같은 고정비가 남아서 나온 숫자다. **그건 견적이 아니라 찌꺼기다.**
   *   ⇒ 값을 못 짚었으면 다섯 칸이 「—」로 선다. 지어낸 숫자보다 빈 칸이 정직하다.
   */
  const priceKnown = isNew ? listPrice > 0 : usedPrice > 0;

  /** 손바뀜을 «몇 번»으로 풀어 보여 주기 위한 값 — 원가 설정의 반납률에서 온다. */
  const retentionOf = useCallback((c: string) => (c === '저신용' ? cost.retentionLowPct
    : c === '중신용' ? cost.retentionMidPct : cost.retentionNormalPct), [cost]);
  const retentionPct = retentionOf(credit);
  const turnovers = expectedTurnovers(retentionPct / 100);

  /**
   * 손님 견적서에 담을 것 — **체크한 기간만**, 그리고 **손님이 볼 것만**.
   * ⚠ 원가·손익은 «한 줄도» 안 담는다. 담을 자리조차 두지 않았다(`QuoteLine` 에 없다) —
   *   자리가 있으면 언젠가 채워지고, 채워지면 손님이 우리 마진을 본다.
   */
  const quoteDoc = useMemo<QuoteDoc>(() => ({
    customer: custName, staff: staffName, tel: staffTel,
    // 제조사는 «따로» 준다 — 견적서 차량칸이 브랜드 줄(`.qd-vehicle__title`)을 따로 세운다.
    brand: picked.maker,
    carName: picked.maker && picked.name.startsWith(`${picked.maker} `)
      ? picked.name.slice(picked.maker.length + 1) : picked.name,
    carSub: [picked.powertrain, picked.trim].filter(Boolean).join(' · '),
    /* ★★**견적서 안에서 기준이 하나여야 한다**(사장님 2026-09-09 「견적만 제대로 나오게 해 기준만
       있으면 됩니다」). 예전에는 차량가만 «할인 전»(listPrice)이고 선납·인수는 «할인 후»(price)라,
       손님이 「차량가 × 인수율」을 손으로 계산하면 우리 숫자와 안 맞았다. 둘 다 «할인 후»로 맞춘다 —
       실제로 그 값에 차를 드리는 것이므로 손님 쪽 기준도 그것이다. */
    price,
    priceBasis: picked.priceBasis,
    saleTaxCredit: taxCredit,
    netPrice,
    channel: CHANNELS.find((c) => c.v === ch)!.label,
    endType: TYPES.find((t) => t.v === type)!.label,
    credit,
    colorExt, colorInt,
    options: ruled
      ? [...optIds].map((id) => ({ name: optSpec.optionsMaster?.[id]?.name ?? id, price: optSpec.optionsMaster?.[id]?.price ?? 0 }))
      : optChosen.map((o) => ({ name: o.name, price: Number(o.price) || 0 })),
    lines: scen.filter((x) => x.send).map((x, i) => {
      const c = lines[scen.findIndex((y) => y.term === x.term)] ?? lines[i];
      return {
        term: x.term,
        pay: Math.round(c?.payVat || 0),
        /* ★★보증금은 «%»가 아니라 «월납 배수»로 정해질 수 있다(`resolveDeposit` · 기준기간 월납 × 배수).
           그때는 세 기간이 다 같은 금액이 되고, 「10%」라는 딱지는 **손님에게 거짓말**이 된다
           (EV9 실측: 적용가 7,917만인데 「보증금 10% · 525만」 — 실제로는 6.6% · 2026-09-09 화면에서 발견).
           ⇒ 딱지는 «금액에서 되짚어» 붙인다. 화면 입력값을 그대로 인쇄하지 않는다. */
        depositPct: netPrice > 0
          ? Math.round((Math.round(c?.deposit || 0) / netPrice) * 1000) / 10 : x.dep,
        deposit: Math.round(c?.deposit || 0),
        prepayPct: x.pre, prepay: Math.round(netPrice * x.pre / 100),
        buyoutPct: buyoutPct[x.term], buyout: Math.round(netPrice * buyoutPct[x.term] / 100),
      };
    }),
    /* ⚠ `optIds`·`ruled`·`optSpec` 이 빠져 있었다 — 규칙판에서 옵션을 갈아도 견적서가
       «지난 옵션»을 실었다(2026-09-09 검수). 화면과 문서가 갈리면 문서가 이긴다(손님이 그걸 본다). */
  }), [custName, staffName, staffTel, picked, ch, type, credit, colorExt, colorInt,
    ruled, optIds, optSpec, optChosen, scen, lines, price, taxCredit, netPrice, buyoutPct]);

  const prepayAmt = Math.round(netPrice * pre / 100);
  /* ★차량가는 «세 자리»에 뜬다 — 폰 고정요약 · 웹 딱지 · 손님 견적서. 셋이 같은 값이어야 한다
     (사장님 2026-09-09 「기준만 있으면 됩니다」). 그래서 다 «할인 후»(price)로 맞춘다. */
  const vehTag = price ? `${man(price)}원` : '차를 고르세요';
  const vMeta = isNew
    ? [picked.meta, (ruled ? optIds.size : optChosen.length) ? `옵션 ${ruled ? optIds.size : optChosen.length}개 +${man(optSum)}` : null,
      listPrice ? `차량가 ${man(listPrice)}` : null].filter(Boolean).join(' · ')
    : [picked.meta, `시세 ${man(usedPrice)}`, `${usedYear}년`, `${usedMileage.toLocaleString('ko-KR')}km`,
      ACQ.find((a) => a.v === acq)!.label].filter(Boolean).join(' · ');

  // 하단 「검색」 탭이 이 화면에서는 «차 고르기»를 연다(lib/tabbar — 검색은 라우트가 아니라 행동이다).
  useAppBar({ search: { onOpen: () => setPickerOpen(true), active: picked !== DEFAULT_USED && picked !== DEFAULT_NEW } },
    [picked, cond]);

  /**
   * ★★화면 조각을 «변수»로 뽑는다 — 데스크톱과 폰이 **같은 조각**을 쓴다.
   *   사장님 2026-09-09 「모바일에서는 이거를 **다음 다음 다음** … 웰릭스 테이블에 이미 있는 내용」.
   *   ⚠ 폰용 마크업을 «따로» 짜면 두 화면이 갈린다 — 규격을 고칠 때 한쪽만 고쳐지고,
   *     그게 사장님이 여러 번 겪으신 「또 원래대로 돌아왔다」의 정체다(CLAUDE.md 절대원칙 3).
   *   ⇒ 조각은 하나, 그것을 «두 껍데기»가 나눠 쓴다.
   */
  const secColor = (
    <section id="sec-color">
      <div className="step-title">색상 {isNew ? <b>{extColors.length ? '제조사 색상' : '아직 안 들어옴'}</b> : <b>규격색</b>}</div>
      <div className="vfields">
        <div className="cs-field">
          <label>외장</label>
          <div className="color-wrap">
            {!isNew && colorExt ? <span className="color-swatch-mini" style={{ background: colorSwatch(colorExt) }} /> : null}
            <select className="step-dd" value={colorExt} onChange={(e) => setColorExt(e.target.value)}>
              <option value="">외장 색상</option>
              {isNew && extColors.length
                ? extColors.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}{c.price ? ` (+${man(c.price)}원)` : ''}</option>
                ))
                : EXT_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="cs-field">
          <label>내장</label>
          <div className="color-wrap">
            {!isNew && colorInt ? <span className="color-swatch-mini" style={{ background: colorSwatch(colorInt) }} /> : null}
            <select className="step-dd" value={colorInt} onChange={(e) => setColorInt(e.target.value)}>
              <option value="">내장 색상</option>
              {isNew && intColors.length
                ? intColors.map((c) => <option key={c.name} value={c.name}>{c.name}{c.price ? ` (+${man(c.price)}원)` : ''}</option>)
                : INT_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {isNew && !extColors.length ? (
          <div className="wx-warn">이 트림의 **제조사 색상**이 아직 안 들어왔습니다 — 규격색으로 적어 둡니다.</div>
        ) : null}
      </div>
    </section>
  );
  const secOptions = (
    isNew ? (
      <section id="sec-options">
        <div className="step-title">
          선택 옵션 {ruled ? <b>{ruledRows.length}개</b> : optionRows.length ? <b>{optionRows.length}개</b> : null}
          {ruled ? <span className="seedmark" title="배타·선행·배제 규칙이 걸려 있습니다">조합규칙</span> : null}
        </div>
        {!picked.newTrim ? (
          <div className="empty-state">트림을 먼저 고르면 옵션이 나옵니다</div>
        ) : ruled ? (
          /* ★규칙판 — 배타그룹은 «택1», 선행이 안 켜졌으면 못 고르고, 배제되면 못 고른다. */
          <div className="grid-1">
            {ruledRows.map(({ id, def }) => {
              const on = optIds.has(id);
              const ok = on || isEnabled(optSpec, id, optIds);
              const g = groupOf(optSpec, id);
              const why = ok ? '' : whyBlocked(optSpec, id, optIds);
              return (
                <label key={id} className={`option-row${on ? ' active' : ''}${ok ? '' : ' disabled'}`}>
                  <input type="checkbox" checked={on} disabled={!ok}
                    onChange={() => setOptIds((prev) => toggleOption(optSpec, id, prev))} />
                  <div className="o-info">
                    <div className="o-name">{def.name}</div>
                    {def.sub ? <div className="o-sub">{def.sub}</div> : null}
                    {/* ⚠ 그 트림에서 «형제가 실제로 보일 때»만 알린다 — 혼자 서 있으면 뜻이 없다. */}
                    {g && g.members.filter((m) => ruledRows.some((r) => r.id === m)).length > 1
                      ? <div className="o-sub">{g.label} 중 1개만</div> : null}
                    {why ? <div className="o-why">{why}</div> : null}
                  </div>
                  <div className="o-price">{def.price > 0 ? `+${man(def.price)}원` : '기본'}</div>
                </label>
              );
            })}
          </div>
        ) : !optionRows.length ? (
          <div className="empty-state">
            이 트림의 옵션은 <b>아직 안 들어왔습니다</b> — 「없다」가 아니라 「못 받았다」입니다.
            제조사 가격표에서 연료가 안 잡힌 트림은 틀린 옵션을 붙이지 않으려고 비워 둡니다.
          </div>
        ) : (
          <div className="grid-1">
            {optionRows.map((o, i) => {
              const k = optKey(o, i);
              const base = !(Number(o.price) > 0);
              const on = !base && !!optSel[k];
              return (
                <label key={k} className={`option-row${on ? ' active' : ''}${base ? ' disabled' : ''}`}>
                  <input type="checkbox" checked={on} disabled={base}
                    onChange={() => setOptSel((v) => ({ ...v, [k]: !v[k] }))} />
                  <div className="o-info"><div className="o-name">{o.name}</div></div>
                  <div className="o-price">{base ? '기본' : `+${man(o.price)}원`}</div>
                </label>
              );
            })}
          </div>
        )}
        {optNamesPartial ? (
          <div className="footnote">
            <b>옵션 이름이 일부만 들어왔습니다</b> — 제조사 가격표를 좌표로 읽어 이름이 조각난 것이고,
            <b> 가격은 정확합니다</b>. 이름이 필요하면 제조사 가격표를 함께 보세요.
          </div>
        ) : null}
        {picked.newTrim?.rules?.length ? (
          <div className="footnote">
            <b>조합규칙</b> — {picked.newTrim.rules.slice(0, 4).join(' · ')}
            {picked.newTrim.rules.length > 4 ? ` 외 ${picked.newTrim.rules.length - 4}건` : ''}
            {ruled
              ? <><br />※ 위 목록은 <b>규칙대로 막힙니다</b> — 배타그룹은 택1, 선행이 없으면 못 고릅니다.</>
              : <><br />※ 이 트림은 아직 <b>글</b>로만 있습니다 — 조합지도가 안 들어온 모델이라 못 막습니다.</>}
          </div>
        ) : null}
      </section>
    ) : null
  );
  const secCarinfo = (
    <section id="sec-carinfo">
      <div className="step-title">차량 정보</div>
      <div className="vfields">
        {isNew ? (
          <div className="cs-field cs-field--wide">
            <label>차량가</label>
            <span className="pin w"><input value={man(listPrice)} disabled /><i>만원</i></span>
          </div>
        ) : (
          <>
            {/* 취득 경로 — 기보유면 등록·탁송·상품화가 원가에서 빠진다. */}
            <div className="cs-field cs-field--wide">
              <label>취득</label>
              <Chips opts={ACQ.map((a) => ({ v: a.v, label: a.label }))} cur={acq} onPick={setAcq} />
            </div>
            {/* ★중고는 «무조건 시세»다(사장님 2026-09-06) — 장부가·최초매입가가 아니다. */}
            {/* ★시세는 «채워 주되 잠그지 않는다» — 사장님 2026-09-08 「평균시세는 틀릴 수 있으니까」.
                자동으로 채운 값에는 「추정」이 붙고, 손대면 그 표시가 사라진다. */}
            <div className="cs-field cs-field--wide">
              <label>시세</label>
              <span className="pin w"><input inputMode="numeric" value={usedPrice ? man(usedPrice) : ''}
                placeholder="0"
                onChange={(e) => { setPriceTyped(true); setPriceSeeded(false); setUsedPrice(digits(e.target.value) * 10000); }} /><i>만원</i></span>
              {priceSeeded && !priceTyped
                ? <span className="seedmark" title="신차 공표가와 연식 잔가곡선으로 짚은 값입니다 — 실거래 시세가 아닙니다. 고쳐 쓰세요.">추정</span>
                : null}
              {usedPrice <= 0 && !isNew
                ? <span className="seedmark warn">시세를 넣어 주세요 — 이 차는 못 짚었습니다</span>
                : null}
            </div>
            <div className="cs-field">
              <label>연식</label>
              <span className="pin w"><input inputMode="numeric" value={usedYear}
                onChange={(e) => setUsedYear(digits(e.target.value))} /><i>년</i></span>
            </div>
            <div className="cs-field">
              <label>주행</label>
              <span className="pin w"><input inputMode="numeric" value={usedMileage.toLocaleString('ko-KR')}
                onChange={(e) => setUsedMileage(digits(e.target.value))} /><i>km</i></span>
            </div>
          </>
        )}
        {/* 마스터가 배기량을 안 주면 여기서 묻는다 — 0 으로 두면 자동차세가 «조용히» 0 이 된다. */}
        {needCc ? (
          <div className="cs-field">
            <label>배기량</label>
            <span className="pin w"><input inputMode="numeric" placeholder="0"
              value={manualCc ? manualCc.toLocaleString('ko-KR') : ''}
              onChange={(e) => setManualCc(digits(e.target.value))} /><i>cc</i></span>
          </div>
        ) : null}
        {lines[0]?.incompleteCc ? (
          <div className="wx-warn">배기량이 없어 자동차세가 0 으로 섭니다 — 위 칸에 넣어 주세요.</div>
        ) : null}
        <div className="cs-field">
          <label>매입 할인</label>
          <span className="pin w"><input inputMode="numeric" value={disc}
            onChange={(e) => setDisc(Math.max(0, Math.min(50, digits(e.target.value))))} /><i>%</i></span>
        </div>
      </div>
    </section>
  );
  const condRow = (
    <div className="qp-form qp-form--conds flow">
      {/* ★라벨을 걷었다 — 사장님 2026-09-08 「채널 만기 신용 이거 **굳이 안 써도 알건데**…
          그냥 **버튼만 있으면 되지** 뭐」. 「렌트|구독」·「반납형|인수형」·「고신용|중신용|저신용」은
          글자만 봐도 무엇을 고르는 칸인지 안다. 라벨을 세우면 그만큼 줄만 길어진다.
          ⚠ 숫자칸(보증금·선납·수수료)은 라벨을 남긴다 — 「10 %」만 있으면 무엇의 10% 인지 모른다. */}
      <Seg tone="t3" opts={CHANNELS.map((o) => ({ v: o.v, label: o.label }))} cur={ch} onPick={setCh} />
      <Seg tone="t3" opts={TYPES.map((o) => ({ v: o.v, label: o.label }))} cur={type} onPick={setType} />
      <Chips opts={CREDIT.map((c) => ({ v: c, label: c }))} cur={credit} onPick={setCredit} />
      <div className="qc-field">
        <label>보증금</label>
        <span className="pin"><input inputMode="numeric" value={dep}
          onChange={(e) => { const v = Math.max(0, Math.min(100, digits(e.target.value))); setDep(v); setScen((a) => a.map((x) => ({ ...x, dep: v }))); }} /><i>%</i></span>
      </div>
      <div className="qc-field">
        <label>선납금</label>
        <span className="pin"><input inputMode="numeric" value={pre}
          onChange={(e) => { const v = Math.max(0, Math.min(100, digits(e.target.value))); setPre(v); setScen((a) => a.map((x) => ({ ...x, pre: v }))); }} /><i>%</i></span>
      </div>
      <div className="qc-field">
        <label>수수료</label>
        <span className="pin"><input inputMode="numeric" value={fee}
          onChange={(e) => setFee(Math.max(0, Math.min(20, Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)))} /><i>%</i></span>
      </div>
    </div>
  );
  const termGrid = (
    <div className="qgrid">
      {scen.map((sc, i) => {
        const c = lines[i];
        const v = pnl(c, Math.round(netPrice * sc.pre / 100));
        const cogs = v.rev - v.opProfit;
        const isOpen = openTerm === sc.term;
        return (
          <div className={`term-card${sc.send ? '' : ' unchecked'}${isOpen ? ' open' : ''}`} key={sc.term}>
            <div className="term-card__head">
              <span className="qterm">{sc.term / 12}년<em>{sc.term}개월</em></span>
              <label className={`term-card__check${sc.send ? ' is-checked' : ''}`} title="체크한 칸만 손님 견적서로 나갑니다">
                <input type="checkbox" checked={sc.send}
                  onChange={(e) => setScen((a) => a.map((x, j) => (j === i ? { ...x, send: e.target.checked } : x)))} />
                <span className="term-card__check-cap">발송</span>
              </label>
            </div>

            <div className="term-card__monthly">{priceKnown && c.payVat ? fmtNum(c.payVat) : '—'}<em>원</em></div>

            <div className="term-card__cond">
              <label>
                <span>보증금</span>
                <span className="pct-cell">
                  <input type="text" inputMode="numeric" maxLength={3} value={sc.dep}
                    onChange={(e) => setScen((a) => a.map((x, j) => (j === i ? { ...x, dep: Math.min(100, digits(e.target.value)) } : x)))} />%
                </span>
              </label>
              <label>
                <span>선납금</span>
                <span className="pct-cell">
                  <input type="text" inputMode="numeric" maxLength={3} value={sc.pre}
                    onChange={(e) => setScen((a) => a.map((x, j) => (j === i ? { ...x, pre: Math.min(100, digits(e.target.value)) } : x)))} />%
                </span>
              </label>
            </div>

            <div className="term-card__row"><span>보증금</span><b>{man(c.deposit || 0)}</b></div>
            <div className="term-card__row"><span>선납금</span><b>{man(Math.round(netPrice * sc.pre / 100))}</b></div>
            {/* ★★잔가 둘 — 사장님 2026-09-08 「그 **해당 기간에 잔가를 직접 넣을 수 있게끔**」
                   「잔가는 내부에서 **견적용 잔가와 손님 인수용 잔가가 2개**가 있음」
                · 견적 잔가 = **대여료를 만드는** 값(낮출수록 월납이 올라간다)
                · 인수 잔가 = 만기에 **손님이 사 가는** 값(월납에는 «안» 들어간다)
                ⚠ 둘을 한 값으로 묶으면 「손님에게 싸게 넘기려고 잔가를 올렸더니 대여료가 같이
                  싸지는」 사고가 난다. 그래서 나눠 둔다. */}
            <div className="term-card__cond resid2">
              <label title="우리가 「얼마에 팔릴까」로 잡는 값 — 이 값이 대여료를 만듭니다">
                <span>견적 잔가</span>
                <span className="pct-cell">
                  <input type="text" inputMode="numeric" maxLength={3} value={residPct[sc.term]}
                    onChange={(e) => setResidOverride((o) => ({ ...o, [sc.term]: Math.min(98, digits(e.target.value)) }))} />%
                </span>
              </label>
              <label title="만기에 손님이 사 가는 값 — 대여료에는 들어가지 않습니다">
                <span>인수 잔가</span>
                <span className="pct-cell">
                  <input type="text" inputMode="numeric" maxLength={3} value={buyoutPct[sc.term]}
                    onChange={(e) => setBuyoutOverride((o) => ({ ...o, [sc.term]: Math.min(98, digits(e.target.value)) }))} />%
                </span>
              </label>
            </div>
            <div className="term-card__row">
              <span>만기인수</span>
              <b>{priceKnown ? man(Math.round(netPrice * buyoutPct[sc.term] / 100)) : '—'}</b>
            </div>

            {/* 수익·원가 — 이 칸의 «장부» 세 줄. 뺄셈이 눈으로 맞는다(매출 − 원가 = 영업이익). */}
            <div className="term-card__row bk"><span>매출</span><b>{priceKnown ? man(v.rev) : '—'}</b></div>
            <div className="term-card__row bk"><span>원가</span><b>{priceKnown ? man(cogs) : '—'}</b></div>
            <div className={`term-card__row bk profit${priceKnown && v.opProfit < 0 ? ' neg' : ''}`}>
              <span>영업이익{priceKnown ? <em className="resid-pct">{(v.opPct * 100).toFixed(1)}%</em> : null}</span>
              <b>{priceKnown ? man(v.opProfit) : '—'}</b>
            </div>

            <button type="button" className="qopen" onClick={() => setOpenTerm(isOpen ? null : sc.term)}>
              {isOpen ? '원가 접기' : '원가 펼치기'}
            </button>

            {isOpen ? (
              <div className="qdetail">
                <div className="term-card__row"><span>차량 감가</span><b>−{man(v.dep)}</b></div>
                <div className="term-card__row"><span>금융비용</span><b>−{man(v.interest)}</b></div>
                <div className="term-card__row"><span>직접 운영비</span><b>−{man(v.direct)}</b></div>
                {v.turnover > 0 ? (
                  <div className="term-card__row">
                    <span>손바뀜<em className="resid-pct">{turnovers.toFixed(2)}회</em></span>
                    <b>−{man(v.turnover)}</b>
                  </div>
                ) : null}
                <div className="term-card__row sum"><span>매출총이익</span><b>{man(v.gp)}</b></div>
                <div className="term-card__row"><span>영업수수료<em className="resid-pct">{fee}%</em></span><b>−{man(v.fee)}</b></div>
                <div className="term-card__row sum"><span>영업이익</span><b>{man(v.opProfit)}</b></div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  /**
   * ★★폰은 «다음 다음 다음»이다 — 사장님 2026-09-09
   *   「모바일에서는 이거를 **다음 다음 다음** 이렇게 하게 만들었잖아 **직관적으로**.
   *    **웰릭스 테이블에 이미 있는 내용**이고」.
   *   원본은 폰을 «따로» 짰다(`src/components/mobile/` 여덟 쪽 마법사). 우리도 그 짜임을 쓴다.
   * ⚠ 2026-09-08 에 나는 사장님 「모바일 버전은 다음다음 하게 해놨어」를 «미룬다»로 읽고 미뤘다.
   *   그게 아니라 «이미 그렇게 만들어 놨다»는 말씀이었다. 그래서 폰이 데스크톱 두 칸을 눌러 담고 있었다.
   * ⚠ 조각(`secColor`·`secOptions`·`condRow`·`termGrid`…)은 **데스크톱과 같은 것**을 넘긴다.
   */
  /**
   * 상품(중고↔신차)을 바꿀 때 — **앞 갈래의 찌꺼기를 안 물려준다.**
   * ⚠ 신차를 고르면 연식·주행을 0/올해로 눌러 둔다(신차라 당연하다). 그 상태로 중고로 돌아오면
   *   「2026년식 · 0km 중고차」가 되어 **말이 안 되는 견적**이 조용히 나온다(2026-09-09 폰에서 잡음).
   *   ⇒ 중고로 돌아오면 기본값을 되돌린다. 사람이 넣은 값은 어차피 신차 고를 때 이미 지워졌다.
   */
  const setSource = useCallback((m: 'used' | 'new') => {
    setCond(m);
    setOptSel({});
    if (m === 'used' && (usedMileage === 0 || usedYear >= nowYear)) {
      setUsedYear(DEFAULT_USED_YEAR); setUsedMileage(DEFAULT_USED_MILEAGE);
    }
  }, [usedMileage, usedYear]);

  const wizSummary = useMemo(() => {
    const sent = scen.filter((x) => x.send);
    const cheapest = sent
      .map((x) => lines[scen.findIndex((y) => y.term === x.term)])
      .filter((c) => c && c.payVat)
      .sort((a, b) => (a!.payVat || 0) - (b!.payVat || 0))[0];
    return {
      carName: picked.name, carMeta: vMeta, price,
      monthly: priceKnown ? Math.round(cheapest?.payVat || 0) : 0,
      term: cheapest?.term ?? 0,
    };
  }, [scen, lines, picked, vMeta, price, priceKnown]);

  if (mobile) {
    return (
      <div className="wx-root est-root est-root--wiz">
        <EstimateWizard
          mode={cond}
          onMode={setSource}
          picked={picked}
          onPick={(c) => { setPicked(c); if (c.source === 'new') { setUsedMileage(0); setUsedYear(nowYear); } }}
          sections={{ carinfo: secCarinfo, colors: secColor, options: secOptions, conditions: condRow, terms: termGrid }}
          summary={wizSummary}
          onQuote={() => setDocOpen(true)}
          canQuote={priceKnown && quoteDoc.lines.length > 0}
        />
        {docOpen ? <QuotePreview doc={quoteDoc} onClose={() => setDocOpen(false)} /> : null}
      </div>
    );
  }

  return (
    <div className="wx-root est-root">
      {/* ★★머리 띠가 «없다» — 사장님 2026-09-08 「**상단바 없고 그냥 이거 자체가 별도 페이지야**」.
             ERP 상단바는 앞서 벗었고(`lib/guest-surface`), 여기 있던 견적기 «자체» 머리 띠도 걷었다.
             ⇒ 화면이 곧 페이지다. 위에 아무 띠도 없다.
          ★길은 끊기지 않았다 — 「원가설정」은 맨 아래 주석 줄에 링크로 남아 있다.
             원가는 「한 번 등록해 두면 견적기만 보이는 것」이라(사장님 2026-09-08) 늘 띄울 자리가 아니다.
          ⚠ 다시 띠를 세우려거든 먼저 여쭤라 — 이 화면은 «맨 페이지»가 규격이다. */}

      {/* ══ 좌 400px — 차량 (원본 `.wrap`) ══════════════════════════════════ */}
      <div className="wrap">
        {/* ══ 좌 = «차에 관련된 것만» ═══════════════════════════════════════
               사장님 2026-09-08 「여기는 **차를 선택**한다고 했잖아」
                              「그럼 여기서는 사실상 **중고 신차만 고르면 되고**」
                              「나머지는 **우측에서 고르는 거네**」
                              「**차에 관련된 거만 좌측에서 선택, 우측은 견적에 관련된 거**」
             ⇒ 채널(렌트/구독)·만기(반납/인수)·신용은 «그 차»의 성질이 아니라 «이 견적»의 조건이다.
               오른쪽 조건 줄로 옮겼다. 여기 남는 것은 **어떤 차를 고를 것인가**뿐이다.
             ★그래서 이 칸 바로 밑이 차종 캐스케이드다 — 중고냐 신차냐에 따라 고를 목록이 갈린다. ══ */}
        <section id="sec-source">
          <div className="step-title">상품</div>
          <Seg tone="t2" opts={SOURCES.map((o) => ({ v: o.v, label: o.label }))} cur={cond} onPick={setSource} />
        </section>

        {/* ★★차 고르기 «판»을 걷었다 — 사장님 2026-09-08 「버튼만 만들어 주면 되고」
            「차량 고르는 거는 **딱딱 누르는 거에 연동**이 되어야지」.
            제조사 → 모델 → 파워트레인 → 트림, **한 줄짜리 넷**이 위아래로 물린다(원본 `VehicleCascade`).
            ⚠ 9/7 에 왼쪽에 박았던 검색칸·제조사 칩·목록은 여기서 사라진다 — 그게 「굵다」의 정체였다.
              검색은 폰 하단 「검색」 탭에 남는다(이름을 알 때 한 번에 가는 길). */}
        <VehicleCascade mode={cond} picked={picked} onPick={(c) => {
          setPicked(c);
          if (c.source === 'new') { setUsedMileage(0); setUsedYear(nowYear); }
        }} />

        {/* ★★칸 차례는 **제조사 「내 차 만들기」와 같다** — 사장님 2026-09-09
               「신차는 제조사에서 **차량 가격 산출까지 어떻게 하는지 그 로직을 동일하게**」 ·
               「**세부모델 · 파워트레인 · 세부트림 · 색상 · 옵션** 순서로 기억하고 있음」.
             ⇒ 색상이 옵션 «위»다. 2026-09-08 판은 옵션이 위였다 — 웰릭스 원본 차례를 따랐던 것인데,
               값을 쌓는 차례(트림값 → 색상 → 옵션)는 제조사 것이 정본이다. **뒤엣것이 이긴다.** */}
        {/* ══ 색상 — 신차는 «제조사 색», 중고는 «규격색» ═════════════════════
               사장님 2026-09-08 「신차마스터에는 **제조사 색상 그대로** 해야지」
                              「**중고마스터 색상과 신차마스터 색상은 각각 존재**해야 함」
             · 신차 = 제조사가 준 이름 그대로(「어비스 블랙 펄」). **값이 붙는 색은 차량가에 더한다.**
             · 중고 = 우리 규격색 12색(색상마스터) — 실제 차의 색을 적는 칸이라 이름이 규격이면 된다.
             ⚠ 제조사 색은 트림의 67% 에만 있다(2026-09-08 실측). 없으면 그렇다고 «말하고» 규격색을 쓴다. ══ */}
        {secColor}

        {/* ══ 선택 옵션 — 원본 `#sec-options`. 신차에만 선다(중고는 이미 달려 나온 차다). ══ */}
        {secOptions}

        {secCarinfo}

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
                {isNew ? '트림' : '시세'} <b>{man(isNew ? (picked.price ?? 0) : listPrice)}</b>
                {/* 쌓는 차례는 «고르는 차례»와 같다 — 트림 → 색상 → 옵션(제조사 「내 차 만들기」). */}
                {isNew && colorAdd ? <> + 색상 <b>{man(colorAdd)}</b></> : null}
                {isNew && optSum ? <> + 옵션 <b>{man(optSum)}</b></> : null}
                {disc ? <> − 할인 <b>{disc}%</b></> : null}
                {' = 차량가 '}<b className="total">{man(price)}원</b>
              </span>
            ) : null}
          </div>
        </div>

        {/* ══ 조건 — **한 줄로 흐른다** ═════════════════════════════════════════
               사장님 2026-09-08 「이런 거 **너무 칸 맞추려고 하지 말고 배열만 잘해** 봐.
               버튼으로 하는 건데 **상품조건과 공통조건을 한 줄에 넣어도** 될 거 같기도 하고」
             ⇒ ①상품 조건 · ②공통 조건을 **한 단**으로 합쳤다. 격자로 칸을 맞추던 것을 걷고
               내용 폭대로 흐르게 했다 — 격자에 맞추니 「10 %」 하나가 칸을 다 먹어 늘어났다.
             ★보증금·선납은 여기서 바꾸면 다섯 칸이 한꺼번에 따라온다(칸마다 따로도 잡는다). ══ */}
        <div className="qp-terms__title">조건 <small>· 보증금·선납은 다섯 칸에 한꺼번에</small></div>
        {condRow}

        {/* ══ 1년 ~ 5년 — **가로로 쭉**(폰에서는 위아래로) ═══════════════════════════
               사장님 2026-09-08 「**1~5년은 가로로 쭉** 나와야지」 · 「**모바일에서는 그게 위아래로 분리**되는 거고」
             · 한 칸(한 해) 안에 대여료·조건·수익·원가가 다 있다 — 오른쪽에 따로 두지 않는다.
             · 보증금·선납은 **칸마다** 잡는다(그게 「설계」다). 위 조건 줄은 다섯 칸을 한꺼번에 바꾼다.
             · 「원가」를 누르면 그 칸 «안»에서 분해가 열린다. 다섯을 한꺼번에 펼쳐 견줄 수도 있다.
             ⚠ 짜임은 원본 `.term-card` 그대로다. 원본은 셋이고 우리는 다섯이라 열 수만 늘렸다. ══ */}
        <div className="qp-terms__title">기간별 설계 <small>· 칸마다 조건·잔가 · 「원가」를 누르면 분해</small></div>
        {termGrid}

        {/* ══ 손님·담당자 — **맨 아래**다 ═════════════════════════════════════
               견적서에 찍힐 이름이라 **발송 직전**에 적는다. 맨 위에서 물으면 차·조건을 보러 온 사람이
               이름 칸부터 지나가야 한다(사장님 2026-09-08 「입력칸들 동선 안 꼬이게」).
             ⚠ 원본 웰릭스는 이 줄이 위에 있다 — 거기서는 조건이 넷뿐이라 위든 아래든 같았다.
               우리는 조건이 세 단이라 차례가 뜻을 갖는다. ══ */}
        <div className="qp-terms__title">손님 · 담당자 <small>· 견적서에 찍힙니다</small></div>
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
        </div>

        {/* ★손님에게 나가는 길 — 체크한 기간만 담아 견적서로 편다. */}
        <div className="qdock">
          <button type="button" className="qdock__go" disabled={!priceKnown || !quoteDoc.lines.length}
            onClick={() => setDocOpen(true)}>
            견적서 보기
            <em>{quoteDoc.lines.length ? `${quoteDoc.lines.length}개 기간` : '보낼 기간을 체크하세요'}</em>
          </button>
        </div>

        <div className="footnote">
          금액은 부가세 포함 월 대여료 · 잔가는 국산 표준곡선 + 차종델타 · 원가는 <Link href="/estimate/cost">원가설정</Link>이 정한 값<br />
          조달금리·손바뀜·취득세·공채·등록비·자동차세·보험·정비 반영 · 업계 기준선 추정<br />
          실채택 전 엔카·KB차차차 실시세 검산 필요
        </div>
      </section>

      {docOpen ? <QuotePreview doc={quoteDoc} onClose={() => setDocOpen(false)} /> : null}

      {/* 왼쪽은 이제 캐스케이드다. 이 시트는 **이름을 알 때 한 번에 가는 길**(폰 하단 「검색」 탭)로만 뜬다 —
          왼쪽에 박아 두면 그게 굵어진다(사장님 2026-09-08 「저렇게 굵을 필요 없고」).
          ⚠ 웹에서는 부르는 자리가 없다 — 하단바가 없기 때문이다. 왼쪽 넷으로 고른다. */}
      <CarPicker open={pickerOpen} optionsOutside mode={cond} onClose={() => setPickerOpen(false)}
        onPick={(c) => { setPicked(c); if (c.source === 'new') { setUsedMileage(0); setUsedYear(nowYear); } }} />

    </div>
  );
}
