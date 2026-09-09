/**
 * 현대 «공식 선택품목» 크롤러 — 트림마다 고를 수 있는 옵션·값, 그리고 **선행/배타 규칙**까지.
 *
 * ★★사장님 2026-09-09 「다음 ㄱㄱㄱ」 · 「추천대로 ㄱㄱ」
 *
 * ⚠ 현대 BFF(`/e/api/bff/estimate/making/init`)는 **기본 옵션만** 준다 — 유료 옵션이 «없다»(실측).
 *   그래서 처음엔 브라우저를 몰아야 하나 했는데, **가격표 페이지 HTML 에 다 있었다.**
 *   ⇒ `https://www.hyundai.com/kr/ko/vehicles/{slug}/price` — 기아와 «같은 짜임»이다.
 *
 * ★단 한 겹이 더 있다 — 현대는 그 HTML 을 `__NUXT__` 안에 **유니코드로 이스케이프해서** 넣는다.
 *   `<` · `\"` · `\n` 을 풀어야 태그가 보인다. 안 풀면 정규식이 한 건도 안 걸린다(실측).
 *   ⚠ 특히 `\n` 을 안 풀면 태그 사이가 «역슬래시 n» 이라 `\s*` 가 안 먹는다 — 여기서 한참 헤맸다.
 *
 * ★짜임(2026-09-09 실측)
 *     <caption> GRANDEUR 스마트스트림 가솔린 2.5/가솔린 3.5 가격표 …   ← 파워트레인
 *     <tr> td0 「Premium (프리미엄) 42,450,000」   td1 기본품목   td2 【선택품목】【H Genuine Accessories】
 *          <li><p class="item-name"><span>파노라마 선루프</span></p><span class="item-price">1,200,000</span></li>
 *
 * ★★현대는 **규칙을 이름 안에** 준다 — 「HTRAC**(가솔린 3.5 선택 시 가능)**」.
 *   「~ 선택 시 (가능)」 = 선행(requires) · 「~ 와 동시 (선택/적용) 불가」 = 배제(excludes).
 *   ⚠ 상대를 그 트림 목록에서 «찾았을 때만» 세운다. 못 찾으면 규칙을 만들지 않는다(지어내지 않는다).
 *
 * ⚠⚠ 색상은 옵션에서 뺀다 — 화면이 색상을 «따로» 더한다(`colorAdd`). 그대로 두면 두 번 받는다.
 * ⚠ 이미 실린 조합 규칙(웰릭스)은 **덮지 않는다** — 비어 있는 줄만 채운다.
 *
 * 실행 : npx tsx scripts/crawl-newcar-hyundai-options.mts            (드라이런)
 *        npx tsx scripts/crawl-newcar-hyundai-options.mts --apply
 *        --model=grandeur,staria
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { canonFuel } from '../lib/domain/estimate/newcar-normalize';
import { priceOf, rulesFrom, splitNote } from '../lib/domain/estimate/option-note';
import { impliedOf } from '../lib/domain/estimate/implied-options';

const APPLY = process.argv.includes('--apply');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/[\s\-_()·]/g, '');
const T = (h: string) => S(h.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' '));

const BS = String.fromCharCode(92);
/** `__NUXT__` 안의 이스케이프를 푼다 — 이걸 안 하면 태그가 안 보인다. */
export function unescapeNuxt(s: string): string {
  let t = s;
  for (let k = 0; k < 4; k++) {
    const n = t.replace(new RegExp(BS + BS + '+u([0-9a-fA-F]{4})', 'g'), (_m, h) => String.fromCharCode(parseInt(h, 16)));
    if (n === t) break;
    t = n;
  }
  /* ⚠ `\r`·`\t` 도 푼다 — 안 풀면 트림 머리가 「\r \r Smart \r (스마트)」가 되어
     이름도 값도 못 읽는다(2026-09-09 실측 — 스타리아가 통째로 안 붙었다). */
  return t.replace(new RegExp(BS + BS + '+"', 'g'), '"')
    .replace(new RegExp(BS + BS + '+n', 'g'), '\n')
    .replace(new RegExp(BS + BS + '+[rt]', 'g'), ' ');
}

const ONLY = (process.argv.find((a) => a.startsWith('--model=')) || '').split('=')[1]?.split(',').filter(Boolean) ?? [];
/**
 * 현대 모델 슬러그 — **현대닷컴 제 메뉴에서 읽은 것**이다(2026-09-09 · 브라우저로 `a[href]` 를 훑었다).
 * ⚠ 짐작으로는 못 맞춘다 — 「디 올 뉴 아반떼」가 `the-all-new-avante` 라 이름·이미지 파일에서 유추하면
 *   48개 중 셋만 맞았다. 그래서 «사이트가 스스로 건 링크»를 정본으로 둔다.
 * ⚠ 슬러그가 늘거나 바뀌면 여기만 고친다. 없는 슬러그는 404 로 조용히 넘어간다.
 */
