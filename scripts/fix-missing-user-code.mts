/**
 * user_code 없는 영업자에게 코드 발급 — 이게 없으면 **문의·계약을 아예 못 만든다.**
 *
 * deal.ts resolveChannel 은 agent_channel_code → session.channel → user_code 순으로 폴백하는데
 * 셋 다 비면 requireParties 가 throw 해서 방 생성이 실패한다.
 *
 * **agent_channel_code 는 일부러 건드리지 않는다.** 폴백으로 user_code 가 채널이 되는 게
 * 설계다(lib/firebase/auth.ts: "공유 SP999 채널 금지 — 규칙 게시 시 개인끼리 방·계약·정산 교차열람").
 * 실제로 SP001·SP002·SP999 를 보는 채널 관리자는 없다(2026-07-31 실측: QA 계정 1개뿐).
 *
 * 기본은 드라이런. 쓰려면 --apply.
 *
 * 실행:
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/fix-missing-user-code.mts
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/fix-missing-user-code.mts --apply
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const APPLY = process.argv.includes('--apply');
const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
initializeApp({ credential: saJson ? cert(JSON.parse(saJson)) : applicationDefault(), databaseURL: DB });
const db = getDatabase();

type Rec = Record<string, any>;
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const S = (v: unknown) => String(v ?? '').trim();
const AGENT_ROLES = new Set(['agent', 'agent_admin', 'agent_manager']);

async function main() {
  const snap = await db.ref('users').get();
  const users = Object.entries((snap.val() || {}) as Rec).filter(([, u]) => isObj(u));

  const used = new Set<string>();
  for (const [, u] of users) if (S(u.user_code)) used.add(S(u.user_code));

  const targets = users.filter(([, u]) => {
    if (!AGENT_ROLES.has(S(u.role))) return false;
    if (u._deleted === true) return false;
    const st = S(u.status);
    if (st === 'deleted' || st === 'pending' || st === 'rejected') return false;
    if (S(u.is_active) === '아니오' || u.is_active === false) return false;
    return !S(u.user_code);
  });

  if (!targets.length) { console.log('대상 없음 — user_code 없는 활성 영업자가 없다.'); process.exit(0); }

  console.log(`대상 ${targets.length}명`);
  const plan: { uid: string; name: string; code: string; company?: string }[] = [];

  // 채번은 counters/user_code_seq 트랜잭션으로 — writeUserProfile 과 같은 원천을 쓴다.
  //  별도로 최대값을 계산해 쓰면 신규 가입자와 충돌한다.
  for (const [uid, u] of targets) {
    let code = '';
    if (APPLY) {
      const res = await db.ref('counters/user_code_seq').transaction((cur) => (Number(cur) || 0) + 1);
      if (!res.committed) throw new Error(`채번 실패: ${uid}`);
      code = `U${String(res.snapshot.val()).padStart(4, '0')}`;
    } else {
      const seq = Number((await db.ref('counters/user_code_seq').get()).val()) || 0;
      code = `U${String(seq + 1 + plan.length).padStart(4, '0')}`;
    }
    if (used.has(code)) throw new Error(`코드 충돌: ${code} — 중단`);
    used.add(code);
    const entry = { uid, name: S(u.name) || '(이름없음)', code, ...(S(u.company_code) ? {} : { company: 'SP999' }) };
    plan.push(entry);
    console.log(`  ${entry.name} (${uid.slice(0, 8)}…) → user_code=${code}${entry.company ? ` · company_code=${entry.company}(소속없음→개인)` : ''}`);
  }

  if (!APPLY) {
    console.log('\n드라이런 — 실제 쓰기 없음. 적용하려면 --apply');
    console.log('※ agent_channel_code 는 건드리지 않는다(user_code 폴백이 고유 채널이 된다)');
    process.exit(0);
  }

  mkdirSync('tmp/migration', { recursive: true });
  const log = `tmp/migration/user-code-fix-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
  const patch: Rec = {};
  for (const p of plan) {
    const before = (await db.ref(`users/${p.uid}`).get()).val();
    appendFileSync(log, JSON.stringify({ uid: p.uid, before }) + '\n', 'utf8');
    patch[`users/${p.uid}/user_code`] = p.code;
    patch[`users/${p.uid}/updated_at`] = Date.now();
    if (p.company) patch[`users/${p.uid}/company_code`] = p.company;
  }
  await db.ref('/').update(patch);
  console.log(`\n적용 ${Object.keys(patch).length}경로 · 롤백 로그 ${log}`);
  process.exit(0);
}

main().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });
