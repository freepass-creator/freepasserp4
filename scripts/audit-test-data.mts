/**
 * 운영 데이터에 섞인 «테스트 흔적» 찾기 — 읽기 전용.
 *
 * 계기: 공급사에 공유할 「프리패스 상품리스트」 게시 대상 502대에 `[QA] 공급사 20260727` 이 1대 있었다.
 * 시트는 남에게 보여주는 물건이라 QA 데이터가 한 줄만 섞여도 신뢰를 잃는다.
 *
 * 지우기 전에 «참조»를 먼저 본다. 계약·문의방이 걸린 것은 지우면 그 화면이 깨진다 —
 * 테스트 계약이라도 화면이 에러를 내는 것과 조용히 비어 있는 것은 다르다.
 *
 *   npx tsx scripts/audit-test-data.mts
 */
import { readFileSync } from 'node:fs';

const S = (v: unknown) => String(v ?? '').trim();
type Rec = Record<string, unknown>;

/** 테스트 표식 — 이름·코드에 남는 흔적. 과탐하면 진짜 데이터를 지우게 되니 좁게 잡는다. */
const TEST_MARK = /(\[QA\]|^QA[\s_-]|테스트|test\b|샘플|sample|dummy|더미)/i;

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

  const [p3, p4, t3, t4, c3, c4, r3, r4, u3, u4] = await Promise.all([
    db.ref('products').get(), db.ref('v4/products').get(),
    db.ref('partners').get(), db.ref('v4/partners').get(),
    db.ref('contracts').get(), db.ref('v4/contracts').get(),
    db.ref('rooms').get(), db.ref('v4/rooms').get(),
    db.ref('users').get(), db.ref('v4/users').get(),
  ]);

  const merge = (a: unknown, b: unknown) => {
    const m = new Map<string, Rec>();
    for (const [k, v] of Object.entries((a || {}) as Record<string, Rec>)) m.set(k, { ...v, _key: k });
    for (const [k, v] of Object.entries((b || {}) as Record<string, Rec>)) m.set(k, { ...(m.get(k) || {}), ...v, _key: k });
    return m;
  };
  const alive = (v: Rec) => v._deleted !== true && S(v.status) !== 'deleted';

  const partners = merge(t3.val(), t4.val());
  const products = merge(p3.val(), p4.val());
  const contracts = merge(c3.val(), c4.val());
  const rooms = merge(r3.val(), r4.val());
  const users = merge(u3.val(), u4.val());

  console.log('\n══ 운영 데이터의 테스트 흔적 ══\n');

  // ── 테스트 공급사
  const testPartners = new Map<string, Rec>();
  for (const p of partners.values()) {
    const name = S(p.company_name || p.name || p.partner_name);
    const code = S(p.company_code || p.partner_code || p._key);
    if (TEST_MARK.test(name) || TEST_MARK.test(code)) testPartners.set(code, p);
  }
  console.log(`■ 테스트 공급사 ${testPartners.size}곳`);
  for (const [code, p] of testPartners) {
    console.log(`   ${code.padEnd(12)} ${S(p.company_name || p.name)}  ${alive(p) ? '활성' : '삭제됨'}`);
  }

  // ── 테스트 매물: 테스트 공급사 소속이거나, 매물 자체에 표식
  const testProducts: Rec[] = [];
  for (const p of products.values()) {
    if (!alive(p)) continue;
    const owner = S(p.provider_company_code);
    const marked = TEST_MARK.test(S(p.product_code)) || TEST_MARK.test(S(p.sub_model)) || TEST_MARK.test(S(p.model)) || TEST_MARK.test(S(p.partner_memo));
    if (testPartners.has(owner) || marked) testProducts.push(p);
  }
  console.log(`\n■ 살아있는 테스트 매물 ${testProducts.length}대`);
  for (const p of testProducts) {
    console.log(`   ${S(p._key).padEnd(26)} ${S(p.car_number) || '(번호없음)'} ${S(p.maker)} ${S(p.model)} · 상태 ${S(p.vehicle_status) || '빈값'} · 공급사 ${S(p.provider_company_code)}`);
  }

  // ── 참조 — 지워도 되는지의 유일한 판단 근거
  const testCodes = new Set(testProducts.map((p) => S(p.product_code || p._key)).filter(Boolean));
  const testKeys = new Set(testProducts.map((p) => S(p._key)));
  console.log(`\n■ 참조 확인`);
  const refContracts = [...contracts.values()].filter((c) => alive(c) && (testCodes.has(S(c.product_code)) || testKeys.has(S(c.product_code))));
  const refRooms = [...rooms.values()].filter((r) => alive(r) && (testCodes.has(S(r.product_code)) || testKeys.has(S(r.product_code))));
  console.log(`   계약 ${refContracts.length}건 · 문의방 ${refRooms.length}개`);
  for (const c of refContracts) console.log(`      계약 ${S(c.contract_code || c._key)} ${S(c.contract_status)} ${S(c.customer_name)} → ${S(c.product_code)}`);
  for (const r of refRooms.slice(0, 5)) console.log(`      방 ${S(r._key)} → ${S(r.product_code)}`);

  // 테스트 공급사에 걸린 계약·방(매물 코드가 아니라 소속으로)
  const byOwnerContracts = [...contracts.values()].filter((c) => alive(c) && testPartners.has(S(c.provider_company_code)));
  const byOwnerRooms = [...rooms.values()].filter((r) => alive(r) && testPartners.has(S(r.provider_company_code)));
  if (byOwnerContracts.length || byOwnerRooms.length) {
    console.log(`   공급사 소속 기준: 계약 ${byOwnerContracts.length}건 · 문의방 ${byOwnerRooms.length}개`);
  }

  // ── 테스트 계정
  // «살아있다»는 삭제 여부가 아니라 «지금 로그인해서 쓸 수 있나»여야 한다.
  //  규칙이 보는 값이 is_active 라, 이걸 안 보면 비활성 처리한 계정이 계속 위험해 보인다.
  const usable = (u: Rec) => alive(u) && S(u.is_active) !== '아니오' && u.is_active !== false;
  const testUsers = [...users.values()].filter((u) => {
    if (!alive(u)) return false;
    return TEST_MARK.test(S(u.name)) || TEST_MARK.test(S(u.email)) || TEST_MARK.test(S(u.company_name)) || testPartners.has(S(u.company_code));
  });
  const active = testUsers.filter(usable);
  console.log(`\n■ 테스트 계정 ${testUsers.length}개 — 그중 «지금 쓸 수 있는» 것 ${active.length}개`);
  for (const u of testUsers) {
    const off = usable(u) ? '' : '  ← 비활성';
    console.log(`   ${S(u.email || u._key).padEnd(34)} ${S(u.name)} · ${S(u.role)} · ${S(u.company_code)} · ${S(u.status)}${off}`);
  }

  console.log('\n── 판정 ──');
  const blocked = testProducts.filter((p) => {
    const code = S(p.product_code || p._key);
    return refContracts.some((c) => S(c.product_code) === code) || refRooms.some((r) => S(r.product_code) === code);
  });
  console.log(`  지워도 되는 매물 ${testProducts.length - blocked.length}대 · 참조가 걸린 매물 ${blocked.length}대`);
  if (blocked.length) blocked.forEach((p) => console.log(`     보류: ${S(p._key)} — 계약/문의가 가리킨다`));
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
