/**
 * 진단 전용 — 이안카(EANCAR) 홈의 "계약(약정)기간" 필터(1~60개월)를 바꾸면 요금이 어떻게 뜨는지 찾는다.
 * 이 사이트는 Next.js App Router RSC 구조다(로그인 흐름에서 GET /.rsc?_rsc=... 확인됨,
 * 2026-09-17 diag-ianka-login-playwright.mts 실측) — 즉 필터를 바꿀 때 REST API 가 아니라
 * «RSC 재요청»(홈 주소에 쿼리파라미터를 붙여 RSC 헤더로 다시 받는 방식)일 가능성이 높다.
 * 그래서 이번엔 홈 주소에 기간 관련 쿼리파라미터 후보를 붙여 RSC로 요청해보고,
 * 응답에 요금 패턴(원·요금·대여료 등)이 있는지 훑는다. 비밀번호는 로그에 안 찍는다.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-period-filter.mts
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

async function req(method: string, path: string, extraHeaders: Record<string, string> = {}, body?: unknown): Promise<{ res: Response; text: string }> {
  const res = await fetch(`${HOME}${path}`, {
    method,
    headers: {
      'User-Agent': 'FreepassERP/4 diag (readonly)',
      Cookie: cookies.join('; '),
      ...extraHeaders,
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

function 요금패턴스캔(label: string, text: string) {
  const priceLike = [...text.matchAll(/"[\wㄱ-힣]*(?:rate|price|fare|fee|월대여료|요금|대여료|보증금|deposit)[\wㄱ-힣]*"\s*:\s*"?[\d,]+/gi)];
  const wonNumbers = [...text.matchAll(/(\d{1,3}(?:,\d{3})+)\s*원/g)];
  console.log(`  [${label}] 요금 키 매칭 ${priceLike.length}건 · "N,NNN원" 패턴 ${wonNumbers.length}건`);
  for (const m of priceLike.slice(0, 5)) console.log(`    ${m[0]}`);
  for (const m of wonNumbers.slice(0, 5)) console.log(`    ${m[0]}`);
}

// 1) 로그인
await req('GET', '/login');
const login = await req('POST', '/api/auth/login', {}, { login: account.email, password: account.password });
if (!login.res.ok) { console.log('■ 로그인 실패'); process.exit(1); }
console.log('■ 로그인 성공');

// 2) 홈(기간 파라미터 없이) — RSC 요청으로 받아본다
const rscHeaders = { RSC: '1', 'Next-Router-State-Tree': '', Accept: 'text/x-component' };
const home = await req('GET', '/', rscHeaders);
요금패턴스캔('홈 RSC(기간없음)', home.text);

// 3) 기간 파라미터 후보들을 붙여서 다시 받아본다
const paramNames = ['months', 'month', 'period', 'term', 'contractMonths', 'rentMonths', '개월', 'duration'];
for (const name of paramNames) {
  const { text } = await req('GET', `/?${name}=12`, rscHeaders);
  요금패턴스캔(`?${name}=12`, text);
}

// 4) 일반 HTML(RSC 헤더 없이)로도 한 번 — 서버가 RSC 헤더를 요구하는지 확인
const plain = await req('GET', '/?months=12');
요금패턴스캔('평범한 HTML ?months=12', plain.text);

// 5) 첫 차량 하나로 상세/견적류 라우트 후보를 다시 두들겨본다(재고 API에서 얻은 vehicleNo 사용)
const inv = await req('GET', '/api/inventory');
let vehicleNo = '';
try {
  const parsed = JSON.parse(inv.text) as { models: { units: { vehicleNo: string }[] }[] };
  vehicleNo = parsed.models?.[0]?.units?.[0]?.vehicleNo || '';
} catch {}
console.log(`■ 표본 vehicleNo=${vehicleNo}`);
if (vehicleNo) {
  const candidates = [
    `/${vehicleNo}`,
    `/vehicles/${vehicleNo}`,
    `/inventory/${vehicleNo}`,
    `/estimate/${vehicleNo}`,
    `/quote/${vehicleNo}`,
    `/api/rates?carId=${vehicleNo}`,
    `/api/rates?id=${vehicleNo}`,
    `/api/estimate?vehicleNo=${vehicleNo}&months=12`,
    `/api/quote?vehicleNo=${vehicleNo}&months=12`,
  ];
  for (const path of candidates) {
    const { res, text } = await req('GET', path, rscHeaders);
    if (res.ok) 요금패턴스캔(path, text);
  }

  // 6) /api/rates 는 파라미터를 바꿔도 계속 403 — 그 403 응답 본문과 POST 방식도 본다.
  const getRates = await req('GET', `/api/rates?vehicleNo=${vehicleNo}`);
  console.log(`■ GET /api/rates 403 본문: ${getRates.text}`);
  const postRates = await req('POST', '/api/rates', {}, { vehicleNo, months: 12 });
  console.log(`■ POST /api/rates 본문: ${postRates.text.slice(0, 300)}`);
  const postRates2 = await req('POST', '/api/rates', {}, { vehicleNo, months: [1, 3, 6, 12, 24, 36, 48, 60] });
  console.log(`■ POST /api/rates(배열) 본문: ${postRates2.text.slice(0, 300)}`);
}
