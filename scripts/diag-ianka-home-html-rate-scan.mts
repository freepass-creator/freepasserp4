/**
 * 진단 전용 — 응답 헤더에 `Vary: RSC, Next-Router-State-Tree, ...`가 있다 — 이 사이트는
 * 진짜 Next.js RSC 서버다. 홈 HTML이 610KB나 되는데 지금까지 __next_f RSC 청크만
 * 찾아봤지(0건), 원본 HTML 텍스트 자체에서 요금 패턴을 직접 스캔한 적이 없다.
 * b2b 회원(admin 아님)인 우리 계정도 브라우저로는 요금을 본다(사장님 확인) — 즉 서버가
 * «페이지 렌더링 시점에» 이미 합쳐서 HTML 안에 박아 보내고 있을 가능성이 크다.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-home-html-rate-scan.mts
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
  const res = await fetch(`${HOME}${path}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 FreepassERP diag', Cookie: cookies.join('; '), ...extraHeaders },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  mergeCookies(res);
  const text = await res.text();
  console.log(`GET ${path} → ${res.status} (길이 ${text.length}자)`);
  return { res, text };
}

function 요금패턴스캔(label: string, text: string) {
  const priceLike = [...text.matchAll(/"[\wㄱ-힣]*(?:rate|price|fare|fee|charge|amount|rental|월대여료|요금|대여료|보증금|deposit|months?|개월|terms)[\wㄱ-힣]*"\s*:\s*"?[\d,\[{]/gi)];
  const wonNumbers = [...text.matchAll(/(\d{1,3}(?:,\d{3})+)\s*원/g)];
  const termsWord = [...text.matchAll(/.{60}\.terms.{60}/g)];
  console.log(`  [${label}] 요금 키 매칭 ${priceLike.length}건 · "N,NNN원" 패턴 ${wonNumbers.length}건 · ".terms" 문맥 ${termsWord.length}건`);
  for (const m of priceLike.slice(0, 15)) console.log(`    ${m[0]}`);
  for (const m of wonNumbers.slice(0, 15)) console.log(`    ${m[0]}`);
  for (const m of termsWord.slice(0, 10)) console.log(`    …${m[0]}…`);
}

// 로그인
await req('/login');
const loginRes = await fetch(`${HOME}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookies.join('; ') },
  body: JSON.stringify({ login: account.email, password: account.password }),
});
mergeCookies(loginRes);
console.log(`로그인 → ${loginRes.status}`);
if (!loginRes.ok) process.exit(1);

// 홈을 일반 브라우저처럼 받는다(Accept: text/html)
const home = await req('/', { Accept: 'text/html,application/xhtml+xml' });
console.log(`\n■ 홈 HTML 전체 길이: ${home.text.length}자`);
요금패턴스캔('홈 HTML 원본', home.text);

// __next_f RSC 청크도 다시 확인(전에는 0건이었는데 재확인)
const chunks: string[] = [];
for (const m of home.text.matchAll(/self\.__next_f\.push\(\s*(\[.*?\])\s*\)/gs)) chunks.push(m[1]);
console.log(`\n■ __next_f RSC 청크 ${chunks.length}건, 합계 길이: ${chunks.join('').length}자`);

// 혹시 <script id="__NEXT_DATA__"> 같은 고전 Next.js 데이터도 있는지
const nextDataMatch = home.text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
if (nextDataMatch) {
  console.log(`\n■ __NEXT_DATA__ 발견, 길이: ${nextDataMatch[1].length}자`);
  요금패턴스캔('__NEXT_DATA__', nextDataMatch[1]);
} else {
  console.log('\n■ __NEXT_DATA__ 없음');
}

// 홈 HTML 안에서 "차량/렌트" 목록이 실제로 서버사이드 렌더링됐는지 — 대표적인 태그/클래스 확인
console.log('\n■ 홈 HTML 앞부분 2000자(구조 확인용):');
console.log(home.text.slice(0, 2000));
