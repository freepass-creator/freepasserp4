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
  const [residOverride, setResidOverride] = useState<Record<number, number>>({});
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

  /** 고른 트림의 옵션 줄 — 원본 규격대로 «가격 0 = 기본 포함»은 고르는 대상이 아니다. */
  const optionRows = useMemo(() => (picked.newTrim?.options ?? []).filter((o) => o && o.name), [picked]);
  const optChosen = useMemo(() => optionRows.filter((o) => Number(o.price) > 0 && optSel[o.name]), [optionRows, optSel]);
  const optSum = optChosen.reduce((n, o) => n + (Number(o.price) || 0), 0);
  /** 기아는 가격표를 «좌표»로 읽어 옵션 «이름»이 조각으로 온다(「옵션3」) — 값은 정확하다. 숨기지도 지어내지도 않는다. */
  const optNamesPartial = useMemo(() => optionRows.some((o) => /^옵션\s*\d+$/.test(o.name.trim())), [optionRows]);

  /* ★신차 차량가 = «트림값 + 고른 옵션». 옵션을 밖에서 고르므로 더하는 일은 화면 몫이다. */
  const listPrice = isNew ? (picked.price ?? 0) + optSum : usedPrice;
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

  /**
   * ★다섯 해가 «각자 제 조건»으로 선다 — 이 한 벌이 화면의 전부다.
   *   그 전에는 「기본 견적(고정 3장)」과 「손님 발송용(자유 3열)」과 「손익(오른쪽 탭)」 셋이 따로 있었다.
   *   같은 숫자를 세 군데서 세니 어디를 봐야 하는지가 흐려졌다(사장님 2026-09-08 「우측에 따로 놓지 말고」).
   */
  const lines = useMemo<Card[]>(() => scen.map((x) => mk(x.term, x.dep, x.pre)), [mk, scen]);

  /** 손바뀜을 «몇 번»으로 풀어 보여 주기 위한 값 — 원가 설정의 반납률에서 온다. */
  const retentionOf = useCallback((c: string) => (c === '저신용' ? cost.retentionLowPct
    : c === '중신용' ? cost.retentionMidPct : cost.retentionNormalPct), [cost]);
  const retentionPct = retentionOf(credit);
  const turnovers = expectedTurnovers(retentionPct / 100);

  const prepayAmt = Math.round(price * pre / 100);
  const vehTag = listPrice ? `${man(listPrice)}원` : '차를 고르세요';
  const vMeta = isNew
    ? [picked.meta, optChosen.length ? `옵션 ${optChosen.length}개 +${man(optSum)}` : null,
      listPrice ? `차량가 ${man(listPrice)}` : null].filter(Boolean).join(' · ')
    : [picked.meta, `시세 ${man(usedPrice)}`, `${usedYear}년`, `${usedMileage.toLocaleString('ko-KR')}km`,
      ACQ.find((a) => a.v === acq)!.label].filter(Boolean).join(' · ');

  // 하단 「검색」 탭이 이 화면에서는 «차 고르기»를 연다(lib/tabbar — 검색은 라우트가 아니라 행동이다).
  useAppBar({ search: { onOpen: () => setPickerOpen(true), active: picked !== DEFAULT_USED && picked !== DEFAULT_NEW } },
    [picked, cond]);

  return (
    <div className="wx-root est-root">
      {/* ══ 상단바 — 원본 `.global-topbar`. ★브랜드 표식은 안 세운다(CLAUDE.md 노브랜드).
             원본의 CI 이미지·워드마크 자리는 비웠고, 위에는 ERP 상단바가 따로 선다. ══ */}
      <div className="global-topbar">
        <span className="global-topbar__hint">{isNew ? '신차' : '중고'} 장기렌터카 견적</span>
        <span className="spacer" />
        {/* ★사장님 2026-09-08 「원가설정에는 왜 **밑줄**이 가져 있지?」 · 「견적내기 / 원가설정 **잘 정렬**해 주고」
            ⇒ 링크(`<a>`)라 밑줄이 그어졌고, 옆 버튼과 높이·테두리가 달라 줄이 안 맞았다.
              둘을 **한 덩이 토글**(`.gt-modes`)로 묶었다 — 지금 선 자리가 눌린 칸이다.
              ⚠ 견적·원가 **두 화면이 같은 것을 쓴다**. 한쪽만 고치면 또 어긋난다. */}
        <div className="global-topbar__actions">
          <div className="gt-modes">
            <span className="on">견적내기</span>
            <Link href="/estimate/cost">원가설정</Link>
          </div>
        </div>
      </div>

      {/* ══ 좌 400px — 차량 (원본 `.wrap`) ══════════════════════════════════ */}
      <div className="wrap">
        {/* ★원본은 왼쪽이 전부 「라벨 + 한 줄」이다 — 카드로 쌓지 않는다.
            사장님 2026-09-08 「저렇게 굵을 필요 없고」. 값·차례는 그대로, 짜임만 얇아졌다. */}
        {/* ★고르는 것은 전부 «버튼»이다 — 사장님 2026-09-08 「드랍다운보다는 버튼으로 할 수 있으면
            버튼으로 해」. 드롭다운은 열고 고르느라 두 번 누른다. 통화 중에 그 한 걸음이 그대로 느려짐이 된다. */}
        <section id="sec-source">
          <div className="step-title">상품</div>
          <Seg tone="t2" opts={SOURCES.map((o) => ({ v: o.v, label: o.label }))} cur={cond} onPick={setCond} />
        </section>

        <section id="sec-channel">
          <div className="step-title">채널</div>
          <Seg tone="t3" opts={CHANNELS.map((o) => ({ v: o.v, label: o.label }))} cur={ch} onPick={setCh} />
        </section>

        <section id="sec-type">
          <div className="step-title">만기</div>
          <Seg tone="t3" opts={TYPES.map((o) => ({ v: o.v, label: o.label }))} cur={type} onPick={setType} />
        </section>

        <section id="sec-credit">
          {/* 유지율을 칩에 붙여 둔다 — 왜 등급마다 값이 갈리는지가 «고르는 자리»에서 보여야 한다. */}
          <div className="step-title">신용</div>
          <Chips opts={CREDIT.map((c) => ({ v: c, label: c }))} cur={credit} onPick={setCredit} />
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

        {/* ══ 선택 옵션 — 원본 `#sec-options`. 신차에만 선다(중고는 이미 달려 나온 차다). ══ */}
        {isNew ? (
          <section id="sec-options">
            <div className="step-title">선택 옵션 {optionRows.length ? <b>{optionRows.length}개</b> : null}</div>
            {!picked.newTrim ? (
              <div className="empty-state">트림을 먼저 고르면 옵션이 나옵니다</div>
            ) : !optionRows.length ? (
              <div className="empty-state">
                이 트림의 옵션은 <b>아직 안 들어왔습니다</b> — 「없다」가 아니라 「못 받았다」입니다.
                제조사 가격표에서 연료가 안 잡힌 트림은 틀린 옵션을 붙이지 않으려고 비워 둡니다.
              </div>
            ) : (
              <div className="grid-1">
                {optionRows.map((o) => {
                  const base = !(Number(o.price) > 0);
                  const on = !base && !!optSel[o.name];
                  return (
                    <label key={o.name} className={`option-row${on ? ' active' : ''}${base ? ' disabled' : ''}`}>
                      <input type="checkbox" checked={on} disabled={base}
                        onChange={() => setOptSel((v) => ({ ...v, [o.name]: !v[o.name] }))} />
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
                <br />※ 아직 <b>글</b>로만 있습니다 — 원본(웰릭스)은 여기서 «고를 수 없게» 막습니다.
                규칙이 원자로 정의되면 우리도 막습니다. 지금은 <b>고를 수 없는 조합도 골립니다.</b>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* ══ 색상 — 원본 `#sec-color`. ⚠ 값에는 영향이 없다(우리 마스터에 색상별 가격이 없다). ══ */}
        {isNew ? (
          <section id="sec-color">
            <div className="step-title">색상 <b>견적서 표기용</b></div>
            <div className="vfields">
              {/* 색도 버튼이다 — 색 칩이 보이면 이름을 안 읽어도 고른다.
                  ⚠ 색·이름은 **색상마스터**가 준 것만 쓴다(화면이 색을 지어내지 않는다). */}
              <div className="cs-field cs-field--wide">
                <label>외장</label>
                <TChips opts={EXT_COLORS.map((c) => ({ v: c, label: c, swatch: colorSwatch(c) }))}
                  cur={colorExt} onPick={setColorExt} />
              </div>
              <div className="cs-field cs-field--wide">
                <label>내장</label>
                <TChips opts={INT_COLORS.map((c) => ({ v: c, label: c, swatch: colorSwatch(c) }))}
                  cur={colorInt} onPick={setColorInt} />
              </div>
            </div>
          </section>
        ) : null}

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
                <div className="cs-field">
                  <label>시세</label>
                  <span className="pin w"><input inputMode="numeric" value={man(usedPrice)}
                    onChange={(e) => setUsedPrice(digits(e.target.value) * 10000)} /><i>만원</i></span>
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

        <section id="sec-resid">
          <div className="step-title">연도별 잔가 <b>{delta ? '차종곡선' : '표준곡선'}</b></div>
          <div className="vfields">
            {TERMS.map((t) => (
              <div className="cs-field" key={t}>
                <label>{t / 12}년</label>
                <span className="pin w"><input inputMode="numeric" value={residPct[t]}
                  onChange={(e) => setResidOverride((o) => ({ ...o, [t]: digits(e.target.value) }))} /><i>%</i></span>
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
                {isNew ? '트림' : '시세'} <b>{man(isNew ? (picked.price ?? 0) : listPrice)}</b>
                {isNew && optSum ? <> + 옵션 <b>{man(optSum)}</b></> : null}
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
            <span className="pin w"><input inputMode="numeric" value={fee}
              onChange={(e) => setFee(Math.max(0, Math.min(20, Number(e.target.value.replace(/[^0-9.]/g, '')) || 0)))} /><i>%</i></span>
          </div>
        </div>

        {/* 견적 조건 — 원본 `ConditionsForm`. 여기 보증금·선납이 「기본 견적」 세 장을 움직인다. */}
        <div className="qp-form qp-form--conds">
          <div className="qc-field">
            <label>보증금</label>
            <span className="pin w"><input type="number" min={0} max={100} value={dep}
              onChange={(e) => { const v = Math.max(0, Math.min(100, Number(e.target.value) || 0)); setDep(v); setScen((a) => a.map((x) => ({ ...x, dep: v }))); }} /><i>%</i></span>
          </div>
          <div className="qc-field">
            <label>선납금</label>
            <span className="pin w"><input type="number" min={0} max={100} value={pre}
              onChange={(e) => { const v = Math.max(0, Math.min(100, Number(e.target.value) || 0)); setPre(v); setScen((a) => a.map((x) => ({ ...x, pre: v }))); }} /><i>%</i></span>
          </div>
        </div>

        {/* ══ 1년 ~ 5년 — **각 줄에 대여료·조건·수익·원가가 다 있다** ══════════════
               사장님 2026-09-08 「우측에서 1년부터 5년까지 **설계**되게끔 해주고
               각 기간별로 **수익이나 원가 볼 수 있게끔 그 라인에 표현**해주면 돼. **우측에 따로 놓지 말고**」
             · 보증금·선납은 **줄마다** 잡는다(그게 「설계」다). 위 조건 칸은 다섯 줄을 한꺼번에 바꾼다.
             · 줄을 누르면 그 해의 **원가 분해**가 그 자리에서 열린다 — 탭으로 옮겨 다니지 않는다.
             · 체크한 줄만 손님 견적서로 나간다(원본 「견적서에 포함」). ══ */}
        {/* ══ 1년 ~ 5년 — **가로로 쭉**(폰에서는 위아래로) ═══════════════════════════
               사장님 2026-09-08 「**1~5년은 가로로 쭉** 나와야지」 · 「**모바일에서는 그게 위아래로 분리**되는 거고」
             · 한 칸(한 해) 안에 대여료·조건·수익·원가가 다 있다 — 오른쪽에 따로 두지 않는다.
             · 보증금·선납은 **칸마다** 잡는다(그게 「설계」다). 위 조건 줄은 다섯 칸을 한꺼번에 바꾼다.
             · 「원가」를 누르면 그 칸 «안»에서 분해가 열린다. 다섯을 한꺼번에 펼쳐 견줄 수도 있다.
             ⚠ 짜임은 원본 `.term-card` 그대로다. 원본은 셋이고 우리는 다섯이라 열 수만 늘렸다. ══ */}
        <div className="qp-terms__title">기간별 설계 <small>· 칸마다 조건 · 「원가」를 누르면 분해</small></div>
        <div className="qgrid">
          {scen.map((sc, i) => {
            const c = lines[i];
            const v = pnl(c, Math.round(price * sc.pre / 100));
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

                <div className="term-card__monthly">{c.payVat ? fmtNum(c.payVat) : '—'}<em>원</em></div>

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
                <div className="term-card__row"><span>선납금</span><b>{man(Math.round(price * sc.pre / 100))}</b></div>
                <div className="term-card__row">
                  <span>만기인수<em className="resid-pct">{Math.round((c.residualRate || 0) * 100)}%</em></span>
                  <b>{man(Math.round(price * (c.residualRate || 0)))}</b>
                </div>

                {/* 수익·원가 — 이 칸의 «장부» 세 줄. 뺄셈이 눈으로 맞는다(매출 − 원가 = 영업이익). */}
                <div className="term-card__row bk"><span>매출</span><b>{man(v.rev)}</b></div>
                <div className="term-card__row bk"><span>원가</span><b>{man(cogs)}</b></div>
                <div className={`term-card__row bk profit${v.opProfit < 0 ? ' neg' : ''}`}>
                  <span>영업이익<em className="resid-pct">{(v.opPct * 100).toFixed(1)}%</em></span>
                  <b>{man(v.opProfit)}</b>
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

        <div className="footnote">
          금액은 부가세 포함 월 대여료 · 잔가는 국산 표준곡선 + 차종델타 · 원가는 <Link href="/estimate/cost">원가설정</Link>이 정한 값<br />
          조달금리·손바뀜·취득세·공채·등록비·자동차세·보험·정비 반영 · 업계 기준선 추정<br />
          실채택 전 엔카·KB차차차 실시세 검산 필요
        </div>
      </section>

      {/* 왼쪽은 이제 캐스케이드다. 이 시트는 **이름을 알 때 한 번에 가는 길**(폰 하단 「검색」 탭)로만 뜬다 —
          왼쪽에 박아 두면 그게 굵어진다(사장님 2026-09-08 「저렇게 굵을 필요 없고」).
          ⚠ 웹에서는 부르는 자리가 없다 — 하단바가 없기 때문이다. 왼쪽 넷으로 고른다. */}
      <CarPicker open={pickerOpen} optionsOutside mode={cond} onClose={() => setPickerOpen(false)}
        onPick={(c) => { setPicked(c); if (c.source === 'new') { setUsedMileage(0); setUsedYear(nowYear); } }} />

    </div>
  );
}
