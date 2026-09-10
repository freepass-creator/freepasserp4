/**
 * 원본(웰릭스) **ID 대응표**를 만든다 — 이름 짐작을 코드에서 걷어내는 첫 걸음.
 *
 * ★★사장님 2026-09-10 「예전에 다 만들어놨던 거잖아 … AI 네 개 다 동원해」 → 원본 대조 ①번.
 *
 * 왜 필요한가 — 우리는 지금 «이름»으로 원본을 찾는다:
 *   세부모델은 이름 포함관계로, 트림은 「Modern ↔ 모던」을 몰라 42%를 못 맞댔고,
 *   그 자리를 메우려고 내가 **별칭표·엔진 정규식·산문 파싱**을 지어냈다.
 *   원본에는 `manufacturer_id` · `model_id` · `variant_id` · `trim_id` 가 **다 있다**
 *   (3 · 25 · 83 · 253). ID 로 맞추면 지어낸 것들이 통째로 없어진다.
 *
 * ⚠⚠ **이 도구는 짐작을 «파일»로 옮길 뿐이다.** 코드가 매번 새로 짐작하지 않게 하는 것이 목적이고,
 *   짐작 자체가 사라지는 것은 아니다. 그래서:
 *     · 확실한 것만 `map` 에 넣는다(정확 일치 · 꼬리 뗀 일치 · trim_id 일치).
 *     · **갈리거나 못 찾은 것은 `unmatched` 에 그대로 남긴다.** 지어내서 채우지 않는다.
 *     · 사람이 `map` 을 손보면 그 값이 이긴다(`_pinned: true` 를 달면 재생성이 안 덮는다).
 *
 *   npx tsx scripts/build-welrix-id-map.mts          # 미리보기
 *   npx tsx scripts/build-welrix-id-map.mts --write  # data/new-car/welrix-id-map.json 에 쓰기
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';

const WRITE = process.argv.includes('--write');
const OUT = 'data/new-car/welrix-id-map.json';
const DB = 'C:/dev/welrixtable/public/vehicle-db.js';
const FEED = 'tmp/feed.json';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/[\s\-_()·]/g, '');
/** 꼬리(「(2WD)」·「(1인승 밴)」)를 떼고 고른다 — 원본 트림엔 꼬리가 없다. */
const bare = (v: unknown) => N(S(v).replace(/\([^)]*\)\s*$/, ''));

type Trim = { trim_id?: string; name?: string; base_price_5?: number };
type Variant = { variant_id?: string; variant_name?: string; fuel?: string; displacement_cc?: number; trims?: Trim[] };
type Model = { model_id?: string; model_name?: string; variants?: Variant[] };
type Maker = { manufacturer_id?: string; manufacturer_name?: string; models?: Model[] };

/** 원본은 사람이 읽는 JS 다 — 평가해서 객체로 받는다(네트워크·부작용 없음).
 *  ⚠ 원본은 `window.VEHICLE_DB` 에 단다. 인제스터와 «같은 방식»으로 읽는다. */
function loadDb(): Maker[] {
  const ctx: Record<string, unknown> = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(DB, 'utf8'), ctx);
  const db = (((ctx.window as Record<string, unknown>).VEHICLE_DB ?? ctx.VEHICLE_DB) ?? {}) as { manufacturers?: Maker[] };
  return db.manufacturers ?? [];
}

export type Row = { id?: string; maker?: string; sub_model?: string; fuel?: string; trim?: string; priceBefore?: number };
export type Hit = {
  manufacturer_id: string; model_id: string; variant_id: string; trim_id: string;
  /** 사람이 읽는 이름 — id 만으론 무슨 차인지 모른다. */
  _label?: string;
  /** 어떻게 맞췄나 — 「이름」·「꼬리뗌」·「trim_id」. 사람이 볼 때 근거가 된다. */
  how: string;
};

