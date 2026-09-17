/**
 * 진단 전용(읽기만) — 이안카(https://xn--le5bt3bwxk.com/, 사장님 확인 「1번」) 실제 재고 구조를 찍는다.
 * 아무것도 쓰지 않는다. GitHub Actions(열린 인터넷)에서만 돈다 — 샌드박스는 일반 웹사이트가 막혀 있다.
 *   npx tsx scripts/diag-ianka-site.mts
 */
import { load } from 'cheerio';
const S = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');
const HOME = 'https://xn--le5bt3bwxk.com';

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'FreepassERP/4 diag (readonly)' },
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  console.log(`GET ${url} → ${res.status} ${res.headers.get('content-type') || ''}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const html = await fetchHtml(HOME);
const $ = load(html);

// ── 1) article(차량 카드) 전체를 있는 그대로 찍는다 ──
const articles = $('article');
console.log(`\n■ article 총 ${articles.length}개`);
articles.each((i, el) => {
  const $el = $(el);
  console.log(`\n--- article[${i}] ---`);
  console.log(`  class="${$el.attr('class') || ''}"`);
  console.log(`  text: ${S($el.text()).slice(0, 300)}`);
  $el.find('a[href]').each((_, a) => console.log(`  a href=${$(a).attr('href')}`));
  $el.find('img').each((_, img) => console.log(`  img src=${$(img).attr('src') || $(img).attr('data-src') || ''}`));
  // data-* 속성(프레임워크가 원자료를 실어 두는 자리인지 확인)
  const dataAttrs = Object.entries((el as any).attribs || {}).filter(([k]) => k.startsWith('data-'));
  if (dataAttrs.length) console.log(`  data-*: ${JSON.stringify(dataAttrs)}`);
});

// ── 2) 페이지에 박힌 초기 상태(JSON) 흔적 — Next.js/Nuxt/자체 API 호출 여부 ──
console.log('\n■ 스크립트 태그 중 JSON 흔적');
$('script').each((i, el) => {
  const text = $(el).text();
  const id = $(el).attr('id') || '';
  const src = $(el).attr('src') || '';
  if (src) return;
  if (id.includes('NEXT_DATA') || /__NUXT__|__NEXT_DATA__|window\.__INITIAL_STATE__|"vehicles"|"cars"|"products"/i.test(text)) {
    console.log(`  script[${i}] id="${id}" 길이=${text.length} 표본: ${text.slice(0, 400)}`);
  }
});

// ── 3) 네트워크가 부르는 API 흔적 — fetch(...)/axios(...) 호출 문자열 ──
console.log('\n■ 외부 스크립트 src(API 서버 후보)');
$('script[src]').each((_, el) => console.log(`  ${$(el).attr('src')}`));

// ── 4) 페이지네이션·더보기 흔적 ──
console.log('\n■ 더보기/페이지 버튼 후보');
$('button, a').each((_, el) => {
  const t = S($(el).text());
  if (/더보기|다음|more|next|페이지/i.test(t) && t.length < 20) console.log(`  <${(el as any).tagName}> ${t}`);
});
