/**
 * 브리지(8단계) 해제 준비도 — 엔티티별로 "v3 없이도 화면이 채워지는가"를 실측한다.
 *
 * 통째로 끄면 안 된다. users 는 이관 대상이 아니라(루트 공유) v4 에 거의 없다 —
 * 끄는 순간 회원목록·발신자 이름·담당 영업자가 전부 빈다.
 *
 * 실행:
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/bridge-readiness.mts
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const DB_URL = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
initializeApp({ credential: saJson ? cert(JSON.parse(saJson)) : applicationDefault(), databaseURL: DB_URL });
const db = getDatabase();

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const alive = (o: Record<string, any>) =>
  Object.values(o).filter((v) => isObj(v) && v._deleted !== true && String(v.status ?? '') !== 'deleted').length;

/** 엔티티 → [v3 루트 노드, v4 오버레이 노드] */
const PAIRS: [string, string][] = [
  ['product', 'products'], ['policy', 'policies'], ['partner', 'partners'], ['user', 'users'],
  ['room', 'rooms'], ['contract', 'contracts'], ['audit_log', 'audit_logs'],
];

async function count(path: string): Promise<number> {
  const snap = await db.ref(path).get();
  const v = snap.val();
  return isObj(v) ? alive(v) : 0;
}

/**
 * 살아있는 레코드의 **업무키** 집합.
 * 자식키(푸시ID)로 비교하면 안 된다 — 이관이 계약을 contract_code 로 재키잉하므로
 * 같은 계약인데도 "v3에만 있음"으로 잡혀 전부 유실처럼 보인다.
 */
const BIZ_KEY: Record<string, (r: Record<string, any>, k: string) => string> = {
  products: (r, k) => String(r.car_number || r.product_code || k).replace(/\s/g, ''),
  partners: (r, k) => String(r.partner_code || k),
  policies: (r, k) => String(r.policy_code || k),
  contracts: (r, k) => String(r.contract_code || k),
  users: (r, k) => String(r.uid || k),
  rooms: (_r, k) => k,
  audit_logs: (_r, k) => k,
};

async function aliveKeys(path: string, node: string): Promise<Set<string>> {
  const snap = await db.ref(path).get();
  const v = snap.val();
  if (!isObj(v)) return new Set();
  const key = BIZ_KEY[node] || ((_r: any, k: string) => k);
  return new Set(Object.entries(v)
    .filter(([, r]) => isObj(r) && r._deleted !== true && String(r.status ?? '') !== 'deleted')
    .map(([k, r]) => key(r as Record<string, any>, k))
    .filter(Boolean));
}

async function main() {
  console.log('엔티티        v3(루트)   v4(오버레이)   v3에만 있음   판정');
  const keep: string[] = [];
  const orphanSamples: Record<string, string[]> = {};
  for (const [entity, node] of PAIRS) {
    const [k3, k4] = await Promise.all([aliveKeys(node, node), aliveKeys(`v4/${node}`, node)]);
    // **핵심 판정** — 건수가 아니라 "v3에만 있는 키". 이게 곧 브리지를 끄면 사라질 레코드다.
    const onlyV3 = [...k3].filter((k) => !k4.has(k));
    const safe = onlyV3.length === 0;
    if (!safe) { keep.push(entity); orphanSamples[entity] = onlyV3.slice(0, 5); }
    console.log(
      `${entity.padEnd(12)} ${String(k3.size).padStart(7)} ${String(k4.size).padStart(12)} ${String(onlyV3.length).padStart(12)}   ${safe ? '✅ 끄기 안전' : '⛔ 유지 필요'}`,
    );
  }
  for (const [e, s] of Object.entries(orphanSamples)) {
    if (s.length) console.log(`   ${e} — v3에만: ${s.join(', ')}${s.length === 5 ? ' …' : ''}`);
  }

  // 메시지 — v3 는 messages/{roomKey}/{id} 2단, v4 는 v4/messages/{id} 평면
  const [m3, m4] = await Promise.all([db.ref('messages').get(), db.ref('v4/messages').get()]);
  let n3 = 0;
  for (const b of Object.values((m3.val() || {}) as Record<string, any>)) if (isObj(b)) n3 += Object.keys(b).length;
  const n4 = isObj(m4.val()) ? Object.keys(m4.val()).length : 0;
  // 삭제된 방의 메시지는 애초에 이관 대상이 아니다 — 살아있는 방 기준으로 봐야 한다.
  const msgSafe = n4 > 0;
  if (!msgSafe) keep.push('message');
  console.log(`${'message'.padEnd(12)} ${String(n3).padStart(7)} ${String(n4).padStart(12)}   ${msgSafe ? '✅ 안전 (삭제된 방 메시지는 애초 제외)' : '⛔ 유지 필요'}`);

  console.log('\n권장 설정:');
  console.log(`  NEXT_PUBLIC_BRIDGE_V3="${keep.join(',')}"`);
  console.log(keep.length
    ? `  → ${keep.join('·')} 만 v3 를 계속 읽는다. 나머지는 v4 단독.`
    : '  → 전부 v4 단독 가능(빈 문자열).');
  process.exit(0);
}

main().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });
