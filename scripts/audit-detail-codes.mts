/**
 * 상세페이지에 «코드»가 새어 나가는 자리를 찾는다 — 영업자·손님 화면 기준.
 *
 * 사장님 2026-08-07 「각 섹션에 내용들만 영업자 손님이 보는 거만 잘 정리하자는 거여 코드 같은 건 필요 없다」.
 * 사람이 읽는 화면에 `RP014` · `pol_freepassstd` · `veh_...` 같은 기계 식별자가 서 있으면
 * 영업자가 그걸 손님에게 말한다. 값이 틀린 게 아니라 «말이 아닌 것»이 화면에 있는 게 문제다.
 *
 * 읽기만 한다(RTDB 쓰기 없음).
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { detailSections, agentPanelRows, isHiddenFromCatalog, priceList } from '../lib/domain/product';
import { applyPolicyDefaults } from '../lib/domain/policy-defaults';
import type { EntityRecord } from '../lib/intake/entities';

const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const t = (await new JWT({ email: sa.client_email, key: sa.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] }).getAccessToken()).token;
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const read = async (path: string) => JSON.parse(await (await fetch(`${DB}/${path}.json?access_token=${t}`)).text()) || {};

const prods = await read('v4/products');
// 정책은 v3 루트 + v4 오버레이 둘 다 읽어 겹친다(rtdb-adapter 와 같은 순서).
const polByCode = new Map<string, any>();
for (const node of ['policies', 'v4/policies']) {
  for (const [k, v] of Object.entries<any>(await read(node))) {
    if (!v || typeof v !== 'object') continue;
    polByCode.set(S(v.policy_code) || k, v);
  }
}
console.log(`정책 ${polByCode.size}건`);
// ★ 정책이 안 붙어도 applyPolicyDefaults 가 프리패스 표준으로 채운다 — 화면과 같은 값을 보려면 이걸 태워야 한다.
//   (안 태우면 「계약조건 100% 빔」 같은 거짓 측정이 나온다.)
const joinPolicy = (p: any) => applyPolicyDefaults(polByCode.get(S(p.policy_code)) || {}).next;
const dead = (p: any) => p?._deleted === true || !!p?.deletedAt || S(p?.status) === 'deleted';
const listed = Object.entries<any>(prods)
  .filter(([, p]) => p && typeof p === 'object' && !dead(p))
  .map(([k, p]) => ({ ...p, _key: k, _policy: joinPolicy(p) }))
  .filter((p) => !isHiddenFromCatalog(p as any) && priceList(p as any).length > 0);

console.log(`매물 ${listed.length}대\n`);

// 「코드」로 보이는 값 — 사람이 말로 쓰지 않는 기계 식별자.
const CODEY = [
  { name: '공급사코드 RP0xx', re: /\bRP\d{3}\b/ },
  { name: '정책키 pol_xxx', re: /\bpol_[a-z0-9_]+/i },
  { name: '매물키 veh_xxx', re: /\bveh_[a-z0-9_]+/i },
  { name: '언더바 식별자', re: /\b[a-z]+_[a-z0-9_]{4,}\b/i },
];

type Hit = { label: string; sample: string; kind: string; n: number };
const scan = (who: 'agent' | 'customer') => {
  const hits = new Map<string, Hit>();
  for (const p of listed) {
    const rows: [string, string, string][] = [];
    for (const sec of detailSections(p as EntityRecord, who)) {
      if (sec.kind === 'kv') for (const [l, v] of sec.rows) rows.push([sec.title, l, S(v)]);
      if (sec.kind === 'ins') for (const [l, a, b] of sec.rows as any[]) rows.push([sec.title, l, `${S(a)} ${S(b)}`]);
    }
    if (who === 'agent') for (const [l, v] of agentPanelRows(p as EntityRecord, 'agent')) rows.push(['영업자패널', l, S(v)]);
    for (const [sec, label, val] of rows) {
      if (!val) continue;
      for (const c of CODEY) {
        if (!c.re.test(val)) continue;
        const key = `${sec}|${label}|${c.name}`;
        const cur = hits.get(key);
        if (cur) cur.n++;
        else hits.set(key, { label: `${sec} › ${label}`, sample: val.slice(0, 60), kind: c.name, n: 1 });
        break;
      }
    }
  }
  console.log(`── ${who === 'agent' ? '영업자' : '손님'} 화면 ──`);
  if (!hits.size) { console.log('  코드로 보이는 값 없음\n'); return; }
  for (const h of [...hits.values()].sort((a, b) => b.n - a.n)) {
    console.log(`  ${String(h.n).padStart(4)}대  ${h.label.padEnd(24)} ${h.kind.padEnd(16)} 예: ${h.sample}`);
  }
  console.log('');
};
scan('agent');
scan('customer');

// 섹션별 「미입력/빈칸」 비율 — 무엇이 채워져 있고 무엇이 늘 비는지.
console.log('── 줄별 빈칸 비율(영업자 화면) ──');
const tally = new Map<string, { empty: number; total: number }>();
for (const p of listed) {
  for (const sec of detailSections(p as EntityRecord, 'agent')) {
    if (sec.kind !== 'kv') continue;
    for (const [l, v] of sec.rows) {
      const key = `${sec.title} › ${l}`;
      const t2 = tally.get(key) || { empty: 0, total: 0 };
      t2.total++;
      const sv = S(v);
      if (!sv || sv === '미입력' || /^(미입력( · 미입력)*)$/.test(sv) || sv === '-') t2.empty++;
      tally.set(key, t2);
    }
  }
}
for (const [k, v] of tally) {
  const pct = Math.round((v.empty / v.total) * 100);
  const bar = pct >= 90 ? '████ 거의 다 빔' : pct >= 50 ? '██   절반 이상 빔' : pct >= 15 ? '█    일부 빔' : '     찼음';
  console.log(`  ${String(pct).padStart(3)}%  ${k.padEnd(34)} ${bar}  (${v.empty}/${v.total})`);
}

/**
 * ★진짜 문제 — 「의미 없이 채워진 칸」(사장님 2026-08-07 「의미없이 채우기 했거나 내용에 안 맞게 있거나」).
 * 정책이 안 붙은 매물도 applyPolicyDefaults 가 «프리패스 표준»으로 다 채운다.
 * 그래서 화면은 빈 데가 없지만, 그 값은 **그 공급사가 실제로 준 조건이 아니다**.
 * 영업자가 그걸 그대로 손님에게 말하면 틀린 조건을 약속하는 것이다.
 */
console.log('\n── 정책이 안 붙은 매물이 화면에 무엇을 보이나 ──');
const noPol = listed.filter((p) => !polByCode.has(S(p.policy_code)));
const byProv = new Map<string, number>();
for (const p of noPol) byProv.set(S(p.provider_name) || S(p.provider_company_code) || '?', (byProv.get(S(p.provider_name) || S(p.provider_company_code) || '?') || 0) + 1);
console.log(`  정책 미연결 ${noPol.length}대 / 전체 ${listed.length}대`);
for (const [k, v] of [...byProv].sort((a, b) => b[1] - a[1])) console.log(`     ${String(v).padStart(4)}대  ${k}`);
if (noPol.length) {
  const sec = detailSections(noPol[0] as EntityRecord, 'agent').find((x) => x.title === '계약조건');
  console.log('\n  → 이 매물들의 「계약조건」에 찍히는 값(전부 같은 프리패스 표준):');
  if (sec && sec.kind === 'kv') for (const [l, v] of sec.rows) console.log(`     ${l.padEnd(14)} ${S(v) || '(빈칸)'}`);
}
