/**
 * 신차 «옵션 조합» 적재 — 배타그룹 · 선행필수 · 배제를 정본(`new_car_trim`)에 싣는다.
 *
 * ★★사장님 2026-09-09 「야 **옵션은 명확하게 다 구현하는 게 웰릭스 테이블에 있는데**」 · 「제대로 쌓아올려봐」
 *
 * 맞는 말씀이다. `C:\dev\welrixtable/public/vehicle-db.js`(371KB)에 손으로 정리돼 있다 —
 *   세부모델 83/83 에 `options_master`, 트림 253/253 에 `available_options`,
 *   배타그룹 41 · 배제 19. 로직도 `mobile/StepVehicle.vue` 에 다 있다.
 *
 * ★붙는 자리는 «세부모델(variant)»이다 — 옵션표·배타·배제가 다 거기 달려 있고,
 *   트림에는 `available_options`(그 트림에서 고를 수 있는 것) 만 있다.
 *   ⇒ **모델 + 연료**만 맞으면 붙는다. 트림까지 안 맞아도 된다.
 *     (2026-09-09 실측 — 트림까지 맞추면 111/447, 세부모델 단위면 **277/447**)
 *
 * ⚠ 연료는 «연료말»만 반드시 같고 배기량은 «둘 다 있을 때만» 본다 —
 *   우리 「하이브리드」에 배기량이 없는 줄이 있다(원천이 안 준다. 지어내지 않는다).
 *
 * ⚠⚠ **이중 계상을 막는다.** 웰릭스는 그랜저를 「가솔린 2.5/3.5」 **한 세부모델**로 묶고
 *   3.5 엔진을 «옵션»(`engine_3_5` +247만)으로 둔다. 우리 마스터는 연료가 이미 갈려 있어
 *   「가솔린 3.5」 트림에 그 옵션을 또 붙이면 **엔진값을 두 번 받는다.**
 *   ⇒ 그 차가 이미 그 엔진이면 옵션에서 빼고 `impliedOptions` 에 남긴다 —
 *     그 옵션을 `requires` 로 요구하던 것들(HTRAC 등)은 «이미 충족»으로 봐야 하기 때문이다.
 *
 * ★값 단위 — 웰릭스는 **만원**(`price: 247` = 247만)이다. 우리 규격은 **원**이라 ×10,000 한다.
 *
 * 실행 : npx tsx scripts/ingest-newcar-options.mts          (드라이런)
 *        npx tsx scripts/ingest-newcar-options.mts --apply  (Firestore 에 merge)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';
import { impliedByFuel, impliedByTrim, impliedOf } from '../lib/domain/estimate/implied-options';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/[\s\-_()·]/g, '');

// ── 웰릭스 조합지도를 읽는다(브라우저 전역에 붙는 파일이라 vm 으로 태운다) ──────────
const ctx: Record<string, unknown> = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(readFileSync('C:/dev/welrixtable/public/vehicle-db.js', 'utf8'), ctx);
const db = ((ctx.window as Record<string, unknown>).VEHICLE_DB ?? ctx.VEHICLE_DB) as {
  manufacturers: { manufacturer_name: string; models: { model_name: string; variants: Variant[] }[] }[];
};

type Opt = { name?: string; sub?: string; price?: number; requires?: string[]; requires_in_trim?: Record<string, string[]>; trim_prices?: Record<string, number> };
type Variant = {
  variant_name?: string;
  options_master?: Record<string, Opt>;
  exclusive_groups?: { id?: string; label?: string; members?: string[] }[];
  option_excludes?: Record<string, string[]>;
  /** ★variant 층의 트림별 선행 — 원본 팰리세이드가 `PALISADE_REQUIRES_9` 로 이렇게 둔다.
      옵션 층(`opt.requires_in_trim`)과 «같은 뜻»이라 합쳐서 읽는다(원본 index.html:1119 도 한 자리에서 본다). */
  requires_in_trim?: Record<string, Record<string, string[]>>;
  trims?: { name?: string; available_options?: string[]; trim_id?: string }[];
};

