/**
 * 마이그레이션 1단계 — 차량번호별 «원자»를 RTDB → Firestore. 읽기는 안 바꾼다(위험 0).
 *
 * 원자 = «차번 + 정제 스펙(불변) + 공급사 원문(근거)». 매뉴얼 2중 보관(원문+정제)을 따른다.
 *   변동값(입고일자·차량상태·주행거리·대여료·정책)은 «변동」이라 제외 — 이후 최신 소스에서 위에 구성.
 *   ★정제규격은 여기 그대로 옮긴다(정제 엔진이 채운 값). 아직 빈 세대는 정제 개선 시 자동 최신화된다.
 *
 * 키 = 차량번호(`products/{차번}`). 기본 dry-run · 반영은 --apply.
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

// ★불변 스펙(정제규격) — 한 번 정하면 안 바뀜. 상태·대여료·주행·입고는 «변동」이라 제외.
const REFINED = ['car_number', 'maker', 'model', 'sub_model', 'trim_name', 'trim_extra', 'variant',
  'origin', 'fuel_type', 'engine_cc', 'drive_type', 'seats', 'ext_color', 'int_color',
  'battery_capacity', 'year', 'vehicle_class', 'first_registration_date'];
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const alive = (v: Record<string, any>) => v._deleted !== true && S(v.status) !== 'deleted';
const atomOf = (v: Record<string, any>) => {
  const o: Record<string, any> = {};
  for (const f of REFINED) if (v[f] !== undefined && v[f] !== '') o[f] = v[f];
  const raw: Record<string, any> = {};
  if (S(v.supplier_vehicle_name)) raw['차명'] = v.supplier_vehicle_name;   // 공급사 원문 차명
  if (S(v.supplier_options)) raw['옵션'] = v.supplier_options;             // 공급사 원문 옵션
  if (Object.keys(raw).length) o['원문'] = raw;
  return o;
};

const products = (await rtdb.ref('v4/products').get()).val() as Record<string, any> || {};
const rows = Object.entries(products).filter(([, v]) => isObj(v) && alive(v) && S(v.car_number));
const docId = (v: Record<string, any>) => S(v.car_number).replace(/\s/g, '').replace(/[/#.$\[\]]/g, '_');
const seen = new Set<string>(); let dups = 0;
const items = rows.map(([, v]) => { const id = docId(v); if (seen.has(id)) dups++; seen.add(id); return { id, atom: atomOf(v) }; });
const withRaw = items.filter((x) => x.atom['원문']).length;
const blankSub = items.filter((x) => !S(x.atom.sub_model)).length;

console.log(`RTDB v4/products(차번有·살아있음) ${rows.length} → Firestore products 원자 ${items.length} (차번중복 ${dups})`);
// ★차량번호는 유일 — 겹치면 오류다(사장님 2026-09-03 「겹친다면 오류임」). 겹치면 쓰지 않고 멈춘다.
if (dups > 0) { console.error(`\n✗ 차번 겹침 ${dups}건 — 오류. 원자에 같은 번호 2개 불가. 중복 해소 전 반영 중단.`); process.exit(1); }
console.log(`정제 ${REFINED.length}필드 + 원문(차명·옵션) · 원문있음 ${withRaw} · 세부모델 아직 빈 것 ${blankSub}(정제개선 시 최신화)`);
console.log('샘플 3:');
for (const { id, atom } of items.slice(0, 3)) console.log(`  products/${id}  정제「${S(atom.maker)} ${S(atom.model)} ${S(atom.sub_model)} ${S(atom.trim_name)}」 · 원문「${S(atom['원문']?.['차명']).slice(0, 30)}」`);

if (!APPLY) {
  console.log(`\n미리보기 — Firestore 「products」에 원자(정제+원문) ${items.length}개. 상태·대여료 없음. 앱 읽기 안 바꿈.`);
  console.log('실제 반영: --apply');
  process.exit(0);
}
let written = 0;
for (let i = 0; i < items.length; i += 400) {
  const batch = fs.batch();
  for (const { id, atom } of items.slice(i, i + 400)) { batch.set(fs.collection('products').doc(id), { ...atom, _seeded_at: Date.now() }); written++; }
  await batch.commit();
  console.log(`  ${Math.min(i + 400, items.length)}/${items.length}…`);
}
const fsCount = (await fs.collection('products').count().get()).data().count;
console.log(`\n반영 완료 — Firestore products 원자 ${written} 씀 · 컬렉션 실측 ${fsCount}건.`);
process.exit(0);
