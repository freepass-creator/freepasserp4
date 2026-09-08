/**
 * 견적 «차 고르기» — 인덱스 읽기 · 검색 · 고른 차 한 대의 모양.
 *
 * ★두 원천을 **한 모양**(`PickedCar`)으로 낸다. 화면이 갈래마다 다른 값을 다루기 시작하면
 *   「중고에서는 되는데 신차에서는 안 되는」 칸이 생긴다.
 *     중고 = 차종마스터 슬림 인덱스 `public/data/estimate-cars.json`
 *            (정본 `vehicle-trim-master.json` 에서 `scripts/generate-estimate-car-index.mts` 가 추림)
 *     신차 = 신차마스터 피드 `GET /api/newcar?group=model` (Firestore `new_car_trim` · docs/신차마스터-피드.md)
 *
 * ★고른 결과가 엔진에 그대로 들어간다 — `fuel`(엔진 키)·`cc` 는 여기서 «번역»해서 넘긴다.
 *   화면이 제 나름대로 번역하기 시작하면 같은 차가 화면마다 다른 세금을 문다.
 */

/** 파워트레인 한 갈래 — 연료·배기량·구동·시트. */
export type CarPt = { pt: string; f: string; cc: number | null; dl: number | null; dr: string | null; st: number | null; t: string[] };
/** 세부모델 한 대 — 목록이 한 줄로 보여 주는 단위(사장님 「세부 모델까지 특정」의 그 단위). */
export type CarEntry = { i: string; mk: string; md: string; sm: string; g: string; dc: string; ys: string; ye: string; o: string; ms: string; mn?: true; p: CarPt[] };
export type CarIndex = { v: number; source: string; data_as_of: string | null; carCount: number; trimCount: number; cars: CarEntry[]; al?: Record<string, string> };

/** 신차 피드 — 모델 하나와 그 트림들. */
export type NewTrim = { maker: string; sub_model: string; carType?: string; fuel: string; trim: string; priceBefore: number; priceAfter: number; options?: { name: string; price: number }[]; rules?: string[]; basePrices?: { label: string; price: number }[] };
export type NewModel = { maker: string; sub_model: string; fuels: string[]; trimCount: number; trims: NewTrim[] };

/** 견적 STEP 1 이 받는 «고른 차 한 대». 중고·신차가 같은 모양으로 온다. */
export type PickedCar = {
  source: 'used' | 'new';
  /** 화면 첫 줄 — 「현대 그랜저 GN11 · 캘리그래피」 */
  name: string;
  /** 화면 둘째 줄 — 「중고 · 2022~2026 · 가솔린 2.5 FWD」 */
  meta: string;
  maker: string; model: string; subModel: string; trim: string; powertrain: string;
  /** 엔진에 그대로 들어가는 값 */
  fuel: EngineFuel; cc: number | null;
  /** 신차만 자동으로 찬다(공표가 + 고른 옵션). 중고 시세는 마스터에 없어 사람이 넣는다. */
  price?: number;
  /** 신차 — 고른 옵션과 조합규칙(있으면). */
  options?: { name: string; price: number }[];
  rules?: string[];
  /** 중고 — 그 세부모델의 생산 연식(「2019」~「2022」·「현재」). 시세를 짐작할 때 쓴다. */
  ys?: string; ye?: string;
  /**
   * 신차 — **고른 트림 원본**. 옵션 목록·조합규칙이 여기 들어 있다.
   * ★2026-09-08 부터 옵션은 «차 고르기 시트 밖»(왼쪽 `#sec-options` 칸)에서 고른다 —
   *   웰릭스 원본이 그 자리에 세우기 때문이다(사장님 「1번으로」).
   *   그래서 화면이 목록을 그리려면 트림을 통째로 들고 나와야 한다.
   * ⚠ 옵션이 밖에서 골리면 `price` 는 **옵션을 뺀 트림값**이다. 더하는 일은 화면이 한다.
   */
  newTrim?: NewTrim;
};

export type EngineFuel = 'gasoline' | 'diesel' | 'lpg' | 'hybrid' | 'ev';

/**
 * 마스터 연료 → 엔진 연료 키.
 * ⚠ 엔진이 아는 것은 다섯뿐이다(`data/cost-config.js` FUEL). 마스터에는 「바이퓨얼」·「플러그인 하이브리드」도 있다.
 *   플러그인 하이브리드는 **하이브리드**로, 바이퓨얼(가솔린+LPG)은 **LPG** 로 붙인다 —
 *   자동차세·취득세에서 그쪽이 실제와 가깝다. 모르면 가솔린(엔진 기본값).
 *   ★엔진에 연료가 늘면 여기부터 고친다. 화면에서 따로 번역하지 않는다.
 */