const MODELS = ONLY.length ? ONLY : [
  'the-new-grandeur', 'the-new-grandeur-hybrid', 'the-new-grandeur-taxi',
  'sonata-the-edge', 'sonata-the-edge-hybrid', 'sonata-taxi',
  'the-all-new-avante', 'the-all-new-avante-hybrid', 'avante-n',
  'venue', 'kona', 'kona-hybrid', 'kona-electric',
  'the-all-new-tucson', 'tucson', 'tucson-hybrid',
  'santafe', 'santafe-hybrid', 'palisade', 'palisade-hybrid',
  'the-new-staria', 'the-new-staria-hybrid', 'the-new-staria-electric',
  'the-new-staria-lounge', 'the-new-staria-lounge-hybrid', 'the-new-staria-lounge-electric',
  'the-new-staria-lounge-mobility', 'the-new-staria-lounge-mobility-hybrid',
  'the-new-staria-limousine-hybrid', 'the-new-staria-limousine-electric',
  'the-new-staria-kinder', 'the-new-staria-kinder-hybrid',
  'ioniq5', 'ioniq5-n', 'the-new-ioniq6', 'ioniq6-n', 'ioniq9',
  'nexo', 'st1', 'porter2', 'porter2-electric', 'porter2-special', 'porter2-electric-special',
];

export type Opt = { name: string; price: number; note?: string };
export type TrimOpts = {
  slug: string; koModel: string; powertrain: string; trim: string; trimEn: string; trimKo: string; price: number;
  options: Opt[]; accessories: Opt[];
  requires: Record<string, string[]>; excludes: Record<string, string[]>;
};

/**
 * 한 묶음 안의 항목 — 이름과 값이 같은 `<li>` 안에 있다.
 * ★규칙 떼기·값 읽기는 **기아와 같은 자**(`lib/domain/estimate/option-note.ts`)를 쓴다 —
 *   두 크롤러가 자를 달리 쓰면 한쪽만 고쳐져 갈린다(실제로 기아가 `※` 를 못 읽고 있었다).
 * ⚠⚠ **값을 못 읽으면 그 줄을 버린다** — 0 원으로 실으면 «공짜 옵션»이 된다(코덱스 검수).
 */
function itemsOf(block: string): Opt[] {
  const out: Opt[] = [];
  for (const m of block.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const li = m[1];
    const won = priceOf(li);
    if (won === null) continue;
    const raw = T(li.replace(/<span[^>]*class="[^"]*item-price[^"]*"[\s\S]*?<\/span>/g, ''));
    if (!raw) continue;
    const { name, notes } = splitNote(raw);
    if (!name) continue;
    out.push({ name, price: won, ...(notes.length ? { note: notes.join(' / ') } : {}) });
  }
  return out;
}

/** 가격표 주소가 «두 갈래»다 — `/kr/ko/vehicles/…` 와 `/kr/ko/e/vehicles/…`. 모델마다 다르다(실측). */
async function fetchPrice(slug: string): Promise<string | null> {
  for (const base of ['https://www.hyundai.com/kr/ko/e/vehicles', 'https://www.hyundai.com/kr/ko/vehicles']) {
    try {
      const r = await fetch(`${base}/${slug}/price`, { headers: { 'User-Agent': UA } });
      if (!r.ok) continue;
      const t = await r.text();
      if (t.includes('item-price')) return t;
    } catch { /* 다음 갈래 */ }
  }
  return null;
}

