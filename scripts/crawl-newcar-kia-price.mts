/**
 * 기아 «공식 가격표» 크롤러 — 모델 → 연료 → **정확한 트림명 + 세제 전/후 가격**.
 *
 * ★★사장님 2026-09-09 「**여기도 SSOT 에서 제대로 갖고와야 한다**」 · 「**제대로 쌓아올려봐**」
 *
 * ⚠⚠ **왜 다시 받나 — 지금 신차마스터의 기아 트림명이 망가져 있다.**
 *   PDF 좌표 파싱(`crawl-newcar-kia-pdf.mts`)이 «옵션 이름을 트림명에 붙여» 버렸다(2026-09-09 실측):
 *     K8  「**기아 AI 어시스턴트** 베스트 셀렉션」 · 「**오토 디포그** 노블레스」  (실제 = 베스트 셀렉션 · 노블레스)
 *     K9  「베스트」가 **두 줄**(6,899만 · 8,229만)   (실제 = 베스트 셀렉션 Ⅰ · Ⅱ — 이름이 잘려 둘이 한 이름이 됐다)
 *     카니발 「노블레스」 세 줄 · 「시그니처」 세 줄  (좌석·구동 구분이 이름에서 사라졌다)
 *   ⇒ 이름이 이러면 **어느 원천과도 못 붙는다** — 옵션도 색상도 웰릭스 조합지도도 붙일 수가 없다.
 *     문자열로 기우지 않는다. **공식에서 다시 받는다.**
 *
 * ★원천 = `https://www.kia.com/kr/vehicles/{slug}/price` — 브라우저가 필요 없다(HTML 에 그대로 있다).
 *   연료 = `<ol role="tablist">` 의 `<li id="tabs-aem-item-N-tab">` 안 단추 글씨
 *   트림 = 그 탭의 판(`id="tabs-aem-item-N"`) 안
 *          `<h3 class="price_list__item-title">이름</h3>`
 *          `<p class="trim_price">세제혜택 전 판매가격<strong>45,200,000</strong></p>`
 *          `<p class="trim_price">세제혜택 후 판매가격<strong>44,200,000</strong></p>`
 *   ★★**가격 규격은 「세제혜택 전」**이다 — `docs/신차마스터-피드.md` 「모든 가격 = 개별소비세 5% 기준」.
 *     세제 후(3.5%)를 쓰면 현대·제네시스와 basis 가 어긋나 1.3~1.7% 싸 «보인다».
 *
 * 실행 : npx tsx scripts/crawl-newcar-kia-price.mts              (드라이런 · data/new-car/kia-price.json)
 *        npx tsx scripts/crawl-newcar-kia-price.mts --model=k8   몇 개만
 * ⚠ 제조사 서버 배려 — 모델 사이에 쉰다.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const S = (v: unknown) => String(v ?? '').trim();
/** HTML 조각에서 글자만 — 태그·주석·엔티티를 걷는다. */
const text = (h: string) => S(h.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' '));

const ONLY = (process.argv.find((a) => a.startsWith('--model=')) || '').split('=')[1]?.split(',').filter(Boolean) ?? [];

/** 신차마스터에 실려 있는 기아 슬러그 그대로 — 여기가 늘면 마스터에도 늘어야 한다. */
const MODELS = ONLY.length ? ONLY : [
  'morning', 'ray', 'k5', 'k8', 'k9', 'seltos', 'niro', 'sportage', 'sorento', 'carnival',
  'ev3', 'ev4', 'ev5', 'ev6', 'ev9',
];

export type KiaTrim = { slug: string; koModel: string; fuel: string; trim: string; priceBefore: number; priceAfter: number };

/** 탭 목록 — 「터보 하이브리드」·「2.5 가솔린」… 순서대로. 판 번호와 짝이 된다. */
function tabsOf(html: string): { n: number; label: string }[] {
  const ol = /<ol[^>]*role="tablist"[\s\S]*?<\/ol>/.exec(html)?.[0] ?? '';
  const out: { n: number; label: string }[] = [];
  for (const m of ol.matchAll(/<li[^>]*id="tabs-aem-item-(\d+)-tab"[\s\S]*?<button[^>]*>([\s\S]*?)<\/button>/g)) {
    const label = text(m[2]);
    if (label) out.push({ n: Number(m[1]), label });
  }
  return out;
}

/**
 * 한 판(탭) 안의 트림들.
 * ⚠ 값 적는 법이 모델마다 «세 갈래»다(2026-09-09 실측) —
 *     K8    `세제혜택 전 판매가격<strong>…</strong>` (라벨 · `<br>` 없음)
 *     쏘렌토 `세제혜택 전 판매가격<br /><strong>…</strong>` (라벨 · `<br>` 있음)
 *     K9    `<strong>…</strong>` **라벨이 아예 없다**(세제 구분 없는 단일가)
 *   ⇒ `<td>` 안의 값을 «다 모으고» 라벨이 있으면 전/후로 가른다. 없으면 그 하나를 둘 다로 쓴다.
 */
