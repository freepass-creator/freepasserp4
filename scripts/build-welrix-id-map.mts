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

type Trim = { trim_id?: string; name?: string };
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

export type Row = { id?: string; maker?: string; sub_model?: string; fuel?: string; trim?: string };
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
  const cands: { m: Model; v: Variant }[] = [];
  for (const m of models) {
    for (const v of m.variants ?? []) {
      const fw = fuelWord(S(v.fuel) || S(v.variant_name));
      if (fw && fuelWord(S(row.fuel)) && fw !== fuelWord(S(row.fuel))) continue;
      const d1 = disp(S(v.variant_name)); const d2 = disp(S(row.fuel));
      if (d1 && d2 && d1 !== d2) continue;
      cands.push({ m, v });
    }
  }
  if (!cands.length) return null;

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
  const byHow: Record<string, number> = {};
  for (const r of rows) {
    const k = rowKey(r);
    if (prev[k]?._pinned) { map[k] = prev[k]; byHow['사람이 정함'] = (byHow['사람이 정함'] ?? 0) + 1; continue; }
    const hit = findIds(makers, r);
    if (!hit) { unmatched.push(`${k}  ·  ${rowLabel(r)}`); continue; }
    map[k] = { ...hit, _label: rowLabel(r) } as Hit & { _pinned?: boolean };
    byHow[hit.how] = (byHow[hit.how] ?? 0) + 1;
  }

  console.log(`우리 줄 ${rows.length} · 맞춘 것 ${Object.keys(map).length} · 못 맞춘 것 ${unmatched.length}`);
  for (const [how, n] of Object.entries(byHow).sort((a, b) => b[1] - a[1])) console.log(`  ${how} — ${n}`);
  console.log('\n못 맞춘 줄(앞 15):');
  for (const k of unmatched.slice(0, 15)) console.log(`  ⚠ ${k}`);

  if (!WRITE) { console.log('\n(미리보기 — 쓰려면 --write)'); return; }
  mkdirSync('data/new-car', { recursive: true });
  writeFileSync(OUT, `${JSON.stringify({
    _설명: '원본(웰릭스) ID 대응표. 이름 짐작을 코드에서 걷어내려고 «파일»로 고정한다.',
    _규칙: '확실한 것만 담는다. 갈리면 unmatched 에 남긴다. 사람이 고친 줄에 _pinned:true 를 달면 재생성이 안 덮는다.',
    _만든날: new Date().toISOString().slice(0, 10),
    map, unmatched,
  }, null, 2)}\n`);
  console.log(`\n→ ${OUT}`);
}

if (!process.env.VITEST) await main();
