/**
 * 테스트 매물을 «운영 노출»에서 내린다 — 계정·공급사는 건드리지 않는다.
 *
 * 왜 매물만인가: QA 계정 4개와 QA 공급사 2곳은 오픈 런시트가 쓴다
 * (`OPEN_RUNSHEET.md` 1단계 «5역할 QA 계정 baseline», 8단계 «5역할 수동 권한 smoke»).
 * 지금 지우면 오픈 검증을 못 한다. 반면 매물은 카탈로그와 공급사 공유 시트에 그대로 나가므로
 * 지금 내려야 한다 — 남에게 보여주는 물건에 테스트 차가 한 줄 섞이면 그걸로 끝이다.
 *
 * 계약이 이 매물을 가리키지만 그 계약도 QA 다(`[QA] 서명거절고객`). 게다가 계약 화면은
 * 차량 정보를 «스냅샷»으로 들고 있어 매물이 없어도 깨지지 않는다 — 이미 실물로 확인했다
 * (PD2604101220 사례: 출고 후 매물 삭제된 정상 계약이 멀쩡히 뜬다).
 *
 * 삭제는 v4 오버레이 톰스톤이다. v3 는 읽기만 한다.
 *
 *   npx tsx scripts/cleanup-test-products.mts            dry-run
 *   npx tsx scripts/cleanup-test-products.mts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
type Rec = Record<string, unknown>;

/** 오픈 스모크에 필요해 «남겨 두는» 것들 — 여기 있는 건 이 스크립트가 절대 손대지 않는다. */
const KEEP_PARTNERS = ['sup_qgd99qtj85', 'sup_5rzn9q4mqm'];
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

  const [p3, p4, t3, t4] = await Promise.all([
    db.ref('products').get(), db.ref('v4/products').get(),
    db.ref('partners').get(), db.ref('v4/partners').get(),
  ]);
  const merge = (a: unknown, b: unknown) => {
    const m = new Map<string, Rec>();
    for (const [k, v] of Object.entries((a || {}) as Record<string, Rec>)) m.set(k, { ...v, _key: k });
    for (const [k, v] of Object.entries((b || {}) as Record<string, Rec>)) m.set(k, { ...(m.get(k) || {}), ...v, _key: k });
    return m;
  };

  const testPartnerCodes = new Set<string>();
  for (const p of merge(t3.val(), t4.val()).values()) {
    const name = S(p.company_name || p.name || p.partner_name);
    const code = S(p.company_code || p.partner_code || p._key);
    if (code && (TEST_MARK.test(name) || TEST_MARK.test(code))) testPartnerCodes.add(code);
  }

  const targets: Rec[] = [];
  for (const p of merge(p3.val(), p4.val()).values()) {
    if (p._deleted === true || S(p.status) === 'deleted') continue;
    const marked = TEST_MARK.test(S(p.product_code)) || TEST_MARK.test(S(p.model)) || TEST_MARK.test(S(p.sub_model)) || TEST_MARK.test(S(p.partner_memo));
    if (testPartnerCodes.has(S(p.provider_company_code)) || marked) targets.push(p);
  }

  console.log('\n══ 테스트 매물 내리기 (계정·공급사는 유지) ══\n');
  console.log(`  유지할 QA 공급사: ${KEEP_PARTNERS.join(' · ')}  ← 오픈 5역할 스모크에 필요\n`);
  console.log(`  내릴 매물 ${targets.length}대`);
  for (const p of targets) {
    console.log(`     ${S(p._key).padEnd(26)} ${S(p.car_number) || '(번호없음)'} ${S(p.maker)} ${S(p.model)} · ${S(p.vehicle_status) || '빈값'} · ${S(p.provider_company_code)}`);
  }
  if (!targets.length) { console.log('\n내릴 것 없음.\n'); return; }
  if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply\n'); return; }

  const now = new Date().toISOString();
  const backup: Record<string, unknown> = {};
  const patch: Record<string, unknown> = {};
  for (const p of targets) {
    const key = S(p._key);
    backup[key] = p;
    patch[`products/${key}/_deleted`] = true;
    patch[`products/${key}/deletedAt`] = now;
    patch[`products/${key}/deleted_reason`] = '테스트 데이터 정리 — 공급사 공유 시트/카탈로그 노출 제외';
  }
  writeFileSync('tmp/cleanup-test-products-backup.json', JSON.stringify(backup, null, 1), 'utf8');
  console.log('\n  백업 → tmp/cleanup-test-products-backup.json');
  await db.ref('v4').update(patch);
  console.log(`\n✅ ${targets.length}대 내림 (v4 톰스톤). 계약 화면은 스냅샷으로 뜨므로 영향 없음.\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
