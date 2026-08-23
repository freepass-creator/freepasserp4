/**
 * **ERP 파워트레인(variant) 잔재 정리** — 기본 dry-run, 반영은 `--apply`.
 *
 * ★왜(사장님 2026-08-22 「정제칸 쓰기로 했는데 왜 아직도 파워트레인이 나오지??」)
 *   차명 표현의 기본은 **세부모델 + 세부트림**이다. 파워트레인은 정제칸 체계에서 축이 아니다 —
 *   같은 정보가 「연료」·「배기량」 칸에 따로 있고(판매가능 474대 기준 연료 100%·배기량 95%),
 *   판매시트도 08-18 에 「파워트레인」 열을 뺐다(SALES_RETIRED_COLUMNS).
 *
 * ★그런데 왜 아직 남아 있나 — 시트가 그 축을 안 나르니 **동기가 지울 길이 없다**.
 *   soft-merge 는 «빈 incoming 은 기존 유지»라, 옛 차종마스터 스냅이 박아 둔 값(applySnap `variant: res.variant`)이
 *   그대로 굳어 있다. 실측 2026-08-22: 판매가능 474대 중 472대. 그래서 한 번 비워 주는 일이 필요하다.
 *
 * ⚠ 지우는 것은 `variant` 한 칸뿐이다. 연료·배기량·트림은 건드리지 않는다.
 * ⚠ 계약이 나간 차의 계약서·정산 스냅샷은 별도 저장이라 영향받지 않는다.
 *
 *   npx tsx scripts/clear-legacy-variant.mts
 *   npx tsx scripts/clear-legacy-variant.mts --apply
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
});
const tok = (await jwt.getAccessToken()).token;
const base = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const all = await (await fetch(`${base}/v4/products.json?access_token=${tok}`)).json() as Record<string, any>;
const targets = Object.entries(all).filter(([, p]) => S(p?.variant));
console.log(`■ 파워트레인(variant) 잔재 ${APPLY ? '정리' : '미리보기'} — 상품 ${Object.keys(all).length}대 중 ${targets.length}대에 값이 있다`);
for (const [key, p] of targets.slice(0, 8)) {
  console.log(`   ${S(p.car_number) || key}  「${S(p.variant)}」  (세부모델 ${S(p.sub_model) || '-'} · 트림 ${S(p.trim_name) || '-'} · 연료 ${S(p.fuel_type) || '-'} ${S(p.engine_cc) || '-'}cc)`);
}
if (targets.length > 8) console.log(`   … 그 밖 ${targets.length - 8}대`);

if (!targets.length) { console.log('  비울 것 없음'); process.exit(0); }
if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply'); process.exit(0); }

// RTDB PATCH 는 null 로 칸을 지운다. 400대씩 끊어 보낸다(한 번에 몰면 요청이 너무 커진다).
let done = 0;
for (let i = 0; i < targets.length; i += 400) {
  const patch: Record<string, null> = {};
  for (const [key] of targets.slice(i, i + 400)) patch[`${key}/variant`] = null;
  const res = await fetch(`${base}/v4/products.json?access_token=${tok}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  done += Object.keys(patch).length;
  console.log(`   … ${done}/${targets.length}`);
}
console.log(`  ✓ ${done}대 파워트레인 칸 비움`);
