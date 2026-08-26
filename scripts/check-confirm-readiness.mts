/**
 * **이 달 실적 확인을 «누를 수 있는 사람»이 있는가.** 읽기만 한다.
 *
 * ★사장님 2026-08-26 「영업자한테 실적 먼저 확인하고 그게 ㅇㅋ 되면 공급사에 청구」.
 *   문을 만들어 놓고 **열 사람이 없으면** 그건 문이 아니라 벽이다.
 *   9월 초에 청구가 안 나가는 이유가 「계정이 없어서」면 그건 지금 알아야 한다.
 *
 * 세 가지를 센다 —
 *   ① 이 달 청구가 서는 건의 영업담당자 — 몇 명이 몇 건을 들고 있나
 *   ② 그 이름으로 **로그인할 수 있는 계정**이 있나 (users/{uid}.name 대조)
 *   ③ 계정이 있어도 «막혀» 있지 않나 (pending·비활성·역할 없음)
 *
 *   npx tsx scripts/check-confirm-readiness.mts 2026-08
 */
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
import { SETTLEMENT_LEDGER_ID as LEDGER } from '../lib/domain/settlement-ledger';
import { billingMonth, moneyOf, type SettlementRow } from '../lib/domain/settlement-stage';
import { nameKey } from '../lib/domain/settlement-view';
import { isWorkspaceEmail } from '../lib/domain/self-serve-activation';

