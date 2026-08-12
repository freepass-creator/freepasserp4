/**
 * **매물에 잘못 저장된 `origin`·`_deposit_origin_trusted` 를 걷어낸다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜 지우나 — 국산/수입은 **저장하는 값이 아니다.**
 *   유입은 마스터에서 그때그때 판정해 «금액 계산에만» 쓰고 매물에는 안 남긴다
 *   (`sheet-import.ts` 의 priceRecord). 저장 필드로 만들면 마스터가 바뀔 때마다
 *   기존 재고 수백 대의 보증금이 조용히 흔들린다. `sim-sheet-price` 의
 *   「MASTER-ORIGIN은 금액 판정에만 쓰고 …」 항목이 그 규칙을 지킨다.
 *
 *   2026-08-12에 오토플러스 보증금을 고치려다 이 규칙을 모르고 546대에 써 넣었다. 그걸 되돌린다.
 *   ⚠ **요금·보증금 값 자체는 건드리지 않는다** — 그건 시트대로 고쳐진 옳은 값이다.
 *     여기서 지우는 건 판정 근거로 쓰려고 얹은 필드뿐이다.
 *
 *   npx tsx scripts/unset-product-origin.mts
 *   npx tsx scripts/unset-product-origin.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const dbT = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;

const prods = JSON.parse(await (await fetch(`${DB}/v4/products.json?access_token=${dbT}`)).text()) || {};
const dead = (p: Rec) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';

const targets: { key: string; had: string[] }[] = [];
for (const [k, p] of Object.entries<Rec>(prods)) {
  if (!p || typeof p !== 'object' || dead(p)) continue;
  const had: string[] = [];
  if (S(p.origin)) had.push(`origin=${S(p.origin)}`);
  if (p._deposit_origin_trusted !== undefined) had.push('_deposit_origin_trusted');
  if (had.length) targets.push({ key: k, had });
}
console.log(`■ 매물 origin 필드 걷어내기 ${APPLY ? '(반영)' : '(dry-run)'}\n`);
console.log(`  대상 ${targets.length}대`);
if (!APPLY) { console.log('\n※ dry-run. 실제 반영은 --apply\n'); process.exit(0); }

const at = new Date().toISOString();
let done = 0;
for (const t of targets) {
  // RTDB 는 null 을 쓰면 그 키를 지운다.
  const res = await fetch(`${DB}/v4/products/${encodeURIComponent(t.key)}.json?access_token=${dbT}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origin: null, _deposit_origin_trusted: null, updatedAt: at }),
  });
  if (res.ok) done++; else console.log(`  △ ${t.key} — ${res.status}`);
}
console.log(`\n  걷어냄 ${done}대\n`);
