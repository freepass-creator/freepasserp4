/**
 * 기아 «공식 선택품목» 크롤러 — 트림마다 고를 수 있는 옵션과 값, 그리고 **동시 적용 불가**까지.
 *
 * ★★사장님 2026-09-09 「야 **옵션은 명확하게 다 구현하는 게 웰릭스 테이블에 있는데**」 · 「제대로 쌓아올려봐」
 *
 * ⚠ 웰릭스 조합지도는 **25모델**만 덮는다 — EV3~EV9·스타리아·아이오닉·르노는 웰릭스도 모른다.
 *   그 구멍은 **제조사에서 직접 받아야** 메워진다. 기아는 브라우저가 필요 없다(HTML 에 그대로 있다).
 *
 * ★원천 = `https://www.kia.com/kr/vehicles/{slug}/price` — 가격표와 **같은 페이지**다.
 *   트림 한 줄(`<tr>`)이 칸 셋으로 되어 있다:
 *     td0 트림 이름·값   td1 기본품목(다 달려 나오는 것)   td2 **선택품목**
 *   td2 는 아코디언 묶음이다:
 *     【선택품목】        진짜 옵션 — `<li><a>이름</a><p class="item-price">109,000</p></li>` (값은 **원**)
 *     【기아 순정 액세서리】 딜러 용품 — 차량가와 성격이 다르다. **따로 담는다.**
 *
 * ★★규칙이 «이름 안»에 있다 — 「블랙 루프스킨**(선루프와 동시 적용 불가)**」.
 *   괄호 안 문구에서 «동시 적용 불가»를 읽어 `optionExcludes` 로 세운다.
 *   ⚠ 상대를 못 찾으면 규칙을 «만들지 않는다» — 이름만 남기고 넘어간다(지어내지 않는다).
 *
 * ⚠⚠ **색상은 옵션에서 뺀다.** 기아는 유료 색상(「스노우 화이트 펄 8만」)도 선택품목에 넣는다.
 *   우리 화면은 색상을 «따로» 골라 차량가에 더한다(`colorAdd`) — 그대로 두면 **두 번 받는다.**
 *
 * 실행 : npx tsx scripts/crawl-newcar-kia-options.mts            (드라이런)
 *        npx tsx scripts/crawl-newcar-kia-options.mts --apply    (Firestore 에 merge)
 *        --model=k8,ev9
 */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { koFromAliases, splitAxis, withSuffix } from '../lib/domain/estimate/newcar-normalize';

const APPLY = process.argv.includes('--apply');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/[\s\-_()·]/g, '');
const text = (h: string) => S(h.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' '));

const ONLY = (process.argv.find((a) => a.startsWith('--model=')) || '').split('=')[1]?.split(',').filter(Boolean) ?? [];
const MODELS = ONLY.length ? ONLY : [
  'morning', 'ray', 'k5', 'k8', 'k9', 'seltos', 'niro', 'sportage', 'sorento', 'carnival',
  'ev3', 'ev4', 'ev5', 'ev6', 'ev9',
];

export type KiaOpt = { name: string; price: number; note?: string };
export type KiaTrimOpts = {
  slug: string; fuelTab: string; trim: string;
  options: KiaOpt[]; accessories: KiaOpt[];
  /** 「A 와 동시 적용 불가」에서 세운 배타 — 상대를 실제로 찾았을 때만 담는다. */
  excludes: Record<string, string[]>;
};

/** 한 묶음(아코디언) 안의 항목들. 이름과 값이 같은 `<li>` 안에 있다. */
function itemsOf(block: string): KiaOpt[] {
  const out: KiaOpt[] = [];
  for (const m of block.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const li = m[1];
    const price = Number((/<p[^>]*class="[^"]*item-price[^"]*"[^>]*>([\d,]+)</.exec(li)?.[1] ?? '').replace(/[^\d]/g, '')) || 0;
    const raw = text(li.replace(/<p[^>]*class="[^"]*item-price[^"]*"[\s\S]*?<\/p>/g, ''));
    if (!raw) continue;
    // 「블랙 루프스킨(선루프와 동시 적용 불가)」 — 괄호 뒤는 «규칙»이지 이름이 아니다.
    const m2 = /^(.*?)\s*\(([^()]*(?:불가|필수|선택 시)[^()]*)\)\s*$/.exec(raw);
    out.push(m2 ? { name: m2[1].trim(), price, note: m2[2].trim() } : { name: raw, price });
  }
  return out;
}