const word = (t: string) => /전기|EV/i.test(t) ? 'ev' : /하이브리드|HEV/i.test(t) ? 'hev'
  : /LP[GI]/i.test(t) ? 'lpg' : /디젤/.test(t) ? 'diesel' : /가솔린/.test(t) ? 'gas' : '';
const disp = (t: string) => /([1-6]\.[0-9])/.exec(S(t))?.[1] ?? '';
/** 이름에 담긴 배기량을 «다» 모은다 — 웰릭스 세부모델은 「가솔린 2.5/3.5」처럼 둘을 담기도 한다. */
const allDisp = (t: string) => [...S(t).matchAll(/([1-6]\.[0-9])/g)].map((m) => m[1]);

/**
 * 연료말은 반드시 같고, 배기량은 «둘 다 있을 때만» 본다.
 * ★세부모델 이름이 두 배기량을 담으면(「가솔린 2.5/3.5」) 우리 것이 그 안에 있으면 맞는 것으로 본다 —
 *   그 세부모델이 두 엔진을 «한 판»으로 다루고 큰 엔진을 옵션으로 파는 짜임이기 때문이다.
 */
export const fuelMatches = (variantName: string, fuel: string) => {
  if (word(variantName) !== word(fuel) || !word(fuel)) return false;
  const xs = allDisp(variantName); const y = disp(fuel);
  return !xs.length || !y || xs.includes(y);
};

export type OptionPack = {
  optionsMaster: Record<string, { name: string; sub?: string; price: number; requires?: string[] }>;
  exclusiveGroups: { id: string; label: string; members: string[] }[];
  optionExcludes: Record<string, string[]>;
  availableOptions: string[];
  impliedOptions: string[];
  /** 원본 `trim_id` — `requiresInTrim` 을 고르는 열쇠. 이름이 아니다. */
  trimKey?: string;
  optionSource: string;
};

/** 우리 한 줄(maker·sub_model·fuel·trim)에 붙일 옵션 꾸러미. 못 붙으면 `null`. */
/**
 * ★★★**ID 대응표가 있으면 그대로 쓴다** — 이름 짐작을 코드에서 걷어낸다.
 *   `data/new-car/welrix-id-map.json` 은 줄 id → 원본 ID 넷(`model_id`·`variant_id`·`trim_id`).
 *   ⚠ 표에 없는 줄은 **예전처럼 이름으로** 찾는다(있는 것을 없앤 게 아니라 «먼저 보는 것»을 바꾼다).
 *   ⚠ 표는 `scripts/build-welrix-id-map.mts` 가 만든다. 사람이 고친 줄(`_pinned`)은 안 덮는다.
 */
type IdHit = { model_id?: string; variant_id?: string; trim_id?: string };
const idMap: Record<string, IdHit> = (() => {
  try {
    const j = JSON.parse(readFileSync('data/new-car/welrix-id-map.json', 'utf8')) as { map?: Record<string, IdHit> };
    return j.map ?? {};
  } catch { return {}; }
})();

