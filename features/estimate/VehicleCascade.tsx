'use client';
/**
 * 차종 캐스케이드 — **왼쪽 기둥에서 «딱딱 눌러» 이어 고른다.**
 *
 * ★★사장님 2026-09-08 「차량 선택하는 거는 **저렇게 굵을 필요 없고**」
 *   「**버튼만** 만들어 주면 되고」 · 「차량 고르는 거는 **딱딱 누르는 거에 연동**이 되어야지」
 *   ⇒ 원본 웰릭스 `VehicleCascade.vue` 그대로다 — 제조사 → 모델 → 세부 → 트림,
 *     **한 줄짜리 컨트롤 넷**이 위에서 아래로 물린다. 위를 바꾸면 아래는 비워진다.
 *   ⚠ 2026-09-07 에는 차 고르기 «판»(`CarPicker`)을 왼쪽에 통째로 박았다. 그게 굵었다.
 *     검색칸·제조사 칩·목록이 왼쪽을 다 먹어, 정작 조건 칸들이 저 아래로 밀렸다. **뒤엣것이 이긴다.**
 *
 * ★칸 이름(`#sec-manufacturer`·`#sec-model`·`#sec-variant`·`#sec-trim`)은 **원본 것 그대로**다 —
 *   웰릭스 CSS 가 그 이름에 「라벨 96 + 한 줄」 짜임을 걸어 두었다. 이름을 바꾸면 짜임이 안 붙는다.
 *
 * ★고르는 «단위»는 갈래마다 다르다 — 데이터가 그렇게 생겼다.
 *     중고 : 제조사 → **세부모델**(그랜저 IG) → 파워트레인(가솔린 2.5) → 트림
 *     신차 : 제조사 → 모델(그랜저)       → 연료        → 트림
 *   둘 다 «넷»이라 같은 줄에 선다.
 *
 * ⚠ 트림까지 고르면 **그 자리에서** 위로 올려 보낸다(`onPick`). 「확인」 단추를 따로 두지 않는다 —
 *   원본도 고르는 즉시 반영한다. 누르는 걸음이 하나 늘면 그만큼 통화 중에 느려진다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  loadCarIndex, loadNewModels, pickUsed, pickNew, guessCc, koModel,
  type CarIndex, type CarEntry, type NewModel, type NewTrim, type PickedCar,
} from '@/lib/domain/estimate/car-index';

/** 폰 마법사가 «한 번에 한 걸음»만 그릴 때 쓰는 걸음 이름 — 원본 `VEHICLE_SUB_STEPS` 와 같다. */
export type CarStep = 'brand' | 'model' | 'variant' | 'trim';
export const CAR_STEPS: CarStep[] = ['brand', 'model', 'variant', 'trim'];

type Props = {
  mode: 'used' | 'new'; picked: PickedCar; onPick: (car: PickedCar) => void;
  /**
   * ★★폰은 «다음 다음 다음»이다 — 사장님 2026-09-09
   *   「모바일에서는 이거를 **다음 다음 다음** 이렇게 하게 만들었잖아 **직관적으로**.
   *    **웰릭스 테이블에 이미 있는 내용**이고」.
   *   원본 `src/components/mobile/StepVehicle.vue` 는 걸음마다 «한 쪽»을 꽉 채워 그리고,
   *   고르면 **바로 다음 쪽으로 넘어간다**(누르는 걸음이 하나 준다).
   * ⇒ 걸음 상태는 «밖»(마법사 껍데기)이 쥔다 — 진행 막대·이전/다음 단추가 같은 값을 봐야 하기 때문이다.
   * ⚠ 데이터를 뽑는 셈(제조사·모델·파워트레인·트림)은 **여기 한 곳**이다. 폰이 따로 세면 어긋난다.
   */
  wizard?: {
    step: CarStep;
    /**
     * ⚠⚠ 차 걸음이 «아닐» 때도 이 조각은 **붙어 있어야 한다**(그리지만 않는다).
     *   2026-09-09 실측 — 트림을 고르면 껍데기가 바로 다음 쪽으로 넘어가면서 이 조각이 떨어져 나갔고,
     *   그래서 «고른 차를 위로 올리는» 효과(`onPick`)가 **한 번도 안 돌았다.**
     *   색상은 규격색으로 뜨고, 옵션은 「트림을 먼저 고르면」이라 하고, 기간 칸은 전부 「—원」이었다.
     *   ⇒ 떼지 말고 «감춘다». 붙어 있어야 효과가 돈다.
     */
    hidden?: boolean;
    /** 그 걸음에서 하나 골랐다 — 껍데기가 다음 쪽으로 넘긴다. */
    onPicked: (step: CarStep) => void;
    /** 걸음마다 «고를 것이 있나 · 골랐나»를 껍데기에 알린다(다음 단추를 켜고 끄는 데 쓴다). */
    onState: (s: { step: CarStep; count: number; chosen: boolean }) => void;
  };
};