/** 연료말 — 원본 variant 는 「가솔린」·「전기」처럼 적는다. */
const fuelWord = (t: string) => /(가솔린|디젤|하이브리드|전기|수소|LPG|LPi)/i.exec(S(t))?.[1] ?? '';
const disp = (t: string) => /([1-6]\.[0-9])/.exec(S(t))?.[1] ?? '';

/**
 * 못 맞춘 «까닭»을 갈래로 답한다 — 고칠 방법이 갈래마다 다르다.
 *   `모델없음`  원본에 그 세부모델이 아예 없다 → 평면 옵션으로 두는 것이 맞다(옮길 것이 없다)
 *   `연료없음`  모델은 있는데 그 파워트레인(variant)이 없다 → 위와 같다
 *   `트림이름`  variant 까지 찾았는데 **트림 이름이 안 맞는다** → **사람이 정하면 끝나는 것**
 *
 * ⚠ 갈래를 안 나누면 「원본에 없는 것」과 「이름만 다른 것」이 한 무더기가 되어,
 *   **있는 규칙도 못 옮긴 채 「267줄 실패」로 뭉개진다.**
 */
export type Why = { why: '모델없음' | '연료없음' | '트림없음' | '이름다름'; near: string[] };

export function whyNot(makers: Maker[], row: Row): Why {
  const mk = makers.find((m) => N(m.manufacturer_name) === N(row.maker));
  const models = (mk?.models ?? []).filter((m) =>
    N(m.model_name) === N(row.sub_model)
    || N(m.model_name).includes(N(row.sub_model))
    || N(row.sub_model).includes(N(m.model_name)));
  if (!models.length) {
    const head = N(row.sub_model).slice(0, 2);
    const near = (mk?.models ?? []).map((m) => S(m.model_name))
      .filter((n) => n && (N(n).includes(head) || N(row.sub_model).includes(N(n).slice(0, 2))))
      .slice(0, 4);
    return { why: '모델없음', near };
  }
  const vs = models.flatMap((m) => (m.variants ?? []).map((v) => ({ m, v })));
  const fit = vs.filter(({ v }) => {
    const fw = fuelWord(S(v.fuel) || S(v.variant_name));
    if (fw && fuelWord(S(row.fuel)) && fw !== fuelWord(S(row.fuel))) return false;
    const d1 = disp(S(v.variant_name));
    const d2 = disp(S(row.fuel));
    return !(d1 && d2 && d1 !== d2);
  });
  if (!fit.length) return { why: '연료없음', near: vs.map(({ v }) => S(v.variant_name)).slice(0, 4) };
  /* variant 는 있다. 이제 둘로 갈린다:
       `이름다름`  비슷한 이름이 «있다» → **사람이 짝지으면 끝난다**
       `트림없음`  비슷한 것이 하나도 없다 → **원본에 그 트림이 아예 없다**(옮길 것이 없다)
     ⚠ 둘을 한 무더기로 두면 「사람이 할 일」이 부풀어 보인다 — 실제로 할 일만 남긴다. */
  const trims = fit.flatMap(({ v }) => (v.trims ?? []));
  const mineN = bare(row.trim);
  const 닮음 = (t: Trim) => {
    const a = bare(t.name); const b = N(t.trim_id);
    if (!a && !b) return false;
    return a === mineN || b === mineN
      || (mineN.length >= 2 && (a.includes(mineN) || mineN.includes(a)))
      || (mineN.length >= 2 && b && (b.includes(mineN) || mineN.includes(b)));
  };
  const near = [...new Set(trims.map((t) => S(t.name) + '(' + S(t.trim_id) + ')'))];
  return trims.some(닮음)
    ? { why: '이름다름', near: near.slice(0, 8) }
    : { why: '트림없음', near: near.slice(0, 8) };
}
/**
 * 우리 한 줄에 맞는 원본 ID 넷. **확실할 때만** 답한다.
 * ⚠ 갈리면 `null` — 지어내면 남의 차 규칙이 붙는다(이번 세션에 그 사고를 여러 번 냈다).
 */
