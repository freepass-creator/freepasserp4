'use client';
/**
 * 폰 견적 마법사 — **다음 · 다음 · 다음**.
 *
 * ★★사장님 2026-09-09 「그래서 **모바일에서는 이거를 다음 다음 다음** 이렇게 하게 만들었잖아
 *   **직관적으로**. **웰릭스 테이블에 이미 있는 내용**이고」
 *
 * ⚠⚠ 2026-09-08 에 나는 사장님 「모바일 버전은 다음다음 하게 해놨어」를 «미룬다»는 뜻으로 읽고
 *   「모바일은 나중에」라고 적어 두었다. 그게 아니라 **«이미 그렇게 만들어 놨다»**는 말씀이었다.
 *   그래서 폰이 여태 데스크톱 두 칸을 그대로 눌러 담은 꼴이었다 — 한 쪽에 스무 칸이 쌓였다.
 *
 * ★짜임은 원본 `src/components/mobile/MobileApp.vue` 그대로다 —
 *     머리(고정) · **진행 막대**(쪽 수만큼 칸) · 본문 한 쪽 · **하단 고정 견적** · 발(이전/다음).
 *   스타일도 원본 것을 그대로 들여왔다(`scripts/extract-welrix-css.py` 의 SFC 목록에 mobile 여섯 조각).
 *   ⚠ 그래서 이 조각은 **반드시 `.wx-root` 안**에서 그려야 한다.
 *
 * ★걸음 차례는 **제조사 「내 차 만들기」**를 따른다(사장님 2026-09-09
 *   「세부모델 · 파워트레인 · 세부트림 · **색상 · 옵션** 순서」) — 데스크톱 왼쪽 칸 차례와 같다.
 *   ⚠ 원본 폰은 «옵션 → 색상»이었다. 우리는 **색상 → 옵션**이다. 뒤엣것이 이긴다.
 *
 * ★갈래마다 쪽 수가 다르다 — 중고는 «차량 정보»(시세·연식·주행) 쪽이 있고 옵션 쪽이 없다.
 *   신차는 그 반대다. 진행 막대가 그 수를 그대로 센다(없는 쪽을 세면 막대가 거짓말을 한다).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import VehicleCascade, { CAR_STEPS, type CarStep } from '@/features/estimate/VehicleCascade';
import type { PickedCar } from '@/lib/domain/estimate/car-index';

export type WizStep = 'source' | CarStep | 'carinfo' | 'colors' | 'options' | 'conditions' | 'terms';

const LABEL: Record<WizStep, string> = {
  source: '상품', brand: '제조사', model: '모델', variant: '파워트레인', trim: '트림',
  carinfo: '차량 정보', colors: '색상', options: '옵션', conditions: '견적 조건', terms: '기간별 견적',
};

export type WizardProps = {
  mode: 'used' | 'new';
  onMode: (m: 'used' | 'new') => void;
  picked: PickedCar;
  onPick: (c: PickedCar) => void;
  /** 데스크톱과 «같은» 조각을 받는다 — 폰이 따로 짜면 두 화면이 갈린다. */
  sections: { carinfo: React.ReactNode; colors: React.ReactNode; options: React.ReactNode; conditions: React.ReactNode; terms: React.ReactNode };
  summary: { carName: string; carMeta: string; price: number; monthly: number; term: number };
  onQuote: () => void;
  canQuote: boolean;
};

const man = (n: number) => `${Math.round((n || 0) / 10000).toLocaleString('ko-KR')}만`;

