/**
 * 진단 전용 — 이안카(EANCAR) 요금을 REST API가 아니라 «페이지 자체의 RSC 스트림»에서 찾는다.
 * 지금까지는 "/api/..." 문자열 리터럴만 스캔했다(diag-ianka-js-bundle-scan.mts) — 그런데
 * Next.js App Router는 서버 컴포넌트가 서버에서 직접 데이터를 읽어 페이지 HTML 안에
 * self.__next_f.push([...]) 형태의 RSC 청크로 «인라인」한다. 즉 요금이 별도 API 호출 없이
 * 차량 상세 페이지 자체의 HTML 응답 안에 처음부터 박혀 있을 수 있다.
 * 이 스크립트는:
 *  1) 홈 HTML에서 "/api/"가 아닌 실제 페이지 링크(차량 상세로 보이는 href)를 모은다.
 *  2) 그 페이지들을 실제로 받아 __next_f.push(...) RSC 청크를 전부 이어붙인다.
 *  3) 그 안에서 요금 비슷한 키·"N,NNN원" 패턴을 찾는다.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-page-rate-scan.mts
 */
const HOME = 'https://xn--le5bt3bwxk.com';
const account = JSON.parse(process.env.IANKA_ACCOUNT_JSON || '{}') as { email?: string; password?: string };
if (!account.email || !account.password) throw new Error('IANKA_ACCOUNT_JSON에 email/password가 없다');

let cookies: string[] = [];
function mergeCookies(res: Response) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const pair = c.split(';')[0];
    const name = pair.split('=')[0];
    cookies = cookies.filter((existing) => !existing.startsWith(`${name}=`));
    cookies.push(pair);
  }
}

async function req(path: string, extraHeaders: Record<string, string> = {}): Promise<{ res: Response; text: string }> {
  const res = await fetch(path.startsWith('http') ? path : `${HOME}${path}`, {
    headers: { 'User-Agent': 'FreepassERP/4 diag (readonly)', Cookie: cookies.join('; '), ...extraHeaders },
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  mergeCookies(res);
  const text = await res.text();
  console.log(`GET ${path} → ${res.status} (길이 ${text.length}자)`);
  return { res, text };
}

function 요금패턴스캔(label: string, text: string) {
  const priceLike = [...text.matchAll(/"[\wㄱ-힣]*(?:rate|price|fare|fee|charge|amount|월대여료|요금|대여료|보증금|deposit|months?|개월)[\wㄱ-힣]*"\s*:\s*"?[\d,\[{]/gi)];
  const wonNumbers = [...text.matchAll(/(\d{1,3}(?:,\d{3})+)\s*원/g)];
  console.log(`  [${label}] 요금 키 매칭 ${priceLike.length}건 · "N,NNN원" 패턴 ${wonNumbers.length}건`);
  for (const m of priceLike.slice(0, 20)) console.log(`    ${m[0]}`);
  for (const m of wonNumbers.slice(0, 20)) console.log(`    ${m[0]}`);
  return priceLike.length + wonNumbers.length;
}

// 1) 로그인
await req('/login');
const loginRes = await fetch(`${HOME}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookies.join('; ') },
  body: JSON.stringify({ login: account.email, password: account.password }),
});
mergeCookies(loginRes);
console.log(`로그인 → ${loginRes.status}`);
if (!loginRes.ok) process.exit(1);

// 2) 재고 API에서 표본 차량 하나 확보
const inv = await req('/api/inventory');
let vehicleNo = '';
let modelName = '';
try {
  const parsed = JSON.parse(inv.text) as { models: { name: string; units: { vehicleNo: string }[] }[] };
  modelName = parsed.models?.[0]?.name || '';
  vehicleNo = parsed.models?.[0]?.units?.[0]?.vehicleNo || '';
} catch {}
console.log(`■ 표본 vehicleNo=${vehicleNo} modelName=${modelName}`);

// 3) 홈 HTML(일반, RSC 헤더 없이)에서 "/api/"가 아닌 내부 링크(href="/...")를 전부 모은다
const home = await req('/');
const internalLinks = new Set<string>();
for (const m of home.text.matchAll(/href="(\/[^"]*)"/g)) {
  const href = m[1];
  if (!href.startsWith('/api/') && !href.startsWith('/_next/') && href.length > 1) internalLinks.add(href);
}
console.log(`\n■ 홈에서 찾은 내부 링크 ${internalLinks.size}개`);
for (const l of internalLinks) console.log(`  ${l}`);

// 4) 홈 HTML 자체에 이미 __next_f.push RSC 청크가 있는지 먼저 본다(재고 목록이 홈에 있을 수 있음)
function extractNextF(html: string): string {
  const chunks: string[] = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\s*(\[.*?\])\s*\)/gs)) chunks.push(m[1]);
  return chunks.join('\n');
}
const homeRsc = extractNextF(home.text);
console.log(`\n■ 홈 HTML 안의 __next_f RSC 청크 합계 길이: ${homeRsc.length}자`);
요금패턴스캔('홈 RSC 인라인', homeRsc);

// 5) 후보 상세/견적 페이지들을 실제로 받아서 RSC 청크를 스캔한다
const candidates = [...internalLinks].filter((l) => /vehicle|car|estimate|quote|rent|product|detail/i.test(l));
if (vehicleNo) {
  candidates.push(`/${vehicleNo}`, `/vehicles/${vehicleNo}`, `/inventory/${vehicleNo}`, `/rentcar/${vehicleNo}`, `/car/${vehicleNo}`);
}
console.log(`\n■ 상세 페이지 후보 ${candidates.length}개 — 실제로 받아서 RSC 스캔`);
for (const path of [...new Set(candidates)]) {
  try {
    const { res, text } = await req(path);
    if (!res.ok) continue;
    const rsc = extractNextF(text);
    const hit = 요금패턴스캔(`${path} (RSC ${rsc.length}자, HTML ${text.length}자)`, rsc + '\n' + text);
    if (hit > 0) {
      console.log(`  ★★ ${path} 에서 요금 패턴 발견 — 전체 RSC 청크를 찍는다`);
      console.log(rsc.slice(0, 8000));
    }
  } catch (e) {
    console.log(`  ${path} 에러: ${(e as Error).message}`);
  }
}

// 6) JS 번들 안에서 "Next-Action" 서버 액션 흔적(POST 방식 데이터 조회)도 찾아본다
const jsPaths = new Set<string>();
for (const m of home.text.matchAll(/(?:href|src)="([^"]+\.(?:js|mjs))"/gi)) jsPaths.add(m[1]);
let actionIds = new Set<string>();
for (const jsPath of jsPaths) {
  try {
    const { text } = await req(jsPath);
    for (const m of text.matchAll(/"([a-f0-9]{40})"/g)) actionIds.add(m[1]);
  } catch {}
}
console.log(`\n■ JS 번들에서 발견된 40자리 hex(서버 액션 ID 후보) ${actionIds.size}개`);
for (const id of [...actionIds].slice(0, 10)) console.log(`  ${id}`);
