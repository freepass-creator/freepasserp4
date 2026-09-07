'use client';
/**
 * 견적 «차 고르기» 시트 — 중고는 차종마스터, 신차는 신차마스터에서 고른다.
 *
 * ★사장님 2026-09-06 「견적에는 차종마스터와 신차마스터를 활용해서 **중고차를 세부 모델까지 특정**할 수
 *   있어야 되고, 신차 견적은 현존하는 차량들이 **제조사처럼** 옵션 그룹·옵션 제어까지 활용해서 고를 수
 *   있어야 돼. … 일단 너는 **풀옵션 정의보다 어떻게 고를 건지** 그거를 고민해서 구현해내야 돼」.
 *
 * ★「어떻게 고를 건지」 — 갈래마다 **주(主)가 다르다.**
 *   중고 = **검색이 주, 드릴다운이 보조.** 후보가 260 세부모델 · 17 제조사다. 영업자는 차 이름을 안다
 *          (「그랜저 IG」). 제조사부터 훑게 하면 느리다. 대신 제조사 칩을 두어 «뭐가 있나»도 볼 수 있게 한다.
 *   신차 = **드릴다운이 주.** 모델이 몇 십 개뿐이고, 손님에게 «무엇이 있나»를 보여 주는 일 자체가 목적이다
 *          (제조사 「내 차 만들기」가 하는 일). 제조사 → 모델 → 연료 → 트림 → 옵션.
 *   ⇒ 두 갈래가 **같은 시트·같은 줄·같은 칩**을 쓴다. 갈래마다 화면을 새로 만들면 한쪽만 고쳐진다.
 *
 * ★걸음은 둘뿐이다 — ①차 고르기 ②사양 좁히기. 셋을 넘기면 폰에서 되돌아가다 지친다.
 *
 * ⚠ **옵션 «제어»(조합규칙)는 아직 글이다.** 피드의 `rules` 는 제조사 PDF 에서 뽑은 «문장»이라
 *   기계가 강제할 수 없다. 사장님이 원자 쪽(차종마스터 데이터 관리)에서 규칙을 «정의»하기로 하셨으니,
 *   여기서는 그 규칙이 오면 **그대로 먹을 자리**만 만들어 두고 지금은 문장을 보여 준다.
 *   ★없는 규칙을 화면이 지어내면 「고를 수 있는데 못 고르는」 사고가 난다. 지어내지 않는다.
 * ⚠ 목업(원가·견적)에는 신차를 «브랜드/모델/트림 select 셋»으로 그렸다. 옵션과 조합규칙을 담을 수 없어
 *   이 시트로 바꿨다 — 사장님이 「제조사처럼」이라 하신 것이 그 셋으로는 안 된다.
 */
import { useEffect, useMemo, useState } from 'react';
import '@/components/estimate/picker.css';
import {
  loadCarIndex, loadNewModels, searchCars, carSubtitle, carYears, pickUsed, pickNew, guessCc, koModel,
  type CarEntry, type CarPt, type CarIndex, type NewModel, type NewTrim, type PickedCar,
} from '@/lib/domain/estimate/car-index';

const won = (n: number) => `${Math.round(n || 0).toLocaleString('ko-KR')}원`;
const man = (n: number) => `${Math.round((n || 0) / 10000).toLocaleString('ko-KR')}만`;

const IconX = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
);
const IconSearch = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
);
const IconRight = () => (
  <svg className="cv" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="m9 6 6 6-6 6" /></svg>
);
const IconCheck = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L19 7" /></svg>
);

export type CarPickerProps = {
  open: boolean;
  /**
   * **인라인** — 시트로 «떠오르지» 않고 부르는 자리에 그대로 편다.
   *
   * ★사장님 2026-09-07 「차량 고르는 거 좌측에서 다 골랐잖아 … **왜 패널이 새로 뜨니**」.
   *   웹은 좌 400 기둥이 «차 고르는 자리»다. 그 자리에 두고 또 시트를 띄우면 두 번 고르는 꼴이다.
   * ★원본 둘 다 그렇다 — 손오공 `.vside` 는 차종검색·캐스케이드·차량정보가 **박혀** 있고,
   *   웰릭스 `.wrap`(좌 400)도 제조사→모델→트림→옵션이 박혀 있다. 모달은 «바구니·견적서·공지»처럼
   *   **결과물**에만 쓴다. 고르는 일에는 안 쓴다.
   * ⚠ 폰은 시트가 맞다 — 좌 기둥이 없다.
   */
  inline?: boolean;
  mode: 'used' | 'new';
  onClose: () => void;
  onPick: (car: PickedCar) => void;
};