/**
 * 한 걸음 = `<section id>` + 라벨 + **한 줄 드롭다운**.
 *
 * ★★사장님 2026-09-08 「**차 고르는 거는 드랍다운으로 해야지… 한 줄 한 줄.**
 *   신차 같은 경우나 **중고차도**」
 *
 * ⚠ 같은 날 오전에는 「드랍다운보다는 **버튼**으로 할 수 있으면 버튼으로 해」였다. 부딪히지 않는다 —
 *   **재 보고 갈린 것**이다. 제조사가 열일곱, 세부모델이 수십이라 칩으로 펴니 왼쪽이 세 줄씩 먹었다.
 *   ⇒ 규칙은 이렇게 굳는다:
 *       **고를 것이 두셋 = 버튼**(상품·채널·만기·신용·취득) — 눈에 다 보이니 한 번에 누른다
 *       **고를 것이 여럿 = 드롭다운**(제조사·모델·파워트레인·트림) — 펴면 화면을 먹는다
 *   ⚠ 색상은 칩으로 둔다 — **색을 봐야 고르는** 것이라 이름만 늘어놓으면 못 고른다.
 *
 * ★긴 목록이라도 «걸음»은 넷 그대로다 — 위를 바꾸면 아래가 비워진다.
 */
function Step({ id, label, value, options, disabled, current, empty, onChange }: {
  id: string; label: string; value: string; disabled: boolean; current: boolean; empty?: string;
  options: { v: string; label: string; sub?: string }[]; onChange: (v: string) => void;
}) {
  return (
    <section id={id} className={`${disabled ? 'hidden' : ''}${current ? ' is-current' : ''}`}>
      <div className="step-title">{label}</div>
      {options.length || disabled ? (
        <select className="step-dd" value={value} disabled={disabled}
          onChange={(e) => onChange(e.target.value)}>
          <option value="">{label} 선택{options.length ? ` (${options.length})` : ''}</option>
          {options.map((o) => (
            <option key={o.v} value={o.v}>{o.label}{o.sub ? ` · ${o.sub}` : ''}</option>
          ))}
        </select>
      ) : <div className="empty-state">{empty ?? '고를 것이 없습니다'}</div>}
    </section>
  );
}

