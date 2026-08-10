/**
 * **v3 의 삭제 표시가 v4 를 덮는 것**을 푼다. 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(2026-08-10)
 *   화면은 v3 ∪ v4 를 합쳐 읽고, 같은 키면 **v4 필드가 v3 를 덮는다**(`mergeV3V4Records`).
 *   그런데 «v4 에 없는 필드»는 v3 것이 그대로 남는다. `_deleted` 가 딱 그 경우다 —
 *   v3 에 `_deleted: true` 가 있고 v4 레코드가 그 필드를 안 들고 있으면
 *   **v4 에서 아무리 되살려도 화면에선 계속 죽어 있다.**
 *   실측: v4 활성 582 · 목록 477 인데 화면은 활성 548 · 목록 470 이었다(34대 유령 삭제).
 *
 * ★고치는 법 — v4 에 `_deleted: false` 를 **명시**한다. 그러면 덮어쓴다.
 *   v3 를 건드리지 않는다. v3 는 erp3 의 정본이고 우리가 손댈 자리가 아니다.
 *
 * ⚠ **v4 에서 살아 있는 차만** 푼다. v4 가 죽었다고 한 차는 그대로 둔다 —
 *   여기서 되살리면 내려둔 차가 되돌아온다.
 *
 *   npx tsx scripts/fix-v3-delete-shadow.mts
 *   npx tsx scripts/fix-v3-delete-shadow.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { isHiddenFromCatalog, priceList } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const t = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;

const [v3, v4] = await Promise.all(['products', 'v4/products'].map(async (n) =>
  JSON.parse(await (await fetch(`${DB}/${n}.json?access_token=${t}`)).text()) || {}));
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

type Shadow = { key: string; plate: string; code: string; listed: boolean; from3: string };
const shadows: Shadow[] = [];
for (const [k, p] of Object.entries<Rec>(v4)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;   // v4 가 죽었다면 그대로 둔다
  const old = (v3 as Rec)[k];
  if (!old || typeof old !== 'object' || !dead(old)) continue;
  const rec = { ...p, _key: k, product_code: p.product_code || k } as EntityRecord;
  shadows.push({
    key: k, plate: S(p.car_number) || '(무번호)', code: S(p.provider_company_code),
    listed: !isHiddenFromCatalog(rec as Rec) && priceList(rec).length > 0,
    from3: [old._deleted === true ? '_deleted' : '', S(old.deletedAt) ? 'deletedAt' : '', S(old.status) === 'deleted' ? 'status' : ''].filter(Boolean).join('·'),
  });
}

console.log(`■ v3 삭제 표시가 v4 를 덮는 차 ${APPLY ? '(반영)' : '(dry-run)'} — ${shadows.length}대\n`);
const byProv = new Map<string, number>();
for (const s of shadows) byProv.set(s.code || '(코드없음)', (byProv.get(s.code || '(코드없음)') || 0) + 1);
for (const [c, n] of [...byProv].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}대  ${c}`);
console.log(`\n   그중 목록에 서야 하는 차 ${shadows.filter((s) => s.listed).length}대\n`);
for (const s of shadows.slice(0, 12)) console.log(`   ${s.plate.padEnd(11)} ${s.code.padEnd(9)} v3 ${s.from3}${s.listed ? ' · 목록에 서야 함' : ''}`);
if (shadows.length > 12) console.log(`   … 외 ${shadows.length - 12}대`);

if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply\n'); process.exit(0); }

const at = new Date().toISOString();
let n = 0;
for (const s of shadows) {
  // v4 에 «안 죽었다»를 명시해 v3 를 덮는다. deletedAt·status 도 함께 비운다.
  const res = await fetch(`${DB}/v4/products/${encodeURIComponent(s.key)}.json?access_token=${t}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ _deleted: false, deletedAt: null, updatedAt: at }),
  });
  if (res.ok) n++;
  else console.log(`  △ ${s.plate} — ${res.status}`);
}
console.log(`\n  덮음 ${n}대 — 화면에서 되살아난다\n`);
