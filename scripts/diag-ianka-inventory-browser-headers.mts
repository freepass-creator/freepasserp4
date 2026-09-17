/**
 * 진단 전용 — 실 브라우저 네트워크 캡처(2026-09-17)에서 결정적 증거를 찾았다: 홈에서
 * 요금이 렌더링될 때 호출된 API는 «/api/inventory 딱 하나뿐»이었다. /api/rates는 아예
 * 호출되지 않았다. 그런데 우리가 plain fetch(User-Agent: FreepassERP/4 diag)로 부른
 * /api/inventory는 rateOverride:null만 있고 요금이 없었다 — 헤더 차이(Accept·
 * sec-ch-ua·Referer 등 브라우저다움) 때문에 서버가 축소판을 준 것으로 보인다.
 * plain fetch에 브라우저 헤더를 그대로 흉내 내서 /api/inventory를 다시 불러본다.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-inventory-browser-headers.mts
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

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  Referer: `${HOME}/`,
};

async function req(path: string, extraHeaders: Record<string, string> = {}): Promise<{ res: Response; text: string }> {
  const res = await fetch(`${HOME}${path}`, {
    headers: { ...BROWSER_HEADERS, ...extraHeaders, Cookie: cookies.join('; ') },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  mergeCookies(res);
  const text = await res.text();
  console.log(`GET ${path} → ${res.status} (길이 ${text.length}자)`);
  return { res, text };
}

await req('/login');
const loginRes = await fetch(`${HOME}/api/auth/login`, {
  method: 'POST',
  headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/json', Cookie: cookies.join('; ') },
  body: JSON.stringify({ login: account.email, password: account.password }),
});
mergeCookies(loginRes);
console.log(`로그인 → ${loginRes.status}`);
if (!loginRes.ok) process.exit(1);

const { text } = await req('/api/inventory', { Accept: 'application/json, text/plain, */*', 'Sec-Fetch-Dest': 'empty' });
let parsed: any;
try {
  parsed = JSON.parse(text);
} catch (e) {
  console.log('JSON 파싱 실패:', (e as Error).message, text.slice(0, 500));
  process.exit(1);
}
const firstUnit = parsed.models?.[0]?.units?.[0];
console.log('\n■ 첫 유닛 객체의 키:', firstUnit ? Object.keys(firstUnit) : '(없음)');
console.log('\n■ 첫 유닛 객체 전체(JSON):');
console.log(JSON.stringify(firstUnit, null, 1));

const termsLike = [...text.matchAll(/"[\wㄱ-힣]*(?:term|rate|price|fare|fee|rental|요금|대여료|보증금)[\wㄱ-힣]*"\s*:/gi)];
console.log(`\n■ "term/rate/price/rental/요금" 비슷한 키 매칭 ${termsLike.length}건`);
for (const m of [...new Set(termsLike.map((m) => m[0]))].slice(0, 20)) console.log(`  ${m}`);

const wonNumbers = [...text.matchAll(/(\d{1,3}(?:,\d{3})+)\s*원/g)];
console.log(`\n■ "N,NNN원" 패턴 ${wonNumbers.length}건`);
for (const m of wonNumbers.slice(0, 10)) console.log(`  ${m[0]}`);