/** 「선루프와 동시 적용 불가」 → 그 상대를 이 트림의 옵션 목록에서 찾는다. 못 찾으면 안 세운다. */
function excludesFrom(opts: KiaOpt[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const o of opts) {
    if (!o.note || !/동시\s*적용\s*불가/.test(o.note)) continue;
    const who = o.note.replace(/와?\s*동시\s*적용\s*불가.*/, '').trim();
    if (!who) continue;
    const partner = opts.find((x) => x !== o && (N(x.name).includes(N(who)) || N(who).includes(N(x.name))));
    if (!partner) continue;   // 상대를 못 찾으면 규칙을 «만들지 않는다»
    (out[o.name] ??= []).push(partner.name);
    (out[partner.name] ??= []).push(o.name);
  }
  return out;
}

export async function crawlModel(slug: string): Promise<KiaTrimOpts[]> {
  const r = await fetch(`https://www.kia.com/kr/vehicles/${slug}/price`, { headers: { 'User-Agent': UA } });
  if (!r.ok) { console.log(`  ✗ ${slug} — HTTP ${r.status}`); return []; }
  const html = await r.text();

  // 탭(연료·좌석·구동) 이름 — 판 차례와 짝이 된다(가격 크롤러와 같은 규칙).
  const ol = /<ol[^>]*role="tablist"[\s\S]*?<\/ol>/.exec(html)?.[0] ?? '';
  const tabs = [...ol.matchAll(/<li[^>]*id="tabs-aem-item-\d+-tab"[\s\S]*?<button[^>]*>([\s\S]*?)<\/button>/g)]
    .map((m) => text(m[1])).filter(Boolean);
  const panelAt = [...html.matchAll(/data-cmp-hook-tabs="tabpanel"/g)].map((m) => m.index ?? 0);
  const panels = panelAt.map((a, i) => html.slice(a, i + 1 < panelAt.length ? panelAt[i + 1] : html.length));

  const out: KiaTrimOpts[] = [];
  let tabIdx = -1;
  for (const panel of panels) {
    const rows = [...panel.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
      .filter((m) => m[1].includes('price_list__item-title'));
    if (!rows.length) continue;
    tabIdx++;
    const fuelTab = tabs[tabIdx] ?? '';
    for (const rm of rows) {
      const tr = rm[1];
      const trim = text(/<h3[^>]*class="[^"]*price_list__item-title[^"]*"[^>]*>([\s\S]*?)<\/h3>/.exec(tr)?.[1] ?? '')
        .replace(/\s*([ⅠⅡⅢⅣ])/g, ' $1').replace(/\s+/g, ' ').trim();
      if (!trim) continue;
      const tds = tr.split(/<td[^>]*>/).slice(1);
      const td2 = tds[2] ?? '';
      let options: KiaOpt[] = []; let accessories: KiaOpt[] = [];
      for (const am of td2.matchAll(/<button[^>]*class="[^"]*price_accor__option[^"]*"[^>]*>([\s\S]*?)<\/button>([\s\S]*?)(?=<button[^>]*class="[^"]*price_accor__option|$)/g)) {
        const title = text(am[1]);
        const items = itemsOf(am[2]);
        if (/액세서리|용품/.test(title)) accessories = accessories.concat(items);
        else options = options.concat(items);
      }
      out.push({ slug, fuelTab, trim, options, accessories, excludes: excludesFrom(options) });
    }
  }
  const nOpt = out.reduce((n, x) => n + x.options.length, 0);
  const nEx = out.reduce((n, x) => n + Object.keys(x.excludes).length, 0);
  console.log(`  · ${slug} — 트림 ${out.length} · 옵션 ${nOpt} · 배타 ${nEx}`);
  return out;
}

// ── 돌린다 ───────────────────────────────────────────────────────────────
const all: KiaTrimOpts[] = [];
console.log(`기아 공식 선택품목 — 모델 ${MODELS.length}개`);
for (const m of MODELS) {
  try { all.push(...await crawlModel(m)); }
  catch (e) { console.log(`  ✗ ${m} —`, String((e as Error).message).slice(0, 70)); }
  await sleep(700);
}
mkdirSync('data/new-car', { recursive: true });
writeFileSync('data/new-car/kia-options.json', JSON.stringify({
  source: 'kia.com/kr/vehicles/{model}/price · 선택품목', updated: new Date().toISOString().slice(0, 10), trims: all,
}, null, 1));
console.log(`\n트림 ${all.length} · 옵션 ${all.reduce((n, x) => n + x.options.length, 0)} → data/new-car/kia-options.json`);