export default function CarPicker({ open, mode, onClose, onPick, inline }: CarPickerProps) {
  const [index, setIndex] = useState<CarIndex | null>(null);
  const [models, setModels] = useState<NewModel[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [maker, setMaker] = useState<string | null>(null);
  // 걸음 2 — 고른 차(중고=세부모델 / 신차=모델)
  const [car, setCar] = useState<CarEntry | null>(null);
  const [ptIdx, setPtIdx] = useState(0);
  const [trim, setTrim] = useState<string | null>(null);
  const [model, setModel] = useState<NewModel | null>(null);
  const [fuel, setFuel] = useState<string | null>(null);
  const [nTrim, setNTrim] = useState<NewTrim | null>(null);
  const [opts, setOpts] = useState<Record<string, boolean>>({});

  // 열릴 때마다 첫 화면으로 — 지난번 고르던 자리에서 시작하면 「왜 이 차가 떠 있지」가 된다.
  useEffect(() => {
    if (!open) return;
    setQ(''); setMaker(null); setCar(null); setPtIdx(0); setTrim(null);
    setModel(null); setFuel(null); setNTrim(null); setOpts({}); setErr(null);
  }, [open, mode]);

  // 인덱스는 «열 때» 받는다. 견적 첫 화면을 무겁게 하지 않는다.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadCarIndex().then((j) => { if (alive) setIndex(j); }).catch((e) => alive && setErr(String(e?.message || e)));
    if (mode === 'new') {
      loadNewModels().then((m) => { if (alive) setModels(m); }).catch((e) => alive && setErr(String(e?.message || e)));
    }
    return () => { alive = false; };
  }, [open, mode]);

  const cars = index?.cars ?? null;
  /** 신차 모델명은 한글로 보여 준다 — 기아는 영문 슬러그로 온다(car-index `koModel`). */
  const ko = (sub: string) => koModel(index?.al, sub);

  const makers = useMemo(() => {
    if (mode === 'new') return [...new Set((models ?? []).map((m) => m.maker))];
    const seen = new Map<string, number>();
    for (const c of cars ?? []) seen.set(c.mk, (seen.get(c.mk) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')).map(([m]) => m);
  }, [cars, models, mode]);

  const usedRows = useMemo(() => (cars ? searchCars(cars, q, maker ?? undefined) : []), [cars, q, maker]);
  const newRows = useMemo(() => {
    let list = models ?? [];
    if (maker) list = list.filter((m) => m.maker === maker);
    const s = q.trim();
    if (s) list = list.filter((m) => `${m.maker} ${m.sub_model} ${ko(m.sub_model)}`.toLowerCase().includes(s.toLowerCase()));
    return list;
  }, [models, maker, q]);

  const pt: CarPt | null = car ? (car.p[ptIdx] ?? car.p[0] ?? null) : null;
  const fuels = useMemo(() => (model ? [...new Set(model.trims.map((t) => t.fuel))] : []), [model]);
  const trimRows = useMemo(() => (model ? model.trims.filter((t) => !fuel || t.fuel === fuel) : []), [model, fuel]);

  // 옵션 — price 0 은 「기본 포함」이라 고르는 대상이 아니다(피드 규격).
  const optionRows = useMemo(() => (nTrim?.options ?? []).filter((o) => o && o.name), [nTrim]);
  /**
   * 기아는 가격표 PDF 를 «좌표»로 읽어 옵션 «이름»이 조각으로 온다(「옵션3」). **가격은 정확하다**
   * (docs/신차마스터-피드.md). 이름이 조각인 채로 두면 영업자가 무엇을 고르는지 모른 채 값만 올린다 —
   * 그러면 고르지 않는다. ⇒ 조각이 섞이면 화면이 «그렇다고 말한다». 숨기지도, 지어내지도 않는다.
   */
  const optNamesPartial = useMemo(() => optionRows.some((o) => /^옵션\s*\d+$/.test(o.name.trim())), [optionRows]);
  const chosen = useMemo(() => optionRows.filter((o) => Number(o.price) > 0 && opts[o.name]), [optionRows, opts]);
  const optSum = chosen.reduce((n, o) => n + (Number(o.price) || 0), 0);
  const newTotal = nTrim ? (Number(nTrim.priceAfter) || Number(nTrim.priceBefore) || 0) + optSum : 0;

  if (!open) return null;

  const step2 = mode === 'used' ? !!car : !!model;
  const canGo = mode === 'used' ? !!(car && pt && trim) : !!nTrim;

  const confirm = () => {
    if (mode === 'used') {
      if (!car || !pt || !trim) return;
      onPick(pickUsed(car, pt, trim));
    } else {
      if (!model || !nTrim) return;
      onPick(pickNew(model, nTrim, chosen, guessCc(cars ?? [], model.maker, model.sub_model, nTrim.fuel), ko(model.sub_model)));
    }
    onClose();
  };

  const back = () => {
    if (mode === 'used') { setCar(null); setTrim(null); setPtIdx(0); }
    else { setModel(null); setFuel(null); setNTrim(null); setOpts({}); }
  };

  return (
    /* 인라인일 때는 «떠 있는 것»이 아니므로 dialog 도 아니고 바깥 누름도 없다.
       바깥 `est-root` 도 안 두른다 — 이미 그 안에 들어가 있다(토큰이 두 번 선언된다). */
    <div className={inline ? 'est-picker inline' : 'est-root est-picker'}
      role={inline ? undefined : 'dialog'} aria-modal={inline ? undefined : true}
      onClick={inline ? undefined : (e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="psheet">
        <div className="phead">
          <b>{mode === 'used' ? '중고 차종' : '신차'}</b>
          <span className="sub">{step2 ? '사양을 고르세요' : '차를 고르세요'}</span>
          {inline ? null : <button type="button" className="x" onClick={onClose} aria-label="닫기"><IconX /></button>}
        </div>

        <div className="pbody">
          {err ? <div className="pempty"><b>차종을 불러오지 못했습니다</b><br />{err}<br />잠시 뒤 다시 열어 주세요.</div> : null}

          {/* ── 걸음 1 — 차 고르기 ── */}
          {!step2 && !err ? (
            <>
              <div style={{ padding: '10px 12px 0' }}>
                <div className="vsearch" style={{ marginTop: 0 }}>
                  <IconSearch />
                  {/* ⚠ 자동 포커스하지 않는다 — 키보드가 목록을 덮는다. */}
                  <input
                    placeholder={mode === 'used' ? '차종 검색 (제조사·모델·세대)' : '모델 검색'}
                    value={q} onChange={(e) => setQ(e.target.value)}
                  />
                </div>
              </div>
              <div className="mkrow">
                <button type="button" className={maker === null ? 'on' : ''} onClick={() => setMaker(null)}>전체</button>
                {makers.map((m) => (
                  <button key={m} type="button" className={maker === m ? 'on' : ''} onClick={() => setMaker(m)}>{m}</button>
                ))}
              </div>

              {mode === 'used' ? (
                cars === null ? <div className="pempty">차종을 불러오는 중…</div>
                  : usedRows.length ? (
                    <div className="plist">
                      {usedRows.map((c) => (
                        <button key={c.i} type="button" className="prow" onClick={() => { setCar(c); setPtIdx(0); setTrim(null); }}>
                          <span className="pn"><b>{c.mk} {c.sm}</b><em>{carSubtitle(c)}</em></span>
                          <IconRight />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="pempty">
                      <b>찾는 차가 없습니다</b><br />
                      차종마스터에 아직 없는 차입니다. 시트를 닫고 <b>차량가·연식·주행</b>을 직접 넣으면 견적은 그대로 나옵니다.
                    </div>
                  )
              ) : (
                models === null ? <div className="pempty">신차 목록을 불러오는 중…</div>
                  : newRows.length ? (
                    <div className="plist">
                      {newRows.map((m) => (
                        <button key={`${m.maker}/${m.sub_model}`} type="button" className="prow"
                          onClick={() => { setModel(m); setFuel(m.fuels?.[0] ?? null); setNTrim(null); setOpts({}); }}>
                          <span className="pn"><b>{m.maker} {ko(m.sub_model)}</b><em>{(m.fuels ?? []).join('·')} · 트림 {m.trimCount}</em></span>
                          <IconRight />
                        </button>
                      ))}
                    </div>
                  ) : <div className="pempty"><b>해당 신차가 없습니다</b><br />신차마스터에 실가가 들어온 차만 보입니다.</div>
              )}
            </>
          ) : null}

          {/* ── 걸음 2 — 사양 좁히기 ── */}
          {step2 && mode === 'used' && car ? (
            <div className="card">
              <div className="step"><span className="no">2</span>사양<span className="veh">{car.mk} {car.sm}</span></div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', fontWeight: 600, marginTop: -4 }}>
                {carYears(car)}{car.g ? ` · ${car.g}` : ''}{car.dc ? ` · ${car.dc}` : ''}
              </div>
              <div className="tchips">
                {car.p.map((p, i) => (
                  <button key={p.pt} type="button" className={i === ptIdx ? 'on' : ''} onClick={() => { setPtIdx(i); setTrim(null); }}>
                    {p.pt}{p.st ? ` · ${p.st}인승` : ''}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', marginTop: 14 }}>트림</div>
              <div className="tchips">
                {(pt?.t ?? []).map((t) => (
                  <button key={t} type="button" className={t === trim ? 'on' : ''} onClick={() => setTrim(t)}>{t}</button>
                ))}
                {!pt?.t?.length ? <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>등록된 트림이 없습니다</span> : null}
              </div>
              <div className="prules">
                <b>배기량 {pt?.cc ? `${pt.cc}cc` : '미등록'}</b> · 연료 {pt?.f}{pt?.dr ? ` · ${pt.dr}` : ''} — 자동차세·취득세가 이 값으로 계산된다.
                {car.mn ? ' · 이 차는 사람이 손으로 확인한 행이다.' : ''}
              </div>
            </div>
          ) : null}

          {step2 && mode === 'new' && model ? (
            <>
              <div className="card">
                <div className="step"><span className="no">2</span>트림<span className="veh">{model.maker} {ko(model.sub_model)}</span></div>
                {fuels.length > 1 ? (
                  <div className="seg t3">
                    {fuels.map((f) => (
                      <button key={f} type="button" className={f === fuel ? 'on' : ''} onClick={() => { setFuel(f); setNTrim(null); setOpts({}); }}>{f}</button>
                    ))}
                  </div>
                ) : null}
                <div className="plist" style={{ margin: '10px 0 0' }}>
                  {trimRows.map((t) => (
                    <button key={`${t.trim}/${t.fuel}`} type="button" className={`prow${nTrim === t ? ' on' : ''}`}
                      onClick={() => { setNTrim(t); setOpts({}); }}>
                      <span className="pn"><b>{t.trim}</b><em>{t.fuel}{(t.options?.length ?? 0) ? ` · 옵션 ${t.options!.length}` : ''}</em></span>
                      <span className="pv">{man(t.priceAfter || t.priceBefore)}<small>원</small></span>
                    </button>
                  ))}
                  {!trimRows.length ? <div style={{ padding: 14, fontSize: 12, color: 'var(--ink-4)' }}>트림이 없습니다</div> : null}
                </div>
              </div>

              {nTrim ? (
                <div className="card">
                  <div className="step"><span className="no">3</span>옵션<span className="veh dim">{optionRows.length ? `${optionRows.length}개` : '미수집'}</span></div>
                  {optionRows.length ? optionRows.map((o) => {
                    const base = !(Number(o.price) > 0);
                    const on = !base && !!opts[o.name];
                    return (
                      <button key={o.name} type="button" className={`oprow${on ? ' on' : ''}${base ? ' base' : ''}`}
                        onClick={() => { if (!base) setOpts((s) => ({ ...s, [o.name]: !s[o.name] })); }}>
                        <span className="bx"><IconCheck /></span>
                        <span className="on2">{o.name}</span>
                        <span className="ov">{base ? '기본' : `+${man(o.price)}원`}</span>
                      </button>
                    );
                  }) : (
                    <div style={{ fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.7 }}>
                      이 트림의 옵션은 <b>아직 안 들어왔습니다</b>. 「옵션이 없다」가 아니라 「아직 못 받았다」입니다 —
                      제조사 가격표에서 연료가 안 잡힌 트림은 틀린 옵션을 붙이지 않으려고 비워 둡니다.
                    </div>
                  )}
                  {optNamesPartial ? (
                    <div className="prules">
                      <b>옵션 이름이 일부만 들어왔습니다</b> — 제조사 가격표를 좌표로 읽어 이름이 조각난 것이고,
                      <b> 가격은 정확합니다</b>. 이름이 필요하면 제조사 가격표를 함께 보세요.
                    </div>
                  ) : null}
                  {nTrim.rules?.length ? (
                    <div className="prules">
                      <b>조합규칙</b> — {nTrim.rules.slice(0, 4).join(' · ')}
                      {nTrim.rules.length > 4 ? ` 외 ${nTrim.rules.length - 4}건` : ''}
                      <br />※ 아직 <b>글</b>로만 있습니다. 규칙이 원자로 정의되면 여기서 «고를 수 없게» 막습니다.
                    </div>
                  ) : null}
                  <div className="psum">
                    차량가 <b>{won(newTotal)}</b>
                    {optSum ? <> · 기본 {man(nTrim.priceAfter || nTrim.priceBefore)} + 옵션 {man(optSum)}</> : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="pdock">
          {step2 ? <button type="button" className="prev" onClick={back}>이전</button> : null}
          <button type="button" className="go" disabled={!canGo} onClick={confirm}>
            {canGo
              ? (mode === 'used' ? '이 차로 견적' : `이 차로 견적 · ${man(newTotal)}원`)
              : (step2 ? (mode === 'used' ? '트림을 고르세요' : '트림을 고르세요') : '차를 고르세요')}
          </button>
        </div>
      </div>
    </div>
  );
}
