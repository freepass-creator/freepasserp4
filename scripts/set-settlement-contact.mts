/**
 * **정산서를 «어디로» 보낼지 적어 둔다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-03 「이메일 들어온곳은 나중에 확정되면 이메일로 보낼거니까 메모해둬」.
 *
 * ★★**보내지 않는다 — 적어만 둔다.** 확정(영업자 실적 확인 → 발행)이 끝난 뒤에 보낸다.
 * ★★**한 곳에만 적는다** — `v4/settlement_contacts/<원장이 부르는 이름>`.
 *   ⚠ 파트너 레코드에 흩뿌리면 안 된다. 리더스처럼 «파트너 레코드가 아예 없는» 곳이 있어서
 *     어떤 곳은 파트너에, 어떤 곳은 딴 데 있게 된다 — 그러면 다음 사람이 두 군데를 뒤진다.
 *   원장이 부르는 이름(공급사 칸 그대로)이 열쇠다. 정산서도 그 이름으로 만들어진다.
 *
 *   npx tsx scripts/set-settlement-contact.mts
 *   npx tsx scripts/set-settlement-contact.mts --apply
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();

/** ★사람이 준 값만 적는다. 짐작해서 넣지 않는다 — 틀린 주소로 남의 정산서가 나간다. */
const MAIL: Record<string, string> = {
  리더스: 'ldsrent@naver.com',
  아이언: 'iron_rent7777@naver.com',
  스타스카이: 'starskynet@nate.com',
};

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();

const have = (await db.ref('v4/settlement_contacts').get()).val() || {};
console.log(`\n■ 정산서 받을 곳 — 적혀 있는 ${Object.keys(have).length}곳 · 이번에 ${Object.keys(MAIL).length}곳\n`);
for (const [who, mail] of Object.entries(MAIL)) {
  const old = S((have as Record<string, { email?: string }>)[who]?.email);
  console.log(`   ${who.padEnd(10)} ${old ? `${old} → ` : ''}${mail}${old === mail ? '  (그대로)' : ''}`);
}
if (!APPLY) { console.log('\n※ dry-run — 안 썼다. --apply 로 적는다.\n'); process.exit(0); }

const patch: Record<string, unknown> = {};
for (const [who, email] of Object.entries(MAIL)) {
  patch[`v4/settlement_contacts/${who}`] = { name: who, email, by: '사장님', updatedAt: Date.now() };
}
await db.ref().update(patch);
const back = (await db.ref('v4/settlement_contacts').get()).val() || {};
console.log(`\n   ✓ 적었다 — ${Object.keys(back).length}곳`);
console.log('   ⚠ 보내지 않았다. 발행이 끝난 뒤에 보낸다.\n');
process.exit(0);