export function engineFuel(masterFuel: string | null | undefined): EngineFuel {
  const f = String(masterFuel ?? '').trim();
  const U = f.toUpperCase();
  /**
   * ⚠⚠ **영문 「EV」를 못 알아봤다**(2026-09-07 전수 검사에서 잡혔다).
   *   신차마스터가 기아 전기차의 연료를 **「EV」**로 싣는데 여기는 한글 「전기」만 봤다.
   *   그래서 **기아 EV3·EV4·EV5·EV6 가 통째로 «가솔린»으로 계산**됐다 —
   *   구매보조금도, 취득세 감면 140만도, 공채 면제도 **하나도 안 걸렸고**,
   *   자동차세를 cc 로 매기려다 배기량이 없어 0 이 됐다.
   * ⚠ 단어 경계로 본다 — 「PHEV」의 EV 는 전기차가 아니라 **플러그인 하이브리드**다.
   */
  if (f.includes('전기') || U.includes('ELECTRIC') || /(^|[^A-Z])EV([^A-Z]|$)/.test(U)) return 'ev';
  if (f.includes('플러그인') || f.includes('하이브리드') || U.includes('PHEV') || U.includes('HEV')) return 'hybrid';
  if (f.includes('바이퓨얼') || f.toUpperCase().includes('LPG')) return 'lpg';
  if (f.includes('디젤')) return 'diesel';
  return 'gasoline';
}

let cached: CarIndex | null = null;
let inflight: Promise<CarIndex> | null = null;

