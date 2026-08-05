/**
 * **채팅·계약·정산이 v3 에 얼마나 매여 있나** — erp4 독자 운영의 선행 측정.
 *
 * 매물과 성격이 다르다. 매물은 시트가 원본이라 언제든 다시 만들 수 있지만
 * **문의·계약·정산은 시트에 없다.** v3 를 끊는 순간 v3-only 인 것은 사라지고 복구 수단이 없다.
 * 그래서 「끊어도 되나」가 아니라 「무엇을 먼저 옮겨야 하나」를 재는 스크립트다.
 *
 * 판정:
 *   v4 있음     → 이관 완료. v3 끊어도 안전.
 *   v3 에만 있음 → 옮겨야 한다. 그 전엔 못 끊는다.
 *
 * 읽기 전용. 프로세스 하나 · 다운로드 한 번.
 *   npx tsx scripts/audit-v3-dependency-core.mts
 */
import { readFileSync } from 'node:fs';

const S = (v: unknown) => String(v ?? '').trim();
type Rec = Record<string, unknown>;

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

  // 메시지는 v3 가 rooms/{roomId}/{pushId} 중첩, v4 는 flat 이라 따로 센다.
  const [c3, c4, r3, r4, s3, s4, m3, m4, cu3, cu4] = await Promise.all([
    db.ref('contracts').get(), db.ref('v4/contracts').get(),
    db.ref('rooms').get(), db.ref('v4/rooms').get(),
    db.ref('settlements').get(), db.ref('v4/settlements').get(),
    db.ref('messages').get(), db.ref('v4/messages').get(),
    db.ref('customers').get(), db.ref('v4/customers').get(),
  ]);

  const live = (o: unknown) => Object.entries((o || {}) as Record<string, Rec>)
    .filter(([, v]) => v && v._deleted !== true && S(v.status) !== 'deleted');

  console.log('\n══ 채팅·계약·정산의 v3 의존도 ══\n');
  console.log('노드          v3만    양쪽    v4만   합계   판정');
  console.log('─'.repeat(62));

  const rows: { name: string; only3: number; both: number; only4: number }[] = [];
  for (const [name, a, b] of [
    ['계약', c3.val(), c4.val()],
    ['문의방', r3.val(), r4.val()],
    ['정산', s3.val(), s4.val()],
    ['고객', cu3.val(), cu4.val()],
  ] as const) {
    const A = new Map(live(a)); const B = new Map(live(b));
    let only3 = 0, both = 0;
    for (const k of A.keys()) { if (B.has(k)) both++; else only3++; }
    const only4 = [...B.keys()].filter((k) => !A.has(k)).length;
    rows.push({ name, only3, both, only4 });
    const verdict = only3 === 0 ? '✓ 끊어도 안전' : `❌ v3 에만 ${only3}건 — 못 끊는다`;
    console.log(`${name.padEnd(12)} ${String(only3).padStart(5)} ${String(both).padStart(7)} ${String(only4).padStart(7)} ${String(only3 + both + only4).padStart(6)}   ${verdict}`);
  }

  // 메시지 — v3 중첩 구조를 펼쳐 센다
  // ⚠ v3 «전체»가 아니라 «v3 에만 있는 것»을 세야 한다. 같은 pushId 가 v4 에도 있으면 이미 옮겨진 것이다.
  //   처음엔 v3 전체(2,045)를 세서 이관 후에도 숫자가 안 줄어 보였다.
  const msg3 = m3.val() as Record<string, Record<string, Rec>> | null;
  const msg4 = m4.val() as Record<string, Rec> | null;
  const v4Ids = new Set(Object.keys(msg4 || {}));
  let m3Total = 0, m3Only = 0; const onlyRooms = new Set<string>();
  for (const [roomId, bucket] of Object.entries(msg3 || {})) {
    if (!bucket || typeof bucket !== 'object') continue;
    for (const [pushId, msg] of Object.entries(bucket)) {
      if (!msg || typeof msg !== 'object' || (msg as Rec)._deleted === true) continue;
      m3Total++;
      if (!v4Ids.has(pushId)) { m3Only++; onlyRooms.add(roomId); }
    }
  }
  const m4Count = v4Ids.size;
  const m4Rooms = new Set(Object.values(msg4 || {}).map((x) => S(x.room_id)).filter(Boolean));
  console.log(`${'메시지'.padEnd(12)} ${String(m3Only).padStart(5)} ${String(m3Total - m3Only).padStart(7)} ${String(m4Count - (m3Total - m3Only)).padStart(7)} ${String(m3Only + m4Count).padStart(6)}   ${m3Only ? `❌ v3 에만 ${m3Only}건 (방 ${onlyRooms.size}개)` : '✓ 끊어도 안전'}`);
  console.log(`${''.padEnd(12)} ${''.padStart(5)} ${''.padStart(7)} ${''.padStart(7)} ${''.padStart(6)}   v3 전체 ${m3Total} · v4 메시지가 붙은 방 ${m4Rooms.size}개`);
  const m3Count = m3Only; const m3Rooms = onlyRooms;

  // 계약이 가리키는 매물이 v4 에 있나 — 계약만 옮겨도 매물이 v3 면 화면이 깨진다
  const p4 = (await db.ref('v4/products').get()).val() as Record<string, Rec> | null;
  const v4Keys = new Set(Object.keys(p4 || {}));
  const allContracts = [...live(c3.val()), ...live(c4.val())];
  const codes = new Set(allContracts.map(([, v]) => S(v.product_code)).filter(Boolean));
  const missing = [...codes].filter((k) => !v4Keys.has(k));
  console.log(`\n계약이 가리키는 매물코드 ${codes.size}종 · 그중 v4 에 없는 것 ${missing.length}`);
  if (missing.length) console.log(`   표본: ${missing.slice(0, 8).join(' · ')}`);

  const blockers = rows.filter((r) => r.only3 > 0);
  console.log('\n── 판정 ──');
  if (!blockers.length && !m3Count) console.log('  v3 를 끊어도 채팅·계약·정산이 온전하다.');
  else {
    console.log('  아래를 v4 로 옮기기 전에는 v3 를 끊을 수 없다:');
    blockers.forEach((r) => console.log(`     ${r.name} ${r.only3}건`));
    if (m3Count) console.log(`     메시지 ${m3Count}건 (방 ${m3Rooms.size}개)`);
  }
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
