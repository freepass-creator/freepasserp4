/**
 * 진단 전용(읽기만) — 이안카 실제 페이지 구조를 찍는다. 아무것도 쓰지 않는다.
 * ⚠ 2026-09-17 — ianka.com(로마자)은 도메인 판매 파킹 페이지였다(실측). 사장님이 다시 준 진짜
 *   주소는 한글 도메인 https://xn--le5bt3bwxk.com/ (punycode) — 이걸로 다시 찍는다.
 * 이 세션(샌드박스)은 일반 웹사이트 접근이 막혀 있어(ironrentcar.com도 마찬가지) 여기서
 * GitHub Actions(열린 인터넷)로 한 번 열어보고, 그 결과로 실제 어댑터(lib/adapters/ianka-web.ts 류)를 짠다.
 *   npx tsx scripts/diag-ianka-site.mts
 */
const S = (v: unknown) => String(v ?? '').trim();
const BASE = 'https://xn--le5bt3bwxk.com';

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'FreepassERP/4 diag (readonly)' },
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  console.log(`  GET ${url} → ${res.status} ${res.headers.get('content-type') || ''}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function summarize(html: string, label: string) {
  console.log(`\n■ ${label} — 길이 ${html.length}`);
  // 후보 링크: /vehicle /car /product /rent 등 흔한 패턴을 다 찍어 본다.
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const candidates = hrefs.filter((h) => /vehicle|car|product|rent|item|goods|list|detail/i.test(h));
  const uniq = [...new Set(candidates)].slice(0, 40);
  console.log(`  링크 총 ${hrefs.length}개 · 차량스러운 패턴 ${candidates.length}개(중복 포함) · 표본:`);
  for (const h of uniq) console.log(`    ${h}`);
  // 흔한 프레임워크 흔적
  const frameworkHints = ['__NEXT_DATA__', 'window.__INITIAL_STATE__', 'nuxt', 'React', 'wix', 'imweb', 'cafe24', 'godo'];
  for (const hint of frameworkHints) if (html.includes(hint)) console.log(`  ⚑ 흔적: ${hint}`);
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  if (titleMatch) console.log(`  <title>: ${S(titleMatch[1])}`);
}

try {
  const home = await fetchHtml(BASE);
  summarize(home, '홈');
} catch (e) {
  console.error(`  ⛔ 홈 실패: ${(e as Error).message}`);
}

for (const path of ['/vehicles', '/vehicle', '/car', '/cars', '/product', '/products', '/rent', '/list', '/inventory']) {
  try {
    const html = await fetchHtml(`${BASE}${path}`);
    summarize(html, `경로 ${path}`);
  } catch (e) {
    console.log(`  ○ ${path}: ${(e as Error).message}`);
  }
}