if (!APPLY) { console.log('(드라이런 — Firestore 에 쓰려면 --apply)'); process.exit(0); }

// ── 정본에 싣는다 ─────────────────────────────────────────────────────────
const { initializeApp, cert, getApps } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }) });
const fs = getFirestore();
const aliases = JSON.parse(readFileSync('data/model-aliases.json', 'utf8')) as Record<string, string[]>;
const snap = await fs.collection('new_car_trim').where('maker', '==', '기아').get();

let wrote = 0; let skipped = 0;
let batch = fs.batch(); let n = 0;
for (const d of snap.docs) {
  const v = d.data();
  /**
   * 모델 + 트림으로 맞춘다.
   * ⚠⚠ ①단계에서 `sub_model` 을 **한글로** 바꿔 놨다(`carnival` → 「카니발」).
   *   영문 슬러그로 찾으면 한 건도 안 맞는다 — 별칭표로 슬러그를 한글로 옮겨 맞댄다.
   *   (2026-09-09 백필에서 같은 함정을 이미 한 번 밟았다.)
   */
  /* ⚠ 탭이 «연료가 아닌 축»(EV9 의 2WD/4WD · 카니발 좌석)이면 그 축은 **트림 꼬리**로 갔다.
     ①단계와 «같은 정규화»를 태워야 맞는다 — 안 그러면 EV9 열 줄이 통째로 안 붙는다(실측). */
  const trimOf = (x: KiaTrimOpts) =>
    withSuffix(x.trim, splitAxis(x.fuelTab, /^ev\d/i.test(x.slug)).trimSuffix);
  const pick = all.find((x) => N(koFromAliases(aliases, x.slug)) === N(v.sub_model) && N(trimOf(x)) === N(v.trim))
    ?? all.find((x) => N(koFromAliases(aliases, x.slug)) === N(v.sub_model) && N(x.trim) === N(v.trim))
    ?? null;
  if (!pick || !pick.options.length) { skipped++; continue; }
  /**
   * ⚠⚠ **이미 실린 조합 규칙을 덮지 않는다.**
   *   웰릭스 조합지도에는 «배타·선행·배제»가 있는데 기아 공식 HTML 은 **규칙을 안 준다**
   *   (2026-09-09 실측 — 선택품목에 배타 문구가 없다. 「동시 적용 불가」는 액세서리 쪽에만 있다).
   *   덮으면 규칙이 사라져 **뒷걸음질**이다. ⇒ 비어 있는 줄만 채운다.
   */
  if (v.optionsMaster && Object.keys(v.optionsMaster).length) { skipped++; continue; }

  /* ⚠ 색상은 뺀다 — 화면이 색상을 따로 더한다(`colorAdd`). 그대로 두면 두 번 받는다. */
  const colorNames = new Set([...(v.extColors ?? []), ...(v.intColors ?? [])].map((c: { name?: string }) => N(c?.name)));
  const opts = pick.options.filter((o) => !colorNames.has(N(o.name)));

  const optionsMaster: Record<string, { name: string; price: number; sub?: string }> = {};
  for (const [i, o] of opts.entries()) optionsMaster[`kia_${i}`] = { name: o.name, price: o.price, ...(o.note ? { sub: o.note } : {}) };
  const idOf = (name: string) => Object.entries(optionsMaster).find(([, x]) => N(x.name) === N(name))?.[0];
  const optionExcludes: Record<string, string[]> = {};
  for (const [a, bs] of Object.entries(pick.excludes)) {
    const ia = idOf(a); if (!ia) continue;
    const ids = bs.map(idOf).filter(Boolean) as string[];
    if (ids.length) optionExcludes[ia] = ids;
  }
  batch.set(d.ref, {
    optionsMaster, optionExcludes, exclusiveGroups: [],
    availableOptions: Object.keys(optionsMaster),
    impliedOptions: [],
    accessories: pick.accessories,
    optionSource: 'kia.com/price · 선택품목',
    optionAt: new Date().toISOString().slice(0, 10),
  }, { merge: true });
  wrote++; n++;
  if (n >= 400) { await batch.commit(); batch = fs.batch(); n = 0; }
}
if (n) await batch.commit();
console.log(`기아 ${snap.size}줄 중 ${wrote}줄에 공식 선택품목을 실었다(못 맞춘 줄 ${skipped})`);
