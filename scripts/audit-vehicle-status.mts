/**
 * 차량상태 백필 조사 — **읽기 전용. 아무것도 쓰지 않는다.**
 * 옛 규칙(계약 진행=출고불가)으로 박힌 재고가 몇 대인지, 그중 실제로 살아있는 계약이 붙은 건 몇 대인지 센다.
 *   실행: npx tsx scripts/audit-vehicle-status.mts
 *
 * 읽기 경로 = RTDB REST. products/policies 는 .read:true 라 비로그인으로 읽힌다.
 * contracts 는 admin 또는 스코프 쿼리만 허용 → 비로그인은 거부된다. 거부되면 그 사실을 그대로 출력하고
 * "계약 대조 불가" 상태로 매물 통계만 낸다(추정으로 메우지 않는다).
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const DB = String(env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
if (!DB) { console.error('DATABASE_URL 없음 (.env.local)'); process.exit(1); }

type Rec = Record<string, unknown>;
const s = (v: unknown) => String(v ?? '').trim();

async function node(path: string): Promise<{ ok: true; val: Record<string, Rec> } | { ok: false; err: string }> {
  const res = await fetch(`${DB}/${path}.json`);
  if (!res.ok) return { ok: false, err: `HTTP ${res.status} ${(await res.text()).slice(0, 120)}` };
  const val = (await res.json()) as Record<string, Rec> | null;
  return { ok: true, val: val || {} };
}

console.log(`DB: ${DB}\n`);

// ── 매물 ──
const prodRes = await node('products');
if (!prodRes.ok) { console.error(`products 읽기 실패: ${prodRes.err}`); process.exit(1); }
const v4Res = await node('v4/products');
const overlay = v4Res.ok ? v4Res.val : {};
if (!v4Res.ok) console.log(`⚠ v4/products 읽기 실패(${v4Res.err}) — v3 원본만으로 집계합니다.\n`);

// 앱과 동일하게 v3 ∪ v4 오버레이 필드단위 병합.
const merged: Record<string, Rec> = {};
for (const [k, r] of Object.entries(prodRes.val)) if (r && typeof r === 'object') merged[k] = { ...r };
for (const [k, r] of Object.entries(overlay)) if (r && typeof r === 'object') merged[k] = { ...(merged[k] || {}), ...r };

const live = Object.entries(merged).filter(([, r]) => !r._deleted && !r.deletedAt);

const byStatus = new Map<string, number>();
for (const [, r] of live) {
  const st = s(r.vehicle_status) || '(빈값)';
  byStatus.set(st, (byStatus.get(st) || 0) + 1);
}

console.log('━━ 매물 상태 분포');
console.log(`총 ${live.length}대 (삭제 제외, v3∪v4 병합)`);
for (const [st, n] of [...byStatus].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)}  ${st}`);
}

const blocked = live.filter(([, r]) => s(r.vehicle_status) === '출고불가');
const claiming = live.filter(([, r]) => s(r.vehicle_status) === '계약중');
const owned = blocked.filter(([, r]) => s(r.locked_by_contract));

console.log(`\n━━ 조사 대상`);
console.log(`  출고불가: ${blocked.length}대  (이 중 락 주인 각인됨: ${owned.length}대 → 나머지 ${blocked.length - owned.length}대가 판단 대상)`);
console.log(`  계약중  : ${claiming.length}대`);

// ── 계약 대조 ──
const ctRes = await node('contracts');
const ctV4Res = await node('v4/contracts');
if (!ctRes.ok && !ctV4Res.ok) {
  console.log(`\n━━ 계약 대조 — 불가`);
  console.log(`  contracts    : ${ctRes.ok ? 'ok' : (ctRes as { err: string }).err}`);
  console.log(`  v4/contracts : ${ctV4Res.ok ? 'ok' : (ctV4Res as { err: string }).err}`);
  console.log(`  → 비로그인은 계약을 읽을 수 없습니다(규칙대로). 관리자 로그인 상태의 앱에서 돌려야 대조가 됩니다.`);
  console.log(`\n  현재로선 "출고불가 ${blocked.length}대 중 몇 대가 유효한 잠금인지" 알 수 없습니다.`);
  process.exit(0);
}

const contracts: Rec[] = [];
if (ctRes.ok) for (const [k, r] of Object.entries(ctRes.val)) if (r && typeof r === 'object') contracts.push({ ...r, _key: k });
if (ctV4Res.ok) for (const [k, r] of Object.entries(ctV4Res.val)) if (r && typeof r === 'object') contracts.push({ ...r, _key: k });

const DONE = ['가능', '승인', '출고 가능', '출고 협의'];
const isDone = (v: unknown) => v === true || v === 'yes' || (typeof v === 'string' && DONE.includes(v));
const DEPOSIT_KEYS = ['agent_balance_paid', 'provider_balance_confirmed'];

const byProduct = new Map<string, Rec[]>();
for (const c of contracts) {
  const pc = s(c.product_code);
  if (!pc || s(c.contract_status) === '계약취소') continue;
  if (!byProduct.has(pc)) byProduct.set(pc, []);
  byProduct.get(pc)!.push(c);
}

let validLock = 0, staleLock = 0;
const stale: string[] = [];
for (const [k, r] of blocked) {
  const pc = s(r.product_code) || k;
  const cts = byProduct.get(pc) || [];
  const real = cts.some((c) => s(c.contract_status) === '계약완료' || DEPOSIT_KEYS.some((dk) => isDone(c[dk])));
  if (real) validLock++;
  else { staleLock++; if (stale.length < 30) stale.push(`${pc}  ${s(r.car_number)}  ${s(r.maker)} ${s(r.model)}  공급사=${s(r.provider_company_code)}`); }
}

console.log(`\n━━ 계약 대조 결과 (계약 ${contracts.length}건 기준)`);
console.log(`  출고불가 ${blocked.length}대 중`);
console.log(`    유효 잠금(완료·입금선점 계약 있음): ${validLock}대  → 그대로 두면 됨`);
console.log(`    잔재 잠금(그런 계약 없음)        : ${staleLock}대  → 새 규칙에선 영구히 카탈로그에서 사라짐`);
if (stale.length) {
  console.log(`\n  잔재 잠금 예시 (최대 30건):`);
  for (const l of stale) console.log(`    ${l}`);
  if (staleLock > stale.length) console.log(`    … 외 ${staleLock - stale.length}대`);
}
console.log(`\n  ※ 잔재 ${staleLock}대 중 공급사가 "수기로" 출고불가를 걸어둔 차가 섞여 있을 수 있습니다.`);
console.log(`     이 스크립트는 그 둘을 구분하지 못합니다 — 일괄 복구 전에 공급사 확인이 필요합니다.`);