const MONTH = (process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '2026-08').trim();
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };
const ON = (v: unknown) => /^(TRUE|참|Y|예|1)$/i.test(S(v));
const a1 = (t: string) => "'" + t.replace(/'/g, "''") + "'";
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const SERIAL0 = Date.UTC(1899, 11, 30);
const toDate = (v: unknown): Date | null => {
  const t = S(v);
  if (!t) return null;
  const n = Number(t);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    const u = new Date(SERIAL0 + Math.round(n) * 86_400_000);
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  const x = new Date(t);
  return Number.isNaN(+x) ? null : x;
};

const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const sheetJwt = new JWT({ email: sa.client_email, key: sa.private_key, subject: 'pyh@teamjpk.com', scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheet = async (u: string) => {
  const t = (await sheetJwt.getAccessToken()).token;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${t}` } });
  const x = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${x.slice(0, 160)}`);
  return x ? JSON.parse(x) as { values?: unknown[][] } : {};
};

// ─────────────────────────── ① 이 달 청구가 서는 건의 영업담당자
const agents = new Map<string, { n: number; won: number; suppliers: Set<string>; code: string }>();
for (const tab of ['접수', '취소', '분납실적', '완료실적']) {
  const got = await sheet(`https://sheets.googleapis.com/v4/spreadsheets/${LEDGER}/values/${encodeURIComponent(`${a1(tab)}!A1:BZ3000`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const all = ((got.values || []) as unknown[][]).map((r) => (r || []).map(S));
  const hi = all.findIndex((r) => r.includes('차량번호'));
  if (hi < 0) continue;
  const h = all[hi];
  const at = (n: string) => h.indexOf(n);
  for (const r of all.slice(hi + 1)) {
    if (!S(r[at('차량번호')])) continue;
    const row: SettlementRow = {
      plate: S(r[at('차량번호')]), supplier: S(r[at('공급사')]), agent: S(r[at('영업담당자')]), product: S(r[at('상품구분')]),
      term: N(r[at('계약기간')]), rent: N(r[at('렌탈료')]), price: N(r[at('차량가액')]), payKind: S(r[at('분납여부')]),
      receivedAt: toDate(r[at('접수일')]), deliveredAt: toDate(r[at('인도일')]), clawbackAt: toDate(r[at('환수일')]),
      clawbackAmount: N(r[at('환수금액')]),
      paper: ON(r[at('계약서')]), delivered: !!toDate(r[at('인도일')]),
      cancelled: ON(r[at('계약취소')]), clawback: ON(r[at('환수')]),
      claimWritten: N(r[at('판매수수료')]), payWritten: N(r[at('출고수수료')]),
      supplierRate: N(r[at('공급사수수료율')]), agentRate: N(r[at('에이전시수수료율')]),
      agentCode: S(r[at('영업자코드')]),
    };
    if (row.cancelled || billingMonth(row) !== MONTH) continue;
    const k = row.agent || '(영업담당자 미기재)';
    const c = agents.get(k) || { n: 0, won: 0, suppliers: new Set<string>(), code: '' };
    c.n += 1; c.won += moneyOf(row).claim; c.suppliers.add(row.supplier || '(공급사 미기재)');
    // ★코드가 박혀 있으면 그것이 이긴다 — 동명이인은 이름으로 못 가른다.
    if (S(row.agentCode)) c.code = S(row.agentCode);
    agents.set(k, c);
  }
}

// ─────────────────────────── ② · ③ 계정이 있나 · 막혀 있지 않나
const dbUrl = S(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL);
type U = { name?: string; role?: string; status?: string; is_active?: unknown; email?: string; company_code?: string };
let users: Record<string, U> = {};
if (dbUrl) {
  const rtdb = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'] });
  const tok = (await rtdb.getAccessToken()).token;
  users = (await (await fetch(`${dbUrl}/users.json`, { headers: { Authorization: `Bearer ${tok}` } })).json()) as Record<string, U> || {};
}

const byName = new Map<string, { uid: string; u: U }[]>();
const byCode = new Map<string, { uid: string; u: U }>();
for (const [uid, u] of Object.entries(users)) {
  const code = S((u as U & { user_code?: string })?.user_code);
  if (code) byCode.set(code, { uid, u });
  const k = nameKey(u?.name);
  if (!k) continue;
  (byName.get(k) || byName.set(k, []).get(k)!).push({ uid, u });
}

const blockedWhy = (u: U): string => {
  const st = S(u.status);
  if (st === 'deleted' || st === 'rejected') return `계정이 ${st}`;
  if (u.is_active === false || S(u.is_active) === '아니오') return '비활성';
  if (!S(u.role)) return '역할 없음';
  if (st === 'pending') return isWorkspaceEmail(u.email) ? '승인 대기(우리 도메인 — 로그인하면 자동 통과)' : '승인 대기';
  return '';
};

console.log(`\n${'═'.repeat(72)}`);
console.log(`  ${MONTH} 실적 확인 — 누를 사람이 있나   영업담당자 ${agents.size}명`);
console.log('═'.repeat(72));

let ready = 0; let blocked = 0; let missing = 0;
const rows = [...agents].sort((a, b) => b[1].n - a[1].n);
for (const [name, v] of rows) {
  // ★코드가 박힌 줄은 코드로 사람을 찾는다. 이름은 겹쳐도 코드는 안 겹친다.
  const coded = v.code ? byCode.get(v.code) : undefined;
  const hits = coded ? [coded] : (byName.get(nameKey(name)) || []);
  let mark = '⛔'; let note = '계정 없음 — 만들어야 누를 수 있다';
  if (hits.length === 1) {
    const why = blockedWhy(hits[0].u);
    if (!why) { mark = '✓'; note = `${v.code || S(hits[0].u.email) || hits[0].uid.slice(0, 8)}`; ready++; }
    else { mark = '·'; note = why; blocked++; }
  } else if (hits.length > 1) {
    mark = '·'; note = `같은 이름 계정이 ${hits.length}개 — 누구인지 정해야 한다`; blocked++;
  } else missing++;
  console.log(`   ${mark} ${name.padEnd(12)} ${String(v.n).padStart(3)}건 ${won(v.won).padStart(12)}   ${note}`);
  console.log(`        공급사 ${[...v.suppliers].join(' · ')}`);
}

console.log(`\n■ 정리`);
console.log(`   ✓ 지금 바로 누를 수 있다        ${ready}명`);
console.log(`   · 계정은 있는데 막혀 있다        ${blocked}명`);
console.log(`   ⛔ 계정이 없다                  ${missing}명`);
const stuck = rows.filter(([n, v]) => {
  const c = v.code ? byCode.get(v.code) : undefined;
  const h = c ? [c] : (byName.get(nameKey(n)) || []);
  return h.length !== 1 || !!blockedWhy(h[0].u);
});
const stuckMoney = stuck.reduce((s, [, v]) => s + v.won, 0);
const stuckLines = stuck.reduce((s, [, v]) => s + v.n, 0);
if (stuck.length) {
  console.log(`\n   ⚠ 못 누르는 ${stuck.length}명이 ${stuckLines}건 ${won(stuckMoney)} 을 들고 있다.`);
  console.log('      이 사람들이 확인을 못 하면 그 건이 든 공급사 청구서가 못 나간다.');
  console.log('      계정을 만들거나, 확인 단위를 사람이 아니라 영업채널로 올려야 한다.');
}
console.log('');
