/**
 * 변동값 동기(마이그레이션 2단계) — 파이어스토어 원자에 «변동·렌더」 필드를 얹는다(merge).
 *
 * 1단계(refine-atoms)가 넣은 «불변 원자」는 안 건드린다. 여기서 얹는 것:
 *   변동 = 차량상태·대여료(개월중첩)·주행거리·정책. (입고일자는 원천에 없음 — 이후 별도.)
 *   렌더 = 상품코드·상품구분·공급사·영업자·사진·위치·옵션. (스펙 아님, 앱 표시에 필요.)
 *
 * ★불변 식별(제조사·모델·세부모델·트림·스펙·확정)은 update 대상 아님 → 재정제로만 바뀐다.
 * ★파이어스토어도 쓰기는 자유(update 한 줄). 실시간이 아닐 뿐, 값 반영은 언제든 가능.
 *
 * 기본 dry-run · 반영은 --apply. products/{차번} 이 이미 있어야 함(없으면 건너뜀·경고).
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const app = initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const rtdb = getDatabase(app);
const fs = getFirestore(app);

// 변동값 — 자주/가끔 바뀜. 상태만 이후 RTDB 얇은노드로 뽑고, 나머지는 파이어스토어에서 update.
const VARIABLE = ['vehicle_status', 'status_label_raw', 'price', 'mileage', 'policy_code'];
// 렌더 필요 안정 필드 — 스펙 아님. 파이어스토어 하나로 상품카드가 그려지게.
const CARRY = ['product_code', 'product_type', 'provider_company_code', 'partner_code', 'photo_link', 'location', 'options', 'usage'];
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const alive = (v: Record<string, any>) => v._deleted !== true && S(v.status) !== 'deleted';
const docId = (car: string) => car.replace(/\s/g, '').replace(/[/#.$\[\]]/g, '_');

const products = (await rtdb.ref('v4/products').get()).val() as Record<string, any> || {};
const rows = Object.values(products).filter((v) => isObj(v) && alive(v) && S(v.car_number));
// 파이어스토어에 이미 있는 원자 id 집합(1단계 결과)
const existing = new Set<string>();
(await fs.collection('products').select().get()).forEach((d) => existing.add(d.id));

const seen = new Set<string>();
type Item = { id: string; patch: Record<string, any> };
const items: Item[] = []; let missing = 0, dups = 0;
const statusCount: Record<string, number> = {};
for (const v of rows) {
  const id = docId(S(v.car_number)); if (seen.has(id)) { dups++; continue; } seen.add(id);
  if (!existing.has(id)) { missing++; continue; }
  const patch: Record<string, any> = {};
  for (const f of [...VARIABLE, ...CARRY]) if (v[f] !== undefined && v[f] !== '' && v[f] !== null) patch[f] = v[f];
  const st = S(v.vehicle_status) || '(빈)'; statusCount[st] = (statusCount[st] || 0) + 1;
  items.push({ id, patch });
}

console.log(`RTDB ${rows.length} · 파이어스토어 원자 ${existing.size} · 패치대상 ${items.length} (없어서 건너뜀 ${missing} · 차번중복 ${dups})`);
console.log(`변동 ${VARIABLE.length} + 렌더 ${CARRY.length} 필드 얹음(불변 원자는 안 건드림).`);
console.log('차량상태 분포:'); for (const [s, n] of Object.entries(statusCount).sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(10)} ${n}`);
const withPrice = items.filter((x) => x.patch.price).length;
console.log(`대여료 있는 것 ${withPrice} · 표본:`);
for (const it of items.slice(0, 3)) console.log(`  ${it.id}  상태「${S(it.patch.vehicle_status)}」 대여료 ${JSON.stringify(it.patch.price || {}).slice(0, 50)} 주행 ${S(it.patch.mileage)}`);

if (!APPLY) { console.log(`\n미리보기 — 파이어스토어 원자 ${items.length}개에 변동·렌더 필드 merge. 불변 식별 안 건드림. 실제: --apply`); process.exit(0); }
let written = 0;
for (let i = 0; i < items.length; i += 400) {
  const batch = fs.batch();
  for (const { id, patch } of items.slice(i, i + 400)) { batch.set(fs.collection('products').doc(id), { ...patch, _var_synced_at: Date.now() }, { merge: true }); written++; }
  await batch.commit();
  console.log(`  ${Math.min(i + 400, items.length)}/${items.length}…`);
}
console.log(`\n반영 완료 — 변동·렌더 필드 ${written}건 merge. 파이어스토어 원자는 이제 완전한 상품(불변+변동+렌더).`);
process.exit(0);