export async function crawlModel(slug: string): Promise<TrimOpts[]> {
  const raw = await fetchPrice(slug);
  if (!raw) { console.log(`  ✗ ${slug} — 가격표를 못 찾았다`); return []; }
  const html = unescapeNuxt(raw);
  /* 페이지 제목이 한글 모델명이다 — 「더 뉴 스타리아 &gt; 가격 | 현대자동차…」.
     값이 안 맞아도 «같은 모델의 같은 트림»이면 옵션은 같다. 그 길을 열어 둔다. */
  const koModel = T((/<title[^>]*>([\s\S]*?)<\/title>/.exec(raw)?.[1] ?? '').split('&gt;')[0].split('>')[0]);
  const out: TrimOpts[] = [];

  for (const tm of html.matchAll(/<table[\s\S]*?<\/table>/g)) {
    const table = tm[0];
    if (!table.includes('item-price')) continue;   // 가격표만
    const cap = T(/<caption[^>]*>([\s\S]*?)<\/caption>/.exec(table)?.[1] ?? '');
    // 「GRANDEUR 스마트스트림 가솔린 2.5/가솔린 3.5 가격표 - …」 에서 파워트레인만 남긴다
    const powertrain = cap.replace(/^\s*\S+\s*/, '').replace(/\s*가격표[\s\S]*$/, '').trim();
    for (const rm of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const tr = rm[1];
      if (!tr.includes('item-price')) continue;
      const tds = tr.split(/<t[dh][^>]*>/).slice(1);
      const head = T(tds[0] ?? '');
      /**
       * 「Premium (프리미엄) 42,450,000」 — **영문과 한글을 둘 다** 담는다.
       * ⚠ 우리 신차마스터는 현대 BFF 에서 온 **영문**(「Smart」·「Modern」)을 쓴다.
       *   한글만 뽑으면 스타리아·아이오닉이 통째로 안 붙는다(2026-09-09 실측 — 121줄 중 0줄 매칭).
       */
      /* ★값이 「세제혜택 전 … 후 …」 둘인 모델이 있다(아이오닉). **전**이 우리 규격이다
         (`docs/신차마스터-피드.md` 「모든 가격 = 개별소비세 5% 기준」). 없으면 첫 값을 쓴다. */
      const beforeTax = Number((/세제혜택\s*전[^\d]{0,14}([\d,]{7,})/.exec(head)?.[1] ?? '').replace(/,/g, '')) || 0;
      const firstNum = Number((/([\d,]{7,})/.exec(head)?.[1] ?? '').replace(/,/g, '')) || 0;
      const price = beforeTax || firstNum;
      const noPrice = head.replace(/세제혜택[\s\S]*$/, '').replace(/[\d,]{7,}[\s\S]*$/, '').trim();
      const trimKo = /\(([^()]+)\)/.exec(noPrice)?.[1]?.trim() ?? '';
      const trimEn = noPrice.replace(/\s*\([^()]*\)\s*/g, ' ').trim();
      const trim = trimKo || trimEn;
      if (!trim) continue;
      let options: Opt[] = []; let accessories: Opt[] = [];
      const td2 = tds[2] ?? '';
      // 【선택품목】과 【H Genuine Accessories】를 가른다 — 제목이 그 앞에 선다.
      const parts = td2.split(/(?=선택품목|H Genuine Accessories|Genuine Accessories)/);
      for (const p of parts) {
        const items = itemsOf(p);
        if (!items.length) continue;
        if (/Genuine Accessories/i.test(p.slice(0, 60))) accessories = accessories.concat(items);
        else options = options.concat(items);
      }
      out.push({ slug, koModel, powertrain, trim, trimEn, trimKo, price, options, accessories, ...rulesFrom(options) });
    }
  }
  const nOpt = out.reduce((n, x) => n + x.options.length, 0);
  const nRq = out.reduce((n, x) => n + Object.keys(x.requires).length, 0);
  const nEx = out.reduce((n, x) => n + Object.keys(x.excludes).length, 0);
  console.log(`  · ${slug} — 트림 ${out.length} · 옵션 ${nOpt} · 선행 ${nRq} · 배타 ${nEx}`);
  return out;
}

// ── 돌린다 ───────────────────────────────────────────────────────────────
const all: TrimOpts[] = [];
console.log(`현대 공식 선택품목 — 모델 ${MODELS.length}개`);
for (const m of MODELS) {
  try { all.push(...await crawlModel(m)); }
  catch (e) { console.log(`  ✗ ${m} —`, String((e as Error).message).slice(0, 70)); }
  await sleep(700);
}
mkdirSync('data/new-car', { recursive: true });
writeFileSync('data/new-car/hyundai-options.json', JSON.stringify({
  source: 'hyundai.com/kr/ko/vehicles/{model}/price · 선택품목', updated: new Date().toISOString().slice(0, 10), trims: all,
}, null, 1));
console.log(`\n트림 ${all.length} · 옵션 ${all.reduce((n, x) => n + x.options.length, 0)} → data/new-car/hyundai-options.json`);

if (!APPLY) { console.log('(드라이런 — Firestore 에 쓰려면 --apply)'); process.exit(0); }

