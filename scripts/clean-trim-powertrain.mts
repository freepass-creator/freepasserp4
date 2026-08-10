/**
 * 트림 칸에 들어간 **파워트레인 문구를 비운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * 실측 2026-08-10: `variant=「가솔린 2.5 5인승 2WD」 · trim_name=「가솔린 2.5 터보」` 처럼
 * 같은 말이 두 칸에 들어가 차명이 겹말로 조립됐다(「… 2WD 7인승 가솔린 2.5 터보」).
 * 판정은 `isForbiddenAsTrim` 하나가 한다 — 여기서 규칙을 새로 적지 않는다.
 *
 * 비우기만 한다. 다른 트림으로 갈아끼우지 않는다 — 무엇이 맞는지는 재매칭이 정한다.
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isForbiddenAsTrim } from '../lib/domain/vehicle-field-guards';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] });
const token = (await jwt.getAccessToken()).token;
const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${token}`)).text()) || {};
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

const hits: { key: string; plate: string; trim: string; variant: string }[] = [];
for (const [key, p] of Object.entries(prods as Record<string, Rec>)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const trim = S(p.trim_name);
  if (!trim || !isForbiddenAsTrim(trim)) continue;
  hits.push({ key, plate: S(p.car_number) || '(무번호)', trim, variant: S(p.variant) });
}
console.log(`■ 트림 칸의 파워트레인 문구 — ${hits.length}대\n`);
for (const h of hits.slice(0, 15)) {
  console.log(`  ${h.plate.padEnd(11)} trim=「${h.trim}」  (파워트레인=「${h.variant}」)`);
}
if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply\n'); process.exit(0); }
let ok = 0;
for (const h of hits) {
  const res = await fetch(`${DB}/v4/products/${encodeURIComponent(h.key)}.json?access_token=${token}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trim_name: '' }),
  });
  if (res.ok) ok++;
}
console.log(`\n✓ 비움 ${ok}대\n`);