function trimsIn(panel: string): { trim: string; priceBefore: number; priceAfter: number }[] {
  const out: { trim: string; priceBefore: number; priceAfter: number }[] = [];
  /* ⚠ 경계는 «다음 h3 앞»이 아니라 `</td>` 다. 품목 표가 길어서 「다음 h3 까지 900자」로 잡으면
     한 건도 안 걸린다(2026-09-09 실측 — 0건). 값은 늘 이름과 같은 `<td>` 안에 있다. */
  const re = /<h3[^>]*class="[^"]*price_list__item-title[^"]*"[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)<\/td>/g;
  for (const m of panel.matchAll(re)) {
    // 「베스트 셀렉션Ⅰ」·「베스트 셀렉션 Ⅱ」처럼 로마숫자 앞 띄어쓰기가 들쭉날쭉하다 — 한 칸으로 고른다.
    const trim = text(m[1]).replace(/\s*([ⅠⅡⅢⅣ])/g, ' $1').replace(/\s+/g, ' ').trim();
    if (!trim) continue;
    let before = 0; let after = 0; const plain: number[] = [];
    for (const p of m[2].matchAll(/<p[^>]*class="[^"]*trim_price[^"]*"[^>]*>([\s\S]*?)<\/p>/g)) {
      const won = Number((/<strong>([\d,]+)<\/strong>/.exec(p[1])?.[1] ?? '').replace(/[^\d]/g, '')) || 0;
      if (!won) continue;
      const lab = text(p[1].replace(/<strong>[\s\S]*?<\/strong>/, ''));
      if (/세제혜택\s*전/.test(lab)) before = won;
      else if (/세제혜택\s*후/.test(lab)) after = won;
      else plain.push(won);
    }
    if (!before && !after && plain.length) { before = plain[0]; after = plain[0]; }
    if (!before && !after) continue;
    // 같은 판에 같은 트림이 두 번 나오면(품목표가 두 벌) 첫 것만.
    if (out.some((o) => o.trim === trim && o.priceBefore === (before || after))) continue;
    out.push({ trim, priceBefore: before || after, priceAfter: after || before });
  }
  return out;
}

/**
 * 판을 가른다 — 판 표식은 `data-cmp-hook-tabs="tabpanel"` 이다.
 * ⚠ `id="tabs-aem-item-N"` 은 **없다**(탭 쪽에만 `-tab` 으로 붙는다 · 2026-09-09 실측 0개).
 *   판은 문서에 나온 «차례»가 곧 탭 차례다.
 */
function panelsOf(html: string): string[] {
  const at: number[] = [];
  for (const m of html.matchAll(/data-cmp-hook-tabs="tabpanel"/g)) at.push(m.index ?? 0);
  return at.map((a, i) => html.slice(a, i + 1 < at.length ? at[i + 1] : html.length));
}

export async function crawlModel(slug: string): Promise<KiaTrim[]> {
  const r = await fetch(`https://www.kia.com/kr/vehicles/${slug}/price`, { headers: { 'User-Agent': UA } });
  if (!r.ok) { console.log(`  ✗ ${slug} — HTTP ${r.status}`); return []; }
  const html = await r.text();
  const koModel = text(/<h2[^>]*class="[^"]*main-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/.exec(html)?.[1] ?? '')
    .replace(/^The\s+\d{4}\s+/i, '').trim() || slug;
  const tabs = tabsOf(html);
  const panels = panelsOf(html);
  const out: KiaTrim[] = [];
  // 탭과 판을 «차례»로 짝짓는다. 판이 더 많으면(다른 탭 묶음이 섞임) 트림이 든 판만 센다.
  const withTrims = panels.map((p) => ({ p, t: trimsIn(p) })).filter((x) => x.t.length);
  withTrims.forEach((x, i) => {
    const fuel = tabs[i]?.label ?? '';
    for (const y of x.t) out.push({ slug, koModel, fuel, ...y });
  });
  // 탭을 못 읽었으면(단일 연료) 문서 전체에서 한 번 훑는다.
  if (!out.length) for (const x of trimsIn(html)) out.push({ slug, koModel, fuel: '', ...x });
  console.log(`  · ${slug}(${koModel}) — 연료 ${tabs.length} · 트림 ${out.length}`);
  return out;
}

if (process.argv[1]?.includes('crawl-newcar-kia-price')) {
  const all: KiaTrim[] = [];
  console.log(`기아 공식 가격표 — 모델 ${MODELS.length}개`);
  for (const m of MODELS) {
    try { all.push(...await crawlModel(m)); }
    catch (e) { console.log(`  ✗ ${m} —`, String((e as Error).message).slice(0, 70)); }
    await sleep(700);
  }
  mkdirSync('data/new-car', { recursive: true });
  writeFileSync('data/new-car/kia-price.json',
    JSON.stringify({ source: 'kia.com/kr/vehicles/{model}/price', basis: '세제혜택 전(개소세 5%)', updated: new Date().toISOString().slice(0, 10), trims: all }, null, 1));
  console.log(`\n받은 트림 ${all.length} → data/new-car/kia-price.json`);
}
