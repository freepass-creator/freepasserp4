/**
 * 손오공(RP012) 「사라진 차」— 오늘 API 덤프에 없는 기존 원자 — 의 상품구분을 SSOT 규칙으로 다시 맞춘다.
 *
 * `ingest-supplier-to-firestore.mts --code=RP012 --apply`는 «오늘 덤프에 있는 차»만 kind 를 다시 계산한다
 * (사장님 2026-09-15 「손오공이는 어디든 다 코드로 만들어 놓고 그거를 실행하는 것만 해야지」로 만든 스크립트 —
 *  전엔 이걸 손으로 tmp 스크립트를 짜서 4건 직접 고쳤는데, 그게 바로 매뉴얼(SSOT-세마스터-설계.md §5-A)이
 *  경계하는 「수집기 밖에서 손으로 고친다」였다. 다시는 손으로 안 고치고, 이 스크립트를 «실행만» 한다).
 *
 * 판정 = `lib/domain/sonokong-product-kind.ts` 의 `isRentPlate` «한 곳» — 한국 렌터카(사업용) 번호판은
 *   하·허·호 세 글자뿐이다. 원천의 `중고` 플래그는 렌트 여부와 무관하다(실측 2026-09-15, 자세한 경위는
 *   그 파일 주석). 픽업구독(버킷=TCAR_EXTERNAL 유래)은 번호판과 무관하므로 건드리지 않는다 — 덤프 없이는
 *   버킷을 다시 알 수 없어 픽업↔오공구독 전환은 이 스크립트의 범위 밖이다(그건 ingest 재수집이 채운다).
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/heal-sonokong-product-kind.mts            드라이런
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/heal-sonokong-product-kind.mts --apply    반영
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { isRentPlate } from '../lib/domain/sonokong-product-kind';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();

const docs = (await fs.collection('products').where('provider_company_code', '==', 'RP012').where('listable', '==', true).get()).docs;
type Fix = { id: string; car: string; from: string; to: '오공구독' | '중고렌트' };
const fixes: Fix[] = [];
for (const d of docs) {
  const v = d.data() as Record<string, unknown>;
  const type = S(v.product_type);
  if (type === '픽업구독') continue;   // 버킷 유래 — 번호판과 무관, 이 스크립트가 안 건드림
  const car = S(v.car_number);
  const shouldBeRent = isRentPlate(car);
  const correct: '오공구독' | '중고렌트' = shouldBeRent ? '중고렌트' : '오공구독';
  if (type !== correct) fixes.push({ id: d.id, car, from: type || '(빈칸)', to: correct });
}

console.log(`손오공 상품구분(번호판 규칙) — 어긋난 차 ${fixes.length}대 / 대상 ${docs.length}대(픽업 제외)`);
for (const f of fixes) console.log(`  ${f.car}  ${f.from} → ${f.to}`);
if (!fixes.length) { console.log('✓ 전부 번호판 규칙과 일치.'); process.exit(0); }
if (!APPLY) { console.log('\n미리보기 — 반영하려면 --apply'); process.exit(0); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `tmp/migration-backups/sonokong-product-kind-${stamp}.json`;
mkdirSync('tmp/migration-backups', { recursive: true });
const affected = new Set(fixes.map((fix) => fix.id));
writeFileSync(backup, JSON.stringify({ captured_at: new Date().toISOString(), fixes, documents: docs.filter((doc) => affected.has(doc.id)).map((doc) => ({ id: doc.id, data: doc.data() })) }, null, 2), { encoding: 'utf8', flag: 'wx' });

let w = 0;
for (let i = 0; i < fixes.length; i += 400) {
  const batch = fs.batch();
  for (const f of fixes.slice(i, i + 400)) {
    batch.update(fs.collection('products').doc(f.id), { product_type: f.to, _kind_fixed_at: Date.now(), _kind_fix_reason: '번호판(하/허/호) 규칙 재적용 — heal-sonokong-product-kind' });
    w++;
  }
  await batch.commit();
}
const reread = await fs.getAll(...fixes.map((fix) => fs.collection('products').doc(fix.id)));
const bad = reread.flatMap((doc, index) => S(doc.data()?.product_type) === fixes[index].to ? [] : [`${fixes[index].car}: ${S(doc.data()?.product_type) || '(빈칸)'} ≠ ${fixes[index].to}`]);
if (bad.length) throw new Error(`반영 후 재조회 불일치 ${bad.length}대 — ${bad.slice(0, 10).join(' · ')} · 백업 ${backup}`);
console.log(`\n반영 완료 — ${w}대 상품구분을 번호판 규칙으로 바로잡고 전부 재조회했다. · 백업 ${backup}`);
process.exit(0);
