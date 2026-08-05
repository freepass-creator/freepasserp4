/**
 * **v3 브리지를 끄면 채팅·계약·정산이 «똑같이» 보이나** — 키가 아니라 «필드»를 재는 감사.
 *
 * 앞선 이관(migrate-core-to-v4)은 v4 에 «없는 키»만 복사했다. 양쪽에 있는 키는
 * "v4 가 최신"이라며 손대지 않았는데, 그 v4 쪽이 **부분 오버레이**(앱이 상태만 패치한 조각)면
 * 지금은 rtdb-adapter.merged() 의 «필드 단위» 병합이 v3 로 빈칸을 메워 정상으로 보인다.
 * 브리지를 끄는 순간 그 빈칸이 그대로 드러난다 — 키는 다 있는데 화면이 비는 형태로.
 *
 * 그래서 이 스크립트는 세 가지를 잰다:
 *   1) 키 누락    v3 에 살아있는데 v4 에 없는 것            → 화면에서 통째로 사라진다
 *   2) 필드 누락  양쪽에 있으나 v4 레코드에 없는 v3 필드    → 이름·금액·날짜가 빈칸이 된다
 *   3) 스코프 필드 agent_uid 등이 없으면 관리자만 보이고
 *                영업자·공급사 화면에서는 «없는 것»이 된다  → 가장 조용한 사고
 *
 * 메시지는 v3 중첩 → v4 flat 이라 구조도 함께 본다(room_id 실체화 여부).
 *
 * 읽기 전용. npx tsx scripts/audit-v4-standalone-core.mts
 */
import { readFileSync } from 'node:fs';

const S = (v: unknown) => String(v ?? '').trim();
type Rec = Record<string, unknown>;

/** 역할 스코프 쿼리가 orderByChild 로 거는 필드 — 없으면 해당 역할에게 «존재하지 않는» 레코드가 된다. */
const SCOPE_FIELDS: Record<string, string[]> = {
  contracts: ['agent_uid', 'agent_channel_code', 'provider_company_code'],
  rooms: ['agent_uid', 'agent_channel_code', 'provider_company_code'],
  settlements: ['agent_code', 'agent_channel_code', 'provider_company_code'],
};

/**
 * 값이 비었는가 — merged() 와 같은 기준이어야 한다.
 * rtdb-adapter.merged(): `if (vv !== undefined) cur[kk] = vv;` 이고 RTDB 는 null 을 키 삭제로 저장하므로
 * 실질 규칙은 «v4 에 키가 있으면 v4 가 이긴다». 빈 문자열도 v4 에 있으면 이긴다(의도적 클리어).
 * 그래서 '' 를 «누락»으로 세면 안 된다 — 처음엔 그렇게 세서 숫자가 부풀었다.
 */
