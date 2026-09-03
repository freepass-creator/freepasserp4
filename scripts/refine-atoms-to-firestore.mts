/**
 * 차번별 원자 정제 — 공급사 원문을 정제해 «계층 준수」 원자를 Firestore 에 확정 보관.
 *
 * ★규칙: 저장된 세부모델이 «이미 계층 유효」면 그대로 둔다(수기·양질 소스 보존).
 *   무효(마스터에 없는 「디 올 뉴 싼타페 MX5」류)·빈칸만 snap 으로 치유한다.
 *   — 전건 재-snap 은 위험하다: W214→W213(세대 강등)·트림 삭제 등 «양질 저장값을 오히려 망가뜨림」을 실측(2026-09-03).
 *   snap 은 «마스터에 실재하는 형태만」 반환(하드게이트) → 치유값은 계층을 절대 안 벗어난다.
 *
 * 원자(불변·확정 후) = 원산지·제조사·모델·세부모델·세부트림·외장·내장·연식·연료·배기량·차종구분·구동·인승·배터리·최초등록
 *   확정 = 저장이 유효했거나 snap high. 치유가 snap medium = 검수대기. 못한 것(원문없음/low) = 검수대기.
 * 변동값(입고·상태·주행·대여료·정책)은 담지 않는다(이후 얹음).
 *
 * ★차번 유일 — 겹치면 오류로 중단. 기본 dry-run · 반영은 --apply.
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

// 마스터 유효 세부모델 경로 → 정본 표기(제조사·모델·세부모델). 별칭 제조사로도 찾히게 그룹 전개.
const SUB: Map<string, { maker: string; model: string; sub_model: string }> = new Map();
for (const e of MASTER) {
  const mk = S(e.maker), mo = S(e.model), sm = S(e.sub_model);
  if (!mk || !mo || !sm) continue;
  const disp = { maker: mk, model: mo, sub_model: sm };
  for (const mkAlias of makerGroup(N(mk))) SUB.set(`${mkAlias}|${N(mo)}|${N(sm)}`, disp);
}
// 저장값이 계층 유효하면 정본표기 반환(별칭 제조사→마스터 표기로 교정), 아니면 null.
const validCanon = (maker: unknown, model: unknown, sub: unknown) => {
  const mo = N(model), sm = N(sub); if (!sm || !mo) return null;
  for (const mkAlias of makerGroup(N(maker))) { const hit = SUB.get(`${mkAlias}|${mo}|${sm}`); if (hit) return hit; }
  return null;
};

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const alive = (v: Record<string, any>) => v._deleted !== true && S(v.status) !== 'deleted';
const products = (await rtdb.ref('v4/products').get()).val() as Record<string, any> || {};
const rows = Object.values(products).filter((v) => isObj(v) && alive(v) && S(v.car_number));

const docId = (car: string) => car.replace(/\s/g, '').replace(/[/#.$\[\]]/g, '_');
const seen = new Set<string>(); let dups = 0;
type Item = { id: string; atom: Record<string, any>; state: string };
const items: Item[] = [];
const stat: Record<string, number> = { 유효보존: 0, snap치유high: 0, snap치유med: 0, 원문없음: 0, 매칭실패: 0 };

for (const v of rows) {
  const id = docId(S(v.car_number)); if (seen.has(id)) { dups++; continue; } seen.add(id);
  const raw = S(v.supplier_vehicle_name);
  let identity: { maker: string; model: string; sub_model: string; trim_name: string; origin?: string } | null = null;
  let state = '';

  const kept = validCanon(v.maker, v.model, v.sub_model);
  if (kept) {
    // 이미 계층 유효 → 보존(제조사만 정본표기로 교정). 트림은 저장값 유지.
    identity = { ...kept, trim_name: S(v.trim_name), origin: S(v.origin) };
    state = '유효보존'; stat.유효보존++;
  } else {
    // 무효·빈칸 → snap 치유
    const snap: any = raw ? snapToMaster({ maker: v.maker, model: v.model, vehicle_name: raw, sub_model: raw, fuel_type: v.fuel_type, year: v.year } as EntityRecord, MASTER) : null;
    const conf = snap?.confidence || 'none';
    const canon = snap ? validCanon(snap.maker, snap.model, snap.sub_model) : null;
    if (canon && (conf === 'high' || conf === 'medium')) {
      identity = { ...canon, trim_name: S(snap.trim_name), origin: S(snap.origin) || S(v.origin) };
      state = conf === 'high' ? 'snap치유high' : 'snap치유med';
      stat[conf === 'high' ? 'snap치유high' : 'snap치유med']++;
    } else {
      identity = { maker: S(v.maker), model: S(v.model), sub_model: '', trim_name: '', origin: S(v.origin) };
      state = raw ? '매칭실패' : '원문없음'; stat[state]++;
    }
  }

  const confirmed = state === '유효보존' || state === 'snap치유high';
  const atom: Record<string, any> = {
    car_number: S(v.car_number),
    origin: S(identity.origin), maker: identity.maker, model: identity.model,
    sub_model: identity.sub_model, trim_name: identity.trim_name,
    ext_color: S(v.ext_color), int_color: S(v.int_color), year: S(v.year),
    fuel_type: S(v.fuel_type), engine_cc: S(v.engine_cc), vehicle_class: S(v.vehicle_class),
    drive_type: S(v.drive_type), seats: S(v.seats), battery_capacity: S(v.battery_capacity),
    first_registration_date: S(v.first_registration_date),
    확정: confirmed, 검수상태: confirmed ? '확정' : (identity.sub_model ? '검수대기' : (raw ? '매칭실패' : '원문없음')),
  };
  const rawObj: Record<string, any> = {};
  if (raw) rawObj['차명'] = raw;
  if (S(v.supplier_options)) rawObj['옵션'] = v.supplier_options;
  if (Object.keys(rawObj).length) atom['원문'] = rawObj;
  items.push({ id, atom, state });
}

console.log(`상품 ${rows.length} → 원자 ${items.length} (차번중복 ${dups})`);
if (dups > 0) { console.error(`✗ 차번 겹침 ${dups} — 오류. 중단.`); process.exit(1); }
const confirmedN = stat.유효보존 + stat.snap치유high;
console.log(`확정 ${confirmedN} = 유효보존 ${stat.유효보존} + snap치유(high) ${stat.snap치유high}`);
console.log(`검수대기 ${items.length - confirmedN} = snap치유(med) ${stat.snap치유med} + 매칭실패 ${stat.매칭실패} + 원문없음 ${stat.원문없음}`);
console.log('치유 표본(무효·빈칸 → 정제):');
for (const it of items.filter((x) => x.state.startsWith('snap')).slice(0, 5)) console.log(`  ${it.atom.car_number}  「${S(it.atom['원문']?.['차명']).slice(0, 26)}」 → ${it.atom.model} ${it.atom.sub_model} ${it.atom.trim_name}`);

if (!APPLY) { console.log(`\n미리보기 — Firestore 「products」에 정제원자 ${items.length}개. 변동값 없음. 실제: --apply`); process.exit(0); }
let written = 0;
for (let i = 0; i < items.length; i += 400) {
  const batch = fs.batch();
  for (const { id, atom } of items.slice(i, i + 400)) { batch.set(fs.collection('products').doc(id), { ...atom, _refined_at: Date.now() }); written++; }
  await batch.commit();
  console.log(`  ${Math.min(i + 400, items.length)}/${items.length}…`);
}
console.log(`\n반영 완료 — Firestore products 정제원자 ${written} · 실측 ${(await fs.collection('products').count().get()).data().count}건.`);
process.exit(0);
