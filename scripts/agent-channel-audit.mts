/**
 * 영업자 채널 결손 실태 — 규칙을 조인 뒤 실제로 무엇이 막히는지.
 *
 * 두 가지를 갈라 본다(대응이 다르다).
 *   A. **문의·계약을 아예 못 만드는 사람** — agent_channel_code 도 user_code 도 없다.
 *      deal.ts resolveChannel 이 channel → session.channel → user_code 순으로 폴백하는데
 *      전부 비면 requireParties 가 throw 한다. 방 생성 자체가 실패한다.
 *   B. **채널 스코프로 아무것도 못 보는 사람** — 역할이 agent_admin/agent_manager 인데 채널이 없다.
 *      accessScope 가 'none' 이 되어 목록이 통째로 빈다.
 *   (일반 agent 는 uid 기준 스코프라 채널이 없어도 읽기는 된다 — 급하지 않다)
 *
 * 실행:
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/agent-channel-audit.mts
 */
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
initializeApp({ credential: saJson ? cert(JSON.parse(saJson)) : applicationDefault(), databaseURL: DB });
const db = getDatabase();

type Rec = Record<string, any>;
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const S = (v: unknown) => String(v ?? '').trim();
const AGENT_ROLES = new Set(['agent', 'agent_admin', 'agent_manager']);

async function main() {
  const [uSnap, rSnap, cSnap] = await Promise.all([
    db.ref('users').get(), db.ref('rooms').get(), db.ref('contracts').get(),
  ]);
  const users = Object.entries((uSnap.val() || {}) as Rec).filter(([, u]) => isObj(u));

  // 최근 활동 — 방·계약에 agent_uid 로 등장한 적 있는가(휴면 계정과 구분).
  const active = new Set<string>();
  for (const snap of [rSnap, cSnap]) {
    for (const v of Object.values((snap.val() || {}) as Rec)) {
      if (isObj(v) && S(v.agent_uid)) active.add(S(v.agent_uid));
    }
  }

  const A: string[] = []; const B: string[] = []; const C: string[] = [];
  for (const [uid, u] of users) {
    const role = S(u.role);
    if (!AGENT_ROLES.has(role)) continue;
    if (u._deleted === true || S(u.status) === 'deleted' || S(u.status) === 'pending') continue;
    if (S(u.is_active) === '아니오' || u.is_active === false) continue;

    const ch = S(u.agent_channel_code);
    const code = S(u.user_code);
    const tag = `${uid.slice(0, 8)}… ${S(u.name) || '(이름없음)'} · ${role} · code=${code || '없음'} · company=${S(u.company_code) || '없음'}${active.has(uid) ? ' · 활동이력있음' : ''}`;
    if (ch) continue;
    if (!code) A.push(tag);
    else if (role !== 'agent') B.push(tag);
    else C.push(tag);
  }

  console.log(`## A. 문의·계약 생성 자체가 실패 (채널·코드 둘 다 없음) — ${A.length}명`);
  A.forEach((t) => console.log('  ', t));
  console.log(`\n## B. 채널 스코프라 목록이 통째로 빔 (agent_admin/manager + 채널 없음) — ${B.length}명`);
  B.forEach((t) => console.log('  ', t));
  console.log(`\n## C. 일반 agent + 채널 없음 — ${C.length}명 (읽기는 uid 스코프라 동작. 방 생성 시 user_code 가 채널로 박힌다)`);
  C.slice(0, 10).forEach((t) => console.log('  ', t));
  if (C.length > 10) console.log(`   … 외 ${C.length - 10}명`);

  // 이미 만들어진 방의 채널값 분포 — user_code 폴백이 실제로 쓰였는지
  const chDist: Record<string, number> = {};
  for (const v of Object.values((rSnap.val() || {}) as Rec)) {
    if (!isObj(v)) continue;
    const c = S(v.agent_channel_code) || '(빈값)';
    chDist[c] = (chDist[c] || 0) + 1;
  }
  console.log('\n## 기존 방의 agent_channel_code 분포');
  for (const [k, n] of Object.entries(chDist).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(4)}  ${k}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });
