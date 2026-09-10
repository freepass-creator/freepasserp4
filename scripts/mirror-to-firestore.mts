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
import { getDatabase } from './lib/disabled-rtdb.mts';
import { getFirestore } from 'firebase-admin/firestore';
import { snapToMaster, makerGroup } from '../lib/domain/vehicle-master-match';
import { cleanTrim } from '../lib/domain/clean-trim';
import { resolveStatus } from '../lib/domain/atom-status';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import type { EntityRecord } from '../lib/intake/entities';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/\s+/g, '');
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
const app = initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const rtdb = getDatabase(app);
const fs = getFirestore(app);
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as any;
const MASTER = ((Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || []) as MasterEntry[];
// ★세부모델 → 마스터 트림 목록 (세부트림 청소기용 — 차명 원문이 통째로 새어드는 걸 막는다, 사장님 2026-09-09).
const masterTrimsBySub = new Map<string, string[]>();
for (const m of MASTER) { const sm = S((m as any).sub_model); if (!sm) continue; const cur = masterTrimsBySub.get(sm) || []; for (const t of ((m as any).trims || [])) { const ts = S(t); if (ts && !cur.includes(ts)) cur.push(ts); } masterTrimsBySub.set(sm, cur); }

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

// 변동·렌더 필드. ★vehicle_price·vin·account_number 는 «담지 않는다»(공급사 원가·차대번호·계좌 = private).
const VARIABLE = ['vehicle_status', 'status_label_raw', 'price', 'mileage', 'policy_code'];
const CARRY = ['product_code', 'product_type', 'provider_company_code', 'partner_code', 'photo_link', 'location', 'options', 'usage'];
// 요금표 안의 private 항목(수수료·커미션) — 손님·영업자에 노출 금지. 공개 문서엔 deposit·rent 만.
const PRIVATE_PRICE_FIELDS = new Set(['fee', 'commission', 'fee_memo']);
function publicPrice(price: unknown): unknown {
  if (!price || typeof price !== 'object' || Array.isArray(price)) return price;
  const out: Record<string, any> = {};
  for (const [period, terms] of Object.entries(price as Record<string, any>)) {
    if (!terms || typeof terms !== 'object' || Array.isArray(terms)) { out[period] = terms; continue; }
    const pub: Record<string, any> = {};
    for (const [k, val] of Object.entries(terms)) if (!PRIVATE_PRICE_FIELDS.has(k)) pub[k] = val;
    out[period] = pub;
  }
  return out;
}
const SPEC = ['ext_color', 'int_color', 'year', 'fuel_type', 'engine_cc', 'vehicle_class', 'drive_type', 'seats', 'battery_capacity', 'first_registration_date'];

// 상태 디테일 — 판정은 «한 곳»(lib/domain/atom-status resolveStatus)에서만. mirror 는 원천 필드를 넘긴다.
//   base=현 vehicle_status · raw=원천 표기 · locked=계약잠금. (규칙·주석 = atom-status.ts)
const statusDetail = (v: Record<string, any>) => resolveStatus({ base: v.vehicle_status, raw: v.status_label_raw, locked: v.locked_by_contract });

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const alive = (v: Record<string, any>) => v._deleted !== true && S(v.status) !== 'deleted';
const docId = (car: string) => car.replace(/\s/g, '').replace(/[/#.$\[\]]/g, '_');

const products = (await rtdb.ref('v4/products').get()).val() as Record<string, any> || {};
const rows = Object.values(products).filter((v) => isObj(v) && alive(v) && S(v.car_number));

// ★직접수집으로 넘어간 공급사는 미러에서 «뺀다»(사장님 2026-09-04 「직접수집으로 넘어갔으니 빼」).
//   대상 = MIRROR_SOURCES(시트·홈피) + 손오공(RP012) + partner.sheet_url 등록. 이들은 원천을 «직접» 읽어
//   Firestore 에 쓰므로(ingest-all-suppliers), 미러가 옛 RTDB 경로로 또 덮으면 둘이 다툰다(사라진 차를 되살리는 등).
//   미러는 «옛 경로만 쓰는» 나머지 공급사만 맡는다. ⚠ 이 파일과 direct-ingest 워크플로는 같이 main 에 가야 원자적 컷오버.
const partnersNode = (await rtdb.ref('v4/partners').get()).val() as Record<string, any> || {};
const DIRECT = new Set<string>([...MIRROR_SOURCES.map((m) => m.code), 'RP012']);
for (const p of Object.values(partnersNode)) if (isObj(p) && S(p.partner_code) && /docs\.google\.com/.test(S(p.sheet_url))) DIRECT.add(S(p.partner_code));
// ★두 코드를 «각각» 본다 — `a || b` 로 앞것만 보면 provider=LEGACY·partner=RP012 인 직접수집 차를 놓쳐 미러가 덮는다(Codex 2026-09-09 반례).
const isDirect = (v: Record<string, any>) => DIRECT.has(S(v.provider_company_code)) || DIRECT.has(S(v.partner_code));

const seen = new Set<string>();
type Item = { id: string; doc: Record<string, any> };
const items: Item[] = [];
const stat: Record<string, number> = { 유효보존: 0, 치유high: 0, 치유med: 0, 트림보강: 0, 검수대기: 0 };
let dups = 0, skippedDirect = 0;

for (const v of rows) {
  const id = docId(S(v.car_number)); if (seen.has(id)) { dups++; continue; } seen.add(id);
  if (isDirect(v)) { skippedDirect++; continue; }   // 직접수집 소유 — 미러가 안 건드린다
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

  // ★세부트림 청소 — 차명 원문 통째(「K5 렌터카 LPi 2.0 스탠다드 4 23MY」)가 세부트림에 새어들지 못하게. 마스터 트림에 맞추거나 노이즈 벗겨 핵심만(사장님 2026-09-09 「진짜 힘들다」).
  ident.trim_name = cleanTrim(ident.trim_name, ident.maker, ident.model, ident.sub_model, masterTrimsBySub.get(ident.sub_model) || []);
  const doc: Record<string, any> = {
    car_number: S(v.car_number),
    origin: ident.origin, maker: ident.maker, model: ident.model, sub_model: ident.sub_model, trim_name: ident.trim_name,
    확정: confirmed, 검수상태: confirmed ? '확정' : (ident.sub_model ? '검수대기' : (raw ? '매칭실패' : '원문없음')),
    // ★원천 표식 — 「이 차 어디서 왔나」 추적(불변식 PROV). 원본 v 에 있으면 잇고, 없으면 «mirror»(RTDB 미러 경로 = 레거시 시트).
    //   직접수집은 sheet·sonokong·iron 을 찍는데 미러만 안 찍어 484대가 source 없었다(2026-09-09 실측). 컷오버 뒤 직접수집으로 넘어가면 실제 채널로 바뀐다.
    source: S(v.source) || 'mirror', ...(S(v.source_schema) ? { source_schema: S(v.source_schema) } : null),
    _mirror_at: Date.now(),
  };
  for (const f of SPEC) doc[f] = S(v[f]);
  for (const f of [...VARIABLE, ...CARRY]) {
    if (v[f] === undefined || v[f] === '' || v[f] === null) continue;
    doc[f] = f === 'price' ? publicPrice(v[f]) : v[f];   // price 는 private 항목(수수료) 걷어내고 공개분만
  }
  // 상태 디테일 — 한 값에 뭉치지 않고 표시·분류·이유·가용을 나눠 박는다.
  const sd = statusDetail(v);
  doc.status = sd.status; doc.status_kind = sd.status_kind; doc.status_reason = sd.status_reason; doc.listable = sd.listable;
  doc.vehicle_status = sd.status;   // 빈 → 차량검수 로 정규화
  // ★데이터가 «아예 없는» 차(원문도 식별도 없음)는 내린다 — 팔 수 없으니 목록에서 뺀다(사장님 2026-09-04 「데이터 아예 없는 건 내려야지, 의미 없잖아」).
  //   계약중이어도 마찬가지 — 스펙·요금이 하나도 없으면 상품이 아니다. 원문은 있는데 매칭만 실패한 차(매칭실패)는 살린다(제조사·원문은 보인다).
  // 원문/검수 품질은 별도 경고다. 재고 파생값은 vehicle_status 하나에서만 만든다.
  const rawObj: Record<string, any> = {};
  if (raw) rawObj['차명'] = raw;
  if (S(v.supplier_options)) rawObj['옵션'] = v.supplier_options;
  if (Object.keys(rawObj).length) doc['원문'] = rawObj;
  items.push({ id, doc });
}

console.log(`RTDB v4/products ${rows.length} → Firestore products ${items.length} (차번중복 ${dups})`);
if (dups > 0) { console.error(`✗ 차번 겹침 ${dups} — 오류. 중단.`); process.exit(1); }
console.log(`확정 ${stat.유효보존 + stat.치유high} (유효보존 ${stat.유효보존} + 치유high ${stat.치유high}, 트림보강 ${stat.트림보강}) · 검수대기 ${stat.치유med + stat.검수대기}(치유med ${stat.치유med} + 미해결 ${stat.검수대기})`);

/**
 * ★★**직접수집이 맡은 차는 미러가 덮지 않는다** (규칙 SSOT = `docs/원자-내려보내기-로직.md` §1).
 *
 * ⚠ 2026-09-08 — 원자 한 문서를 넷이 쓰면서 서로의 칸을 덮고 있었다. 미러는 파이프라인 «맨 끝»(⑭)이라
 *   늘 마지막에 이기는데, 읽는 곳이 **이제 안 쓰는 RTDB** 다. 그래서 직접수집이 원천에서 방금 정확히
 *   가져온 차 이름·제원·상태·요금을 옛 값으로 되돌려 놓았다 — 「왜 넣어도 되돌아가냐」의 정체.
 *
 * ⇒ `_direct_ingest_at` 이 찍힌 차는 **빈 칸만 채운다.** 미러가 «새로 알려 주는 것»은 받고,
 *   «이미 아는 것»은 안 건드린다. 원천이 없는 옛 차(직접수집 밖)는 지금처럼 통째로 미러가 맡는다.
 */
const OWNED_BY_INGEST = new Set([
  'maker', 'model', 'sub_model', 'trim_name', 'origin', '확정', '검수상태', '원문',
  'ext_color', 'int_color', 'year', 'fuel_type', 'engine_cc', 'vehicle_class', 'drive_type', 'seats',
  'first_registration_date', 'battery_capacity', 'options', 'mileage', 'price',
  'status', 'vehicle_status', 'status_kind', 'status_reason', 'status_label_raw', 'listable', 'product_type',
  // ★source·source_schema 도 직접수집 소유 — 미러가 isDirect 를 놓친 회차에도 정확한 출처(sheet·sonokong·iron)를 «mirror»로 안 덮게(Codex 2026-09-09).
  'source', 'source_schema',
]);
const curDocs = new Map<string, Record<string, unknown>>();
for (const d of (await fs.collection('products').get()).docs) curDocs.set(d.id, d.data() as Record<string, unknown>);
let 양보 = 0, 양보칸 = 0;
for (const it of items) {
  const c = curDocs.get(it.id);
  if (!c || !c._direct_ingest_at) continue;   // 직접수집 밖의 차 — 예전처럼 미러가 맡는다
  let cut = 0;
  for (const f of Object.keys(it.doc)) {
    if (!OWNED_BY_INGEST.has(f)) continue;
    const have = c[f];
    const 찼나 = have !== undefined && have !== '' && have !== null
      && !(typeof have === 'object' && !Array.isArray(have) && Object.keys(have as object).length === 0);
    if (찼나) { delete it.doc[f]; cut++; }     // 이미 아는 칸 — 안 덮는다
  }
  if (cut) { 양보++; 양보칸 += cut; }
}
console.log(`직접수집이 맡은 차 ${양보}대 — 이미 찬 칸 ${양보칸}개는 덮지 않는다(빈 칸만 채움).`);

if (!APPLY) { console.log(`\n미리보기 — Firestore products ${items.length}개 merge(불변+변동+렌더). 실제: --apply`); process.exit(0); }


let written = 0;
for (let i = 0; i < items.length; i += 400) {
  const batch = fs.batch();
  for (const { id, doc } of items.slice(i, i + 400)) { batch.set(fs.collection('products').doc(id), doc, { merge: true }); written++; }
  await batch.commit();
  if ((i / 400) % 2 === 0) console.log(`  ${Math.min(i + 400, items.length)}/${items.length}…`);
}
console.log(`\n미러 완료 — ${written}건 merge (직접수집 소유 ${skippedDirect}건 건너뜀 · 공급사 ${DIRECT.size}곳) · Firestore 실측 ${(await fs.collection('products').count().get()).data().count}건.`);
process.exit(0);
