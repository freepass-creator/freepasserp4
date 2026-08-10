/**
 * **아이언 홈페이지 수집을 재고에 반영한다.** 기본 dry-run, 반영은 `--apply`.
 *
 * 계획은 `planIronRentcarReconcile` 이 세운다 — 화면·API 와 **같은 코드**다.
 * 여기서 규칙을 새로 쓰지 않는다.
 *
 * ⚠ **정식 경로가 아니다.** `/api/inventory/ironrentcar/apply` 에는 잠금·스냅샷·감사기록·CAS 가
 *   붙어 있고, 도메인 계획의 `executableOperations` 는 그 승인 경로 전까지 늘 0 이다.
 *   이 스크립트는 그 문턱을 넘어간다 — 서버가 꺼져 있고 `IRONRENTCAR_SYNC_ENABLED` 도 없어
 *   오픈 전에 손으로 한 번 맞추려고 만든 것이다(2026-08-10).
 *   되돌릴 수 있도록 **아이언 레코드 전체를 먼저 파일로 뜬다**. 되돌리려면 `--restore=<파일>`.
 *
 * ★홈페이지가 정본이다(사장님 2026-08-10). 시트 유입은 이미 끊었다.
 *   홈페이지가 가진 공개 필드만 덮는다 — 원가·VIN·계좌·수수료·계약락은 건드리지 않는다
 *   (`IRONRENTCAR_WEB_OWNED_FIELDS`).
 *
 *   npx tsx scripts/apply-ironrentcar-sync.mts
 *   npx tsx scripts/apply-ironrentcar-sync.mts --apply
 *   npx tsx scripts/apply-ironrentcar-sync.mts --restore=tmp/iron-backup-….json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { fetchIronRentcarCatalog } from '../lib/server/ironrentcar-source';
import { planIronRentcarReconcile } from '../lib/domain/ironrentcar-reconcile';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const arg = (k: string, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const APPLY = process.argv.includes('--apply');
const RESTORE = arg('restore');
const CODE = 'RP006';
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
}).getAccessToken()).token;
const put = async (path: string, body: unknown, method: 'PATCH' | 'PUT' = 'PATCH') => {
  const res = await fetch(`${DB}/${path}.json?access_token=${dbT}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
};

const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${dbT}`)).text()) || {};

// ── 되돌리기 ──────────────────────────────────────────────────────────
if (RESTORE) {
  const snap = JSON.parse(readFileSync(RESTORE, 'utf8')) as Record<string, Rec>;
  console.log(`■ 되돌리기 — ${RESTORE} · ${Object.keys(snap).length}건`);
  if (!APPLY) { console.log('※ dry-run. 실제 되돌리기는 --apply 와 함께\n'); process.exit(0); }
  for (const [k, v] of Object.entries(snap)) await put(`v4/products/${encodeURIComponent(k)}`, v, 'PUT');
  console.log(`  되돌림 ${Object.keys(snap).length}건\n`);
  process.exit(0);
}

const existing = Object.entries<Rec>(prods)
  .map(([k, p]) => ({ ...p, _key: k, product_code: p.product_code || k } as EntityRecord));
const catalog = await fetchIronRentcarCatalog({ cacheMs: 0 });
const plan = planIronRentcarReconcile({ webItems: catalog.items, existing, providerCode: CODE, sourceComplete: catalog.complete });

console.log(`■ 아이언 홈페이지 수집 반영 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  홈피 ${catalog.listings}건 — 활성 ${catalog.active} · 판매완료 ${catalog.sold} · 온전함=${catalog.complete}`);
console.log(`  고칠 것 ${plan.patchCandidates.length} · 새로 만들 것 ${plan.createCandidates.length} · 내릴 것 ${plan.absentBlockCandidates.length}`);
console.log(`  그대로 ${plan.unchanged} · 신차 판매완료 무시 ${plan.ignoredSoldNew} · 막힌 것 ${plan.blockedExternalIds.length} · 차번중복 ${plan.duplicatePlateGroups}\n`);

if (!catalog.complete) {
  console.error('✗ 수집이 온전하지 않다 — 반영하지 않는다. 일부만 받은 상태로 덮으면 멀쩡한 차가 내려간다.\n');
  process.exit(1);
}
if (plan.blockedExternalIds.length || plan.duplicatePlateGroups) {
  console.error('✗ 막힌 매물·차번 중복이 있다 — 사람이 먼저 봐야 한다.\n');
  process.exit(1);
}

const keyOf = (x: Rec) => S(x.key || x.productKey || x._key || x.product_code);
console.log(`  새로 만들 차: ${plan.createCandidates.map((p) => S((p as Rec).car_number)).join(' · ')}`);
console.log(`  내릴 차:     ${plan.absentBlockCandidates.map(keyOf).join(' · ')}`);

if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

// ★먼저 뜬다. 이 파일이 곧 되돌리기 수단이다.
const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backup = `tmp/iron-backup-${stamp}.json`;
const snap: Record<string, Rec> = {};
for (const [k, p] of Object.entries<Rec>(prods)) if (S(p?.provider_company_code) === CODE) snap[k] = p;
mkdirSync('tmp', { recursive: true });
writeFileSync(backup, JSON.stringify(snap, null, 1), 'utf8');
console.log(`\n  되돌리기용 백업: ${backup} (${Object.keys(snap).length}건)`);

const at = new Date().toISOString();
let patched = 0; let created = 0; let blocked = 0;
for (const p of plan.patchCandidates) {
  const key = keyOf(p as Rec);
  const patch = { ...((p as Rec).patch || (p as Rec).fields || {}), updatedAt: at };
  if (!key || Object.keys(patch).length <= 1) continue;
  await put(`v4/products/${encodeURIComponent(key)}`, patch);
  patched++;
}
for (const p of plan.createCandidates) {
  const key = S((p as Rec)._key) || S((p as Rec).product_code) || `${CODE}_${S((p as Rec).car_number)}`;
  await put(`v4/products/${encodeURIComponent(key)}`, { ...(p as Rec), updatedAt: at, createdAt: at }, 'PUT');
  created++;
}
for (const p of plan.absentBlockCandidates) {
  const key = keyOf(p as Rec);
  const patch = { ...((p as Rec).patch || (p as Rec).fields || {}), updatedAt: at };
  if (!key) continue;
  await put(`v4/products/${encodeURIComponent(key)}`, patch);
  blocked++;
}
console.log(`\n  고침 ${patched} · 새로 만듦 ${created} · 내림 ${blocked}`);
console.log(`  되돌리려면: npx tsx scripts/apply-ironrentcar-sync.mts --restore=${backup} --apply`);
console.log('  다음: 영업자 시트 두 탭을 다시 찍는다.\n');
