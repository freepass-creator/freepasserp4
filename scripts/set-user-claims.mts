/**
 * Firebase Auth 커스텀 클레임 세팅 — Firestore 규칙(myCompany·role)이 요구하는 것(사장님 2026-09-04 RTDB 제거).
 *   firestore.rules 가 claim('role')·claim('company')·claim('agent_code')·claim('provider_company_code') 로 회사·역할을 가른다.
 *   이게 유저 토큰에 없으면 DATA_BACKEND=firestore 에서 계약·정산·정책·파트너 read 가 전부 막힌다(products 만 예외).
 * 유저 레코드(v3/v4 users, uid 있는 것)를 읽어 setCustomUserClaims. 기본 dry-run · --apply.
 * ★클레임은 «다음 토큰 갱신»에 적용된다(재로그인 또는 최대 1시간). 스위치 전에 미리 박아 둔다.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const app = initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase(app);
const auth = getAuth(app);

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const v3 = (await db.ref('users').get()).val() as Record<string, any> || {};
const v4 = (await db.ref('v4/users').get()).val() as Record<string, any> || {};
const merged = new Map<string, Record<string, any>>();
for (const [k, v] of Object.entries(v3)) if (isObj(v)) merged.set(k, { ...v });
for (const [k, v] of Object.entries(v4)) if (isObj(v)) merged.set(k, { ...(merged.get(k) || {}), ...v });
const users = [...merged.values()].filter((u) => u._deleted !== true && S(u.status) !== 'deleted');

// 유저 → 클레임(사장님 2026-09-04 「공급사 코드 기준 · 공급사별·영업자별」).
//   ★영업자 격리 = agent_code = «user_code» (실측: 계약·정산의 agent_code 가 user_code 와 17/18 일치, channel 과는 0/18).
//   ★공급사 격리 = provider_company_code = 자기 공급사코드(= company_code, RP…). companyId(계약)=공급사코드 base.
function claimsFor(u: Record<string, any>) {
  const role = S(u.role) || 'agent';
  const company = S(u.company_code) || S(u.companyId) || S(u.company);
  const c: Record<string, string> = { role, company };
  const agent = S(u.user_code);   // ★계약 agent_code = user_code
  if (agent) c.agent_code = agent;
  const prov = S(u.provider_company_code) || (role.includes('provider') ? company : '');
  if (prov) c.provider_company_code = prov;
  return c;
}

let ok = 0, noUid = 0, noAuth = 0, fail = 0;
const rows: string[] = [];
for (const u of users) {
  const uid = S(u.uid) || S(u.auth_uid) || S(u.firebase_uid);
  if (!uid) { noUid++; continue; }
  const c = claimsFor(u);
  if (!c.company) { rows.length < 10 && rows.push(`  ⚠ ${uid} ${S(u.email)} — company_code 없음(건너뜀)`); continue; }
  if (rows.length < 12) rows.push(`  ${uid.slice(0, 8)}… ${S(u.email || u.company_name).slice(0, 18).padEnd(18)} → ${JSON.stringify(c)}`);
  if (APPLY) {
    try { await auth.setCustomUserClaims(uid, c); ok++; }
    catch (e) { const m = (e as Error).message; if (/no user record|USER_NOT_FOUND/i.test(m)) noAuth++; else { fail++; if (fail <= 5) console.warn(`  ✗ ${uid}: ${m}`); } }
  } else ok++;
}
console.log(`유저 ${users.length} · uid 있음 ${users.length - noUid} · uid 없음 ${noUid}`);
for (const r of rows) console.log(r);
console.log(`\n${APPLY ? '반영' : '미리보기'}: 세팅 ${ok} · Auth에 없는 uid ${noAuth} · 실패 ${fail}`);
if (!APPLY) console.log('실제 반영: --apply  (★클레임은 다음 토큰 갱신에 적용 — 재로그인 또는 최대 1시간)');
process.exit(0);