export function packFor(maker: string, subModel: string, fuel: string, trim: string, rowId?: string): OptionPack | null {
  const pin = rowId ? idMap[rowId] : undefined;
  for (const m of db.manufacturers) {
    if (m.manufacturer_name !== maker) continue;
    for (const md of m.models ?? []) {
      /* 표가 가리키면 그 모델만 본다. 없으면 예전처럼 이름 포함관계로 훑는다. */
      if (pin?.model_id) { if (S((md as { model_id?: string }).model_id) !== pin.model_id) continue; }
      else {
        const a = N(subModel); const b = N(md.model_name);
        if (!a.includes(b) && !b.includes(a)) continue;
      }
      for (const v of md.variants ?? []) {
        if (pin?.variant_id) { if (S((v as { variant_id?: string }).variant_id) !== pin.variant_id) continue; }
        else if (!fuelMatches(S(v.variant_name), fuel)) continue;
        const om = v.options_master ?? {};
        if (!Object.keys(om).length) continue;

        /* ⚠ «이미 산 것»을 먼저 다 골라낸다 — 뒤에서 `requires` 를 지울 때 그 목록이 완성돼 있어야 한다.
           앞서는 훑으면서 채우고 있어서, 뒤에 나온 implied 를 앞 옵션의 선행에서 못 지웠다. */
        const implied = Object.entries(om)
          .filter(([id, o]) => impliedByFuel(id, o, fuel) || impliedByTrim(id, o, trim))
          .map(([id]) => id);
        /* ⚠ 트림 열쇠를 «먼저» 구한다 — 옵션값이 그 열쇠에 달려 있다. */
        /* ★★**꼬리를 떼고 맞댄다** — 우리 트림은 「X-Line**(2WD)**」·「프레스티지**(전자식4WD)**」·
           「트렌디**(1인승 밴)**」처럼 구동·인승 꼬리가 붙어 있는데, 원본 트림은 「X-Line」이다.
           ⚠⚠ 꼬리 때문에 **282줄 중 118줄이 트림을 못 맞대** 기본값·합집합으로 떨어졌다.
             그래서 쏘렌토 X-Line**(2WD)** 이 컴포트 패키지를 **109만**(진짜 60만)에 팔고 있었다
             — **49만 과대**(2026-09-10 개발센터 4-AI 원본 대조).
           ⚠ 먼저 «그대로» 맞대고, 없을 때만 꼬리를 뗀다 — 꼬리가 «진짜 다른 트림»일 수도 있다. */
        /* ★★**트림을 못 맞대면 규칙이 통째로 안 온다** — 282줄 중 **118줄(42%)**이 그랬다.
           까닭이 둘이었다(2026-09-10 개발센터 4-AI 원본 대조):
             ① **이름 갈래가 다르다** — 우리 `Modern` ↔ 원본 「모던」.
                원본은 `trim_id`(`modern`)를 갖고 있으니 **영문은 그걸로 맞댄다.**
             ② **꼬리가 붙어 있다** — 「X-Line**(2WD)**」·「트렌디**(1인승 밴)**」.
                ⚠ 예전 판은 `N()` 이 괄호를 «먼저» 지워 꼬리 제거가 아예 안 먹었다.
                  그래서 쏘렌토 X-Line(2WD)이 컴포트 패키지를 **109만**(진짜 60만)에 팔았다.
           ⚠ 순서를 지킨다 — 그대로 → trim_id → 꼬리 뗀 것. 갈리면 **안 붙인다.** */
        const bare = (x: string) => N(S(x).replace(/\([^)]*\)\s*$/, ''));
        const trims0 = v.trims ?? [];
        const tid = (t: { trim_id?: string }) => N((t as { trim_id?: string }).trim_id);
        const tHit0 = (pin?.trim_id ? trims0.find((t) => S((t as { trim_id?: string }).trim_id) === pin.trim_id) : undefined)
          ?? trims0.find((t) => N(t.name) === N(trim))
          ?? trims0.find((t) => tid(t) === N(trim))
          ?? trims0.find((t) => N(t.name) === bare(trim) || tid(t) === bare(trim))
          ?? (() => {
            const hits = trims0.filter((t) => bare(t.name) === bare(trim) || bare(tid(t)) === bare(trim));
            return hits.length === 1 ? hits[0] : undefined;   // 갈리면 안 붙인다
          })();
        const trimKey = S((tHit0 as { trim_id?: string } | undefined)?.trim_id);
        const optionsMaster: OptionPack['optionsMaster'] = {};
        for (const [id, o] of Object.entries(om)) {
          /* ⚠⚠ **지우지 않는다 — «표시»만 한다.**
             예전에는 「이미 산 것」을 `optionsMaster` 에서 **삭제**했다. 그러면
             `impliedOptions` 가 가리키는 id 가 사전에 없어(실측 11/11 전부 없음)
             **엔진 차단·대칭 배제가 한 번도 안 돌았다**
             (2026-09-10 개발센터 4-AI 원본 대조 · Codex).
             원본도 옵션을 지우지 않는다 — `available_options` 에서 빼서 «안 판다»고 말할 뿐이다.
             ⇒ 사전에는 **남기고**, `availableOptions` 에서만 뺀다. 화면은 `optionList` 가 거른다. */
          optionsMaster[id] = {
            name: S(o.name) || id,
            ...(o.sub ? { sub: S(o.sub) } : {}),
            /* ★★★**옵션값은 «트림마다 다르다»** — 원본 `trim_prices` 와 `getOptionPrice`(index.html:1096):
                 「그 트림에 따로 값이 있으면 그 값, 없으면 기본값」.
               ⚠⚠ 여태 기본값만 썼다. 실측 차이:
                 쏘렌토 컴포트  109만 ↔ X-Line **60만**  (**49만 과대**)
                 투싼 HTRAC   198만 ↔ 전 트림 **223만** (**25만 과소**)
                 K9 VIP컬렉션 366만 ↔ **307만**
               ⇒ 이 팩은 «한 트림»의 것이므로, 그 트림 값으로 **확정해서** 싣는다. */
            price: Math.round((Number(
              (trimKey && o.trim_prices && trimKey in o.trim_prices) ? o.trim_prices[trimKey] : o.price,
            ) || 0) * 10000),   // 만원 → 원
            // 이미 산 엔진을 요구하던 선행은 «충족»이므로 지운다(HTRAC 이 3.5 를 요구하는 꼴).
            ...(o.requires?.length ? { requires: o.requires.filter((r) => !implied.includes(r)) } : {}),
            /* ★★★**트림별 선행**(`requires_in_trim`) — 원본에 **42개**가 있는데 **하나도 안 옮기고** 있었다.
               원본 `mobile/StepVehicle.vue:103` 이 이렇게 쓴다:
                 `opt.requires_in_trim?.[trim]` 이 있으면 그것들이 다 켜져야 고를 수 있다.
               같은 옵션이라도 **트림마다 선행이 다르다** — 캐스퍼 「17" 휠」은 `smart` 트림에서만
               「액티브 터보Ⅰ」을 요구한다. 이걸 안 옮기면 그 트림에서 **못 고를 것을 팔게** 된다.
               ⚠⚠ 사장님 2026-09-10 「예전에 다 만들어놨던 거란 말이야. 배타그룹까지 다 해놨던 거잖아」 —
                 맞다. 나는 규칙을 «옮기지» 않고 옵션 «이름»에서 다시 만들고 있었다.
               ⚠ 이미 산 것은 선행에서 뺀다(`requires` 와 같은 규칙). */
            /* ⚠ **선행표가 두 층에 있다** — 옵션 층(`opt.requires_in_trim`)과 **variant 층**
               (팰리세이드 `PALISADE_REQUIRES_9` = `{옵션id: {트림id: [선행]}}`). 뜻이 같아 합친다.
               variant 층을 안 읽어 **팰리세이드 프레스티지의 플래티넘·원격주차를
               「컴포트 플러스」 없이 팔고** 있었다(2026-09-10 · Codex 원본 대조). */
            ...(() => {
              const merged = { ...(v.requires_in_trim?.[id] ?? {}), ...(o.requires_in_trim ?? {}) };
              const kept = Object.fromEntries(
                Object.entries(merged)
                  .map(([tk, arr]) => [tk, (arr ?? []).filter((r) => !implied.includes(r))])
                  .filter(([, arr]) => (arr as string[]).length),
              );
              return Object.keys(kept).length ? { requiresInTrim: kept } : {};
            })(),
          };
        }
        // 트림이 맞으면 그 트림의 목록, 아니면 그 세부모델 트림들의 합집합(있는 것을 다 보여 준다).
        const tHit = tHit0;
        const avail = tHit?.available_options
          ?? [...new Set((v.trims ?? []).flatMap((t) => t.available_options ?? []))];

        return {
          optionsMaster,
          exclusiveGroups: (v.exclusive_groups ?? []).map((g) => ({
            id: S(g.id), label: S(g.label), members: (g.members ?? []).filter((x) => optionsMaster[x]),
          })).filter((g) => g.members.length > 1),
          optionExcludes: Object.fromEntries(Object.entries(v.option_excludes ?? {})
            .map(([k, arr]) => [k, (arr ?? []).filter((x) => optionsMaster[x])])
            .filter(([, arr]) => (arr as string[]).length)),
          availableOptions: avail.filter((x) => optionsMaster[x] && !implied.includes(x)),
          ...(trimKey ? { trimKey } : {}),
          impliedOptions: implied,
          optionSource: `welrix vehicle-db · ${md.model_name} ${v.variant_name}`,
        };
      }
    }
  }
  return null;
}

