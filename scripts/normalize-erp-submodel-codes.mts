/**
 * **ERP 세부모델에 굳어 있는 «프로젝트 코드»를 한 번 털어낸다.**
 *
 * ★왜(사장님 2026-08-23 「109호5391 이상하다」)
 *   정제칸과 판매시트는 「AI 정제」 사전으로 고쳤지만, **판매시트를 안 거치는 차**는 그대로다.
 *   - `EXT_*` — v3 시절 웹에서 등록된 옛 상품. 지금 어떤 파이프라인도 이 차를 다시 쓰지 않는다.
 *   - 출고불가 — 발행에서 빠지므로 `soft-merge` 가 손댈 일이 없다(빈 값은 기존 값을 안 덮는다).
 *   그래서 손님 화면에 「그랜저 GN7」·「디 올 뉴 싼타페 MX5」가 남아 있었다.
 *
 * ⚠ **한 번 쓰는 도구다.** 시트에서 오는 차는 다음 동기가 알아서 맞춘다 — 여기서 고칠 필요가 없다.
 *   규칙은 `lib/domain/submodel-code.stripModelCode` 하나뿐이라 사전과 갈릴 일이 없다.
 *
 *   npx tsx scripts/normalize-erp-submodel-codes.mts             # 무엇이 바뀌는지 보기만
 *   npx tsx scripts/normalize-erp-submodel-codes.mts --apply     # 쓰기
 *   npx tsx scripts/normalize-erp-submodel-codes.mts --only-sellable --apply   # 손님에게 보이는 차만
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { stripModelCode } from '../lib/domain/submodel-code';
import { isOfferableProduct } from '../lib/domain/product';

const APPLY = process.argv.includes('--apply');
const ONLY_SELLABLE = process.argv.includes('--only-sellable');
const S = (v: unknown) => String(v ?? '').trim();

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
});
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const tok = (await jwt.getAccessToken()).token;

const all = await (await fetch(`${DB}/v4/products.json?access_token=${tok}`)).json() as Record<string, Record<string, unknown>>;

type Fix = { key: string; before: string; after: string; sellable: boolean };
const fixes: Fix[] = [];
for (const [key, p] of Object.entries(all)) {
  const sub = S(p.sub_model);
  if (!sub) continue;
  const after = stripModelCode(sub, S(p.model), S(p.maker));
  if (after === sub) continue;
  const sellable = isOfferableProduct(p as never);
  if (ONLY_SELLABLE && !sellable) continue;
  fixes.push({ key, before: sub, after, sellable });
}

const sellN = fixes.filter((f) => f.sellable).length;
console.log(`■ ERP 세부모델 코드 털기 — ${Object.keys(all).length}대 중 ${fixes.length}대 (판매가능 ${sellN} · 그 밖 ${fixes.length - sellN})\n`);

const byPair = new Map<string, number>();
for (const f of fixes) byPair.set(`${f.before}|${f.after}`, (byPair.get(`${f.before}|${f.after}`) || 0) + 1);
for (const [k, n] of [...byPair].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  const [before, after] = k.split('|');
  console.log(`  ${String(n).padStart(4)}대  「${before}」 → 「${after}」`);
}
if (byPair.size > 40) console.log(`  … 외 ${byPair.size - 40}가지`);

if (!APPLY) { console.log('\n  (미리보기다 — 쓰려면 --apply)'); process.exit(0); }
if (!fixes.length) { console.log('\n  고칠 것이 없다.'); process.exit(0); }

// 한 번에 다 보내면 요청이 너무 커진다 — 500대씩 끊어 PATCH 한다.
const CHUNK = 500;
for (let i = 0; i < fixes.length; i += CHUNK) {
  const body: Record<string, string> = {};
  for (const f of fixes.slice(i, i + CHUNK)) body[`${f.key}/sub_model`] = f.after;
  const r = await fetch(`${DB}/v4/products.json?access_token=${tok}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  console.log(`  … ${Math.min(i + CHUNK, fixes.length)}/${fixes.length}`);
}
console.log(`\n  ✓ ${fixes.length}대 고쳤다.`);