export default function EstimateWizard({ mode, onMode, picked, onPick, sections, summary, onQuote, canQuote }: WizardProps) {
  const isNew = mode === 'new';
  /** 이 갈래에서 실제로 서는 쪽들 — 없는 쪽은 세지도, 그리지도 않는다. */
  const steps = useMemo<WizStep[]>(() => [
    'source', ...CAR_STEPS,
    ...(isNew ? [] as WizStep[] : ['carinfo' as WizStep]),
    'colors',
    ...(isNew ? ['options' as WizStep] : []),
    'conditions', 'terms',
  ], [isNew]);

  const [step, setStep] = useState<WizStep>('source');
  const idx = Math.max(0, steps.indexOf(step));
  // 갈래를 바꾸면(중고↔신차) 없는 쪽에 서 있을 수 있다 — 가까운 쪽으로 끌어온다.
  useEffect(() => { if (!steps.includes(step)) setStep(steps[Math.min(idx, steps.length - 1)]); }, [steps, step, idx]);

  /** 차 고르는 걸음의 «고를 것이 있나 · 골랐나» — 캐스케이드가 알려 준다. */
  const [carState, setCarState] = useState<{ step: CarStep; count: number; chosen: boolean } | null>(null);
  /* ⚠ 값이 «그대로»면 상태를 안 건드린다 — 같은 값으로 setState 하면 다시 그리고, 다시 알리고, 끝이 없다. */
  const onCarState = useCallback((s: { step: CarStep; count: number; chosen: boolean }) =>
    setCarState((p) => (p && p.step === s.step && p.count === s.count && p.chosen === s.chosen ? p : s)), []);
  const onCarPicked = useCallback((from: CarStep) => {
    // 지나온 걸음을 누르면 «그 걸음»으로 돌아가고, 방금 골랐으면 다음 걸음으로 간다.
    setStep((cur) => (cur === from ? (CAR_STEPS[CAR_STEPS.indexOf(from) + 1] ?? 'colors') : from));
  }, []);

  const isCarStep = (CAR_STEPS as string[]).includes(step);
  /** 차 걸음을 떠나도 «마지막 차 걸음»을 쥐고 있는다 — 조각이 계속 붙어 있어야 해서다. */
  const [carStep, setCarStep] = useState<CarStep>('brand');
  useEffect(() => { if (isCarStep) setCarStep(step as CarStep); }, [isCarStep, step]);
  const canNext = !isCarStep || !!carState?.chosen || carState?.count === 0;

  const go = (d: 1 | -1) => {
    const n = idx + d;
    if (n < 0 || n >= steps.length) return;
    if (d === 1 && !canNext) return;
    setStep(steps[n]);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="m-shell est-wiz">
      <header className="m-header">
        <div className="m-header__brand">
          {/* ★노브랜드 — 마크도 워드마크도 안 세운다. 서는 것은 «지금 무엇을 고르는가»뿐이다. */}
          <span className="m-step-label">{LABEL[step]}</span>
        </div>
        <div className="m-header__actions">
          <button type="button" className="m-act m-act--primary" disabled={!canQuote} onClick={onQuote}>
            <span>견적서</span>
          </button>
        </div>
      </header>

      <div className="m-progress">
        {steps.map((s, i) => <div key={s} className={`m-progress__seg${i <= idx ? ' is-done' : ''}`} />)}
      </div>

      <main className="m-main">
        {step === 'source' ? (
          <div className="sv">
            <div className="sv-section">
              <h2 className="sv-title">중고차인가요,<br />신차인가요?</h2>
              <div className="sv-list">
                {([['used', '중고차', '시세를 넣고 잔가로 계산합니다'],
                   ['new', '신차', '제조사 공표가 · 옵션 · 제조사 색상']] as const).map(([v, label, sub]) => (
                  <button type="button" key={v} className={`sv-row${mode === v ? ' is-selected' : ''}`}
                    onClick={() => { onMode(v); setStep('brand'); }}>
                    <span className="sv-row__label">{label}<em> · {sub}</em></span>
                    <span className="sv-row__chev">›</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {/* ⚠ 차 걸음이 아닐 때도 «붙여 둔다» — 떼면 고른 차가 위로 안 올라간다(조각 주석 참고). */}
        <VehicleCascade mode={mode} picked={picked} onPick={onPick}
          wizard={{ step: carStep, onPicked: onCarPicked, onState: onCarState, hidden: !isCarStep }} />

        {step === 'carinfo' ? <div className="sv sv--fields">{sections.carinfo}</div> : null}
        {step === 'colors' ? <div className="sv sv--fields">{sections.colors}</div> : null}
        {step === 'options' ? <div className="sv sv--fields">{sections.options}</div> : null}
        {step === 'conditions' ? <div className="sv sv--fields">{sections.conditions}</div> : null}
        {step === 'terms' ? <div className="sv sv--fields sv--wide">{sections.terms}</div> : null}
      </main>

      {/* 하단 고정 견적 — 원본 `StickyQuote`. 차를 고른 뒤부터 선다. */}
      {summary.price > 0 ? (
        <div className="sq">
          <div className="sq-summary">
            <span className="sq-summary__bar" />
            <div className="sq-summary__row">
              <div className="sq-summary__label">
                {summary.carName}
                <span className="sq-summary__hint">{summary.carMeta}</span>
              </div>
            </div>
          </div>
          <div className="sq-terms">
            <div className="sq-term-card is-checked">
              <div className="sq-term-card__term">{summary.monthly > 0 ? `${summary.term}개월` : '차량가'}</div>
              <div className="sq-term-card__monthly">
                {summary.monthly > 0
                  ? <>{Math.round(summary.monthly).toLocaleString('ko-KR')}<em>원</em></>
                  : <>{man(summary.price)}<em>원</em></>}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <footer className="m-footer">
        {idx > 0 ? <button type="button" className="m-btn m-btn--ghost" onClick={() => go(-1)}>← 이전</button> : null}
        {idx < steps.length - 1
          ? <button type="button" className="m-btn m-btn--primary" disabled={!canNext} onClick={() => go(1)}>다음 →</button>
          : <button type="button" className="m-btn m-btn--primary" disabled={!canQuote} onClick={onQuote}>견적서 보기</button>}
      </footer>
    </div>
  );
}
