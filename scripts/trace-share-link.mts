/**
 * 손님 공유 링크(/q/{code})가 왜 「현재 견적 가능한 상품이 아닙니다」로 뜨나 — 관문을 순서대로 짚는다.
 * 읽기 전용.
 *
 * `/q` 는 보는 사람과 무관하게 같은 판정을 한다. 관문은 넷이다:
 *   ① 별칭(_merged_into) 을 따라갔는데 살아있는 레코드가 없음
 *   ② status = deleted
 *   ③ 제외 공급사(금강)
 *   ④ isOfferableProduct 실패 — 출고불가 · 유효 가격 없음
 *
 *   npx tsx scripts/trace-share-link.mts <상품코드 또는 차번>
 *   (링크가 https://…/q/RP004_146하4723?a=… 이면 /q/ 뒤 값을 넣는다)
 */
import { readFileSync } from 'node:fs';
import { priceList, isOfferableProduct, isListableProduct } from '../lib/domain/product';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const isDeleted = (r: Rec) => r?._deleted === true || !!r?.deletedAt || S(r?.status) === 'deleted';

async function main() {
  const raw = decodeURIComponent(S(process.argv[2]));
  if (!raw) { console.log('사용: npx tsx scripts/trace-share-link.mts <상품코드|차번>'); return; }

  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const [v4s, v3s] = await Promise.all([db.ref('v4/products').get(), db.ref('products').get()]);
  const v3 = (v3s.val() || {}) as Record<string, Rec>;
  const v4 = (v4s.val() || {}) as Record<string, Rec>;
  // 화면과 같은 병합 — v4 가 이긴다.
  const merged: Record<string, Rec> = {};
  for (const k of new Set([...Object.keys(v3), ...Object.keys(v4)])) {
    merged[k] = { ...(v3[k] || {}), ...(v4[k] || {}), _key: k };
  }
  const byAny = new Map<string, Rec>();
  for (const [k, r] of Object.entries(merged)) {
    byAny.set(k, r);
    const code = S(r.product_code); if (code && !byAny.has(code)) byAny.set(code, r);
    const plate = S(r.car_number); if (plate && !byAny.has(plate)) byAny.set(plate, r);
  }

  console.log(`\n══ 공유 링크 진단 — «${raw}» ══\n`);

  let key = raw;
  let row = byAny.get(key);
  if (!row) { console.log(`❌ ① 그 코드로 레코드를 못 찾는다. 링크의 /q/ 뒤 값을 그대로 넣었는지 확인.\n`); return; }

  // ① 별칭 추적
  const hops: string[] = [];
  for (let i = 0; i <= 5 && row && isDeleted(row); i++) {
    hops.push(`${key} (삭제됨${S(row._merged_reason) ? ` — ${S(row._merged_reason)}` : ''})`);
    key = S(row._merged_into);
    if (!key) { row = undefined; break; }
    row = byAny.get(key);
  }
  if (hops.length) { console.log('■ 별칭 추적'); for (const h of hops) console.log(`   ${h}`); console.log(`   → ${key || '(끝 없음)'}\n`); }
  if (!row) { console.log(`❌ ① 별칭 끝에 살아있는 레코드가 없다 → 「견적 가능한 상품이 아닙니다」\n`); return; }

  console.log(`■ 도달한 레코드 ${S(row._key)}`);
  console.log(`   ${S(row.maker)} ${S(row.model)} ${S(row.sub_model)} · 차번 ${S(row.car_number) || '(없음)'}`);
  console.log(`   상태 ${S(row.vehicle_status) || '(없음)'} · status ${S(row.status) || '-'} · 가격 ${priceList(row as any).length}개`);
  console.log(`   차종검수 ${row._needs_master_review === true ? '대기' : '확정'} · 공급사 ${S(row.provider_company_code)}\n`);

  const reasons: string[] = [];
  if (S(row.status) === 'deleted') reasons.push('② status = deleted');
  if (S(row.vehicle_status).replace(/\s/g, '') === '출고불가') reasons.push('④ 출고불가');
  if (!priceList(row as any).length) reasons.push('④ 유효 가격 없음');

  const offer = isOfferableProduct(row as any);
  console.log('── 판정 ──');
  console.log(`  공유 링크 /q   ${offer ? '✅ 보인다' : `❌ 「견적 가능한 상품이 아닙니다」 — ${reasons.join(' · ') || '원인 불명'}`}`);
  console.log(`  목록 노출      ${isListableProduct(row as any) ? '✅ 뜬다' : '❌ 안 뜬다 (차종 미확정 등 — 링크와는 무관)'}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
