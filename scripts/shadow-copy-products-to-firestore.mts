/**
 * 마이그레이션 1단계 — 차량번호별 «원자(불변 identity)»만 RTDB → Firestore. 읽기는 안 바꾼다(위험 0).
 *
 * ★재고가 최신화 안 됐으니(상태·대여료 stale) 전체 레코드를 안 옮긴다. «차번별 원자」만 씨앗으로 넣고,
 *   변동값(상태·대여료·입고일자)은 이후 최신 소스에서 그 위에 «구성」한다(사장님 2026-09-03).
 *
 * 원자 = 차의 물리적 신원(한 번 정하면 불변). 키 = 차량번호(`products/{차번}`).
 * 기본 dry-run. 반영은 --apply.
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

// ★차량번호별 원자 = 물리적 신원(불변). 상태·대여료·입고·주행·시트메타는 «변동/pipeline」이라 제외.
const ATOM = ['car_number', 'maker', 'model', 'sub_model', 'trim_name', 'trim_extra', 'variant',
  'origin', 'fuel_type', 'engine_cc', 'drive_type', 'seats', 'ext_color', 'int_color',
  'battery_capacity', 'year', 'vehicle_class'];
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const alive = (v: Record<string, any>) => v._deleted !== true && S(v.status) !== 'deleted';
const atomOf = (v: Record<string, any>) => { const o: Record<string, any> = {}; for (const f of ATOM) if (v[f] !== undefined && v[f] !== '') o[f] = v[f]; return o; };

const products = (await rtdb.ref('v4/products').get()).val() as Record<string, any> || {};
const rows = Object.entries(products).filter(([, v]) => isObj(v) && alive(v) && S(v.car_number));
const docId = (v: Record<string, any>) => S(v.car_number).replace(/\s/g, '').replace(/[/#.$\[\]]/g, '_');
const seen = new Set<string>(); let dups = 0;
const items = rows.map(([, v]) => { const id = docId(v); if (seen.has(id)) dups++; seen.add(id); return { id, atom: atomOf(v) }; });

console.log(`RTDB v4/products(차번有·살아있음) ${rows.length} → Firestore products 원자 ${items.length} (차번중복 ${dups})`);
console.log(`원자 필드 ${ATOM.length}개: ${ATOM.join(' ')}`);
console.log('샘플 3:');
for (const { id, atom } of items.slice(0, 3)) console.log(`  products/${id}  ${S(atom.maker)} ${S(atom.model)} ${S(atom.sub_model)} · ${S(atom.trim_name)} · ${S(atom.fuel_type)} ${S(atom.ext_color)}`);

if (!APPLY) {
  console.log(`\n미리보기 — 반영하면 Firestore 「products」에 원자 ${items.length}개 씨앗(상태·대여료 없음). 앱 읽기 안 바꿈.`);
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
