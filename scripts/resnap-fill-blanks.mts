/**
 * 저장된 차종을 **지금 매처로 다시 물려 빈 칸만 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * 규칙은 `lib/domain/resnap-fill.ts` 하나가 정한다 — 일일 동기화도 같은 함수를 쓴다.
 * 각자 구현하면 «어떤 칸을 어떤 조건에 채우는가»가 갈리고, 그때 화면과 시트가 다른 말을 한다.
 *
 * 아침에 손으로 한 번 더 돌릴 때 쓴다(공급사가 낮에 새 차를 넣는 경우).
 * 밤 크론은 재고를 받은 직후 같은 일을 자동으로 한다.
 *
 *   npx tsx scripts/resnap-fill-blanks.mts            (미리보기)
 *   npx tsx scripts/resnap-fill-blanks.mts --apply    (반영)
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { planResnapFill, summarizeResnapFill, SNAP_FILL_FIELDS } from '../lib/domain/resnap-fill';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
});
const token = (await jwt.getAccessToken()).token;
const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${token}`)).text()) || {};
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
const master: MasterEntry[] = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

const active = Object.entries(prods as Record<string, Rec>)
  .filter(([, p]) => p && typeof p === 'object' && !dead(p))
  .map(([k, p]) => ({ ...p, _key: k } as EntityRecord & { _key: string }));

const fills = planResnapFill(active, master);
const by = summarizeResnapFill(fills);

console.log('■ 저장 차종 재매칭 — 빈 칸만 채운다\n');
console.log(`  활성 ${active.length}대 · ★채울 것이 있는 차 ${fills.length}대\n`);
console.log('  칸별 채움');
for (const f of SNAP_FILL_FIELDS) {
  if (by[f]) console.log(`     ${f.padEnd(12)} ${String(by[f]).padStart(4)}대`);
}
if (!fills.length) console.log('     (채울 것 없음 — 이미 다 물려 있다)');
console.log('\n  표본');
for (const c of fills.slice(0, 8)) {
  console.log(`     ${c.plate.padEnd(11)} ${Object.entries(c.patch).map(([k, v]) => `${k}=${v}`).join(' · ').slice(0, 96)}`);
}

if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply (백업 먼저!)\n'); process.exit(0); }

let ok = 0; let failed = 0;
for (const c of fills) {
  if (!c.key) continue;
  const res = await fetch(`${DB}/v4/products/${encodeURIComponent(c.key)}.json?access_token=${token}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c.patch),
  });
  if (res.ok) ok++; else { failed++; if (failed <= 5) console.log(`  ✗ ${c.plate} ${res.status}`); }
}
console.log(`\n✓ 반영 ${ok}대 · 실패 ${failed}대\n`);
