'use client';
/**
 * 견적 — **완전 별도 페이지**(사장님 2026-09-06 「모바일에서 보여지는 거 그대로 · 완전 별도 페이지라고
 * 얘기할 정도로」). 설계서 §11·§12.
 *
 * ★이 층은 업무동 규격을 안 따른다. 전자계약(`/sign`)과 «같은 갈래»다 —
 *   자기 CSS(`components/estimate/estimate.css`)를 갖고, ERP 상단바·하단 홈바를 벗는다.
 *   벗기는 건 `lib/guest-surface.ts` 한 곳이 정한다(거기 한 줄이 이 페이지를 독립으로 만든다).
 *   ⚠ 로그인은 **필요하다** — `lib/public-access.ts` 에 넣지 않았다.
 *     이 화면은 원가·마진·손익을 보여준다. 손님이 우리 원가를 보면 안 된다.
 *
 * ★숫자는 **한 줄도 여기서 계산하지 않는다.** 전부 `lib/domain/estimate` 엔진이 낸다
 *   (손오공 견적기에서 무손실 이관 · 회귀 39개 = `npm run test:estimate`).
 *   화면이 제 나름대로 셈을 하기 시작하면 그날 «견적이 두 곳에서 나온다».
 */
import { useMemo, useState } from 'react';
import '@/components/estimate/estimate.css';
import { safeComputeTerm } from '@/lib/domain/estimate/safe-calc.js';
import { createQuoteInput } from '@/lib/domain/estimate/quote-input.js';
import { DEFAULT_CONFIG } from '@/lib/domain/estimate/default-config.js';

/** 1~5년 — 차를 넣기 전에도 빈 칸으로 «항상» 서 있다(설계서 §1). */
const MTERMS = [12, 24, 36, 48, 60];
const FUELS = [
  { id: 'gasoline', label: '가솔린' }, { id: 'diesel', label: '디젤' },
  { id: 'lpg', label: 'LPG' }, { id: 'hybrid', label: '하이브리드' }, { id: 'ev', label: '전기' },
];
const ACCIDENTS = [
  { id: 'none', label: '무사고' }, { id: 'simple', label: '단순수리' }, { id: 'frame', label: '골격손상' },
];
const CREDITS = [
  { value: '정상', label: '정상' }, { value: '중신용', label: '중신용' }, { value: '저신용', label: '저신용' },
];
const PCTS = [0, 10, 20, 30];

const won = (n: number) => Math.round(n || 0).toLocaleString('ko-KR');
const man = (n: number) => `${Math.round((n || 0) / 10000).toLocaleString('ko-KR')}만`;
const digits = (v: string) => Number(String(v).replace(/[^\d]/g, '')) || 0;

type Card = {
  term: number; payVat?: number; monthlySupply?: number; months?: number;
  subtotal?: number; deposit?: number; residualRate?: number;
  cost?: Record<string, number>;
};

/** 손익 분해 — 원본 MobileApp.vue `pnl()` 과 «같은 식». 값은 엔진이 낸 원가에서만 꺼낸다. */
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

