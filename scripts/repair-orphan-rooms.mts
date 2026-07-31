/**
 * 소유필드 없는 방 복구 — 대화는 살아있는데 **당사자가 조회할 수단이 없는** 방을 되살린다.
 *
 * v4/rooms 에 agent_uid·provider_company_code 가 없는 방이 있다. 규칙상 영업자는
 * `orderByChild('agent_uid').equalTo(내uid)` 로만 방을 찾으므로, 이 필드가 없으면
 * **관리자 말고는 아무도 못 본다.** 메시지는 멀쩡히 쌓여 있는데 화면에 안 뜬다.
 *
 * 복원 근거(추측 금지 — 이 순서로만):
 *   1. 방키 패턴 `CH_{공급사}_{차번}_{채널}` — erp4 가 만든 키라 신뢰할 수 있다
 *   2. 그 방의 메시지 중 sender_role==='agent' 인 것의 sender_uid / sender_code
 *   3. 그 uid 의 users 레코드에서 agent_channel_code(없으면 user_code)
 *   4. 차번으로 매물을 찾아 provider_company_code 보강
 *   5. 그 방에서 말한 공급사 직원의 소속
 * agent_uid·channel 을 못 채우면 건너뛴다. provider 는 모르면 비워 둔다
 * (비워 두는 건 "공급사에게 계속 안 보임" 유지일 뿐이라 잘못 노출될 위험이 없다).
 *
 * 기본 드라이런. 쓰려면 --apply.
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

/** `CH_{공급사}_{차번}_{채널}` · 구형 `CH_{차번}_{코드}` 도 본다. */
function fromKey(key: string): { provider?: string; plate?: string; channel?: string } {
  const p = key.split('_');
  if (p[0] !== 'CH') return {};
  if (p.length >= 4) return { provider: p[1], plate: p[2], channel: p[3] };
  if (p.length === 3) return { plate: p[1], channel: p[2] };
  return {};
}

