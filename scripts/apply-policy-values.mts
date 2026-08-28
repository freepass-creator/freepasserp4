/**
 * 사장님이 말씀해 주신 **공급사 확정값**을 정책에 넣는다.
 *
 * 사장님 2026-08-28
 *   「손오공 구독 보증금 카드결제 가능 · 대여료 카드결제 가능 · 수수료 없음」
 *   「웰릭스 대여료 카드결제 가능, 보증금 카드 가능한데 수수료 2% 있음」
 *
 * ★값 규격은 `policy-value-spec` 을 따른다 — 카드결제 칸은 「불가」 아니면 **수수료율**이고,
 *   수수료 없이 되면 **「무료」**다(「가능」은 율을 모르던 시절의 옛 값). 그래서 「수수료 없음」은 「무료」로 적는다.
 *   여기서 「가능」이라고 적으면 화면이 「율을 모른다」는 뜻으로 읽어 영업자가 다시 물어봐야 한다.
 *
 * ⚠ **그 공급사의 정책 전부**에 넣는다 — 한 공급사가 정책을 여러 개 들고 있고(구독·렌트),
 *   매물이 어느 것에 붙을지는 연결 상태에 따라 달라진다. 한쪽만 채우면 차에 따라 값이 갈린다.
 *
 *   npx tsx scripts/apply-policy-values.mts            드라이런
 *   npx tsx scripts/apply-policy-values.mts --apply    반영(백업 먼저)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();

/**
 * 공급사 → 넣을 값. 「무료」=수수료 없이 카드 가능 · 「2%」=수수료율.
 *
 * ★`only` 는 **말씀하신 범위를 넘지 않기 위한 자물쇠**다.
 *   사장님은 「손오공 **구독**」이라고 하셨다. 손오공은 구독·렌트 정책을 따로 들고 있는데
 *   렌트도 같은지는 안 들었다. 「없는 데는 없다고 해」(사장님 같은 날)에 따라 **구독만** 넣는다.
 *   웰릭스는 갈래를 안 붙여 말씀하셨고 정책도 하나뿐이라 그대로 넣는다.
 */
const VALUES: Record<string, { only?: RegExp; set: Record<string, string> }> = {
  RP012: { only: /구독/, set: { rental_card_payment: '무료', deposit_card_payment: '무료' } },
  RP013: { set: { rental_card_payment: '무료', deposit_card_payment: '2%' } },
};

const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const t = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const read = async (p: string) => JSON.parse(await (await fetch(`${DB}/${p}.json?access_token=${t}`)).text()) || {};

const live = await read('policies');
const over = await read('v4/policies');
type Job = { node: string; code: string; provider: string; name: string; changes: [string, string, string][] };
const jobs: Job[] = [];
for (const [node, bag] of [['policies', live], ['v4/policies', over]] as const) {
  for (const [code, p] of Object.entries<any>(bag)) {
    const provider = S(p?.provider_company_code);
    const rule = VALUES[provider];
    if (!rule) continue;
    const name = S(p.policy_name);
    if (rule.only && !rule.only.test(name)) continue;   // 말씀하신 갈래만
    const changes: [string, string, string][] = [];
    for (const [k, v] of Object.entries(rule.set)) if (S(p[k]) !== v) changes.push([k, S(p[k]) || '(빈칸)', v]);
    if (changes.length) jobs.push({ node, code, provider, name: S(p.policy_name), changes });
  }
}

console.log(`${APPLY ? '★반영' : '드라이런(아무것도 안 씀)'}\n`);
for (const j of jobs) {
  console.log(`${j.provider}  ${j.code}  ${j.name.slice(0, 30)}   [${j.node}]`);
  for (const [k, from, to] of j.changes) console.log(`     ${k.padEnd(22)} ${from} → ${to}`);
}
console.log(`\n정책 ${jobs.length}건 · 칸 ${jobs.reduce((n, j) => n + j.changes.length, 0)}개`);
if (!jobs.length) { console.log('바꿀 것 없음'); process.exit(0); }
if (!APPLY) { console.log('\n반영하려면 --apply'); process.exit(0); }

mkdirSync('tmp/backup', { recursive: true });
writeFileSync('tmp/backup/policy-values-before.json', JSON.stringify(
  Object.fromEntries(jobs.map((j) => [`${j.node}/${j.code}`,
    Object.fromEntries(j.changes.map(([k, from]) => [k, from === '(빈칸)' ? '' : from]))])), null, 2), 'utf8');
console.log('\n백업 → tmp/backup/policy-values-before.json');

for (const j of jobs) {
  const body = Object.fromEntries(j.changes.map(([k, , to]) => [k, to]));
  const r = await fetch(`${DB}/${j.node}/${j.code}.json?access_token=${t}`, { method: 'PATCH', body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH ${j.node}/${j.code} 실패 ${r.status} ${await r.text()}`);
}
console.log(`반영 완료 — 정책 ${jobs.length}건`);