export function findIds(makers: Maker[], row: Row): Hit | null {
  const mk = makers.find((m) => N(m.manufacturer_name) === N(row.maker));
  if (!mk) return null;
  const models = (mk.models ?? []).filter((m) =>
    N(m.model_name) === N(row.sub_model) || N(m.model_name).includes(N(row.sub_model)) || N(row.sub_model).includes(N(m.model_name)));
  if (!models.length) return null;

  /* variant — 연료말이 같아야 하고, 배기량은 «둘 다 있을 때만» 본다. */
  const cands0: { m: Model; v: Variant }[] = [];
  for (const m of models) {
    for (const v of m.variants ?? []) {
      const fw = fuelWord(S(v.fuel) || S(v.variant_name));
      if (fw && fuelWord(S(row.fuel)) && fw !== fuelWord(S(row.fuel))) continue;
      const d1 = disp(S(v.variant_name)); const d2 = disp(S(row.fuel));
      if (d1 && d2 && d1 !== d2) continue;
      cands0.push({ m, v });
    }
  }
  if (!cands0.length) return null;

  /* ★★**인승·밴은 «variant» 축이다** — 원본이 variant 이름에 담는다(「가솔린 1.0 (밴 1인승)」).
     우리는 그것을 **트림 꼬리**에 담는다(「트렌디(1인승 밴)」). 그래서 트림 이름만 보면
     밴 1인승·2인승이 둘 다 걸려 «갈린다»고 버려졌다 — 실측 99줄 중 상당수가 그것이었다.
     ⇒ 꼬리의 인승·밴을 variant 이름과 맞대 «먼저 좁힌다». 못 좁히면 예전 그대로 둔다. */
  const axis = (t: string) => {
    const x = S(t);
    const seat = /(\d{1,2})\s*인승/.exec(x)?.[1] ?? '';
    const van = /밴/.test(x) ? '밴' : '';
    return { seat, van };
  };
  /* ★인승·구동은 이제 **파워트레인 이름**에도 있다(「가솔린 2.5 · 7인승 · 4WD」).
     트림 꼬리와 연료말 «둘 다» 보고 좁힌다 — 어느 쪽에 적혀 있든 같은 축이다. */
  const mine = (() => {
    const a = axis(row.trim); const b = axis(row.fuel);
    return { seat: a.seat || b.seat, van: a.van || b.van };
  })();
  const narrowed = (mine.seat || mine.van)
    ? cands0.filter(({ v }) => {
      const a = axis(S(v.variant_name));
      if (mine.van !== a.van) return false;              // 밴↔승용은 다른 차다
      return !(mine.seat && a.seat && mine.seat !== a.seat);
    })
    /* ★★**밴 표시가 «없으면» 승용이다.** 원본은 「가솔린 1.0 (승용)」·「(밴 1인승)」·「(밴 2인승)」
       셋으로 두는데, 우리 승용 줄에는 아무 표시가 없어 셋 다 걸려 «갈린다»고 버려졌다
       (레이·모닝 등 · 2026-09-11). ⇒ 표시가 없으면 **밴이 아닌 것**만 본다. */
    : cands0.filter(({ v }) => !axis(S(v.variant_name)).van);
  const cands = narrowed.length ? narrowed : cands0;

  /* 트림 — 이름 → trim_id → 꼬리 뗀 것. 갈리면 안 고른다. */
  for (const [how, pick] of [
    ['이름', (t: Trim) => N(t.name) === N(row.trim)],
    ['trim_id', (t: Trim) => N(t.trim_id) === N(row.trim)],
    ['꼬리뗌', (t: Trim) => N(t.name) === bare(row.trim) || N(t.trim_id) === bare(row.trim)],
    ['꼬리뗌2', (t: Trim) => bare(t.name) === bare(row.trim)],
  ] as [string, (t: Trim) => boolean][]) {
    const hits = cands.flatMap(({ m, v }) => (v.trims ?? []).filter(pick).map((t) => ({ m, v, t })));
    if (!hits.length) continue;
    /* ⚠ 여럿이어도 «같은 곳»을 가리키면 애매한 것이 아니다(공유 객체·중복 등재).
       서로 다른 곳을 가리킬 때만 «갈린다»고 보고 안 고른다. */
    const uniq = new Set(hits.map((h) => `${S(h.m.model_id)}|${S(h.v.variant_id)}|${S(h.t.trim_id)}`));
    if (uniq.size !== 1) continue;
    const { m, v, t } = hits[0];
    return {
      manufacturer_id: S(mk.manufacturer_id), model_id: S(m.model_id),
      variant_id: S(v.variant_id), trim_id: S(t.trim_id), how,
    };
  }
  return null;
}