/** 슬림 인덱스 한 번만 받는다(103KB · gzip 15KB). 두 번째부터는 즉시. */
export function loadCarIndex(): Promise<CarIndex> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = fetch('/data/estimate-cars.json')
    .then((r) => { if (!r.ok) throw new Error(`차종 인덱스 HTTP ${r.status}`); return r.json() as Promise<CarIndex>; })
    .then((j) => {
      if (j.v !== 1 || !Array.isArray(j.cars) || !j.cars.length) throw new Error('차종 인덱스 형식이 잘못됐다');
      cached = j; return j;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

let newCached: NewModel[] | null = null;
let newInflight: Promise<NewModel[]> | null = null;

/** 신차 피드 — 모델별로 묶어서 한 번 받는다. */
export function loadNewModels(): Promise<NewModel[]> {
  if (newCached) return Promise.resolve(newCached);
  if (newInflight) return newInflight;
  newInflight = fetch('/api/newcar?group=model')
    .then((r) => { if (!r.ok) throw new Error(`신차 피드 HTTP ${r.status}`); return r.json() as Promise<{ models?: NewModel[] }>; })
    .then((j) => { const m = Array.isArray(j.models) ? j.models : []; newCached = m; return m; })
    .finally(() => { newInflight = null; });
  return newInflight;
}

/** 검색용 문자열 — 띄어쓰기·기호를 지우고 소문자로. 「그랜저ig」로도 「그랜저 IG」가 잡힌다. */
const norm = (v: string) => v.toLowerCase().replace(/[\s()·\-_.]/g, '');

/**
 * 세부모델 검색 — 제조사·모델·세부모델·세대·개발코드까지 한 칸에서 찾는다.
 * ★단어를 쪼개 **모두 들어맞는 것**만 남긴다(「현대 그랜저」가 두 낱말로 걸린다).
 */
export function searchCars(cars: CarEntry[], q: string, maker?: string, limit = 60): CarEntry[] {
  let list = maker ? cars.filter((c) => c.mk === maker) : cars;
  const words = q.trim().split(/\s+/).filter(Boolean).map(norm);
  if (words.length) {
    list = list.filter((c) => {
      const hay = norm(`${c.mk} ${c.md} ${c.sm} ${c.g} ${c.dc}`);
      return words.every((w) => hay.includes(w));
    });
  }
  return list.slice(0, limit);
}

/**
 * 신차 피드의 모델명을 **읽을 수 있게** — 기아는 영문 슬러그(`sorento`)로 온다.
 * ★피드는 안 고친다(외부 견적기도 쓰는 공개 규격). 화면에서만 한글로 보여 준다.
 *   별칭표에 없으면 **원문 그대로** — 없는 이름을 지어내지 않는다.
 */
export function koModel(al: Record<string, string> | undefined, subModel: string): string {
  if (!al) return subModel;
  return al[norm(subModel)] ?? subModel;
}

/** 「2022~2026」 · 「2026~현재」 */
export const carYears = (c: CarEntry) => [c.ys, c.ye].filter(Boolean).join('~');

/** 목록 한 줄의 부제 — 연식 · 원산지 · 연료 갈래. */
export function carSubtitle(c: CarEntry): string {
  const fuels = [...new Set(c.p.map((p) => p.f))].join('·');
  return [carYears(c), c.o, fuels].filter(Boolean).join(' · ');
}

/** 중고 — 고른 세부모델·파워트레인·트림을 한 대로 만든다. */
export function pickUsed(c: CarEntry, p: CarPt, trim: string): PickedCar {
  return {
    source: 'used',
    name: [c.mk, c.sm, trim].filter(Boolean).join(' '),
    meta: ['중고', carYears(c), p.pt].filter(Boolean).join(' · '),
    maker: c.mk, model: c.md, subModel: c.sm, trim, powertrain: p.pt,
    fuel: engineFuel(p.f), cc: p.cc,
    ys: c.ys, ye: c.ye,
  };
}

/**
 * **평균시세 짐작** — 사장님 2026-09-08 「평균시세가 있어?? **없으면 평균시세는 입력해주고
 * 바꿀 수 있게끔** 평균시세는 틀릴 수 있으니까」.
 *
 * ⚠⚠ **우리에게 시세 원장이 없다.** 차종마스터는 제원만 있고(260종·1,907트림) 값은 한 줄도 없다.
 *   그래서 «있는 것»으로 짚는다 — **신차 공표가 × 연식 잔가곡선**.
 *   ⇒ 이것은 «실거래 시세»가 아니라 **첫 숫자**다. 화면이 「추정」이라고 말하고, 사람이 고치면 그 값이 이긴다.
 *   ⇒ 못 짚으면 **0 을 주고 「모른다」고 한다.** 지어내지 않는다.
 *
 * ★왜 신차가인가 — 우리가 가진 유일한 «금액»이다(신차마스터 공표가).
 *   ★왜 잔가곡선인가 — 그 차가 몇 해 지났는지에 따라 값이 어떻게 빠지는지를 이미 그 곡선이 쥐고 있다.
 * ⚠ 이 값을 다시 잔가 계산에 넣어도 «돌지» 않는다 — 엔진은 시세를 «입력»으로만 쓴다.
 */
export function guessMarketPrice(models: NewModel[] | null, maker: string, model: string,
  age: number, curve: (years: number) => number, al?: Record<string, string>): number {
  if (!models?.length) return 0;
  const norm = (s: string) => String(s || '').replace(/\s+/g, '').toLowerCase();
  const want = norm(model);
  /* ⚠ 신차마스터는 기아 모델명을 **영문 슬러그**(`ray`)로 준다. 중고는 한글(`레이`)이다.
     한글로 바꿔서도 맞대 보지 않으면 기아가 통째로 안 잡힌다(2026-09-08 눌러 보고 잡음). */
  const names = (m: NewModel) => [norm(m.sub_model), norm(koModel(al, m.sub_model))];
  const hit = models.filter((m) => m.maker === maker
    && names(m).some((n) => n === want || n.includes(want) || want.includes(n)));
  if (!hit.length) return 0;
  // 트림이 여럿이면 **가운데 값**을 쓴다 — 최저트림은 너무 싸고 최고트림은 너무 비싸다.
  const prices = hit.flatMap((m) => m.trims.map((t) => Number(t.priceAfter) || Number(t.priceBefore) || 0))
    .filter((n) => n > 0).sort((a, b) => a - b);
  if (!prices.length) return 0;
  const mid = prices[Math.floor(prices.length / 2)];
  const pct = curve(Math.max(0, age));
  if (!(pct > 0)) return 0;
  // 만원 자리에서 끊는다 — 「23,487,913원」은 시세처럼 안 보인다.
  return Math.round(mid * (pct / 100) / 100000) * 100000;
}

/**
 * 신차 피드에는 **배기량이 없다**(제조사 「내 차 만들기」가 안 준다). 엔진은 자동차세·취득세에 cc 를 쓴다.
 * ⇒ 차종마스터에서 «같은 제조사 · 이름이 겹치는 세부모델 · 같은 연료»를 찾아 배기량을 빌려 온다.
 *   ⚠ 못 찾으면 `null` 을 낸다 — **지어내지 않는다.** 그때는 화면이 배기량 칸을 열어 사람에게 묻는다.
 *     0 으로 떨어뜨리면 자동차세가 «조용히» 0 이 되어, 아무도 모르는 채로 싸게 나간다.
 */
/**
 * 신차 연료 표기에서 **배기량**을 뽑는다 — 「3.5 가솔린」 · 「가솔린 2.5」 · 「LPi 3.5」 · 「1.6 가솔린 터보」.
 *
 * ★2026-09-07 — 신차마스터에 **배기량 필드가 없어** 중고 인덱스에서 이름으로 추측하고 있었는데,
 *   신차 모델명은 **영문 슬러그**(`carnival`·`seltos`)이고 중고 인덱스는 **한글**(「더 뉴 모닝 JA」)이라
 *   매칭이 근본적으로 안 됐다. 79 쌍 중 **32 가 null** 이었고, `Number(null)=0` 이라
 *   **자동차세가 조용히 0** 으로 빠졌다(`safe-calc` 도 유한수만 보므로 오류로 안 잡힌다).
 *
 * ★표시 리터는 반올림값이다(1.6 → 실제 1,598 · 2.5 → 2,497). 그래도 안전한 까닭은
 *   **세율 경계를 법대로 고쳤기** 때문이다 — 1,598 도 1,600 도 「1,600cc 이하」 한 구간,
 *   2,497 도 2,500 도 「2,500cc 이하」 한 구간이다(`data/cost-config.js` 머리말).
 *   ⚠ 경계를 되돌리면 이 반올림이 곧바로 세금 오류가 된다. 둘은 한 몸이다.
 *
 * ⚠ 못 뽑는 것도 있다 — 하이브리드 12(「하이브리드」만 적힘) · 제네시스 6(「가솔린」만 적힘).
 *   그때는 아래 중고 인덱스 폴백을 타고, 그래도 없으면 **화면이 배기량을 묻는다**(`manualCc`).
 *   지어내지 않는다. 전기차는 배기량이 없는 것이 정상이라 null 이 맞다.
 */
export function ccFromFuelLabel(fuel: string | null | undefined): number | null {
  const m = /(?:^|[^0-9.])([1-6]\.[0-9])(?![0-9])/.exec(String(fuel ?? ''));
  if (!m) return null;
  const liter = Number(m[1]);
  if (!Number.isFinite(liter) || liter <= 0) return null;
  return Math.round(liter * 1000);
}

export function guessCc(cars: CarEntry[], maker: string, subModel: string, fuel: string): number | null {
  // ★연료 표기에 리터가 있으면 그게 «원천»이다 — 남의 인덱스에서 이름으로 추측하는 것보다 낫다.
  const fromLabel = ccFromFuelLabel(fuel);
  if (fromLabel) return fromLabel;
  const want = norm(subModel);
  const ef = engineFuel(fuel);
  const hits: number[] = [];
  for (const c of cars) {
    if (c.mk !== maker) continue;
    const sm = norm(c.sm); const md = norm(c.md);
    if (!(want.includes(md) || sm.includes(want) || want.includes(sm))) continue;
    for (const p of c.p) {
      if (engineFuel(p.f) !== ef || !p.cc) continue;
      hits.push(p.cc);
    }
  }
  if (!hits.length) return null;
  // 여러 개면 «가장 많이 나온 값». 같은 모델의 주력 배기량이 답일 확률이 높다.
  const tally = new Map<number, number>();
  for (const cc of hits) tally.set(cc, (tally.get(cc) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/** 신차 — 고른 트림 + 옵션 합계가 곧 차량가다. */
export function pickNew(m: NewModel, t: NewTrim, chosen: { name: string; price: number }[], cc: number | null = null, koName?: string): PickedCar {
  const optSum = chosen.reduce((n, o) => n + (Number(o.price) || 0), 0);
  const label = koName || m.sub_model;
  return {
    source: 'new',
    name: [m.maker, label, t.trim].filter(Boolean).join(' '),
    meta: ['신차', t.fuel, chosen.length ? `옵션 ${chosen.length}개` : '기본'].filter(Boolean).join(' · '),
    // ★잔가 델타는 «모델» 이름으로 되짚는다 — 한글 이름이 있어야 표(residual-delta)와 맞는다.
    maker: m.maker, model: label, subModel: label, trim: t.trim, powertrain: t.fuel,
    fuel: engineFuel(t.fuel), cc,   // 없으면 null → 화면이 배기량을 묻는다(위 `guessCc` 주석)
    price: (Number(t.priceAfter) || Number(t.priceBefore) || 0) + optSum,
    options: chosen,
    rules: t.rules,
    newTrim: t,
  };
}
