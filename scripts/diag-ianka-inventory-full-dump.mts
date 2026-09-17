/**
 * 진단 전용 — /api/inventory 응답을 «전체」 덤프한다. 지금까지는 models[].units[].vehicleNo 같은
 * 특정 필드만 골라서 봤지, model 레벨에 요금(terms 등)이 이미 박혀있는지는 안 봤다.
 * rate-app-TlBSMRpG.js에서 찾은 `L?.terms.find(e=>e.months===_)?.rental` 구조가 어디서 채워지는지
 * 확인하려면, 관리자 전용 /api/rates 말고 손님이 실제로 보는 데이터 흐름(=/api/inventory 자체
 * 또는 그 안의 모델 객체)에 이미 있는지부터 봐야 한다.
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-inventory-full-dump.mts
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

async function req(path: string): Promise<string> {
  const res = await fetch(`${HOME}${path}`, {
    headers: { 'User-Agent': 'FreepassERP/4 diag (readonly)', Cookie: cookies.join('; ') },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  mergeCookies(res);
  const text = await res.text();
  console.log(`GET ${path} → ${res.status} (길이 ${text.length}자)`);
  return text;
}

await req('/login');
const loginRes = await fetch(`${HOME}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookies.join('; ') },
  body: JSON.stringify({ login: account.email, password: account.password }),
});
mergeCookies(loginRes);
console.log(`로그인 → ${loginRes.status}`);
if (!loginRes.ok) process.exit(1);

const text = await req('/api/inventory');
let parsed: any;
try {
  parsed = JSON.parse(text);
} catch (e) {
  console.log('JSON 파싱 실패:', (e as Error).message);
  process.exit(1);
}

console.log('\n■ 최상위 키:', Object.keys(parsed));
const firstModel = parsed.models?.[0];
console.log('\n■ 첫 모델 객체의 키:', firstModel ? Object.keys(firstModel) : '(models 없음)');
console.log('\n■ 첫 모델 객체 전체(JSON):');
console.log(JSON.stringify(firstModel, null, 1).slice(0, 3000));

const firstUnit = firstModel?.units?.[0];
console.log('\n■ 첫 유닛 객체의 키:', firstUnit ? Object.keys(firstUnit) : '(units 없음)');
console.log('\n■ 첫 유닛 객체 전체(JSON):');
console.log(JSON.stringify(firstUnit, null, 1));

// terms/rate 비슷한 키가 어디 있는지 전체 텍스트에서 찾는다
const termsLike = [...text.matchAll(/"[\wㄱ-힣]*(?:term|rate|price|fare|fee|rental|요금|대여료|보증금)[\wㄱ-힣]*"\s*:/gi)];
console.log(`\n■ "term/rate/price/rental/요금" 비슷한 키 매칭 ${termsLike.length}건:`);
for (const m of termsLike.slice(0, 30)) console.log(`  ${m[0]}`);

// ── rate-app 말고 다른 번들(손님이 실제로 보는 목록/상세 화면일 수 있는 index-*.js)에서
//    ".terms" 사용처와 fetch 호출을 넓게 훑는다. rate-app은 로딩문구가 "관리자 데이터를
//    불러오는 중..."이라 관리자 대시보드 모듈일 가능성이 크다 — 손님 화면은 다른 파일일 수 있다.
async function reqAsset(path: string): Promise<string> {
  const res = await fetch(`${HOME}${path}`, {
    headers: { 'User-Agent': 'FreepassERP/4 diag (readonly)', Cookie: cookies.join('; ') },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });
  mergeCookies(res);
  const t = await res.text();
  console.log(`GET ${path} → ${res.status} (길이 ${t.length}자)`);
  return t;
}

const otherBundles = [
  '/assets/index-C5VsXIGz.js',
  '/assets/framework-CXnKph_e.js',
];
for (const path of otherBundles) {
  const b = await reqAsset(path);
  console.log(`\n========== ${path} ==========`);
  const calls = [...b.matchAll(/(fetch|axios\.\w+)\s*\(\s*([^)]{0,150})/g)];
  console.log(`  fetch/axios 호출부 ${calls.length}건:`);
  for (const c of calls.slice(0, 40)) console.log(`    ${c[1]}(${c[2]})`);
  const termsIdx: number[] = [];
  let idx = b.indexOf('.terms');
  while (idx >= 0 && termsIdx.length < 10) {
    termsIdx.push(idx);
    idx = b.indexOf('.terms', idx + 1);
  }
  console.log(`  ".terms" 등장 ${termsIdx.length}건(최대10 표시):`);
  for (const i of termsIdx) console.log(`    …${b.slice(Math.max(0, i - 150), i + 50)}…`);
  const urlLike = [...new Set([...b.matchAll(/["'`](\/[a-zA-Z0-9][a-zA-Z0-9/_.-]{2,60})["'`]/g)].map((m) => m[1]))]
    .filter((s) => !s.match(/\.(png|jpg|jpeg|webp|svg|css|woff2?|js|mjs)$/i));
  console.log(`  경로 비슷한 문자열 ${urlLike.length}개: ${urlLike.slice(0, 40).join(', ')}`);
}