async function main() {
  const feed = JSON.parse(readFileSync('tmp/feed.json', 'utf8')) as { trims: Record<string, string>[] };
  const rows = feed.trims;
  let hit = 0; const sample: string[] = [];
  const packs: { row: Record<string, string>; pack: OptionPack }[] = [];
  for (const r of rows) {
    const p = packFor(S(r.maker), S(r.sub_model), S(r.fuel), S(r.trim), S(r.id));
    if (!p) continue;
    hit++; packs.push({ row: r, pack: p });
    if (sample.length < 6) {
      sample.push(`${r.maker} ${r.sub_model} ${r.fuel} ${r.trim} — 옵션 ${p.availableOptions.length}`
        + ` · 배타 ${p.exclusiveGroups.length} · 배제 ${Object.keys(p.optionExcludes).length}`
        + (p.impliedOptions.length ? ` · 이미 산 엔진 ${p.impliedOptions.join(',')}` : ''));
    }
  }
  console.log(`우리 ${rows.length}줄 중 옵션 조합을 붙일 수 있는 줄 ${hit} (${Math.round(hit / rows.length * 100)}%)`);
  console.log(sample.map((s) => '  ' + s).join('\n'));
  const eg = packs.filter((p) => p.pack.exclusiveGroups.length).length;
  const ox = packs.filter((p) => Object.keys(p.pack.optionExcludes).length).length;
  const im = packs.filter((p) => p.pack.impliedOptions.length).length;
  console.log(`  배타그룹 있는 줄 ${eg} · 배제 있는 줄 ${ox} · «이미 산 엔진»을 뺀 줄 ${im}`);

  mkdirSync('data/new-car', { recursive: true });
  writeFileSync('data/new-car/option-packs.json', JSON.stringify({
    updated: new Date().toISOString().slice(0, 10), count: hit,
    packs: packs.map((p) => ({ maker: p.row.maker, sub_model: p.row.sub_model, fuel: p.row.fuel, trim: p.row.trim, ...p.pack })),
  }, null, 1));
  console.log('→ data/new-car/option-packs.json');

  if (!APPLY) { console.log('\n(드라이런 — Firestore 에 쓰려면 --apply)'); return; }

  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
  if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
  const fs = getFirestore();
  const snap = await fs.collection('new_car_trim').get();
  let wrote = 0;
  let batch = fs.batch(); let n = 0;
  for (const d of snap.docs) {
    const v = d.data();
    const p = packFor(S(v.maker), S(v.sub_model), S(v.fuel), S(v.trim));
    if (!p) continue;
    batch.set(d.ref, { ...p, optionAt: new Date().toISOString().slice(0, 10) }, { merge: true });
    wrote++; n++;
    if (n >= 400) { await batch.commit(); batch = fs.batch(); n = 0; }
  }
  if (n) await batch.commit();
  console.log(`옵션 조합을 ${wrote}줄에 실었다`);
}

await main();