export default function EstimatePage() {
  const nowYear = new Date().getFullYear();
  const [price, setPrice] = useState(0);       // 원 단위(화면은 만원)
  const [cc, setCc] = useState(0);
  const [mileage, setMileage] = useState(0);
  const [year, setYear] = useState<number | null>(null);
  const [fuel, setFuel] = useState('gasoline');
  const [accident, setAccident] = useState('none');
  const [channel, setChannel] = useState<'rent' | 'sub'>('rent');
  const [type, setType] = useState<'return' | 'acquire'>('return');
  const [credit, setCredit] = useState('정상');
  const [depositPct, setDepositPct] = useState(10);
  const [prepayPct, setPrepayPct] = useState(0);
  const [openTerm, setOpenTerm] = useState(48);

  /** 연식·차량가·배기량이 다 있어야 잔가가 산다 — 원본 `valid` 와 같은 조건. */
  const valid = price > 0 && cc > 0 && !!year;

  const input = useMemo(() => createQuoteInput({
    adminCfg: DEFAULT_CONFIG, channel, type,
    form: { price, cc, fuel, accident, mileage, year, credit },
    conditions: { depositPct, prepayPct },
    residual: null, residualDefault: null, credit, defaultGroup: 'B', nowYear,
  }), [price, cc, fuel, accident, mileage, year, credit, channel, type, depositPct, prepayPct, nowYear]);

  const products: Card[] = useMemo(
    () => (valid ? MTERMS.map((t) => ({ ...safeComputeTerm(t, input, { idx: t }), term: t })) : []),
    [valid, input],
  );

  const yearOptions = useMemo(
    () => Array.from({ length: 16 }, (_, i) => nowYear - i),
    [nowYear],
  );

  return (
    <div className="est-root">
      <div className="m-shell">
        {/* 머리 — 원본 .hd 그대로. ⚠ 워드마크는 원본 화면을 «그대로» 옮긴 것이다.
            노브랜드 규칙(CLAUDE.md)과 부딪히는 자리라, 뺄지는 사장님 확인 뒤 정한다. */}
        <header className="hd">
          <span className="wm"><span className="a">freepass</span><span className="b">mobility</span></span>
          <h1>견적</h1>
        </header>

        <main className="m-body">
          {/* STEP 1 차량 */}
          <section className="card">
            <div className="step"><span className="no">1</span>차량</div>

            <div className="crow first">
              <span className="lb">연식<em className="req">필수</em></span>
              <span className="pinf">
                <select value={year ?? ''} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">연식 선택 (필수)</option>
                  {yearOptions.map((y) => <option key={y} value={y}>{y}년</option>)}
                </select>
              </span>
            </div>
            {!year && <div className="warn-tx">연식을 선택해야 잔가·견적이 산출됩니다</div>}

            <div className="crow">
              <span className="lb">차량가</span>
              <span className="pinf">
                <input inputMode="numeric" value={price ? Math.round(price / 10000).toLocaleString('ko-KR') : ''}
                  onChange={(e) => setPrice(digits(e.target.value) * 10000)} placeholder="0" />
                <i>만원</i>
              </span>
            </div>
            <div className="crow">
              <span className="lb">배기량</span>
              <span className="pinf">
                <input inputMode="numeric" value={cc ? cc.toLocaleString('ko-KR') : ''}
                  onChange={(e) => setCc(digits(e.target.value))} placeholder="0" /><i>cc</i>
              </span>
            </div>
            <div className="crow">
              <span className="lb">주행</span>
              <span className="pinf">
                <input inputMode="numeric" value={mileage ? mileage.toLocaleString('ko-KR') : ''}
                  onChange={(e) => setMileage(digits(e.target.value))} placeholder="0" /><i>km</i>
              </span>
            </div>
            <div className="crow top">
              <span className="lb">연료</span>
              <div className="chipw">
                {FUELS.map((f) => (
                  <button key={f.id} className={fuel === f.id ? 'on' : ''} onClick={() => setFuel(f.id)}>{f.label}</button>
                ))}
              </div>
            </div>
            <div className="crow top">
              <span className="lb">사고</span>
              <div className="chipw">
                {ACCIDENTS.map((a) => (
                  <button key={a.id} className={accident === a.id ? 'on' : ''} onClick={() => setAccident(a.id)}>{a.label}</button>
                ))}
              </div>
            </div>
          </section>

          {/* STEP 2 상품 조건 */}
          <section className="card">
            <div className="step"><span className="no">2</span>상품 조건</div>
            <div className="seg t2">
              <button className={channel === 'rent' ? 'on' : ''} onClick={() => setChannel('rent')}>렌트</button>
              <button className={channel === 'sub' ? 'on' : ''} onClick={() => setChannel('sub')}>구독</button>
            </div>
            <div className="seg t3">
              <button className={type === 'return' ? 'on' : ''} onClick={() => setType('return')}>반납형</button>
              <button className={type === 'acquire' ? 'on' : ''} onClick={() => setType('acquire')}>인수형</button>
            </div>
            <div className="crow top" style={{ marginTop: 12 }}>
              <span className="lb">신용</span>
              <div className="chipw">
                {CREDITS.map((g) => (
                  <button key={g.value} className={credit === g.value ? 'on' : ''} onClick={() => setCredit(g.value)}>{g.label}</button>
                ))}
              </div>
            </div>
          </section>

          {/* STEP 3 영업자 책정 */}
          <section className="card">
            <div className="step"><span className="no">3</span>영업자 책정<span className="veh dim">보증금·선납</span></div>
            <div className="crow first top">
              <span className="lb">보증금</span>
              <div className="chipw">
                {PCTS.map((p) => (
                  <button key={`d${p}`} className={depositPct === p ? 'on' : ''} onClick={() => setDepositPct(p)}>{p}%</button>
                ))}
              </div>
            </div>
            <div className="crow top">
              <span className="lb">선납</span>
              <div className="chipw">
                {PCTS.map((p) => (
                  <button key={`p${p}`} className={prepayPct === p ? 'on' : ''} onClick={() => setPrepayPct(p)}>{p}%</button>
                ))}
              </div>
            </div>
          </section>

          {/* STEP 4 연도별 잔가 */}
          {valid && (
            <>
              <section className="card">
                <div className="step"><span className="no">4</span>연도별 잔가<span className="veh dim">시세 대비 잔존율 · 자동</span></div>
                <div className="resid-in">
                  {products.map((p) => (
                    <div key={`r${p.term}`} className="ri">
                      <span className="ry">{p.term / 12}년</span>
                      <span className="rv">{p.residualRate ? Math.round(p.residualRate * 100) : '—'}%</span>
                    </div>
                  ))}
                </div>
              </section>
              <div className="basis">
                <span className="bi">원가 기준</span>
                <span className="bt">
                  국산 표준잔가 + 차종델타 · 손바뀜(신용등급별) · 조달금리·직접운영비·등록비 반영 ·{' '}
                  <b>수익률 {Math.round((DEFAULT_CONFIG.marginRate?.rent ?? 0) * 100)}% 공통</b>
                </span>
              </div>
            </>
          )}

          {/* 5 기간별 대여료·수익 — 항상 표시 */}
          <div className="plabel"><span className="pno">5</span>기간별 대여료 · 수익</div>
          <div className="prods">
            {!valid ? MTERMS.map((t) => (
              <div key={`ph${t}`} className="prod ph">
                <div className="prodh">
                  <span className="yr">{t / 12}년</span>
                  <span className="ph-hint">연식 · 차량가 · 배기량을 넣으면 여기에 대여료 · 수익</span>
                </div>
              </div>
            )) : products.map((p) => {
              const v = pnl(p, input.prepay);
              const open = openTerm === p.term;
              return (
                <div key={p.term} className={`prod${open ? ' open' : ''}`}>
                  <button className="prodh" onClick={() => setOpenTerm(open ? -1 : p.term)}>
                    <span className="yr">{p.term / 12}년</span>
                    <span className="amt">{won(p.payVat || 0)}<small>원/월</small></span>
                    <span className="mg">수익 {man(v.opProfit)} · {(v.opPct * 100).toFixed(0)}%</span>
                  </button>
                  {open && (
                    <div className="pd">
                      <div className="li"><span className="k">매출 <em>공급가 · {p.term / 12}년</em></span><span className="v">{won(v.rev)}</span></div>
                      <div className="li subh"><span className="k">매출원가</span><span className="v" /></div>
                      <div className="li minus"><span className="k">· 차량 감가 <em>잔가 {Math.round((p.residualRate || 0) * 100)}%</em></span><span className="v">−{won(v.dep)}</span></div>
                      <div className="li minus"><span className="k">· 금융비용 <em>조달이자</em></span><span className="v">−{won(v.interest)}</span></div>
                      <div className="li minus"><span className="k">· 직접 운영비 <em>보험·자차·정비·세금</em></span><span className="v">−{won(v.direct)}</span></div>
                      {!!v.turnover && (
                        <div className="li minus"><span className="k">· 손바뀜 <em>{credit} 위험원가</em></span><span className="v">−{won(v.turnover)}</span></div>
                      )}
                      <div className="li gp"><span className="k">매출총이익</span><span className="v">{won(v.gp)}</span></div>
                      <div className="li subh"><span className="k">판매관리비</span><span className="v" /></div>
                      <div className="li minus"><span className="k">· 영업수수료</span><span className="v">−{won(v.fee)}</span></div>
                      <div className="li pay"><span className="k">영업이익 <em>{(v.opPct * 100).toFixed(1)}%</em></span><span className="v">{won(v.opProfit)}</span></div>
                      <div className="li"><span className="k">보증금 <em>{depositPct}%</em> · 선납 <em>{prepayPct}%</em></span><span className="v">{won(v.depAmt)} · {won(v.preAmt)}</span></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="foot">
            <b>업계 기준선 추정</b> — 잔가=시장 벤치마크 역산. 실채택 전 엔카·KB차차차 실시세 검산 필요.
          </div>
        </main>
      </div>
    </div>
  );
}
