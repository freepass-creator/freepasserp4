/**
 * 진단 전용(읽기만) — 이안카 실제 페이지 구조를 찍는다. 아무것도 쓰지 않는다.
 * ⚠ 2026-09-17 — ianka.com(로마자)은 도메인 판매 파킹 페이지였다. 실제 주소는 한글 도메인
 *   https://xn--le5bt3bwxk.com/ (punycode) · <title>이안카 렌터카 요금표. 회원/약관은
 *   eancar.co.kr 로 링크돼 있어 그 플랫폼도 같이 본다.
 * 이 세션(샌드박스)은 일반 웹사이트 접근이 막혀 있어(ironrentcar.com도 마찬가지) 여기서
 * GitHub Actions(열린 인터넷)로 한 번 열어보고, 그 결과로 실제 어댑터(lib/adapters/ianka-web.ts 류)를 짠다.
 *   npx tsx scripts/diag-ianka-site.mts
 */
import { load } from 'cheerio';
const S = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');

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

function dump(html: string, label: string, baseUrl: string) {
  console.log(`\n■ ${label} — 길이 ${html.length}`);
  const $ = load(html);
  console.log(`  <title>: ${S($('title').first().text())}`);
  console.log(`  테이블 ${$('table').length}개 · tr ${$('tr').length}개 · iframe ${$('iframe').length}개`);
  $('iframe').each((i, el) => console.log(`    iframe[${i}] src=${$(el).attr('src') || ''}`));
  // 표 내용을 최대 20행까지 실제로 찍는다 — 가격표라면 여기 다 있을 것.
  $('table').each((ti, table) => {
    console.log(`  --- table[${ti}] ---`);
    $(table).find('tr').slice(0, 20).each((ri, tr) => {
      const cells = $(tr).find('th,td').map((_, c) => S($(c).text())).get();
      if (cells.some(Boolean)) console.log(`    row[${ri}]: ${cells.join(' | ')}`);
    });
  });
  // 표가 없으면 차/가격/모델스러운 블록을 텍스트로 훑는다.
  if ($('table').length === 0) {
    const keyworded = $('*').filter((_, el) => {
      const t = S($(el).text());
      return t.length > 0 && t.length < 200 && /차량|모델|보증금|대여료|월\s*\d|평생무사고|출고|렌트/.test(t);
    });
    console.log(`  표 없음 — 키워드 포함 짧은 블록 ${keyworded.length}개(최대 30개 표본):`);
    keyworded.slice(0, 30).each((_, el) => console.log(`    <${(el as any).tagName}> ${S($(el).text()).slice(0, 120)}`));
  }
  // 링크 전체 — 상세페이지·다른 도메인 후보를 본다.
  const hrefs = [...new Set($('a[href]').map((_, el) => $(el).attr('href') || '').get())].filter(Boolean);
  console.log(`  링크(유니크) ${hrefs.length}개:`);
  for (const h of hrefs.slice(0, 60)) console.log(`    ${h}`);
}

const HOME = 'https://xn--le5bt3bwxk.com';
try {
  const html = await fetchHtml(HOME);
  dump(html, '이안카 홈(요금표)', HOME);
} catch (e) {
  console.error(`  ⛔ 홈 실패: ${(e as Error).message}`);
}

try {
  const html = await fetchHtml('https://eancar.co.kr');
  dump(html, 'eancar.co.kr 홈', 'https://eancar.co.kr');
} catch (e) {
  console.error(`  ⛔ eancar.co.kr 실패: ${(e as Error).message}`);
}