/**
 * 우리 한 줄의 «열쇠» — 대응표의 키.
 * ★**줄의 제 id 가 있으면 그것이다.** 네 칸(제조사·세부모델·연료·트림)은 **유일하지 않다** —
 *   447줄이 298개로 뭉갠다(스타리아 Modern 이 9인승·11인승 세 줄인데 하나가 된다).
 * ⚠ id 가 없으면 네 칸으로 물러서되, 그런 줄은 «겹칠 수 있다»는 것을 알고 쓴다.
 */
export const rowKey = (r: Row) =>
  (S(r.id) ? S(r.id) : [S(r.maker), S(r.sub_model), S(r.fuel), S(r.trim)].join(' | '));
/** 사람이 읽는 이름 — 표에 같이 적어 둔다(id 만으론 무슨 차인지 모른다). */
export const rowLabel = (r: Row) => [S(r.maker), S(r.sub_model), S(r.fuel), S(r.trim)].join(' | ');

/**
 * ★★**제안** — 「이름은 같은데 여럿이 걸려 갈리는」 줄을 «값 순서»로 짝지어 본다.
 *
 * 왜 이게 되나 — 원본도 우리도 **같은 제조사 가격표**다. 연식이 달라 값은 안 맞지만
 *   («팰리세이드 익스클루시브» 우리 4,478만 ↔ 원본 4,383만) **순서와 간격은 남는다**:
 *     우리   9인승 4,478 · 7인승 4,610   (차 132만)
 *     원본   9인승 4,383 · 7인승 4,516   (차 133만)
 *   ⇒ 값이 싼 것부터 차례로 짝지으면 맞는다.
 *
 * ⚠⚠ **이것은 «확정»이 아니다.** 그래서 `map` 에 넣지 않고 `proposed` 에 따로 담는다.
 *   사람이 보고 옳으면 `map` 으로 옮기고 `_pinned: true` 를 단다.
 *   ⚠ 개수가 다르면 제안하지 않는다 — 짝이 안 맞는데 억지로 붙이면 남의 차 규칙이 붙는다.
 *   ⚠ 우리 쪽 값이 없는 줄이 하나라도 있으면 제안하지 않는다(순서를 못 세운다).
 */
export type Proposal = {
  key: string; label: string;
  manufacturer_id: string; model_id: string; variant_id: string; trim_id: string;
  근거: string;
};

