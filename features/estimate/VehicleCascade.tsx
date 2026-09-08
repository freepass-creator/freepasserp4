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
import { useEffect, useMemo, useState } from 'react';
import {
  loadCarIndex, loadNewModels, pickUsed, pickNew, guessCc, koModel,
  type CarIndex, type CarEntry, type NewModel, type NewTrim, type PickedCar,
} from '@/lib/domain/estimate/car-index';

type Props = { mode: 'used' | 'new'; picked: PickedCar; onPick: (car: PickedCar) => void };

/**
 * 한 걸음 = `<section id>` + 라벨 + **버튼 줄**.
 * ★사장님 2026-09-08 「드랍다운보다는 **버튼**으로 할 수 있으면 버튼으로 해」 —
 *   원본은 드롭다운이지만 그건 열고 고르느라 두 번 누른다. 눈에 다 보이면 한 번이다.
 * ★긴 칸(제조사·모델)은 `scroll` 로 키를 묶는다 — 안 묶으면 열일곱·수십 개가 왼쪽을 통째로 민다.
 */
function Step({ id, label, value, options, disabled, current, scroll, empty, onChange }: {
  id: string; label: string; value: string; disabled: boolean; current: boolean;
  scroll?: boolean; empty?: string;
  options: { v: string; label: string; sub?: string }[]; onChange: (v: string) => void;
}) {
  return (
    <section id={id} className={`${disabled ? 'hidden' : ''}${current ? ' is-current' : ''}`}>
      <div className="step-title">{label}</div>
      {/* 기존 칩(`picker.css .tchips`)을 그대로 쓴다 — 사장님 2026-09-08 「기존거 활용하라고 했는데」. */}
      {options.length ? (
        <div className={`tchips${scroll ? ' scroll' : ''}`}>
          {options.map((o) => (
            <button key={o.v} type="button" className={String(o.v) === String(value) ? 'on' : ''}
              disabled={disabled} onClick={() => onChange(o.v)}>
              {o.label}{o.sub ? <em>{o.sub}</em> : null}
            </button>
          ))}
        </div>
      ) : <div className="empty-state">{empty ?? '고를 것이 없습니다'}</div>}
    </section>
  );
}

export default function VehicleCascade({ mode, picked, onPick }: Props) {
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
  const ko = (sub: string) => koModel(index?.al, sub);

  // ── 걸음 ① 제조사 ─────────────────────────────────────────────────────────
  const makers = useMemo(() => {
    if (mode === 'new') return [...new Set((models ?? []).map((m) => m.maker))];
    // 대수가 많은 제조사가 위로 — 영업자가 제일 자주 누르는 순서다.
    const seen = new Map<string, number>();
    for (const c of cars ?? []) seen.set(c.mk, (seen.get(c.mk) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')).map(([m]) => m);
  }, [cars, models, mode]);

  // ── 걸음 ② 모델(중고=세부모델 · 신차=모델) ────────────────────────────────
  const usedModels = useMemo(
    () => (cars ?? []).filter((c) => c.mk === maker).sort((a, b) => a.sm.localeCompare(b.sm, 'ko')),
    [cars, maker]);
  const newModels = useMemo(
    () => (models ?? []).filter((m) => m.maker === maker).sort((a, b) => ko(a.sub_model).localeCompare(ko(b.sub_model), 'ko')),
    [models, maker, index]);

  const usedCar: CarEntry | null = useMemo(
    () => usedModels.find((c) => c.i === model) ?? null, [usedModels, model]);
  const newModel: NewModel | null = useMemo(
    () => newModels.find((m) => m.sub_model === model) ?? null, [newModels, model]);

  // ── 걸음 ③ 파워트레인(중고) · 연료(신차) ──────────────────────────────────
  const variants = useMemo(() => {
    if (mode === 'new') return (newModel?.fuels ?? []).map((f) => ({ v: f, label: f }));
    return (usedCar?.p ?? []).map((p, i) => ({ v: String(i), label: p.pt }));
  }, [mode, newModel, usedCar]);

  // ── 걸음 ④ 트림 ───────────────────────────────────────────────────────────
  const trims = useMemo(() => {
    if (mode === 'new') {
      return (newModel?.trims ?? []).filter((t) => !variant || t.fuel === variant)
        .map((t) => ({ v: t.trim, label: t.trim }));
    }
    const p = usedCar?.p[Number(variant)];
    return (p?.t ?? []).map((t) => ({ v: t, label: t }));
  }, [mode, newModel, usedCar, variant]);

  /* ★고르는 즉시 위로 올린다 — 「확인」 단추 없음(원본과 같다). */
  useEffect(() => {
    if (!trim) return;
    if (mode === 'used') {
      const p = usedCar?.p[Number(variant)];
      if (usedCar && p) onPick(pickUsed(usedCar, p, trim));
      return;
    }
    const t: NewTrim | undefined = newModel?.trims.find((x) => x.trim === trim && (!variant || x.fuel === variant));
    if (newModel && t) {
      onPick(pickNew(newModel, t, [], guessCc(cars ?? [], newModel.maker, newModel.sub_model, t.fuel), ko(newModel.sub_model)));
    }
    // onPick 은 매 그림마다 새로 만들어져 의존에 넣으면 무한히 돈다 — 고른 값이 바뀔 때만 올린다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trim, variant, model, maker, mode, usedCar, newModel]);

  const loading = mode === 'new' ? !models : !cars;

  return (
    <>
      <Step id="sec-manufacturer" label="제조사"
        value={maker} disabled={loading} current={!maker}
        scroll empty="차종을 받는 중입니다"
        options={makers.map((m) => ({ v: m, label: m }))}
        onChange={(v) => { setMaker(v); setModel(''); setVariant(''); setTrim(''); }} />

      <Step id="sec-model" label={mode === 'used' ? '세부모델' : '모델'}
        value={model} disabled={!maker} current={!!maker && !model} scroll
        empty="이 제조사의 차가 아직 없습니다"
        options={mode === 'used'
          ? usedModels.map((c) => ({ v: c.i, label: `${c.sm}${c.ys ? ` (${c.ys}~${c.ye || '현재'})` : ''}` }))
          : newModels.map((m) => ({ v: m.sub_model, label: ko(m.sub_model) }))}
        onChange={(v) => { setModel(v); setVariant(''); setTrim(''); }} />

      <Step id="sec-variant" label={mode === 'used' ? '파워트레인' : '연료'}
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
