/**
 * RTDB v4/products → Firestore products «한 방 미러」 (정본 미러 스크립트).
 *
 * 두 일을 한 번의 RTDB 읽기로 처리해 Firestore 를 최신으로 둔다:
 *   ① 불변 원자 정제 — 유효보존/무효치유(디올뉴류·빈칸만 snap). 빈 트림은 같은 세부모델 수렴 시 원문보강.
 *   ② 변동·렌더 필드 — 차량상태·대여료·주행·정책 + 상품코드·구분·공급사·사진.
 * 문서키 = 차번(구조적 유일). merge 로 써서 서로 안 덮는다.
 *
 * refine-atoms + sync-variable 을 합친 «운영 미러」다 — 매시간 이걸 돌리면 Firestore 가 RTDB 를 따라온다.
 * 기본 dry-run · 반영은 --apply.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import { snapToMaster, makerGroup } from '../lib/domain/vehicle-master-match';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import type { EntityRecord } from '../lib/intake/entities';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/\s+/g, '');
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const app = initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const rtdb = getDatabase(app);
const fs = getFirestore(app);
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as any;
const MASTER = ((Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || []) as MasterEntry[];

// 마스터 유효 세부모델 → 정본 표기(별칭 제조사 전개).
const SUB = new Map<string, { maker: string; model: string; sub_model: string; origin?: string }>();
for (const e of MASTER) {
  const mk = S(e.maker), mo = S(e.model), sm = S(e.sub_model);
  if (!mk || !mo || !sm) continue;
  const disp = { maker: mk, model: mo, sub_model: sm, origin: S(e.origin) };
  for (const a of makerGroup(N(mk))) SUB.set(`${a}|${N(mo)}|${N(sm)}`, disp);
}
const validCanon = (maker: unknown, model: unknown, sub: unknown) => {
  const mo = N(model), sm = N(sub); if (!sm || !mo) return null;
  for (const a of makerGroup(N(maker))) { const h = SUB.get(`${a}|${mo}|${sm}`); if (h) return h; }
  return null;
};
const snapOf = (v: Record<string, any>) => {
  const raw = S(v.supplier_vehicle_name); if (!raw) return null;
  return snapToMaster({ maker: v.maker, model: v.model, vehicle_name: raw, sub_model: raw, fuel_type: v.fuel_type, year: v.year } as EntityRecord, MASTER) as any;
};

// 변동·렌더 필드
const VARIABLE = ['vehicle_status', 'status_label_raw', 'price', 'mileage', 'policy_code'];
const CARRY = ['product_code', 'product_type', 'provider_company_code', 'partner_code', 'photo_link', 'location', 'options', 'usage'];
const SPEC = ['ext_color', 'int_color', 'year', 'fuel_type', 'engine_cc', 'vehicle_class', 'drive_type', 'seats', 'battery_capacity', 'first_registration_date'];

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const alive = (v: Record<string, any>) => v._deleted !== true && S(v.status) !== 'deleted';
const docId = (car: string) => car.replace(/\s/g, '').replace(/[/#.$\[\]]/g, '_');

const products = (await rtdb.ref('v4/products').get()).val() as Record<string, any> || {};
const rows = Object.values(products).filter((v) => isObj(v) && alive(v) && S(v.car_number));
const seen = new Set<string>();
type Item = { id: string; doc: Record<string, any> };
const items: Item[] = [];
const stat: Record<string, number> = { 유효보존: 0, 치유high: 0, 치유med: 0, 트림보강: 0, 검수대기: 0 };
let dups = 0;

for (const v of rows) {
  const id = docId(S(v.car_number)); if (seen.has(id)) { dups++; continue; } seen.add(id);
  const raw = S(v.supplier_vehicle_name);
  let ident: { maker: string; model: string; sub_model: string; trim_name: string; origin: string } | null = null;
  let confirmed = false, note = '';

  const kept = validCanon(v.maker, v.model, v.sub_model);
  if (kept) {
    let trim = S(v.trim_name);
    if (!trim && raw) {
      const snap = snapOf(v);
      if (snap && (snap.confidence === 'high' || snap.confidence === 'medium') && S(snap.trim_name) && N(snap.model) === N(kept.model) && N(snap.sub_model) === N(kept.sub_model)) { trim = S(snap.trim_name); stat.트림보강++; }
    }
    ident = { maker: kept.maker, model: kept.model, sub_model: kept.sub_model, trim_name: trim, origin: S(v.origin) || S(kept.origin) };
    confirmed = true; note = '유효보존'; stat.유효보존++;
  } else {
    const snap = snapOf(v);
    const canon = snap ? validCanon(snap.maker, snap.model, snap.sub_model) : null;
    if (canon && (snap.confidence === 'high' || snap.confidence === 'medium')) {
      ident = { maker: canon.maker, model: canon.model, sub_model: canon.sub_model, trim_name: S(snap.trim_name), origin: S(snap.origin) || S(v.origin) || S(canon.origin) };
      confirmed = snap.confidence === 'high';
      note = snap.confidence === 'high' ? '치유high' : '치유med';
      stat[note === '치유high' ? '치유high' : '치유med']++;
    } else {
      ident = { maker: S(v.maker), model: S(v.model), sub_model: '', trim_name: '', origin: S(v.origin) };
      note = raw ? '매칭실패' : '원문없음'; stat.검수대기++;
    }
  }

  const doc: Record<string, any> = {
    car_number: S(v.car_number),
    origin: ident.origin, maker: ident.maker, model: ident.model, sub_model: ident.sub_model, trim_name: ident.trim_name,
    확정: confirmed, 검수상태: confirmed ? '확정' : (ident.sub_model ? '검수대기' : (raw ? '매칭실패' : '원문없음')),
    _mirror_at: Date.now(),
  };
  for (const f of SPEC) doc[f] = S(v[f]);
  for (const f of [...VARIABLE, ...CARRY]) if (v[f] !== undefined && v[f] !== '' && v[f] !== null) doc[f] = v[f];
  const rawObj: Record<string, any> = {};
  if (raw) rawObj['차명'] = raw;
  if (S(v.supplier_options)) rawObj['옵션'] = v.supplier_options;
  if (Object.keys(rawObj).length) doc['원문'] = rawObj;
  items.push({ id, doc });
}

console.log(`RTDB v4/products ${rows.length} → Firestore products ${items.length} (차번중복 ${dups})`);
if (dups > 0) { console.error(`✗ 차번 겹침 ${dups} — 오류. 중단.`); process.exit(1); }
console.log(`확정 ${stat.유효보존 + stat.치유high} (유효보존 ${stat.유효보존} + 치유high ${stat.치유high}, 트림보강 ${stat.트림보강}) · 검수대기 ${stat.치유med + stat.검수대기}(치유med ${stat.치유med} + 미해결 ${stat.검수대기})`);

if (!APPLY) { console.log(`\n미리보기 — Firestore products ${items.length}개 merge(불변+변동+렌더). 실제: --apply`); process.exit(0); }
let written = 0;
for (let i = 0; i < items.length; i += 400) {
  const batch = fs.batch();
  for (const { id, doc } of items.slice(i, i + 400)) { batch.set(fs.collection('products').doc(id), doc, { merge: true }); written++; }
  await batch.commit();
  if ((i / 400) % 2 === 0) console.log(`  ${Math.min(i + 400, items.length)}/${items.length}…`);
}
console.log(`\n미러 완료 — ${written}건 merge · Firestore 실측 ${(await fs.collection('products').count().get()).data().count}건.`);
process.exit(0);
