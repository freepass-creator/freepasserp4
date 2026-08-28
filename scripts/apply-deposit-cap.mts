/**
 * 이미 저장된 손오공 보증금에 **3개월치 상한**을 적용한다(사장님 2026-08-28 「손오공 규칙임」).
 *
 * 상한은 `sheet-import.depositByRule` 에 걸었지만, 그건 «다음에 시트를 읽을 때»부터다.
 * ERP 에 이미 들어와 있는 1,640줄은 그대로 4·5개월치를 들고 있다.
 * 시트 동기를 통째로 한 번 돌리는 게 정석인데 그게 20분 넘게 안 끝나서(로컬 부하),
 * **같은 산식으로 이미 저장된 값만 눕힌다.**
 *
 * ⚠ **옛 산식과 정확히 맞는 줄만 고친다** — `deposit === rent × round(기간/12)`.
 *   공급사가 따로 적어 준 금액이나 사람이 손댄 값은 산식과 안 맞으므로 건드리지 않는다.
 *   「고칠 수 있는 것」이 아니라 「우리가 계산해서 넣은 것」만 되돌리는 것이다.
 * ⚠ 손오공(RP012)만. 다른 공급사는 이 규칙을 안 쓴다.
 *
 *   npx tsx scripts/apply-deposit-cap.mts            드라이런
 *   npx tsx scripts/apply-deposit-cap.mts --apply    반영(백업 먼저)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const APPLY = process.argv.includes('--apply');
const CAP = 3;
const PROVIDER = 'RP012';
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const t = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const products = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${t}`)).text()) || {};
const dead = (p: any) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

type Fix = { key: string; plate: string; changes: [string, number, number][] };
const fixes: Fix[] = [];
let untouched = 0;
for (const [key, p] of Object.entries<any>(products)) {
  if (!p || typeof p !== 'object' || dead(p) || S(p.provider_company_code) !== PROVIDER) continue;
  const price = (p.price || {}) as Record<string, { rent?: number; deposit?: number }>;
  const changes: [string, number, number][] = [];
  for (const [slot, v] of Object.entries(price)) {
    const rent = Number(v?.rent) || 0;
    const dep = Number(v?.deposit) || 0;
    if (rent <= 0 || dep <= 0) continue;
    const bar = slot.indexOf('_');
    const months = Number(bar >= 0 ? slot.slice(0, bar) : slot);
    if (!Number.isFinite(months) || months <= 0) continue;
    const years = Math.max(1, Math.round(months / 12));
    if (years <= CAP) continue;                 // 상한 안 넘음
    if (dep !== rent * years) { untouched++; continue; }  // 우리 산식이 아니다 — 안 건드린다
    changes.push([slot, dep, rent * CAP]);
  }
  if (changes.length) fixes.push({ key, plate: S(p.car_number), changes });
}

const lines = fixes.reduce((n, f) => n + f.changes.length, 0);
console.log(`${APPLY ? '★반영' : '드라이런(아무것도 안 씀)'}\n`);
console.log(`손오공 매물 ${fixes.length}대 · 요금 줄 ${lines}개를 3개월치로 내린다`);
console.log(`산식과 안 맞아 건드리지 않는 줄 ${untouched}개\n`);
for (const f of fixes.slice(0, 6)) {
  for (const [slot, from, to] of f.changes) {
    console.log(`   ${f.plate.padEnd(11)} ${slot.padEnd(12)} ${from.toLocaleString().padStart(11)} → ${to.toLocaleString()}`);
  }
}
if (fixes.length > 6) console.log(`   … ${fixes.length - 6}대 더`);

if (!APPLY) { console.log('\n반영하려면 --apply'); process.exit(0); }

mkdirSync('tmp/backup', { recursive: true });
writeFileSync('tmp/backup/deposit-cap-before.json',
  JSON.stringify(Object.fromEntries(fixes.map((f) => [f.key, (products as any)[f.key].price])), null, 2), 'utf8');
console.log('\n백업 → tmp/backup/deposit-cap-before.json');

let n = 0;
for (const f of fixes) {
  const price = { ...(products as any)[f.key].price };
  for (const [slot, , to] of f.changes) price[slot] = { ...price[slot], deposit: to };
  const r = await fetch(`${DB}/v4/products/${f.key}/price.json?access_token=${t}`, { method: 'PATCH', body: JSON.stringify(price) });
  if (!r.ok) throw new Error(`PATCH ${f.key} 실패 ${r.status} ${await r.text()}`);
  n++;
  if (n % 100 === 0) console.log(`   … ${n}대`);
}
console.log(`반영 완료 — ${n}대 · ${lines}줄`);
