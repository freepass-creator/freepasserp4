/**
 * 공급사 정책 연결 — 「없으면 없다」로.
 *
 * 사장님 2026-08-07 「연동되게 해야 하는데… 없으면 없다 · 미입력이면 미입력이다 ·
 * 차라리 대여료만 맞게 보여주는 게 낫지」, 그리고
 * 「공급업체별로 정책은 기본적으로 관리자가 알려줄 수 있으니까 일단 내용 없는 건 없으면 없는 거로 연동될 수 있게끔」.
 *
 * ── 무엇이 깨져 있었나
 * 매물이 든 `policy_code` 는 erp3 시절 코드(`pol_freepassstd` 244대 · 빈칸 514대)인데
 * 정책 노드의 키는 절연 때 새로 발급한 `FP-RP0xx-RENT` 다. **한 대도 안 붙는다.**
 * 조인이 실패하면 `applyPolicyDefaults` 가 빈 정책을 프리패스 표준으로 채워
 * 816대가 전부 같은 조건을 보인다 — 그 공급사가 주지도 않은 조건이다.
 *
 * ── 이 스크립트가 하는 일 (둘 다 되돌릴 수 있게 백업을 먼저 뜬다)
 *  ① 공급사 정책 셸(`FP-{공급사}-RENT`)에서 **기본값으로 채워진 칸을 걷어낸다.**
 *     FP-* 21건은 값이 6칸(전부 이름·코드)만 다른 **똑같은 기본 묶음**이라 공급사 사실이 하나도 없다.
 *     대신 그 공급사가 실제로 준 정책(시트 유래 `RP0xx_S**` · v3 `RP0xx_P**`)의 값은 살려서 얹는다.
 *     비운 칸이 다시 채워지지 않도록 `policy_default_pack` 을 박는다(applyPolicyDefaults 의 기존 약속).
 *  ② 매물의 `policy_code` 를 자기 공급사의 `FP-{공급사}-RENT` 로 건다.
 *
 * 그러면 화면은 «아는 것만» 말한다. 나머지는 미입력으로 서서, 관리자가 공급사에게 받아 채우면
 * 그 공급사 매물 전부가 한 번에 바뀐다.
 *
 * 실행: npx tsx scripts/apply-policy-link.mts          (드라이런 — 아무것도 안 쓴다)
 *       npx tsx scripts/apply-policy-link.mts --apply  (백업 뜨고 반영)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { POLICY_DEFAULTS, FREEPASS_POLICY_PACK } from '../lib/domain/policy-defaults';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const t = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const read = async (p: string) => JSON.parse(await (await fetch(`${DB}/${p}.json?access_token=${t}`)).text()) || {};
const patch = async (p: string, body: unknown) => {
  const r = await fetch(`${DB}/${p}.json?access_token=${t}`, { method: 'PATCH', body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`PATCH ${p} 실패 ${r.status} ${await r.text()}`);
};

const products = await read('v4/products');
const policies = { ...(await read('policies')), ...(await read('v4/policies')) } as Record<string, any>;
const dead = (p: any) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const live = Object.entries<any>(products).filter(([, p]) => p && typeof p === 'object' && !dead(p));

// 기본값과 «글자까지 같은» 칸만 걷어낸다 — 사람이 손으로 넣은 값은 건드리지 않는다.
const DEFAULT_BY_KEY = new Map(POLICY_DEFAULTS.filter((d) => d.value !== null).map((d) => [d.key, String(d.value)]));
// 신원 칸은 남긴다 — 이게 없으면 정책이 자기가 누구 것인지 잃는다.
const KEEP = new Set(['policy_code', 'policy_name', 'provider_company_code', 'term_code', 'term_name', 'createdAt', 'updatedAt', '_key']);

type Plan = { code: string; clear: string[]; keepReal: Record<string, string>; from: string[] };
const plans: Plan[] = [];
for (const [code, pol] of Object.entries(policies)) {
  const m = /^FP-(RP\d{3})-RENT$/.exec(code);
  if (!m) continue;
  const prov = m[1];
  // 그 공급사가 실제로 준 정책 = 시트 유래(S**) · v3(P**). 여기 값은 사실이라 살린다.
  // 시트 유래 `RP031_S01` · v3 `RP004_P01` 꼴. 정규식 이스케이프를 파일에 담다 한 번 먹혀
  //  `\d` 가 `d` 로 새어 0건이 나왔다 — 그래서 글자로 판정한다.
  const isRealSourceKey = (k: string) => {
    if (!k.startsWith(`${prov}_`)) return false;
    const tail = k.slice(prov.length + 1);
    return tail.length >= 2 && (tail[0] === 'S' || tail[0] === 'P') && /^[0-9]+$/.test(tail.slice(1));
  };
  const realSources = Object.entries(policies).filter(([k]) => k !== code && isRealSourceKey(k));
  const keepReal: Record<string, string> = {};
  for (const [, src] of realSources) {
    for (const [k, v] of Object.entries<any>(src)) {
      if (KEEP.has(k) || k.startsWith('_') || S(v) === '') continue;
      if (keepReal[k] == null) keepReal[k] = S(v);
    }
  }
  const clear: string[] = [];
  for (const [k, v] of Object.entries<any>(pol)) {
    if (KEEP.has(k) || k.startsWith('_') || S(v) === '') continue;
    if (keepReal[k] != null) continue;              // 공급사가 준 값이 덮을 자리
    if (DEFAULT_BY_KEY.get(k) === S(v)) clear.push(k); // 기본값 그대로 = 우리가 지어낸 값
  }
  plans.push({ code, clear, keepReal, from: realSources.map(([k]) => k) });
}

// 매물 → 자기 공급사 정책
const linkable: [string, string, string][] = []; // [매물키, 지금코드, 걸 코드]
const noPolicy = new Map<string, number>();
for (const [key, p] of live) {
  const prov = S(p.provider_company_code);
  const want = `FP-${prov}-RENT`;
  if (!policies[want]) { noPolicy.set(prov, (noPolicy.get(prov) || 0) + 1); continue; }
  if (S(p.policy_code) === want) continue;
  linkable.push([key, S(p.policy_code) || '(빈칸)', want]);
}

console.log(`${APPLY ? '★반영' : '드라이런(아무것도 안 씀)'}\n`);
console.log(`── ① 공급사 정책 셸에서 기본값 걷어내기 (FP-* ${plans.length}건) ──`);
for (const pl of plans.sort((a, b) => b.clear.length - a.clear.length).slice(0, 6)) {
  console.log(`   ${pl.code.padEnd(16)} 기본값 ${String(pl.clear.length).padStart(2)}칸 비움` +
    (pl.from.length ? ` · 공급사 실제값 ${Object.keys(pl.keepReal).length}칸 얹음(${pl.from.join(',')})` : ''));
}
const totalClear = plans.reduce((n, p) => n + p.clear.length, 0);
const totalReal = plans.reduce((n, p) => n + Object.keys(p.keepReal).length, 0);
console.log(`   … 합계 ${totalClear}칸 비움 · 공급사 실제값 ${totalReal}칸 살림\n`);

console.log('── ② 매물 → 공급사 정책 연결 ──');
const byWant = new Map<string, number>();
for (const [, , w] of linkable) byWant.set(w, (byWant.get(w) || 0) + 1);
for (const [w, n] of [...byWant].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(4)}대 → ${w}`);
console.log(`   합계 ${linkable.length}대 연결`);
if (noPolicy.size) {
  console.log('\n   ★그 공급사 정책이 없어 못 거는 매물:');
  for (const [c, n] of noPolicy) console.log(`      ${String(n).padStart(4)}대  ${c}  → 정책을 만들거나 미연결로 둔다`);
}

if (!APPLY) { console.log('\n반영하려면 --apply'); process.exit(0); }

mkdirSync('tmp/backup', { recursive: true });
const stamp = S(process.env.STAMP) || 'policy-link';
writeFileSync(`tmp/backup/${stamp}-policies.json`, JSON.stringify(policies, null, 2), 'utf8');
writeFileSync(`tmp/backup/${stamp}-product-policy-codes.json`,
  JSON.stringify(Object.fromEntries(live.map(([k, p]) => [k, S(p.policy_code)])), null, 2), 'utf8');
console.log(`\n백업 → tmp/backup/${stamp}-*.json`);

for (const pl of plans) {
  const body: Record<string, unknown> = { ...pl.keepReal };
  for (const k of pl.clear) body[k] = null;             // null = RTDB 에서 칸 삭제
  if (pl.clear.length || Object.keys(pl.keepReal).length) {
    body.policy_default_pack = FREEPASS_POLICY_PACK;    // 비운 칸이 다시 안 채워지도록
    await patch(`v4/policies/${pl.code}`, body);
  }
}
console.log(`① 정책 ${plans.length}건 정리 완료`);

let n = 0;
for (const [key, , want] of linkable) { await patch(`v4/products/${key}`, { policy_code: want }); n++; if (n % 100 === 0) console.log(`   … ${n}대`); }
console.log(`② 매물 ${n}대 연결 완료`);
