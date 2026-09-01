/**
 * **재고를 비운다 — 판매시트(정제칸 기준)로 다시 담기 위해.**
 *
 * ★사장님 2026-08-23
 *   「기존 데이터가 자꾸 오염시키는 거 같음」 · 「뭔가 기존 거를 없애야 적용을 새롭게 할 거 같아서」
 *   「**재고는 다 지우고 새로 올리자 새로운 틀에 다시 담자 정제 시트 정제칸 기준으로**」
 *
 * ★왜 비워야 새로 앉나
 *   `soft-merge` 는 **빈 값이 기존 값을 안 덮는다.** 그래서 판매시트에 없는 차는 옛 값이 **영원히 굳는다** —
 *   실측 2026-08-23: 6,605대 중 **6,174대**가 판매시트 밖(출고불가·옛 웹 등록분 `EXT_*`)이라
 *   폐지한 축·옛 이름·옛 구동표기를 그대로 들고 있었다. 비워야 판매시트 글자만 남는다.
 *
 * ⚠ **되돌릴 수 없다.** 앞서 두 가지를 이미 해 두었다(안 했으면 먼저 하라):
 *     npx tsx scripts/deploy/rtdb-backup.mts export          전체 백업
 *     npx tsx scripts/archive-erp-transactions.mts --write   거래 이력(CSV+JSON)
 *
 * ⚠ 재고 **말고는 아무것도 안 건드린다** — 회원·파트너사·정책·차종마스터·계약·대화·정산 그대로.
 *   (사장님 「회원과 파트너는 옮겨야지 · 회원은 로그인될 수 있게끔」)
 *
 *   npx tsx scripts/reset-inventory.mts           # 무엇이 비워지는지 보기만
 *   npx tsx scripts/reset-inventory.mts --apply   # 비우기
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();

/** 재고 노드만. 여기 없는 것은 손대지 않는다. */
const NODES = ['v4/products', 'v4/products_private', 'products', 'product_code_aliases'];

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const jwt = new JWT({
  email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
});
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const tok = (await jwt.getAccessToken()).token;
const count = async (p: string) => {
  const v = await (await fetch(`${DB}/${p}.json?shallow=true&access_token=${tok}`)).json();
  return v && typeof v === 'object' ? Object.keys(v).length : 0;
};

console.log('■ 재고 비우기 — 판매시트(정제칸 기준)로 다시 담는다\n');
const counts = new Map<string, number>();
for (const n of NODES) counts.set(n, await count(n));
for (const [n, c] of counts) console.log(`  ${n.padEnd(26)} ${String(c).padStart(6)}건`);
console.log(`  ${'합계'.padEnd(26)} ${String([...counts.values()].reduce((a, b) => a + b, 0)).padStart(6)}건`);
console.log('\n  건드리지 않는 것 — 회원 · 파트너사 · 정책 · 차종마스터 · 계약 · 대화 · 정산');

if (!APPLY) {
  console.log('\n  (미리보기다 — 비우려면 --apply)');
  console.log('  ⚠ 먼저: rtdb-backup export · archive-erp-transactions --write');
  process.exit(0);
}

for (const n of NODES) {
  if (!counts.get(n)) continue;
  const r = await fetch(`${DB}/${n}.json?access_token=${tok}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`${n} 비우기 실패 ${r.status} ${(await r.text()).slice(0, 160)}`);
  console.log(`  ✓ 비움 ${n.padEnd(26)} ${String(counts.get(n)).padStart(6)}건`);
}

console.log('\n  다음 — 판매시트를 지금 기준으로 담는다');
console.log('     npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/run-sheet-daily-sync-local.mts --apply');
console.log('  그다음 확인: npm run audit:axes · npm run audit:passthrough');
