/**
 * 오픈 게이트 — «공급사가 올린 상품이 ERP 에서 보이나» 를 실데이터로 잰다. 읽기 전용.
 *
 * 상품은 v4/products 단독 정본이다(레거시 브리지는 410 으로 폐기). 그래서 화면에 뜨는지는
 * 세 가지가 정한다:
 *   1) v4/products 에 레코드가 있는가
 *   2) 살아있는가 (_deleted / status)
 *   3) 공급사 스코프가 붙어 있는가 — provider_company_code 가 비면 공급사 화면에서 «없는 것»이 된다
 *
 * 공급사 목록(v4/partners)과 대조해 «파트너는 있는데 상품이 0대» / «상품은 있는데 파트너가 없음»
 * 양쪽을 다 낸다. 후자가 RESUME §7 의 RP031 같은 유령이다.
 *
 * npx tsx scripts/audit-open-visibility.mts
 */
import { readFileSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';

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

  const [prodSnap, partLive, partOver, usersSnap] = await Promise.all([
    db.ref('v4/products').get(), db.ref('partners').get(), db.ref('v4/partners').get(), db.ref('users').get(),
  ]);

  const products = (prodSnap.val() || {}) as Record<string, Rec>;
  const pl = (partLive.val() || {}) as Record<string, Rec>;
  const po = (partOver.val() || {}) as Record<string, Rec>;
  const partners: Record<string, Rec> = {};
  for (const k of new Set([...Object.keys(pl), ...Object.keys(po)])) partners[k] = { ...(pl[k] || {}), ...(po[k] || {}) };
  const users = (usersSnap.val() || {}) as Record<string, Rec>;

  const all = Object.entries(products);
  const alive = all.filter(([, p]) => !dead(p));

  console.log(`\n══ 공급사 상품이 ERP 에 보이나 ══\n`);
  console.log(`  v4/products  전체 ${all.length}건 · 살아있는 것 ${alive.length}건 · 삭제표시 ${all.length - alive.length}건\n`);

  // ── 스코프 필드 ─────────────────────────────────────
  const noScope = alive.filter(([, p]) => !S(p.provider_company_code));
  console.log(`■ 공급사 스코프(provider_company_code)`);
  console.log(`   ${noScope.length ? '❌' : '✓'} 비어 있는 상품 ${noScope.length}건${noScope.length ? '  ← 공급사 화면에서 «없는 것»이 된다' : ''}`);
  for (const [k, p] of noScope.slice(0, 10)) {
    console.log(`      ${S(p.product_code) || k} · ${S(p.car_number)} · ${S(p.model)} · 등록 ${S(p.created_at).slice(0, 10)}`);
  }
  if (noScope.length > 10) console.log(`      … 그 외 ${noScope.length - 10}건`);

  // ── 공급사별 ────────────────────────────────────────
  const byCo = new Map<string, number>();
  for (const [, p] of alive) {
    const c = S(p.provider_company_code) || '(없음)';
    byCo.set(c, (byCo.get(c) || 0) + 1);
  }
  const partnerCodes = new Set(Object.values(partners).filter((p) => !dead(p)).map((p) => S(p.partner_code)).filter(Boolean));
  // 공급사 계정이 실제로 있는 회사 = 로그인해서 볼 사람이 있는 곳
  const userCos = new Set(Object.values(users)
    .filter((u) => !dead(u) && /provider/.test(S(u.role)) && S(u.is_active) !== '아니오' && S(u.status) !== 'rejected')
    .map((u) => S(u.company_code)).filter(Boolean));

  console.log(`\n■ 공급사별 재고 (살아있는 상품)`);
  const rows = [...byCo.entries()].sort((a, b) => b[1] - a[1]);
  for (const [code, n] of rows) {
    const p = Object.values(partners).find((x) => S(x.partner_code) === code);
    const name = S(p?.partner_name || p?.company_name || p?.name);
    const flags = [
      code !== '(없음)' && !partnerCodes.has(code) ? '❌파트너없음' : '',
      code !== '(없음)' && !userCos.has(code) ? '⚠계정없음' : '',
    ].filter(Boolean).join(' ');
    console.log(`   ${String(n).padStart(4)}대  ${code.padEnd(8)} ${name.padEnd(20)} ${flags}`);
  }

  // ── 파트너는 있는데 재고 0 ───────────────────────────
  const zero = [...partnerCodes].filter((c) => !byCo.has(c));
  console.log(`\n■ 파트너 등록돼 있으나 재고 0대 — ${zero.length}곳`);
  for (const c of zero.slice(0, 20)) {
    const p = Object.values(partners).find((x) => S(x.partner_code) === c);
    const hasUser = userCos.has(c) ? '계정있음' : '계정없음';
    console.log(`   ${c.padEnd(8)} ${S(p?.partner_name || p?.company_name || p?.name).padEnd(20)} ${hasUser}`);
  }
  if (zero.length > 20) console.log(`   … 그 외 ${zero.length - 20}곳`);

  console.log(`\n■ 로그인 가능한 공급사 계정이 있는 회사 ${userCos.size}곳 · 파트너 레코드 ${partnerCodes.size}곳\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
