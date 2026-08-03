/**
 * 레거시 계약의 빈 agent_channel_code 백필.
 *
 * 왜: 후보 Rules 의 v4/contracts .validate 가 hasChildren 으로 agent_channel_code 를 요구한다.
 * 값이 없는 레거시 계약은 v4 오버레이 첫 쓰기(단계 진행·취소·서명 발송)가 permission_denied 다.
 * 값은 지어내지 않는다 — **계약의 agent_uid 로 users 를 찾아 그 회원의 채널을 그대로 승계**한다.
 * 유도할 수 없는 건(회원 없음·채널 없음)은 건드리지 않고 남긴다.
 *
 * 실행:
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/backfill-contract-channel.mts
 *   ... --apply    실제 기록(변경 전 원본은 tmp/backfill-channel-*.jsonl 에 남긴다)
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync, writeFileSync } from 'node:fs';

const saPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
initializeApp({
  credential: saPath ? cert(JSON.parse(readFileSync(saPath, 'utf8'))) : applicationDefault(),
  databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app',
});
const db = getDatabase();
const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();

type Rec = Record<string, any>;

async function main() {
  const [c3, c4, us] = await Promise.all([
    db.ref('contracts').get(), db.ref('v4/contracts').get(), db.ref('users').get(),
  ]);
  const v4c: Rec = c4.val() || {};
  const users: Rec = us.val() || {};
  const rows = Object.entries<Rec>(c3.val() || {})
    .filter(([, r]) => r && r._deleted !== true && S(r.status) !== 'deleted');

  const updates: Record<string, string> = {};
  const backup: string[] = [];
  let skipped = 0;

  for (const [key, r] of rows) {
    if (S(r.agent_channel_code)) continue;                 // 이미 있음
    const uid = S(r.agent_uid);
    const u = uid ? users[uid] : null;
    const ch = u ? S(u.agent_channel_code) : '';
    if (!ch) {
      skipped++;
      console.log(`  건너뜀 ${key} — ${!uid ? 'agent_uid 없음' : !u ? '회원 없음' : '회원에 채널 없음'}`);
      continue;
    }
    // v4 에 이미 노드가 있으면 그쪽에, 없으면 v4 오버레이를 새로 만든다(v3 원본은 안 건드린다).
    const target = v4c[key] ? `v4/contracts/${key}/agent_channel_code` : `v4/contracts/${key}/agent_channel_code`;
    console.log(`  ${key} ← ${ch}  (${S(u.name)} · ${S(r.contract_status) || '상태없음'})`);
    backup.push(JSON.stringify({ key, before: r.agent_channel_code ?? null, after: ch, from_uid: uid }));
    updates[target] = ch;
  }

  console.log(`\n백필 대상 ${Object.keys(updates).length}건 · 유도 불가 ${skipped}건`);
  if (!Object.keys(updates).length) return;
  writeFileSync('tmp/backfill-channel.jsonl', backup.join('\n'));
  console.log('원본 백업 → tmp/backfill-channel.jsonl');
  if (!APPLY) { console.log('\nDRY-RUN — 쓰지 않았다. 적용하려면 --apply'); return; }
  // set() 금지 — 멀티패스 update 로 해당 필드만.
  await db.ref().update(updates);
  console.log('✓ 적용 완료');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