export function proposeByPriceOrder(
  makers: Maker[],
  rows: (Row & { priceBefore?: number })[],
): Proposal[] {
  const out: Proposal[] = [];
  const nToOne: string[] = [];
  /* 「제조사·세부모델·연료·트림 이름」이 같은 줄끼리 묶는다 — 이 안에서 순서를 센다. */
  const groups = new Map<string, (Row & { priceBefore?: number })[]>();
  for (const r of rows) {
    const g = [S(r.maker), S(r.sub_model), S(r.fuel), N(r.trim)].join('|');
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(r);
  }
  for (const [, rs] of groups) {
    if (rs.length < 2) continue;                       // 하나면 애초에 안 갈린다
    if (rs.some((r) => !(Number(r.priceBefore) > 0))) continue;   // 값이 없으면 순서를 못 센다
    const row0 = rs[0];
    const mk = makers.find((m) => N(m.manufacturer_name) === N(row0.maker));
    if (!mk) continue;
    const models = (mk.models ?? []).filter((m) =>
      N(m.model_name) === N(row0.sub_model)
      || N(m.model_name).includes(N(row0.sub_model))
      || N(row0.sub_model).includes(N(m.model_name)));
    /* 그 이름의 트림을 가진 variant 를 다 모은다 — 연료말이 맞는 것만. */
    const hits: { m: Model; v: Variant; t: Trim; price: number }[] = [];
    for (const m of models) {
      for (const v of m.variants ?? []) {
        const fw = fuelWord(S(v.fuel) || S(v.variant_name));
        if (fw && fuelWord(S(row0.fuel)) && fw !== fuelWord(S(row0.fuel))) continue;
        for (const t of v.trims ?? []) {
          if (N(t.name) !== N(row0.trim) && N(t.trim_id) !== N(row0.trim)) continue;
          const p = Number((t as { base_price_5?: number }).base_price_5) || 0;
          if (p > 0) hits.push({ m, v, t, price: p });
        }
      }
    }
    /* ⚠⚠ **개수가 다르면 제안하지 않는다.** 실측 — 팰리세이드 익스클루시브는 우리 **8줄**인데
       원본은 **2개**(9인승·7인승)다. 우리가 구동·인승을 더 잘게 쪼개 놓아 **1:1 이 아니라 N:1** 이다.
       그런 자리는 「값 순서」로 못 푼다 — 억지로 붙이면 남의 트림 규칙이 붙는다.
       ⇒ 그대로 `unmatchedDetail.트림이름` 에 남겨 **사람이 정하게** 한다. */
    if (hits.length !== rs.length) { nToOne.push(`${S(row0.maker)} ${S(row0.sub_model)} ${S(row0.fuel)} ${S(row0.trim)} — 우리 ${rs.length}줄 ↔ 원본 ${hits.length}개`); continue; }
    const ours = [...rs].sort((a, b) => (Number(a.priceBefore) || 0) - (Number(b.priceBefore) || 0));
    const theirs = [...hits].sort((a, b) => a.price - b.price);
    for (let i = 0; i < ours.length; i++) {
      const r = ours[i]; const h = theirs[i];
      out.push({
        key: rowKey(r), label: rowLabel(r),
        manufacturer_id: S(mk.manufacturer_id), model_id: S(h.m.model_id),
        variant_id: S(h.v.variant_id), trim_id: S(h.t.trim_id),
        근거: `값 순서 ${i + 1}/${ours.length} — 우리 ${Math.round((Number(r.priceBefore) || 0) / 10000)}만 ↔ 원본 ${h.price}만 (${S(h.v.variant_name)})`,
      });
    }
  }
  if (nToOne.length) {
    console.log(`
  ⚠ 1:1 이 아닌 자리 ${nToOne.length}묶음 — 우리가 원본보다 잘게 쪼개져 있다(사람이 정할 것)`);
    for (const x of nToOne.slice(0, 5)) console.log(`      ${x}`);
  }
  return out;
}

async function main() {
  const makers = loadDb();
  const feed = JSON.parse(readFileSync(FEED, 'utf8')) as { trims: Row[] };
  const rows = feed.trims ?? [];

  /* 사람이 손본 것은 «덮지 않는다» — `_pinned: true` 가 그 표시다. */
  const prev = existsSync(OUT)
    ? (JSON.parse(readFileSync(OUT, 'utf8')) as { map?: Record<string, Hit & { _pinned?: boolean }> }).map ?? {}
    : {};

  const map: Record<string, Hit & { _pinned?: boolean }> = {};
  const unmatched: string[] = [];
  const detail: Record<string, { key: string; label: string; near: string[] }[]> = {};
  const byHow: Record<string, number> = {};
  for (const r of rows) {
    const k = rowKey(r);
    if (prev[k]?._pinned) { map[k] = prev[k]; byHow['사람이 정함'] = (byHow['사람이 정함'] ?? 0) + 1; continue; }
    const hit = findIds(makers, r);
    if (!hit) {
      const w = whyNot(makers, r);
      unmatched.push(k + '  ·  ' + rowLabel(r));
      (detail[w.why] ??= []).push({ key: k, label: rowLabel(r), near: w.near });
      continue;
    }
    map[k] = { ...hit, _label: rowLabel(r) } as Hit & { _pinned?: boolean };
    byHow[hit.how] = (byHow[hit.how] ?? 0) + 1;
  }

  console.log(`우리 줄 ${rows.length} · 맞춘 것 ${Object.keys(map).length} · 못 맞춘 것 ${unmatched.length}`);
  for (const [how, n] of Object.entries(byHow).sort((a, b) => b[1] - a[1])) console.log(`  ${how} — ${n}`);
  const 갈린줄 = new Set((detail['트림이름'] ?? []).map((x) => x.key));
  const proposed = proposeByPriceOrder(makers, rows.filter((r) => 갈린줄.has(rowKey(r))));
  console.log('제안 — 값 순서로 짝지음 (★확정 아님 · 사람이 보고 map 으로 옮긴다): ' + proposed.length + '줄');
  for (const x of proposed.slice(0, 4)) console.log('      ' + x.label + '  →  ' + x.variant_id + '/' + x.trim_id + '   ' + x.근거);

  console.log('\n못 맞춘 까닭 — 갈래별');
  for (const [why, arr] of Object.entries(detail).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${why} — ${arr.length}줄`);
    for (const x of arr.slice(0, 3)) {
      const near = x.near.length ? `   ← 가까운 것: ${x.near.slice(0, 4).join(' · ')}` : '';
      console.log(`      ${x.label}${near}`);
    }
  }

  /* ★★**원본이 「폐지」(`operating:false`)라 한 트림에 붙은 줄 — «기록만» 한다.**
     ⚠⚠ 지우지 않는다. 우리 원천은 **제조사 현재 가격표**(hyundai.json·kia)이고 원본은 그보다 낡았다
       ([[mtops-price-staleness]] — 「현재가 정본은 제조사」). 원본이 폐지라 해도 제조사가 아직 팔면
       **파는 차를 우리가 없애는 것**이 된다 — 이 세션에서 「지우는 쪽」으로 다섯 번 사고 났다.
     ★대신 «그 줄의 옵션판이 낡았을 수 있다»는 표시로 남겨, 사람이 볼 수 있게 한다. */
  const stale: string[] = [];
  for (const [k, v] of Object.entries(map)) {
    const mk2 = makers.find((m) => S(m.manufacturer_id) === S(v.manufacturer_id));
    const mo2 = (mk2?.models ?? []).find((m) => S(m.model_id) === S(v.model_id));
    const va2 = (mo2?.variants ?? []).find((x) => S(x.variant_id) === S(v.variant_id));
    const t2 = (va2?.trims ?? []).find((x) => S(x.trim_id) === S(v.trim_id)) as { operating?: boolean } | undefined;
    if (t2 && t2.operating === false) stale.push(`${k}  ·  ${S((v as { _label?: string })._label)}`);
  }
  if (stale.length) {
    console.log(`
원본이 «폐지»라 한 트림에 붙은 줄 — ${stale.length}줄 (★지우지 않는다)`);
    for (const x of stale.slice(0, 4)) console.log(`      ${x}`);
  }

  if (!WRITE) { console.log('\n(미리보기 — 쓰려면 --write)'); return; }
  mkdirSync('data/new-car', { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({
    _설명: '원본(웰릭스) ID 대응표. 이름 짐작을 코드에서 걷어내려고 «파일»로 고정한다.',
    _규칙: '확실한 것만 담는다. 갈리면 unmatched 에 남긴다. 사람이 고친 줄에 _pinned:true 를 달면 재생성이 안 덮는다.',
    _만든날: new Date().toISOString().slice(0, 10),
    map, proposed, unmatched, unmatchedDetail: detail,
    /** 원본이 폐지라 한 트림에 붙은 줄 — «기록만». 지우는 데 쓰지 않는다(위 주석). */
    staleTrims: stale,
  }, null, 2)}\n`);
  console.log(`\n→ ${OUT}`);
}

if (!process.env.VITEST) await main();