export default function VehicleCascade({ mode, picked, onPick, wizard }: Props) {
  const [index, setIndex] = useState<CarIndex | null>(null);
  const [models, setModels] = useState<NewModel[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [maker, setMaker] = useState('');
  const [model, setModel] = useState('');
  const [variant, setVariant] = useState('');
  const [trim, setTrim] = useState('');

  /* 중고 인덱스는 «둘 다» 쓴다 — 신차도 배기량 짐작(`guessCc`)과 한글 이름(`koModel`)에 필요하다. */
  useEffect(() => {
    let alive = true;
    loadCarIndex().then((j) => alive && setIndex(j)).catch((e) => alive && setErr(String(e?.message || e)));
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (mode !== 'new' || models) return;
    let alive = true;
    loadNewModels().then((m) => alive && setModels(m)).catch((e) => alive && setErr(String(e?.message || e)));
    return () => { alive = false; };
  }, [mode, models]);

  /* 갈래를 바꾸면 처음부터 — 중고 트림을 쥔 채 신차 목록을 고르면 안 된다. */
  useEffect(() => { setMaker(''); setModel(''); setVariant(''); setTrim(''); }, [mode]);

  const cars = index?.cars ?? null;
  /** ⚠ `useCallback` 이라야 한다 — 그림마다 새로 만들면 이걸 의존에 넣은 `useMemo` 가 매번 다시 돌고,
     그 값을 보는 효과가 setState 를 불러 **무한히 돈다**(2026-09-09 실측 · 콘솔에 3천 줄). */
  const ko = useCallback((sub: string) => koModel(index?.al, sub), [index]);

  // ── 걸음 ① 제조사 ─────────────────────────────────────────────────────────
  const makers = useMemo(() => {
    if (mode === 'new') return [...new Set((models ?? []).map((m) => m.maker))];
    // 대수가 많은 제조사가 위로 — 영업자가 제일 자주 누르는 순서다.
    const seen = new Map<string, number>();
    for (const c of cars ?? []) seen.set(c.mk, (seen.get(c.mk) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')).map(([m]) => m);
  }, [cars, models, mode]);

  /**
   * ★★걸음이 갈래마다 다르다 — 사장님 2026-09-08
   *     **중고** : 제조사 → **모델** → **세부모델** → 트림
   *     **신차** : 제조사 → **세부모델** → **파워트레인** → 트림 → (옵션·색상)
   *
   *   ⚠ 중고에 파워트레인 걸음이 «없는» 것은 일부러다 — 사장님 「나중에 모델 세부모델 파워트레인
   *     세부트림으로 가긴 할 건데 **아직 원자가 없어서** 그래」.
   *     ⇒ 대신 **트림 이름에 파워트레인을 붙여** 보여 준다(「캘리그래피 · 가솔린 2.5」).
   *       고르면 그 파워트레인이 같이 정해진다 — 걸음은 셋인데 «잃는 것은 없다».
   *       ★이게 중요한 까닭은 시세다 — 파워트레인을 모르면 가솔린과 하이브리드가 같은 값이 된다
   *         (사장님 「파워트레인이 들어가야 신차가 딱 걸린다」).
   *   ⚠ 신차마스터에는 «모델» 단이 없다(피드가 세부모델 단위다). 그래서 신차는 셋째가 파워트레인이다.
   */
  // ── 걸음 ② 중고=모델 · 신차=세부모델 ────────────────────────────────────
  const usedModels = useMemo(() => {
    const seen = new Map<string, number>();
    for (const c of cars ?? []) if (c.mk === maker) seen.set(c.md, (seen.get(c.md) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'));
  }, [cars, maker]);
  const newModels = useMemo(
    () => (models ?? []).filter((m) => m.maker === maker)
      .sort((a, b) => ko(a.sub_model).localeCompare(ko(b.sub_model), 'ko')),
    [models, maker, index]);
  const newModel: NewModel | null = useMemo(
    () => newModels.find((m) => m.sub_model === model) ?? null, [newModels, model]);

  // ── 걸음 ③ 중고=세부모델 · 신차=파워트레인 ──────────────────────────────
  const usedSubs = useMemo(
    () => (cars ?? []).filter((c) => c.mk === maker && c.md === model)
      .sort((a, b) => a.sm.localeCompare(b.sm, 'ko')),
    [cars, maker, model]);
  const usedCar: CarEntry | null = useMemo(
    () => usedSubs.find((c) => c.i === variant) ?? null, [usedSubs, variant]);

  /**
   * 신차 파워트레인 목록 — **값은 «자리 번호»로 나른다.**
   * ⚠⚠ 트림에서 겪은 것과 «같은» 함정이다(2026-09-08 제네시스). 연료 이름을 그대로 값으로 쓰면
   *   이름이 빈 줄에서 값이 빈 문자열이 되어 「파워트레인 선택」 안내문과 구별이 안 되고 **못 고른다.**
   *   실제로 그랬다 — 르노 필랑트(3트림)는 연료가 빈칸이라 **한 대도 못 골랐고**,
   *   기아 EV9 는 열 줄 중 여섯 줄의 연료가 빈칸이라 그 여섯이 통째로 안 보였다(2026-09-09 실측).
   *   ⇒ 비었으면 「미상」이라 **적고** 고를 수 있게 둔다. 원천이 안 준 것은 「없다」가 아니라 「비었다」다.
   */
  const newFuels = useMemo(() => newModel?.fuels ?? [], [newModel]);

  const variants = useMemo(() => {
    if (mode === 'new') return newFuels.map((f, i) => ({ v: `${i}|${f}`, label: f || '미상' }));
    return usedSubs.map((c) => ({
      v: c.i,
      label: c.sm,
      sub: [c.ys && `${c.ys}~${c.ye || '현재'}`, c.g].filter(Boolean).join(' · '),
    }));
  }, [mode, newFuels, usedSubs]);

  // ── 걸음 ④ 트림 ───────────────────────────────────────────────────────────
  /**
   * 중고 트림 — 파워트레인 걸음이 없으므로 **모든 파워트레인의 트림을 합쳐** 보여 준다.
   * 같은 트림명이 여럿이면 파워트레인마다 한 줄씩 선다(「캘리그래피 · 가솔린 2.5」·「… · 하이브리드 1.6T」).
   * ⇒ 고르면 파워트레인이 «같이» 정해진다. 값은 `pt|trim` 으로 둘을 함께 나른다.
   */
  /** 신차 — 파워트레인으로 좁힌 트림 «목록». 값(자리 번호)과 되짚기가 같은 목록을 봐야 안 어긋난다. */
  const pickedFuel = useMemo(
    () => (mode === 'new' && variant ? newFuels[Number(variant.split('|')[0])] ?? null : null),
    [mode, variant, newFuels],
  );
  const newTrims = useMemo(
    () => (newModel?.trims ?? []).filter((t) => pickedFuel === null || t.fuel === pickedFuel),
    [newModel, pickedFuel],
  );

  /**
   * 고를 것이 하나뿐인 걸음은 «묻지 않는다» — 눌러야 다음이 열리는데 고를 것이 없으면 막힌 문이다.
   * (르노 필랑트·현대 파비스처럼 파워트레인이 한 종류인 차 · 제조사 「내 차 만들기」도 이럴 때 안 묻는다.)
   */
  useEffect(() => {
    if (mode !== 'new' || !model || variant || variants.length !== 1) return;
    setVariant(variants[0].v);
  }, [mode, model, variant, variants]);

  const trims = useMemo(() => {
    if (mode === 'new') {
      // ⚠⚠ **이름 없는 트림이 있다** — 제네시스 여덟 모델이 전부 그렇다(BTO 가 「기본 한 대 + 옵션」이라
      //   트림명 자리가 비어 있다 · 2026-09-08 실측 423개 중 8개). 이름을 그대로 값으로 쓰면
      //   빈 값이 되어 «고를 안내문»과 구별이 안 되고, 그래서 **제네시스는 한 대도 못 골랐다.**
      //   ⇒ 값은 «자리 번호»로 나르고, 이름이 비면 「기본」이라 적는다.
      // 값을 곁들인다 — 제조사 견적기도 트림 옆에 값을 보여 준다. 이름이 겹치는 트림
      // (기아 EV9 「라이트 롱레인지」가 6,642만·6,990만 두 줄)을 «값으로» 가릴 수 있게 하는 몫도 한다.
      return newTrims.map((t, i) => ({
        v: `${i}|${t.trim}`,
        label: t.trim || '기본',
        sub: (Number(t.priceAfter) || Number(t.priceBefore) || 0) > 0
          ? `${Math.round((Number(t.priceAfter) || Number(t.priceBefore)) / 10000).toLocaleString('ko-KR')}만` : undefined,
      }));
    }
    if (!usedCar) return [];
    const out: { v: string; label: string; sub?: string }[] = [];
    usedCar.p.forEach((p, pi) => {
      for (const t of p.t) out.push({ v: `${pi}|${t}`, label: t, sub: p.pt });
    });
    return out;
  }, [mode, newTrims, usedCar]);

  /* ★고르는 즉시 위로 올린다 — 「확인」 단추 없음(원본과 같다). */
  useEffect(() => {
    if (!trim) return;
    if (mode === 'used') {
      // 트림 값은 «파워트레인 번호 | 트림명» 이다 — 걸음이 셋이라 둘을 함께 나른다.
      const [pi, name] = trim.split('|');
      const p = usedCar?.p[Number(pi)];
      if (usedCar && p && name) onPick(pickUsed(usedCar, p, name));
      return;
    }
    const t: NewTrim | undefined = newTrims[Number(trim.split('|')[0])];
    if (newModel && t) {
      onPick(pickNew(newModel, t, [], guessCc(cars ?? [], newModel.maker, newModel.sub_model, t.fuel), ko(newModel.sub_model)));
    }
    // onPick 은 매 그림마다 새로 만들어져 의존에 넣으면 무한히 돈다 — 고른 값이 바뀔 때만 올린다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trim, variant, model, maker, mode, usedCar, newModel, newTrims]);

  const loading = mode === 'new' ? !models : !cars;

  /* ── 폰 마법사 — 한 걸음이 한 쪽이다(원본 `StepVehicle.vue` 짜임 그대로) ────────── */
  type StepOpt = { v: string; label: string; sub?: string };
  const stepData = useMemo<Record<CarStep, { title: string; title2: string; value: string; options: StepOpt[] }>>(() => ({
    brand: { title: '어떤 제조사를', title2: '선택할까요?', value: maker,
      options: makers.map((m) => ({ v: m, label: m })) },
    model: { title: `${maker}에서`, title2: mode === 'used' ? '어떤 모델로 갈까요?' : '어떤 차로 갈까요?', value: model,
      options: mode === 'used'
        ? usedModels.map(([md, n]) => ({ v: md, label: md, sub: `${n}종` }))
        : newModels.map((m) => ({ v: m.sub_model, label: ko(m.sub_model) })) },
    variant: { title: ko(model), title2: mode === 'used' ? '세부 모델을 골라주세요' : '파워트레인을 골라주세요',
      value: variant, options: variants },
    trim: { title: ko(model), title2: '트림을 골라주세요', value: trim, options: trims },
  }), [maker, model, variant, trim, makers, usedModels, newModels, variants, trims, mode, ko]);

  const wStep = wizard?.step ?? null;
  const wOnState = wizard?.onState;
  /* ⚠ 의존은 «원시값»으로 둔다 — 객체(`stepData`)를 넣으면 그림마다 달라져 효과가 끝없이 돈다. */
  const wCount = wStep ? stepData[wStep].options.length : 0;
  const wChosen = wStep ? !!stepData[wStep].value : false;
  useEffect(() => {
    if (!wStep || !wOnState) return;
    wOnState({ step: wStep, count: wCount, chosen: wChosen });
  }, [wStep, wOnState, wCount, wChosen]);

  if (wizard) {
    if (wizard.hidden) return null;   // 붙어는 있고 그리지만 않는다(위 주석)
    const d = stepData[wizard.step];
    const set = (v: string) => {
      if (wizard.step === 'brand') { setMaker(v); setModel(''); setVariant(''); setTrim(''); }
      else if (wizard.step === 'model') { setModel(v); setVariant(''); setTrim(''); }
      else if (wizard.step === 'variant') { setVariant(v); setTrim(''); }
      else setTrim(v);
      // ★고르면 «바로» 넘어간다 — 원본도 그렇다. 누르는 걸음이 하나 준다.
      wizard.onPicked(wizard.step);
    };
    return (
      <div className="sv">
        {/* 지나온 걸음 — 누르면 그 걸음으로 되돌아간다(원본 `sv-crumbs`). */}
        {maker ? (
          <div className="sv-crumbs">
            <button type="button" className="sv-crumb" onClick={() => wizard.onPicked('brand')}>{maker}</button>
            {model ? <button type="button" className="sv-crumb" onClick={() => wizard.onPicked('model')}>{ko(model)}</button> : null}
            {variant ? <button type="button" className="sv-crumb" onClick={() => wizard.onPicked('variant')}>{stepData.variant.options.find((o) => o.v === variant)?.label ?? variant}</button> : null}
            {trim ? <button type="button" className="sv-crumb" onClick={() => wizard.onPicked('trim')}>{stepData.trim.options.find((o) => o.v === trim)?.label ?? trim}</button> : null}
          </div>
        ) : null}
        <div className="sv-section">
          <h2 className="sv-title">{d.title}<br />{d.title2}</h2>
          {loading ? <div className="sv-empty">차종을 받는 중입니다…</div>
            : !d.options.length ? <div className="sv-empty">고를 것이 없습니다.</div>
            : wizard.step === 'brand' ? (
              <div className="sv-brand-grid">
                {d.options.map((o) => (
                  <button type="button" key={o.v} className={`sv-brand-card${o.v === d.value ? ' is-selected' : ''}`}
                    onClick={() => set(o.v)}>
                    <span className="sv-brand-card__name">{o.label}</span>
                  </button>
                ))}
              </div>
            ) : wizard.step === 'trim' ? (
              /* 트림은 값이 붙는다 — 원본도 트림 쪽에서만 값을 보여 준다(고르는 근거가 값이라서). */
              <div className="sv-list">
                {d.options.map((o) => (
                  <button type="button" key={o.v} className={`sv-trim-card${o.v === d.value ? ' is-selected' : ''}`}
                    onClick={() => set(o.v)}>
                    <div className="sv-trim-card__top"><span className="sv-trim-card__name">{o.label}</span></div>
                    {o.sub ? <div className="sv-trim-card__price">{o.sub}</div> : null}
                  </button>
                ))}
              </div>
            ) : (
              <div className="sv-list">
                {d.options.map((o) => (
                  <button type="button" key={o.v} className={`sv-row${o.v === d.value ? ' is-selected' : ''}`}
                    onClick={() => set(o.v)}>
                    <span className="sv-row__label">{o.label}{o.sub ? <em> · {o.sub}</em> : null}</span>
                    <span className="sv-row__chev">›</span>
                  </button>
                ))}
              </div>
            )}
        </div>
        {err ? <div className="sv-empty">차종을 못 받았습니다 — {err}</div> : null}
      </div>
    );
  }

  return (
    <>
      <Step id="sec-manufacturer" label="제조사"
        value={maker} disabled={loading} current={!maker}
        empty="차종을 받는 중입니다"
        options={makers.map((m) => ({ v: m, label: m }))}
        onChange={(v) => { setMaker(v); setModel(''); setVariant(''); setTrim(''); }} />

      <Step id="sec-model" label={mode === 'used' ? '모델' : '세부모델'}
        value={model} disabled={!maker} current={!!maker && !model}
        empty="이 제조사의 차가 아직 없습니다"
        options={mode === 'used'
          ? usedModels.map(([md, n]) => ({ v: md, label: md, sub: `${n}종` }))
          : newModels.map((m) => ({ v: m.sub_model, label: ko(m.sub_model) }))}
        onChange={(v) => { setModel(v); setVariant(''); setTrim(''); }} />

      <Step id="sec-variant" label={mode === 'used' ? '세부모델' : '파워트레인'}
        value={variant} disabled={!model} current={!!model && !variant}
        options={variants} onChange={(v) => { setVariant(v); setTrim(''); }} />

      <Step id="sec-trim" label="트림"
        value={trim} disabled={!variant} current={!!variant && !trim}
        options={trims} onChange={setTrim} />

      {/* 고른 차를 한 줄로 되짚어 준다 — 넷을 다 누르고 나면 무엇을 골랐는지 위가 안 보인다. */}
      {trim ? <div className="cascade-echo">{picked.name} · {picked.meta}</div> : null}
      {err ? <div className="empty-state">차종을 못 받았습니다 — {err}</div> : null}
    </>
  );
}