const { initializeApp, cert, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
const fs = getFirestore();
const snap = await fs.collection('new_car_trim').where('maker', '==', '현대').get();

let wrote = 0; let skipped = 0;
let batch = fs.batch(); let n = 0;
for (const d of snap.docs) {
  const v = d.data();
  // ⚠ 이미 실린 조합 규칙(웰릭스)은 덮지 않는다 — 덮으면 배타·선행이 사라져 뒷걸음질이다.
  if (v.optionsMaster && Object.keys(v.optionsMaster).length) { skipped++; continue; }
  /**
   * 값이 같은 트림이 곧 같은 줄이다 — 이름만으로는 모델이 안 갈린다(「프리미엄」이 열 모델에 있다).
   * ⚠ 가격표 머리의 값은 **세제혜택 «전»**이다. 우리 `priceAfter` 하고만 맞대면 거의 안 맞는다
   *   (2026-09-09 실측 — 282줄 중 셋만 맞았다). `priceBefore` 와도 맞댄다.
   */
  const near = (a: number, b: number) => a > 0 && b > 0 && Math.abs(a - b) <= 10_000;
  const sameTrim = (x: TrimOpts) => [x.trim, x.trimEn, x.trimKo].some((n) => n && N(n) === N(v.trim));
  /**
   * ⚠⚠ **모델과 파워트레인을 반드시 본다.** 2026-09-09 검수에서 잡혔다 —
   *   ① 예전 1차 분기는 «트림 이름 + 값 ±1만원»만 봤다. 그런데
   *      「the-all-new-avante 모던 23,980,000」 과 「porter2 모던 23,980,000」 이 **같은 값**이다.
   *      포터2가 마스터에 들어오는 순간 포터2에 아반떼 옵션이 실린다.
   *   ② 폴백은 `powertrain` 을 뽑아 놓고 한 번도 안 썼다 — 「더 뉴 그랜저」는 연료가 셋인데
   *      `find` 가 «첫 줄»을 줘서 LPi 3.5 에 가솔린 2.5 옵션이 붙을 수 있었다.
   * ⇒ 모델(한글) 일치는 «항상» 요구하고, 연료는 읽히면 맞대고 못 읽으면 «갈리면 안 붙인다».
   */
  const sameModel = (x: TrimOpts) => !!x.koModel && N(x.koModel) === N(v.sub_model);
  const sameFuel = (x: TrimOpts) => {
    const f = canonFuel(S(x.powertrain));
    return !f || N(f) === N(canonFuel(S(v.fuel)));
  };
  const byModel = all.filter(sameModel);
  const cands = byModel.filter((x) => sameTrim(x) && sameFuel(x));
  /* 연료로 좁혀도 둘 이상 남으면 «값»으로 가른다. 그래도 안 갈리면 안 붙인다(지어내지 않는다). */
  const pick = cands.length === 1 ? cands[0]
    : cands.find((x) => near(x.price, Number(v.priceBefore || 0)) || near(x.price, Number(v.priceAfter || 0)))
    ?? null;
  if (!pick || !pick.options.length) { skipped++; continue; }

  const colorNames = new Set([...(v.extColors ?? []), ...(v.intColors ?? [])].map((c: { name?: string }) => N(c?.name)));
  const opts = pick.options.filter((o) => !colorNames.has(N(o.name)));
  const optionsMaster: Record<string, { name: string; price: number; sub?: string; requires?: string[] }> = {};
  opts.forEach((o, i) => { optionsMaster[`hd_${i}`] = { name: o.name, price: o.price, ...(o.note ? { sub: o.note } : {}) }; });
  const idOf = (name: string) => Object.entries(optionsMaster).find(([, x]) => N(x.name) === N(name))?.[0];
  for (const [a, bs] of Object.entries(pick.requires)) {
    const ia = idOf(a); if (!ia) continue;
    const ids = bs.map(idOf).filter(Boolean) as string[];
    if (ids.length) optionsMaster[ia].requires = ids;
  }
  const optionExcludes: Record<string, string[]> = {};
  for (const [a, bs] of Object.entries(pick.excludes)) {
    const ia = idOf(a); if (!ia) continue;
    const ids = bs.map(idOf).filter(Boolean) as string[];
    if (ids.length) optionExcludes[ia] = ids;
  }
  batch.set(d.ref, {
    optionsMaster, optionExcludes, exclusiveGroups: [],
    availableOptions: Object.keys(optionsMaster),
    /* ★「이미 산 것」은 다시 팔지 않는다 — 그랜저 「가솔린 3.5」 줄이 「3.5 엔진 +246만」을,
       아이오닉6 AWD 줄이 「HTRAC +247만」을 또 받고 있었다(2026-09-09 검수). 판정은 공용 원자. */
    impliedOptions: impliedOf(optionsMaster, S(v.fuel), S(v.trim)),
    accessories: pick.accessories,
    optionSource: 'hyundai.com/price · 선택품목',
    optionAt: new Date().toISOString().slice(0, 10),
  }, { merge: true });
  wrote++; n++;
  if (n >= 400) { await batch.commit(); batch = fs.batch(); n = 0; }
}
if (n) await batch.commit();
console.log(`현대 ${snap.size}줄 중 ${wrote}줄에 공식 선택품목을 실었다(건너뛴 줄 ${skipped})`);
