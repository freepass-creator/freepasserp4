/**
 * 진단 전용 — 이안카 기간별(1~60개월) 요금이 어디서 오는지, plain fetch로 계속 판다.
 * 헤드리스 브라우저(diag-ianka-pricing.mts)는 Cloudflare 챌린지에 3회 다 막혔다(2026-09-17 실측)
 * — plain fetch는 로그인·재고 API 둘 다 문제없이 통과했으니(diag-ianka-inventory-api.mts) 그 길을 계속 쓴다.
 * 로그인 뒤 인증된 홈 페이지 HTML을 받아 <script> 안 RSC 페이로드·API 경로 흔적을 찾고,
 * 차량 상세 라우트 패턴을 찾으면 하나 직접 불러 요금 흔적을 본다. 비밀번호는 로그에 안 찍는다.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-pricing-api.mts
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

async function req(method: string, path: string, body?: unknown): Promise<{ res: Response; text: string }> {
  const res = await fetch(`${HOME}${path}`, {
    method,
    headers: {
      'User-Agent': 'FreepassERP/4 diag (readonly)',
      Cookie: cookies.join('; '),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  mergeCookies(res);
  const text = await res.text();
  console.log(`${method} ${path} → ${res.status} (길이 ${text.length}자)`);
  return { res, text };
}

// 1) 로그인
await req('GET', '/login');
const login = await req('POST', '/api/auth/login', { login: account.email, password: account.password });
if (!login.res.ok) {
  console.log('■ 로그인 실패 — 중단');
  console.log(login.text.slice(0, 500));
  process.exit(1);
}
console.log(`■ 로그인 성공 — 쿠키: ${cookies.map((c) => c.split('=')[0]).join(', ')}`);

// 2) 인증된 홈 페이지에서 API·라우트 흔적을 찾는다
const home = await req('GET', '/');
const rateKeyMatches = [...new Set([...home.text.matchAll(/["'`](\/api\/[a-zA-Z0-9/_-]*(?:rate|price|quote|fare|fee)[a-zA-Z0-9/_-]*)["'`]/gi)].map((m) => m[1]))];
console.log(`\n■ 홈 HTML 안 rate/price/quote/fare 비슷한 API 경로 ${rateKeyMatches.length}개`);
for (const m of rateKeyMatches) console.log(`  ${m}`);

const vehicleRouteMatches = [...new Set([...home.text.matchAll(/["'`](\/vehicles?\/[a-zA-Z0-9/_-]+|\/car\/[a-zA-Z0-9/_-]+|\/inventory\/[a-zA-Z0-9/_-]+)["'`]/gi)].map((m) => m[1]))];
console.log(`\n■ 홈 HTML 안 차량 상세 라우트 후보 ${vehicleRouteMatches.length}개`);
for (const m of vehicleRouteMatches.slice(0, 20)) console.log(`  ${m}`);

const scriptSrcs = [...new Set([...home.text.matchAll(/<script[^>]+src="([^"]+)"/gi)].map((m) => m[1]))].filter((s) => !s.includes('chunk-'));
console.log(`\n■ 홈 페이지 script src ${scriptSrcs.length}개(축약)`);
for (const s of scriptSrcs.slice(0, 15)) console.log(`  ${s}`);

// 3) 재고 API에서 얻은 vehicleNo 하나로 상세 API/페이지를 직접 두들겨본다
const inv = await req('GET', '/api/inventory');
let sampleVehicleNo = '';
let samplePlate = '';
try {
  const parsed = JSON.parse(inv.text) as { models: { units: { vehicleNo: string; plate: string }[] }[] };
  const firstUnit = parsed.models?.[0]?.units?.[0];
  sampleVehicleNo = firstUnit?.vehicleNo || '';
  samplePlate = firstUnit?.plate || '';
} catch {
  // 무시 — 이미 diag-ianka-inventory-api.mts 에서 구조를 확인했다.
}
console.log(`\n■ 표본 차량 vehicleNo=${sampleVehicleNo} plate=${samplePlate}`);

if (sampleVehicleNo) {
  const candidates = [
    `/api/vehicle/${sampleVehicleNo}`,
    `/api/vehicles/${sampleVehicleNo}`,
    `/api/inventory/${sampleVehicleNo}`,
    `/api/rate?vehicleNo=${sampleVehicleNo}`,
    `/api/rates?vehicleNo=${sampleVehicleNo}`,
    `/api/quote?vehicleNo=${sampleVehicleNo}`,
    `/vehicles/${sampleVehicleNo}`,
    `/vehicle/${sampleVehicleNo}`,
  ];
  for (const path of candidates) {
    try {
      const { res, text } = await req('GET', path);
      if (res.ok) {
        const hasRateWord = /rate|요금|대여료|보증금|deposit|price/i.test(text);
        console.log(`  ↳ 200, 요금 단어 포함=${hasRateWord}, 표본: ${text.slice(0, 300).replace(/\n/g, ' ')}`);
      }
    } catch (e) {
      console.log(`  ↳ 에러: ${(e as Error).message}`);
    }
  }
}
