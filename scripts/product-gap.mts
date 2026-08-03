/**
 * 매물 격차 분석 — 브리지를 끄면 목록에서 사라질 차가 무엇인지.
 *
 * 매물은 이관하지 않기로 했다(v4에 시트 동기화분이 이미 있어 실물 중복·이중판매 위험).
 * 그 전제는 "v3의 살아있는 매물이 v4에도 있다"인데, 실제로 그런지 차량번호로 확인한다.
 *
 * 실행:
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/product-gap.mts
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const DB_URL = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
initializeApp({ credential: saJson ? cert(JSON.parse(saJson)) : applicationDefault(), databaseURL: DB_URL });
const db = getDatabase();

type Rec = Record<string, any>;
const isObj = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const S = (v: unknown) => String(v ?? '').trim();
const plate = (r: Rec) => S(r.car_number).replace(/\s/g, '');
const isDead = (r: Rec) => r._deleted === true || S(r.status) === 'deleted';
const productKey = (childKey: string, r: Rec) => S(r.product_code) || childKey;
const isPresent = (v: unknown) => v !== undefined && v !== null && v !== '';

const PUBLIC_COMPARE_FIELDS = [
  'provider_company_code', 'product_type', 'vehicle_status',
  'maker', 'model', 'sub_model', 'variant', 'trim_name',
  'year', 'fuel_type', 'mileage', 'engine_cc', 'ext_color', 'int_color',
  'policy_code', 'catalog_id', 'price',
] as const;
const PRIVATE_ROOT_FIELDS = ['vehicle_price', 'vin', 'account_number'] as const;
const PRIVATE_PRICE_FIELDS = ['fee', 'commission', 'fee_memo'] as const;

const stable = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return '';
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => stable(item)));
  if (isObj(value)) return JSON.stringify(Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]),
  ));
  return S(value);
};

const publicPrice = (value: unknown): unknown => {
  if (!isObj(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([period, rawTerms]) => {
    if (!isObj(rawTerms)) return [period, rawTerms];
    return [period, Object.fromEntries(Object.entries(rawTerms)
      .filter(([field]) => !PRIVATE_PRICE_FIELDS.includes(field as typeof PRIVATE_PRICE_FIELDS[number])) )];
  }));
};

const valueForCompare = (r: Rec, field: typeof PUBLIC_COMPARE_FIELDS[number]) =>
  field === 'price' ? publicPrice(r.price) : r[field];

const groupByPlate = (rows: [string, unknown][]) => {
  const groups = new Map<string, [string, Rec][]>();
  for (const [key, raw] of rows) {
    const rec = raw as Rec;
    const p = plate(rec);
    if (!p) continue;
    groups.set(p, [...(groups.get(p) || []), [key, rec]]);
  }
  return groups;
};

const hasNestedPrivatePrice = (r: Rec): boolean => isObj(r.price)
  && Object.values(r.price).some((terms) => isObj(terms)
    && PRIVATE_PRICE_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(terms, field)));

const referenceCounts = (rows: [string, unknown][], onlyV3Keys: Set<string>, onlyV3Plates: Set<string>) => {
  let exact = 0;
  let plateOnly = 0;
  for (const [, raw] of rows) {
    if (!isObj(raw) || isDead(raw)) continue;
    const refs = [raw.product_code, raw.product_uid, raw.product_id].map(S).filter(Boolean);
    if (refs.some((ref) => onlyV3Keys.has(ref))) exact++;
    else {
      const p = S(raw.car_number || raw.car_number_snapshot || raw.vehicle_number).replace(/\s/g, '');
      if (p && onlyV3Plates.has(p)) plateOnly++;
    }
  }
  return { exact, plateOnly };
};

async function main() {
  const [s3, s4, privateSnap, c3, c4, r3, r4] = await Promise.all([
    db.ref('products').get(),
    db.ref('v4/products').get(),
    db.ref('v4/products_private').get(),
    db.ref('contracts').get(),
    db.ref('v4/contracts').get(),
    db.ref('rooms').get(),
    db.ref('v4/rooms').get(),
  ]);
  const v3 = Object.entries((s3.val() || {}) as Rec).filter(([, r]) => isObj(r) && !isDead(r));
  const v4 = Object.entries((s4.val() || {}) as Rec).filter(([, r]) => isObj(r) && !isDead(r));
  const privateProducts = (privateSnap.val() || {}) as Rec;

  const g3 = groupByPlate(v3);
  const g4 = groupByPlate(v4);
  const plates3 = new Set(g3.keys());
  const plates4 = new Set(g4.keys());
  const onlyV3Plates = new Set([...plates3].filter((p) => !plates4.has(p)));
  const onlyV4Plates = new Set([...plates4].filter((p) => !plates3.has(p)));
  const commonPlates = [...plates3].filter((p) => plates4.has(p));
  const childKeys3 = new Set(v3.map(([key]) => key));
  const childKeys4 = new Set(v4.map(([key]) => key));
  const duplicatePlates3 = [...g3.values()].filter((rows) => rows.length > 1);
  const duplicatePlates4 = [...g4.values()].filter((rows) => rows.length > 1);

  console.log('키·자연키 대조');
  console.log(`  child key: 공통 ${[...childKeys3].filter((k) => childKeys4.has(k)).length} · v3-only ${[...childKeys3].filter((k) => !childKeys4.has(k)).length} · v4-only ${[...childKeys4].filter((k) => !childKeys3.has(k)).length}`);
  console.log(`  차량번호: 공통 ${commonPlates.length} · v3-only ${onlyV3Plates.size} · v4-only ${onlyV4Plates.size}`);
  console.log(`  중복 차량번호: v3 ${duplicatePlates3.length}그룹/${duplicatePlates3.reduce((n, rows) => n + rows.length, 0)}건 · v4 ${duplicatePlates4.length}그룹/${duplicatePlates4.reduce((n, rows) => n + rows.length, 0)}건\n`);

  const oneToOne = commonPlates.filter((p) => g3.get(p)?.length === 1 && g4.get(p)?.length === 1);
  const fieldDiffs = Object.fromEntries(PUBLIC_COMPARE_FIELDS.map((field) => [field, 0])) as Record<string, number>;
  for (const p of oneToOne) {
    const left = g3.get(p)![0][1];
    const right = g4.get(p)![0][1];
    for (const field of PUBLIC_COMPARE_FIELDS) {
      if (stable(valueForCompare(left, field)) !== stable(valueForCompare(right, field))) fieldDiffs[field]++;
    }
  }
  console.log(`공통 차량번호 중 1:1 필드대조 ${oneToOne.length}대`);
  for (const [field, count] of Object.entries(fieldDiffs).sort((a, b) => b[1] - a[1])) {
    if (count) console.log(`  ${field.padEnd(24)} ${count}`);
  }
  if (!Object.values(fieldDiffs).some(Boolean)) console.log('  공개 비교필드 차이 없음');

  const publicPrivateResidue = (rows: [string, unknown][]) => {
    let root = 0;
    let price = 0;
    for (const [, raw] of rows) {
      const rec = raw as Rec;
      if (PRIVATE_ROOT_FIELDS.some((field) => isPresent(rec[field]))) root++;
      if (hasNestedPrivatePrice(rec)) price++;
    }
    return { root, price };
  };
  const privateV3 = publicPrivateResidue(v3);
  const privateV4 = publicPrivateResidue(v4);
  console.log('\n공개 노드의 비공개 필드 잔존(값 미출력)');
  console.log(`  v3 root원가/VIN/계좌 ${privateV3.root}건 · price 수수료 ${privateV3.price}건`);
  console.log(`  v4 root원가/VIN/계좌 ${privateV4.root}건 · price 수수료 ${privateV4.price}건`);
  console.log(`  v4/products_private ${Object.keys(privateProducts).length}건\n`);

  const v4Plates = new Set(v4.map(([, r]) => plate(r as Rec)).filter(Boolean));
  const gap = v3.filter(([, r]) => { const p = plate(r as Rec); return p && !v4Plates.has(p); });

  console.log(`v3 살아있는 매물 ${v3.length} · v4 ${v4.length} · v3에만 ${gap.length}\n`);

  // 상태별
  const byStatus: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const [, r] of gap) {
    const rec = r as Rec;
    byStatus[S(rec.vehicle_status) || '(없음)'] = (byStatus[S(rec.vehicle_status) || '(없음)'] || 0) + 1;
    byProvider[S(rec.provider_company_code) || '(없음)'] = (byProvider[S(rec.provider_company_code) || '(없음)'] || 0) + 1;
    byType[S(rec.product_type) || '(없음)'] = (byType[S(rec.product_type) || '(없음)'] || 0) + 1;
  }
  const dump = (title: string, o: Record<string, number>) => {
    console.log(title);
    for (const [k, n] of Object.entries(o).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
    console.log('');
  };
  dump('상태별(v3에만 있는 매물)', byStatus);
  dump('공급사별', byProvider);
  dump('상품구분별', byType);

  // 실제로 팔리는 상태만 추림 — 이게 "브리지 끄면 손해 보는" 진짜 숫자다
  const SELLABLE = new Set(['즉시출고', '출고가능', '출고협의', '상품화중']);
  const live = gap.filter(([, r]) => SELLABLE.has(S((r as Rec).vehicle_status)));
  console.log(`판매 가능 상태인데 v4에 없는 차: ${live.length}대`);
  for (const [k, r] of live.slice(0, 15)) {
    const rec = r as Rec;
    console.log(`  ${plate(rec).padEnd(10)} ${S(rec.maker)} ${S(rec.sub_model) || S(rec.model)} · ${S(rec.vehicle_status)} · ${S(rec.provider_company_code)}  (${k})`);
  }
  if (live.length > 15) console.log(`  … 외 ${live.length - 15}대`);

  const onlyV3Keys = new Set(gap.flatMap(([key, raw]) => [key, productKey(key, raw as Rec)]).filter(Boolean));
  const contracts = [...Object.entries((c3.val() || {}) as Rec), ...Object.entries((c4.val() || {}) as Rec)];
  const rooms = [...Object.entries((r3.val() || {}) as Rec), ...Object.entries((r4.val() || {}) as Rec)];
  const contractRefs = referenceCounts(contracts, onlyV3Keys, onlyV3Plates);
  const roomRefs = referenceCounts(rooms, onlyV3Keys, onlyV3Plates);
  console.log('\nv3-only 재고 참조(값 미출력)');
  console.log(`  계약: 정확키 ${contractRefs.exact}건 · 차량번호만 ${contractRefs.plateOnly}건`);
  console.log(`  채팅방: 정확키 ${roomRefs.exact}건 · 차량번호만 ${roomRefs.plateOnly}건`);

  console.log('\n판정:');
  console.log(live.length === 0
    ? '  ✅ v3에만 있는 매물은 전부 비판매 상태 — 매물 브리지를 꺼도 목록 손실 없음'
    : `  ⛔ ${live.length}대가 사라진다 — 시트 동기화로 v4에 채운 뒤에 꺼야 한다`);
  process.exit(0);
}

main().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });
