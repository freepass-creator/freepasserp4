/**
 * **원자에 공급사코드·영업채널코드를 채운다.** 기본 dry-run, 반영은 `--apply`.
 *
 * ★사장님 2026-09-10 「이제 SSOT 로 이거는 넘어가서 ERP 로만 처리하려고 하니까 …
 *   현재 이걸 어떻게 구현하고 영업채널·공급사에도 어떻게 보여줄까를 고민해야 해」
 *
 *   공급사·채널이 «제 정산만» 보려면 서버가 「이 사람이 누구인가」를 줄과 맞춰야 한다.
 *   토큰에는 `companyCode`·`agentChannelCode` 가 **코드로** 들어 있는데,
 *   원자에는 코드가 430줄 중 16줄만 차 있었다(실측 2026-09-10). 코드로 맞추면 대부분 0줄이 된다.
 *
 * ★★**이름이 아니라 코드로 맞춘다** — 사장님 2026-08-26 「각각 영업자한테 코드를 부여해야 할 거 같어,
 *   동명이인 거르려면」. 이름은 「웰릭스/웰릭스모빌리티」처럼 줄여 적히고 겹치지만 코드는 안 겹친다.
 *   ⚠ 이름으로 맞추면 «남의 정산이 보이는» 사고가 난다 — 그건 못 되돌린다.
 *
 * ★코드 정본은 `lib/domain/partner-ci.ts` 다(`ciOf` 가 별칭까지 푼다). 여기서 새로 짓지 않는다.
 * ★이미 코드가 «적혀 있는» 줄은 건드리지 않는다 — 덮지 않는다.
 * ⚠ 못 푸는 상호는 **비워 둔다.** 짐작으로 채우면 그 줄이 남에게 보인다.
 *
 *   npx tsx scripts/backfill-party-codes.mts
 *   npx tsx scripts/backfill-party-codes.mts --apply
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { ciOf } from '../lib/domain/partner-ci';

const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa) });
const db = getFirestore();

const docs = (await db.collection('settlement_rows').get()).docs;
type 할일 = { id: string; patch: Record<string, string>; 말: string };
const 할것: 할일[] = [];
const 못푼공급 = new Map<string, number>();
const 못푼채널 = new Map<string, number>();

for (const d of docs) {
  const r = d.data() as Record<string, unknown>;
  const patch: Record<string, string> = {};
  const 말: string[] = [];

  if (!S(r.supplierCode)) {
    const 상호 = S(r.supplier);
    const ci = 상호 ? ciOf(상호) : null;
    if (ci?.code) { patch.supplierCode = ci.code; 말.push(`공급 ${상호}→${ci.code}`); }
    else if (상호) 못푼공급.set(상호, (못푼공급.get(상호) || 0) + 1);
  }
  if (!S(r.channelCode)) {
    const 상호 = S(r.channel);
    const ci = 상호 ? ciOf(상호) : null;
    if (ci?.code) { patch.channelCode = ci.code; 말.push(`채널 ${상호}→${ci.code}`); }
    else if (상호) 못푼채널.set(상호, (못푼채널.get(상호) || 0) + 1);
  }
  if (Object.keys(patch).length) 할것.push({ id: d.id, patch, 말: 말.join(' · ') });
}

console.log(`\n■ 원자 ${docs.length}줄 — 코드를 채울 줄 ${할것.length}개\n`);
const 셈 = new Map<string, number>();
for (const t of 할것) for (const [k, v] of Object.entries(t.patch)) 셈.set(`${k} ${v}`, (셈.get(`${k} ${v}`) || 0) + 1);
for (const [k, n] of [...셈].sort()) console.log(`   ${k.padEnd(28)} ${String(n).padStart(3)}줄`);

const 보이기 = (표: Map<string, number>, 무엇: string) => {
  if (!표.size) return;
  console.log(`\n   ⚠ 못 푼 ${무엇} ${표.size}곳 — «비워 둔다»(짐작으로 채우면 남에게 보인다)`);
  for (const [k, n] of [...표].sort((a, b) => b[1] - a[1])) console.log(`      ${k.padEnd(16)} ${String(n).padStart(3)}줄   → partner-ci.ts 에 등록하면 풀린다`);
};
보이기(못푼공급, '공급사');
보이기(못푼채널, '영업채널');

if (!APPLY) { console.log('\n   ※ 미리보기입니다 — 반영하려면 --apply\n'); process.exit(0); }

let 쓴것 = 0;
for (let i = 0; i < 할것.length; i += 450) {
  const b = db.batch();
  for (const t of 할것.slice(i, i + 450)) b.update(db.collection('settlement_rows').doc(t.id), t.patch);
  await b.commit();
  쓴것 += Math.min(450, 할것.length - i);
  console.log(`   ${쓴것}/${할것.length} …`);
}

/** ★되읽어 «정말 들어갔는지» 본다. */
const 다시 = (await db.collection('settlement_rows').get()).docs.map((d) => d.data() as Record<string, unknown>);
const 살아 = 다시.filter((r) => r.cancelled !== true);
console.log(`\n   공급사코드 ${살아.filter((r) => S(r.supplierCode)).length} / ${살아.length}`);
console.log(`   채널코드   ${살아.filter((r) => S(r.channelCode)).length} / ${살아.length}\n`);