async function main() {
  const [rSnap, mSnap, uSnap, pSnap, p4Snap] = await Promise.all([
    db.ref('v4/rooms').get(), db.ref('v4/messages').get(), db.ref('users').get(),
    db.ref('products').get(), db.ref('v4/products').get(),
  ]);

  const users = (uSnap.val() || {}) as Rec;
  // 차번 → 공급사코드
  const byPlate = new Map<string, string>();
  for (const src of [pSnap.val() || {}, p4Snap.val() || {}]) {
    for (const v of Object.values(src as Rec)) {
      if (!isObj(v)) continue;
      const plate = S(v.car_number).replace(/\s/g, '');
      const prov = S(v.provider_company_code);
      if (plate && prov && !byPlate.has(plate)) byPlate.set(plate, prov);
    }
  }
  // 방 → 메시지
  const msgs = new Map<string, Rec[]>();
  for (const m of Object.values((mSnap.val() || {}) as Rec)) {
    if (!isObj(m)) continue;
    const rid = S(m.room_id);
    if (!rid) continue;
    const arr = msgs.get(rid); if (arr) arr.push(m); else msgs.set(rid, [m]);
  }

  const rooms = Object.entries((rSnap.val() || {}) as Rec).filter(([, v]) => isObj(v));
  const orphan = rooms.filter(([, v]) => !S((v as Rec).agent_uid));

  const patch: Rec = {};
  const fixed: string[] = []; const skipped: string[] = [];

  for (const [key, room] of orphan) {
    const r = room as Rec;
    if (r.is_admin_chat === true || key.startsWith('ADMIN_')) { skipped.push(`${key} — 관리자 상담방(당사자 없음이 정상)`); continue; }

    const k = fromKey(key);
    // 영업자 — 그 방에서 실제로 말한 사람
    const list = (msgs.get(key) || []).slice().sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));
    const byAgent = list.find((m) => S(m.sender_role) === 'agent' && S(m.sender_uid));
    const agentUid = S(r.agent_uid) || S(byAgent?.sender_uid);
    const agentCode = S(r.agent_code) || S(byAgent?.sender_code);
    const u = agentUid ? (users[agentUid] as Rec | undefined) : undefined;
    const channel = S(r.agent_channel_code) || S(u?.agent_channel_code) || S(u?.user_code) || agentCode || k.channel || '';
    const plate = S(r.vehicle_number) || S(r.car_number) || k.plate || '';
    // 공급사 — 방키·차번으로 못 찾으면 **그 방에서 실제로 말한 공급사 직원**의 소속을 쓴다.
    //  푸시ID 방은 키에 정보가 없어 이 근거가 없으면 영영 복구가 안 된다.
    const byProv = list.find((m) => S(m.sender_role).startsWith('provider') && S(m.sender_uid));
    const provUser = byProv ? (users[S(byProv.sender_uid)] as Rec | undefined) : undefined;
    const provider = S(r.provider_company_code)
      || k.provider
      || (plate ? byPlate.get(plate.replace(/\s/g, '')) : '')
      || S(provUser?.company_code)
      || S(byProv?.sender_code)
      || '';

    // **영업자가 확정되면 채운다.** provider 는 알면 채우고 모르면 비워 둔다.
    //  agent_uid 는 추측이 아니라 그 방에서 실제로 말한 사람이라 확실하고,
    //  이것만 채워도 영업자가 자기 방을 되찾는다(규칙상 영업자 조회는 agent_uid 기준).
    //  provider 를 비워 두는 건 "공급사에게 계속 안 보임" 유지일 뿐이라 잘못 노출될 위험이 없다.
    if (!agentUid || !channel) {
      skipped.push(`${key} — 메시지 ${list.length}건 · 못 채움: ${[!agentUid && 'agent_uid', !channel && 'channel'].filter(Boolean).join(', ')}`);
      continue;
    }

    const add: Rec = {};
    if (!S(r.agent_uid)) add.agent_uid = agentUid;
    if (!S(r.agent_code) && agentCode) add.agent_code = agentCode;
    if (!S(r.agent_channel_code)) add.agent_channel_code = channel;
    if (!S(r.provider_company_code) && provider) add.provider_company_code = provider;
    if (!S(r.vehicle_number) && plate) add.vehicle_number = plate;
    if (!Object.keys(add).length) continue;

    for (const [f, v] of Object.entries(add)) patch[`v4/rooms/${key}/${f}`] = v;
    fixed.push(`${key} · 메시지 ${list.length} → agent=${S(u?.name) || agentUid.slice(0, 8)}(${agentCode || '-'}) · ch=${channel} · prov=${provider || '(모름·비워둠)'}${plate ? ` · ${plate}` : ''}`);
  }

  console.log(`소유필드 없는 방 ${orphan.length}건 → 복구 가능 ${fixed.length} · 건너뜀 ${skipped.length}\n`);
  console.log('## 복구'); fixed.forEach((x) => console.log('  ', x));
  console.log('\n## 건너뜀'); skipped.forEach((x) => console.log('  ', x));

  if (!APPLY) { console.log(`\n드라이런 — 쓰기 ${Object.keys(patch).length}경로 예정. 적용하려면 --apply`); process.exit(0); }
  if (!Object.keys(patch).length) { console.log('\n쓸 것 없음.'); process.exit(0); }

  mkdirSync('tmp/migration', { recursive: true });
  const log = `tmp/migration/orphan-rooms-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
  for (const key of new Set(Object.keys(patch).map((p) => p.split('/')[2]))) {
    appendFileSync(log, JSON.stringify({ room: key, before: (await db.ref(`v4/rooms/${key}`).get()).val() }) + '\n', 'utf8');
  }
  await db.ref('/').update(patch);
  console.log(`\n적용 ${Object.keys(patch).length}경로 · 롤백 로그 ${log}`);
  process.exit(0);
}

main().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });
