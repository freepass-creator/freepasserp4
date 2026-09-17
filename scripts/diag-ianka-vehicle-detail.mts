/**
 * 진단 전용 — 이안카(EANCAR) /api/vehicle-detail 을 확인한다.
 * JS 번들 스캔(diag-ianka-js-bundle-scan.mts)에서 찾은 새 경로 — /api/rates 계열은
 * 전부 관리자 전용 쓰기였지만 /api/vehicle-detail·/api/vehicle-engagement 는 아직 안 두들겨봤다.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-vehicle-detail.mts
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

async function req(method: string, path: string): Promise<{ res: Response; text: string }> {
  const res = await fetch(`${HOME}${path}`, {
    method,
    headers: { 'User-Agent': 'FreepassERP/4 diag (readonly)', Cookie: cookies.join('; ') },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  mergeCookies(res);
  const text = await res.text();
  console.log(`${method} ${path} → ${res.status} (길이 ${text.length}자)`);
  return { res, text };
}

await req('GET', '/login');
const loginRes = await fetch(`${HOME}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookies.join('; ') },
  body: JSON.stringify({ login: account.email, password: account.password }),
});
mergeCookies(loginRes);
if (!loginRes.ok) { console.log('로그인 실패'); process.exit(1); }
console.log('로그인 성공');

const inv = await req('GET', '/api/inventory');
let vehicleNo = '';
try {
  const parsed = JSON.parse(inv.text) as { models: { units: { vehicleNo: string }[] }[] };
  vehicleNo = parsed.models?.[0]?.units?.[0]?.vehicleNo || '';
} catch {}
console.log(`표본 vehicleNo=${vehicleNo}`);

const candidates = [
  `/api/vehicle-detail?vehicleNo=${vehicleNo}`,
  `/api/vehicle-detail/${vehicleNo}`,
  `/api/vehicle-detail?id=${vehicleNo}`,
  `/api/vehicle-engagement?vehicleNo=${vehicleNo}`,
];
for (const path of candidates) {
  const { res, text } = await req('GET', path);
  if (res.ok) {
    console.log(`  본문 전체길이: ${text.length}자`);
    const rateLike = [...text.matchAll(/"[\wㄱ-힣]*(?:rate|price|fare|fee|charge|amount|월대여료|요금|대여료|보증금|deposit|months?|개월)[\wㄱ-힣]*"\s*:\s*"?[\d,\[{]/gi)];
    console.log(`  요금 비슷한 키 ${rateLike.length}건`);
    for (const m of rateLike.slice(0, 30)) console.log(`    ${m[0]}`);
    const wonNumbers = [...text.matchAll(/(\d{1,3}(?:,\d{3})+)\s*원/g)];
    console.log(`  "N,NNN원" 패턴 ${wonNumbers.length}건`);
    for (const m of wonNumbers.slice(0, 10)) console.log(`    ${m[0]}`);
    console.log(`  전체 본문:\n${text}`);
  } else {
    console.log(`  본문: ${text.slice(0, 200)}`);
  }
}