const empty = (v: unknown) => v === undefined || v === null;

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();

  const [c3, c4, r3, r4, s3, s4, m3, m4] = await Promise.all([
    db.ref('contracts').get(), db.ref('v4/contracts').get(),
    db.ref('rooms').get(), db.ref('v4/rooms').get(),
    db.ref('settlements').get(), db.ref('v4/settlements').get(),
    db.ref('messages').get(), db.ref('v4/messages').get(),
  ]);

  const alive = (v: Rec | undefined) => !!v && v._deleted !== true && S(v.status) !== 'deleted';

  console.log('\n══ v3 브리지를 끄면 똑같이 보이나 ══\n');

  let blockers = 0;

  for (const [label, node, v3raw, v4raw] of [
    ['계약', 'contracts', c3.val(), c4.val()],
    ['문의방', 'rooms', r3.val(), r4.val()],
    ['정산', 'settlements', s3.val(), s4.val()],
  ] as const) {
    const A = (v3raw || {}) as Record<string, Rec>;
    const B = (v4raw || {}) as Record<string, Rec>;

    const missingKeys: string[] = [];
    // 필드명 → 그 필드가 v4 에서 빈 레코드 수
    const missingFields = new Map<string, string[]>();
    let both = 0;

    for (const [k, v3] of Object.entries(A)) {
      if (!alive(v3)) continue;
      const v4 = B[k];
      if (v4 === undefined) { missingKeys.push(k); continue; }
      if (!alive(v4)) continue; // v4 에서 지운 것 — 지금도 안 보인다. 정상.
      both++;
      for (const [f, val] of Object.entries(v3)) {
        if (f.startsWith('_') || empty(val)) continue;
        if (f in v4) continue;               // v4 에 키가 있으면 그쪽이 이긴다('' 포함)
        const list = missingFields.get(f) || [];
        list.push(S(v3.contract_code || v3.room_code || v3.settlement_code) || k);
        missingFields.set(f, list);
      }
    }

    const scope = SCOPE_FIELDS[node] || [];
    const scopeLost = [...missingFields.entries()].filter(([f]) => scope.includes(f));
    const total = Object.entries(A).filter(([, v]) => alive(v)).length;

    console.log(`■ ${label}  v3 살아있는 것 ${total}건 · 양쪽에 있는 것 ${both}건`);
    if (missingKeys.length) { blockers++; console.log(`   ❌ v4 에 아예 없는 키 ${missingKeys.length}건 → 통째로 사라진다`); }
    else console.log(`   ✓ 키 누락 없음`);

    if (!missingFields.size) console.log(`   ✓ 필드 누락 없음\n`);
    else {
      blockers++;
      console.log(`   ❌ v4 레코드에 빈 필드 ${missingFields.size}종 → 브리지 끄면 빈칸이 된다`);
      const sorted = [...missingFields.entries()].sort((a, b) => b[1].length - a[1].length);
      for (const [f, list] of sorted.slice(0, 14)) {
        const mark = scope.includes(f) ? '  ⚠스코프' : '';
        console.log(`        ${f.padEnd(26)} ${String(list.length).padStart(4)}건${mark}`);
      }
      if (sorted.length > 14) console.log(`        … 그 외 ${sorted.length - 14}종`);
      if (scopeLost.length) console.log(`   ⚠ 스코프 필드가 비면 관리자만 보이고 영업자·공급사 화면에선 없는 것이 된다`);
      console.log('');
    }
  }

  // ── 메시지: v3 중첩 → v4 flat. 구조가 성립하는지 본다.
  const msg3 = (m3.val() || {}) as Record<string, Record<string, Rec>>;
  const msg4 = (m4.val() || {}) as Record<string, Rec>;
  const roomsAll = new Set([...Object.keys((r3.val() || {}) as Rec), ...Object.keys((r4.val() || {}) as Rec)]);
  const v4Rooms = new Set(Object.keys((r4.val() || {}) as Rec));

  let v3Only = 0, noRoomId = 0, orphanRoom = 0, flatOk = 0;
  const v4Ids = new Set(Object.keys(msg4));
  for (const [roomId, bucket] of Object.entries(msg3)) {
    if (!bucket || typeof bucket !== 'object') continue;
    for (const [pushId, msg] of Object.entries(bucket)) {
      if (!msg || typeof msg !== 'object' || msg._deleted === true) continue;
      if (!v4Ids.has(pushId)) v3Only++;
      void roomId;
    }
  }
  // 방이 v4 에 없는 메시지 — 그 방이 v3 에서 «살아있다»면 이관 누락(사고), «삭제됐다»면 지금도 안 보인다(정상).
  // 어댑터는 방 목록으로 메시지를 읽으므로(readNode message → roomIds) 죽은 방의 메시지는 애초에 화면에 못 온다.
  const R3 = (r3.val() || {}) as Record<string, Rec>;
  let orphanDeadRoom = 0;
  for (const [pushId, msg] of Object.entries(msg4)) {
    if (!msg || typeof msg !== 'object' || msg._deleted === true) continue;
    const rid = S(msg.room_id);
    if (!rid) { noRoomId++; continue; }
    if (!v4Rooms.has(rid)) { if (alive(R3[rid])) orphanRoom++; else orphanDeadRoom++; }
    flatOk++;
    void pushId;
  }
  console.log(`■ 메시지  v4 flat ${flatOk}건`);
  if (v3Only) { blockers++; console.log(`   ❌ v3 에만 ${v3Only}건`); } else console.log(`   ✓ v3 전용 없음`);
  if (noRoomId) { blockers++; console.log(`   ❌ room_id 없는 메시지 ${noRoomId}건 → 어느 방에도 안 붙는다`); }
  else console.log(`   ✓ 전부 room_id 있음`);
  if (orphanRoom) { blockers++; console.log(`   ❌ v3 에 살아있는데 v4 에 없는 방의 메시지 ${orphanRoom}건 → 이관 누락`); }
  else console.log(`   ✓ 살아있는 방은 전부 v4 에 있음`);
  if (orphanDeadRoom) console.log(`   · 삭제된 방의 메시지 ${orphanDeadRoom}건 — 지금도 안 보인다(브리지 꺼도 동일)`);
  void roomsAll;

  console.log('\n── 판정 ──');
  if (!blockers) console.log('  브리지에서 room,message,contract,settlement 를 빼도 화면이 같다.\n');
  else console.log(`  ${blockers}개 항목을 채우기 전에는 끄면 안 된다.\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
