/**
 * 진단 전용 — 이안카 /api/inventory 로 「출고 가능(available)」 대수를 정확히 센다.
 * 최상위 total/fleetTotal/reservedTotal 값과, models[].units[] 를 status별로 실제로 세어
 * 서로 맞는지 대조한다(문서화 없이 숫자만 보면 어느 게 「출고가능」인지 모른다).
 *   IANKA_ACCOUNT_JSON='{"email":"...","password":"..."}' npx tsx scripts/diag-ianka-availability.mts
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

await req('GET', '/login');
const login = await req('POST', '/api/auth/login', { login: account.email, password: account.password });
if (!login.res.ok) {
  console.log('■ 로그인 실패 — 중단');
  process.exit(1);
}

type Unit = { name: string; plate: string; vehicleNo: string; status: string; available: boolean; affiliation: string; dispatchLocation: string };
type Inventory = {
  models: { name: string; count: number; units: Unit[] }[];
  reservedVehicles: { name: string; plate: string; vehicleNo: string; reservedAt: string }[];
  reservedTotal: number;
  fleetTotal: number;
  total: number;
  syncedAt: string;
  source: string;
  stale: boolean;
};

const inv = await req('GET', '/api/inventory');
const data = JSON.parse(inv.text) as Inventory;

console.log(`\n■ 최상위 숫자 — total=${data.total} · fleetTotal=${data.fleetTotal} · reservedTotal=${data.reservedTotal} · stale=${data.stale} · syncedAt=${data.syncedAt} · source=${data.source}`);

const allUnits = data.models.flatMap((m) => m.units);
console.log(`■ models 배열 실측 — 모델 ${data.models.length}종, 차량 합계 ${allUnits.length}대`);

const byStatus = new Map<string, number>();
for (const u of allUnits) byStatus.set(u.status, (byStatus.get(u.status) || 0) + 1);
console.log('■ status별 실측 대수:');
for (const [status, count] of byStatus) console.log(`  ${status}: ${count}대`);

const availableTrue = allUnits.filter((u) => u.available === true).length;
const availableFalse = allUnits.filter((u) => u.available === false).length;
console.log(`■ available 필드 기준 — true(출고가능)=${availableTrue}대 · false=${availableFalse}대`);

console.log(`\n■ reservedVehicles(예약중) 배열 실측 — ${data.reservedVehicles.length}대`);

const byAffiliation = new Map<string, number>();
for (const u of allUnits) byAffiliation.set(u.affiliation, (byAffiliation.get(u.affiliation) || 0) + 1);
console.log('■ affiliation(소속)별 실측 대수:');
for (const [aff, count] of byAffiliation) console.log(`  ${aff}: ${count}대`);
