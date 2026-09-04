/**
 * 공급사 «원천 직접 → Firestore 원자화» — 범용(코드만 갈아끼운다). 정제시트를 안 거친다.
 *
 * 사장님 2026-09-04 「공급사가 입력하는 곳에서 네가 직접 따서 원자화하고 상품시트에 뿌린다.
 *   차량번호로 차종마스터 한 번 학습해 박으면 틀릴 일이 없다 — 우리 것만 보면 되니까.
 *   실사용 전환하고 다른 것도 동일하게.」
 *
 * 핵심 셋:
 *  ① 원본 열 이름이 공급사마다 달라도 `MIRROR_ALIAS`(우리필드→원본열 후보)로 «자동 해석».
 *  ② 차 탭은 «헤더에 차량번호+상태가 있으면」 자동 감지 — 탭 이름을 공급사마다 안 적는다.
 *  ③ ★차번으로 «우리가 박아둔 것»을 먼저 본다. 있으면 그대로(재-snap 안 함). 없는 차번만 마스터 학습.
 *     → 아는 차는 구조적으로 동일, 세대강등 사고 0.
 *
 * 기본 = 대조(dry-run, 읽기만). --apply = Firestore products 에 씀(불변 merge + pin) · 사라진 차 listable=false.
 * 실행: GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json \
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/ingest-supplier-to-firestore.mts --code=RP004 [--apply]
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { listSheetTabs, readSheetGrid } from '../lib/server/google-sheets';
import { snapToMaster, makerGroup } from '../lib/domain/vehicle-master-match';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';
import type { EntityRecord } from '../lib/intake/entities';
import { normFuel } from '../lib/domain/vehicle-master-format';
import { canonSheetVehicleStatus } from '../lib/domain/sheet-import';
import { canonProductType } from '../lib/domain/product';
import { composeVehicleName, MIRROR_ALIAS } from '../lib/domain/mirror-sheet-mapping';
import { snapColor } from '../lib/domain/color-master';
import { MIRROR_SOURCES } from '../lib/domain/mirror-sources';
import { sheetIdFromUrl } from '../lib/domain/supplier-sheet-read';

const APPLY = process.argv.includes('--apply');
const CODE = (process.argv.find((a) => a.startsWith('--code='))?.split('=')[1] || 'RP004').trim();
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/\s+/g, '');

// Firestore 먼저 — 원천 레지스트리(partner.sheet_url)와 원자를 여기서 읽는다.
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();

// 원천 종류 셋 — 시트(공급사 구글시트) · 홈피(ironrentcar.com) · 손오공(API 덤프 JSON).
type Kind = 'sheet' | 'iron' | 'sonokong';
const SON_CODE = 'RP012';
async function srcConfig(): Promise<{ code: string; name: string; kind: Kind; from?: string }> {
  if (CODE === SON_CODE || CODE === 'SONOKONG' || CODE === '손오공') return { code: SON_CODE, name: '손오공', kind: 'sonokong' };
  const m = MIRROR_SOURCES.find((x) => x.code === CODE);
  if (m) return { code: m.code, name: m.name, kind: m.kind as Kind, from: m.from };
  // 나머지 공급사 = v4/partners(→ Firestore partner 그림자)에 등록된 sheet_url 을 원천으로.
  const snap = await fs.collection('partner').where('partner_code', '==', CODE).limit(1).get();
  const p = snap.docs[0]?.data() as { name?: string; sheet_url?: string } | undefined;
  const id = sheetIdFromUrl(p?.sheet_url);
  if (id) return { code: CODE, name: S(p?.name) || CODE, kind: 'sheet', from: id };
  throw new Error(`${CODE}: MIRROR_SOURCES·손오공·partner.sheet_url 어디에도 원천이 없다 — 수동/일회성 공급사`);
}
const src = await srcConfig();
const PROV = src.code;   // Firestore 태깅·pin 조회는 공급사 정식 코드로(손오공=RP012)
const SHEET = src.from || '';

// ── 마스터 ────────────────────────────────────────────────────────────────
const masterRaw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as unknown;
const MASTER = ((Array.isArray(masterRaw) ? masterRaw : (masterRaw as { entries?: MasterEntry[] }).entries) || []) as MasterEntry[];
const SUB = new Map<string, { maker: string; model: string; sub_model: string }>();
for (const e of MASTER) {
  const mk = S(e.maker), mo = S(e.model), sm = S(e.sub_model);
  if (!mk || !mo || !sm) continue;
  for (const a of makerGroup(N(mk))) SUB.set(`${a}|${N(mo)}|${N(sm)}`, { maker: mk, model: mo, sub_model: sm });
}
const validCanon = (maker: unknown, model: unknown, sub: unknown) => {
  const mo = N(model), sm = N(sub); if (!mo || !sm) return null;
  for (const a of makerGroup(N(maker))) { const hit = SUB.get(`${a}|${mo}|${sm}`); if (hit) return hit; }
  return null;
};
const yearOf = (firstReg: string) => {
  const s = S(firstReg);
  const full = s.match(/(20\d{2}|19\d{2})/); if (full) return full[1];
  const yy = s.match(/^\s*(\d{2})[.\-/]/); return yy ? `20${yy[1]}` : '';
};

// ── 원본 열 자동 해석 (MIRROR_ALIAS) ───────────────────────────────────────
const aliasOf = (our: string) => MIRROR_ALIAS.find(([k]) => k === our)?.[1] || [our];
function resolveCols(hdr: string[]) {
  const H = hdr.map(N);
  const find = (cands: string[]) => { for (const c of cands) { const i = H.indexOf(N(c)); if (i >= 0) return i; } return -1; };
  return {
    status: find(aliasOf('상태')), car: find(aliasOf('차량번호')), kind: find(aliasOf('분류')),
    model: find(aliasOf('모델명')), trim: find(['트림', '세부트림']), maker: find(aliasOf('제조사')),
    fuel: find(aliasOf('연료')), ext: find(aliasOf('외부색상')), int: find(aliasOf('내부색상')),
    km: find(aliasOf('주행거리')), opt: find(aliasOf('옵션')), firstReg: find(aliasOf('최초등록일')),
    cc: find(aliasOf('배기량')), klass: find(['차급', '차종크기', '차급분류', '차종분류']),
  };
}

// ── 원천 리더 — 종류마다 «우리필드 키 행(Row)»을 낸다. 원자화는 하나로 공유한다. ──────
type Row = { car: string; status: string; kind: string; maker: string; model: string; vname: string; trim: string; fuel: string; ext: string; int: string; km: string; opt: string; firstReg: string; cc: string; klass: string; tab: string; row: string };
const blank: Omit<Row, 'car' | 'tab' | 'row'> = { status: '', kind: '', maker: '', model: '', vname: '', trim: '', fuel: '', ext: '', int: '', km: '', opt: '', firstReg: '', cc: '', klass: '' };

async function readRows(): Promise<Row[]> {
  const out: Row[] = [];
  const seen = new Set<string>();
  const push = (o: Partial<Row> & { car: string; tab: string; row: string }) => {
    if (!o.car || seen.has(o.car)) return; seen.add(o.car);
    out.push({ ...blank, ...o });
  };
  if (src.kind === 'iron') {
    const { rowsFromIronCatalog } = await import('../lib/domain/mirror-iron-source');
    const got = await rowsFromIronCatalog();
    console.log(`  원본 ironrentcar.com — 목록 ${got.listings} · 활성 ${got.active} · 판매완료 ${got.sold} · 상세실패 ${got.errors}`);
    const g = (m: Map<string, string>, col: string) => S(m.get(N(col)));
    for (const [plate, m] of got.rows) push({ car: g(m, '차량번호') || plate, status: g(m, '상태'), kind: g(m, '분류'), maker: g(m, '제조사'), model: g(m, '모델명'), vname: g(m, '차명(세부모델+트림)'), fuel: g(m, '연료'), ext: g(m, '외부색상'), int: g(m, '내부색상'), km: g(m, '주행거리'), opt: g(m, '옵션'), firstReg: g(m, '최초등록일') || g(m, '연식'), cc: g(m, '배기량'), klass: g(m, '분류'), tab: 'ironrentcar.com', row: plate });
    return out;
  }
  if (src.kind === 'sonokong') {
    const dump = JSON.parse(readFileSync('sonokong/lib/wonja/손오공차량.json', 'utf8')) as { 차량?: Record<string, unknown>[] };
    const cars = dump.차량 || [];
    console.log(`  원본 손오공 API 덤프 — ${cars.length}대`);
    for (const c of cars) {
      const car = S(c.차번); if (!car) continue;
      const status = c.계약중 ? '계약중' : (S(c.계약가능) === 'Y' ? '출고가능' : '출고협의');
      push({ car, status, kind: c.중고 ? '중고구독' : '', maker: S(c.제조사), model: S(c.모델), vname: S(c.차명) || S(c.세부), fuel: S(c.연료), ext: S(c.외장), int: S(c.내장), km: c.주행거리 == null ? '' : String(c.주행거리), opt: S(c.옵션), firstReg: S(c.최초등록) || S(c.연식), cc: c.배기량 == null ? '' : String(c.배기량), klass: '', tab: '손오공API', row: S(c.id) });
    }
    return out;
  }
  // 시트형 — 탭·머리행 자동탐지 후 MIRROR_ALIAS 로 열 해석.
  const tabs = await listSheetTabs(SHEET);
  for (const tab of tabs) {
    const grid = await readSheetGrid(SHEET, tab);
    const allRows = [grid.header, ...grid.rows];
    let hi = -1;
    for (let k = 0; k < Math.min(allRows.length, 8); k++) { const c = resolveCols(allRows[k]); if (c.car >= 0 && c.status >= 0) { hi = k; break; } }
    if (hi < 0) continue;
    const ci = resolveCols(allRows[hi]);
    let rowNo = hi + 1;
    for (const r of allRows.slice(hi + 1)) {
      rowNo += 1;
      const car = S(r[ci.car]); if (!car) continue;
      const model = ci.model >= 0 ? S(r[ci.model]) : '';
      const trim = ci.trim >= 0 ? S(r[ci.trim]) : '';
      push({ car, status: S(r[ci.status]), kind: ci.kind >= 0 ? S(r[ci.kind]) : '', maker: ci.maker >= 0 ? S(r[ci.maker]) : '', model, vname: composeVehicleName(model, trim), trim, fuel: ci.fuel >= 0 ? S(r[ci.fuel]) : '', ext: ci.ext >= 0 ? S(r[ci.ext]) : '', int: ci.int >= 0 ? S(r[ci.int]) : '', km: ci.km >= 0 ? S(r[ci.km]) : '', opt: ci.opt >= 0 ? S(r[ci.opt]) : '', firstReg: ci.firstReg >= 0 ? S(r[ci.firstReg]) : '', cc: ci.cc >= 0 ? S(r[ci.cc]) : '', klass: ci.klass >= 0 ? S(r[ci.klass]) : '', tab, row: String(rowNo) });
    }
  }
  return out;
}

// ── 원자화 (pin: 차번으로 박은 것 지킴) — 원천 종류 무관하게 하나로 ────────────
type Atom = Record<string, unknown> & { car_number: string };
function atomize(row: Row, pinned: Map<string, Record<string, unknown>>): Atom {
  const car = row.car, vname = row.vname;
  const pin = pinned.get(car);
  const pinConfirmed = !!pin && !!S(pin.sub_model) && (pin.확정 === true || S(pin.검수상태) === '확정');
  let identity: { maker: string; model: string; sub_model: string; trim_name: string; origin: string };
  let confirmed: boolean;
  let state: 'pinned' | 'new-high' | 'new-review';
  let spec: Record<string, string>;
  if (pinConfirmed && pin) {
    identity = { maker: S(pin.maker), model: S(pin.model), sub_model: S(pin.sub_model), trim_name: S(pin.trim_name), origin: S(pin.origin) };
    confirmed = true; state = 'pinned';
    spec = { ext_color: S(pin.ext_color), int_color: S(pin.int_color), year: S(pin.year), fuel_type: S(pin.fuel_type), engine_cc: S(pin.engine_cc), vehicle_class: S(pin.vehicle_class), first_registration_date: S(pin.first_registration_date) };
  } else {
    const snap = snapToMaster({ maker: row.maker, model: row.model, vehicle_name: vname, sub_model: vname, fuel_type: row.fuel, year: yearOf(row.firstReg) } as EntityRecord, MASTER) as
      { maker?: string; model?: string; sub_model?: string; trim_name?: string; origin?: string; confidence?: string } | null;
    const canon = snap ? validCanon(snap.maker, snap.model, snap.sub_model) : null;
    const conf = snap?.confidence || 'none';
    confirmed = !!canon && conf === 'high';
    identity = canon
      ? { maker: canon.maker, model: canon.model, sub_model: canon.sub_model, trim_name: S(snap?.trim_name) || row.trim, origin: S(snap?.origin) }
      : { maker: row.maker, model: row.model, sub_model: '', trim_name: row.trim, origin: '' };
    state = confirmed ? 'new-high' : 'new-review';
    spec = {
      ext_color: snapColor(row.ext, 'ext'), int_color: snapColor(row.int, 'int'),
      year: yearOf(row.firstReg), fuel_type: normFuel(row.fuel),
      engine_cc: row.cc, vehicle_class: row.klass, first_registration_date: row.firstReg,
    };
  }
  return {
    car_number: car,
    maker: identity.maker, model: identity.model, sub_model: identity.sub_model, trim_name: identity.trim_name, origin: identity.origin, ...spec,
    product_type: canonProductType(row.kind),
    status: canonSheetVehicleStatus(row.status), mileage: row.km, options: row.opt,
    확정: confirmed, 검수상태: confirmed ? '확정' : (identity.sub_model ? '검수대기' : (vname ? '매칭실패' : '원문없음')),
    _pin_state: state,
    원문: { 차명: vname, ...(row.opt ? { 옵션: row.opt } : null) },
    provider_company_code: PROV, partner_code: PROV,
    source: src.kind, source_schema: PROV, sheet_source_tab: row.tab, sheet_source_row: row.row,
  };
}

async function ingest(pinned: Map<string, Record<string, unknown>>): Promise<Atom[]> {
  const rows = await readRows();
  return rows.map((r) => atomize(r, pinned));
}

// ── 현행 원자(우리 것) — 차번별 pin 정본 ───────────────────────────────────
const cur = new Map<string, Record<string, unknown>>();
{
  const snap = await fs.collection('products').where('provider_company_code', '==', PROV).get();
  for (const d of snap.docs) cur.set(S((d.data() as { car_number?: unknown }).car_number), d.data() as Record<string, unknown>);
}

const now = await ingest(cur);
console.log(`\n■ ${PROV}(${src.name}) 원천 직접 수집 — ${now.length}대 (정제시트 안 거침 · 우리 것 ${cur.size}대 참조)`);
const n = now.length || 1;
const pctOf = (x: number) => `${x}/${now.length} (${Math.round((x / n) * 100)}%)`;
const has = (f: string) => now.filter((a) => S(a[f])).length;
const byPin: Record<string, number> = {};
for (const a of now) byPin[S(a._pin_state)] = (byPin[S(a._pin_state)] || 0) + 1;
console.log(`  정체 출처: 박은 것 그대로 ${byPin.pinned || 0} · 새 차 자동확정 ${byPin['new-high'] || 0} · 새 차 검수필요 ${byPin['new-review'] || 0}`);
console.log(`  세부모델 ${pctOf(has('sub_model'))} · 세부트림 ${pctOf(has('trim_name'))} · 제조사 ${pctOf(has('maker'))} · 연식 ${pctOf(has('year'))} · 연료 ${pctOf(has('fuel_type'))}`);
console.log(`  외장색 ${pctOf(has('ext_color'))} · 내장색 ${pctOf(has('int_color'))} · 배기량 ${pctOf(has('engine_cc'))} · 상태 ${pctOf(has('status'))} · 주행 ${pctOf(has('mileage'))}`);

// 대조 (아는 차 = 우리 것과 같아야)
const IDF = ['maker', 'model', 'sub_model', 'trim_name', 'ext_color', 'int_color', 'year', 'fuel_type'] as const;
const ingestedCars = new Set(now.map((a) => a.car_number));
let both = 0, idSame = 0;
for (const a of now) { const c = cur.get(a.car_number); if (!c) continue; both++; if (IDF.every((f) => N(a[f]) === N(c[f]))) idSame++; }
const gone = [...cur.keys()].filter((k) => !ingestedCars.has(k)); // 우리 것엔 있는데 원천에서 사라진 차
const fresh = now.filter((a) => !cur.has(a.car_number)).length; // 원천엔 있는데 우리 것에 없던 새 차
console.log(`  대조: 아는 차 불변일치 ${both ? Math.round((idSame / both) * 100) : 0}% (${idSame}/${both}) · 새 차 ${fresh} · 사라진 차(정리대상) ${gone.length}`);

if (!APPLY) { console.log(`\n미리보기 — Firestore 안 씀. 쓰려면 --apply.`); process.exit(0); }

// ── 반영 — 불변 merge(pin) + (--retire 일 때만) 사라진 차 listable=false ──
// ⚠ 사라진-차 마킹은 오탐이 곧 «차가 사라져 보임»이라 별도 플래그(--retire)로만. 안전판도 함께:
//   수집분이 우리 것의 절반도 안 되면(원천 읽기 실패 의심) 마킹하지 않는다.
const RETIRE = process.argv.includes('--retire');
const safeToRetire = RETIRE && (cur.size === 0 || now.length >= cur.size * 0.5);
const docId = (car: string) => car.replace(/\s/g, '').replace(/[/#.$[\]]/g, '_');
let wrote = 0, retired = 0;
for (let i = 0; i < now.length; i += 400) {
  const batch = fs.batch();
  for (const a of now.slice(i, i + 400)) {
    const { status, mileage, ...invariant } = a; void status; void mileage; // 변동은 폴링 몫
    batch.set(fs.collection('products').doc(docId(a.car_number)), { ...invariant, listable: true, _direct_ingest_at: Date.now() }, { merge: true });
    wrote++;
  }
  await batch.commit();
}
if (safeToRetire && gone.length) {
  for (let i = 0; i < gone.length; i += 400) {
    const batch = fs.batch();
    for (const car of gone.slice(i, i + 400)) { batch.set(fs.collection('products').doc(docId(car)), { listable: false, status_reason: '원천 이탈(직접수집)', _direct_ingest_at: Date.now() }, { merge: true }); retired++; }
    await batch.commit();
  }
} else if (gone.length) {
  console.log(`  · 사라진 차 ${gone.length}건 마킹 안 함 — ${RETIRE ? `안전판(수집 ${now.length} < 우리 것 ${cur.size}의 절반, 원천 읽기 의심)` : '--retire 없음(오탐 방지, 기본 끔)'}.`);
}
console.log(`\n반영 완료 — ${PROV} 직접 원자 ${wrote}건 merge(불변) · 사라진 차 listable=false ${retired}건. 변동(상태·요금·주행)은 폴링 몫.`);
process.exit(0);
