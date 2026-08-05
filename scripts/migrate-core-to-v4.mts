/**
 * **채팅·계약·정산·고객을 v4 로 옮긴다** — erp4 독자 운영을 위한 이관.
 *
 * 매물과 성격이 완전히 다르다. 매물은 시트가 원본이라 언제든 다시 만들지만
 * **문의·계약·정산은 시트에 없다.** v3 를 끊는 순간 v3-only 인 것은 복구 수단이 없다.
 * 그래서 «지우는» 이관이 아니라 «복사하는» 이관이다 — v3 는 읽기만 하고 그대로 둔다.
 *
 * 실측(2026-08-05): 계약 27 · 문의방 30 · 고객 1 · 메시지 2,045(방 170) 이 v3 에만 있다.
 * 정산은 이미 v3-only 0 이라 손대지 않는다.
 *
 * 안전 규칙:
 *   · v3 는 절대 쓰지 않는다. v4 오버레이에만 쓴다.
 *   · v4 에 이미 있는 키는 **건드리지 않는다**(부분 오버레이가 이관본보다 최신일 수 있다).
 *   · 메시지는 v3 중첩 `messages/{roomId}/{pushId}` → v4 flat `v4/messages/{pushId}` 로 펴고
 *     `room_id` 를 실체화한다(어댑터가 flat 을 전제로 읽는다).
 *   · 한 번에 다 쓰지 않고 청크로 나눈다(멀티패스 크기 한계·타임아웃 회피).
 *
 *   npx tsx scripts/migrate-core-to-v4.mts                 dry-run
 *   npx tsx scripts/migrate-core-to-v4.mts --apply
 *   ... --only=contracts,rooms,customers,messages          일부만
 */
import { readFileSync, writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice('--only='.length)
  .split(',').map((s) => s.trim()).filter(Boolean);
const S = (v: unknown) => String(v ?? '').trim();
type Rec = Record<string, unknown>;
const CHUNK = 200;

const wanted = (name: string) => !ONLY.length || ONLY.includes(name);

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
  const now = new Date().toISOString();

  const [c3, c4, r3, r4, cu3, cu4, m3, m4] = await Promise.all([
    db.ref('contracts').get(), db.ref('v4/contracts').get(),
    db.ref('rooms').get(), db.ref('v4/rooms').get(),
    db.ref('customers').get(), db.ref('v4/customers').get(),
    db.ref('messages').get(), db.ref('v4/messages').get(),
  ]);

  const alive = (v: Rec | undefined) => !!v && v._deleted !== true && S(v.status) !== 'deleted';
  const plan: { path: string; value: unknown }[] = [];
  const summary: string[] = [];

  /** v3 에만 있는 살아있는 레코드를 v4 로 복사. v4 에 이미 있으면 건드리지 않는다. */
  const copyNode = (label: string, node: string, v3: unknown, v4: unknown) => {
    if (!wanted(node)) return;
    const A = (v3 || {}) as Record<string, Rec>;
    const B = (v4 || {}) as Record<string, Rec>;
    let n = 0;
    for (const [k, v] of Object.entries(A)) {
      if (!alive(v)) continue;
      if (B[k] !== undefined) continue; // v4 가 이미 갖고 있으면 그쪽이 최신 — 덮지 않는다
      plan.push({ path: `${node}/${k}`, value: { ...v, _key: k, migrated_from_v3_at: now } });
      n++;
    }
    summary.push(`  ${label.padEnd(10)} ${String(n).padStart(5)}건`);
  };

  copyNode('계약', 'contracts', c3.val(), c4.val());
  copyNode('문의방', 'rooms', r3.val(), r4.val());
  copyNode('고객', 'customers', cu3.val(), cu4.val());

  // 메시지 — v3 중첩을 v4 flat 으로 편다
  if (wanted('messages')) {
    const src = (m3.val() || {}) as Record<string, Record<string, Rec>>;
    const dst = (m4.val() || {}) as Record<string, Rec>;
    let n = 0, rooms = 0;
    for (const [roomId, bucket] of Object.entries(src)) {
      if (!bucket || typeof bucket !== 'object') continue;
      let touched = false;
      for (const [pushId, msg] of Object.entries(bucket)) {
        if (!msg || typeof msg !== 'object') continue;
        if (msg._deleted === true) continue;
        if (dst[pushId] !== undefined) continue;
        plan.push({
          path: `messages/${pushId}`,
          // 어댑터는 flat + room_id 실체화를 전제로 읽는다(rtdb-adapter readMessages).
          value: { ...msg, _key: pushId, room_id: S(msg.room_id) || roomId, migrated_from_v3_at: now },
        });
        n++; touched = true;
      }
      if (touched) rooms++;
    }
    summary.push(`  ${'메시지'.padEnd(10)} ${String(n).padStart(5)}건 (방 ${rooms}개)`);
  }

  console.log('\n══ v3 → v4 이관 (v3 는 읽기만 · v4 기존 키는 안 건드림) ══\n');
  summary.forEach((s) => console.log(s));
  console.log(`\n  총 쓰기 ${plan.length}건 · 청크 ${Math.ceil(plan.length / CHUNK)}회`);

  if (!plan.length) { console.log('\n옮길 것 없음.\n'); return; }
  if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply\n'); return; }

  writeFileSync('tmp/migrate-core-plan.json', JSON.stringify(plan.map((p) => p.path)), 'utf8');
  console.log(`\n계획 → tmp/migrate-core-plan.json`);

  for (let i = 0; i < plan.length; i += CHUNK) {
    const patch: Record<string, unknown> = {};
    for (const { path, value } of plan.slice(i, i + CHUNK)) patch[path] = value;
    await db.ref('v4').update(patch);
    console.log(`  청크 ${Math.floor(i / CHUNK) + 1}/${Math.ceil(plan.length / CHUNK)} · ${Object.keys(patch).length}건 반영`);
  }
  console.log('\n반영 완료\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
