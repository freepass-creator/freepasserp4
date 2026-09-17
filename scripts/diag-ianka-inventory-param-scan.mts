/**
 * 진단 전용 — rate-app-*.js 번들 실측(2026-09-17)에서 두 단서를 찾았다:
 *   1) fetch(`/api/inventory${n}`, {cache:'no-store'})  ← 우리가 지금까지 부른 /api/inventory와
 *      다르게 뒤에 쿼리 조각(n)이 붙는 호출이 있다. 그 안에 요금이 같이 내려올 수 있다.
 *   2) fetch(`/api/rates`)  ← 파라미터 없는 «순수 GET»도 있다. 우리가 전에 부른 건
 *      `/api/rates?vehicleNo=...`(403)뿐이었다 — 파라미터 없이, 그리고 body 없이 다시 시도한다.
 * 이 스크립트는 그 두 호출을 있는 그대로(파라미터 없이) 재현하고, 번들에서 "n"이 뭘로
 * 만들어지는지 문맥도 넓게 뽑는다.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-inventory-param-scan.mts
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
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  mergeCookies(res);
  const text = await res.text();
  console.log(`${method} ${path} → ${res.status} (길이 ${text.length}자)`);
  return { res, text };
}

function 요금패턴스캔(label: string, text: string) {
  const priceLike = [...text.matchAll(/"[\wㄱ-힣]*(?:rate|price|fare|fee|charge|amount|월대여료|요금|대여료|보증금|deposit|months?|개월)[\wㄱ-힣]*"\s*:\s*"?[\d,\[{]/gi)];
  const wonNumbers = [...text.matchAll(/(\d{1,3}(?:,\d{3})+)\s*원/g)];
  console.log(`  [${label}] 요금 키 매칭 ${priceLike.length}건 · "N,NNN원" 패턴 ${wonNumbers.length}건`);
  for (const m of priceLike.slice(0, 20)) console.log(`    ${m[0]}`);
  for (const m of wonNumbers.slice(0, 20)) console.log(`    ${m[0]}`);
}

// 1) 로그인
await req('GET', '/login');
const loginRes = await fetch(`${HOME}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookies.join('; ') },
  body: JSON.stringify({ login: account.email, password: account.password }),
});
mergeCookies(loginRes);
console.log(`로그인 → ${loginRes.status}`);
if (!loginRes.ok) process.exit(1);

// 2) 번들에서 "n"이 뭘로 만들어지는지 문맥을 넓게 뽑는다
const bundle = await req('GET', '/assets/rate-app-TlBSMRpG.js');
const idx = bundle.text.indexOf('/api/inventory${n}');
if (idx >= 0) {
  console.log('\n■ /api/inventory${n} 주변 문맥(앞 400자):');
  console.log(bundle.text.slice(Math.max(0, idx - 400), idx + 100));
}
const idx2 = bundle.text.indexOf('`/api/rates`)');
if (idx2 >= 0) {
  console.log('\n■ fetch(`/api/rates`) 주변 문맥(앞 400자):');
  console.log(bundle.text.slice(Math.max(0, idx2 - 400), idx2 + 100));
}

// 3) 실제로 두들겨본다 — 파라미터 없이
console.log('\n■ 실제 호출 — 파라미터 없이');
const bare = await req('GET', '/api/rates');
if (bare.res.ok) 요금패턴스캔('GET /api/rates(파라미터없음)', bare.text);
else console.log(`  본문: ${bare.text.slice(0, 300)}`);

const plainInv = await req('GET', '/api/inventory');
let vehicleNo = '';
try {
  const parsed = JSON.parse(plainInv.text) as { models: { units: { vehicleNo: string }[] }[] };
  vehicleNo = parsed.models?.[0]?.units?.[0]?.vehicleNo || '';
} catch {}
console.log(`■ 표본 vehicleNo=${vehicleNo}`);

// 4) /api/inventory 뒤에 흔히 붙을 법한 쿼리들을 다 시도한다
const suffixes = [
  '', '?months=12', '?includeRates=1', '?withRates=1', '?rates=1', '?detail=1',
  `?vehicleNo=${vehicleNo}`, `/${vehicleNo}`, `?id=${vehicleNo}`, '?view=rates', '?expand=rates',
];
for (const suf of suffixes) {
  const { res, text } = await req('GET', `/api/inventory${suf}`);
  if (res.ok) 요금패턴스캔(`/api/inventory${suf}`, text);
}
