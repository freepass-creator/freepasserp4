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
const won = (v: unknown) => { const n = Number(S(v).replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };
type Price = Record<string, { rent: number; deposit: number }>;
const PERIOD_ALIAS: [string, string[]][] = [['1', ['1개월', '월렌트', '월세']], ['6', ['6개월']], ['12', ['12개월']], ['18', ['18개월']], ['24', ['24개월']], ['36', ['36개월']], ['48', ['48개월']], ['60', ['60개월']]];

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
// 세부모델 → 마스터 트림 목록 (검증용). 별칭 제조사 전개.
const TRIMS = new Map<string, string[]>();
for (const e of MASTER) {
  if (!e.trims?.length) continue;
  for (const a of makerGroup(N(e.maker))) TRIMS.set(`${a}|${N(e.model)}|${N(e.sub_model)}`, e.trims);
}
const trimsFor = (maker: unknown, model: unknown, sub: unknown) => {
  for (const a of makerGroup(N(maker))) { const t = TRIMS.get(`${a}|${N(model)}|${N(sub)}`); if (t) return t; }
  return [];
};

// (제조사별칭|모델) → 세대들 — 수입차 세대 판별용(섀시코드·연식범위).
const GENS = new Map<string, { sub: string; gen: string; ys: number; ye: number }[]>();
for (const e of MASTER) {
  const g = N(S((e as { gen_code?: string }).gen_code)); if (!g) continue;
  const ys = Number((e as { year_start?: unknown }).year_start) || 0, ye = Number((e as { year_end?: unknown }).year_end) || 9999;
  for (const a of makerGroup(N(e.maker))) { const k = `${a}|${N(e.model)}`; if (!GENS.has(k)) GENS.set(k, []); GENS.get(k)!.push({ sub: S(e.sub_model), gen: g, ys, ye }); }
}
const regYearMonth = (s: string): [number, number] => {
  const m = S(s).match(/(20\d{2}|19\d{2})[.\-/](\d{1,2})/); if (m) return [Number(m[1]), Number(m[2])];
  const y = yearOf(s); return [Number(y) || 0, 0];
};
/**
 * ★수입차 세대 판별 — 우선순위:
 *   ① 원문에 섀시코드(W213·G30·F40…) → snap 이 이미 반영, 그대로. (가장 확실)
 *   ② 표기 없음(수입차 흔함) → 최초등록으로 신형 판별(구형 단종 뒤 신규등록=신형). E-클래스 2024=W214.
 *   국산차는 원문에 세대코드(CN7…)가 있어 ①에서 걸린다 — 최초등록 추론까지 안 간다(안전판).
 *
 * ⚠ 원문의 「N세대」 숫자는 «안» 쓴다 — 시장은 브랜드 시작(E-클래스=W124)부터 세는데 마스터는 그 이전
 *    (W123…)까지 담아 순번이 어긋난다(6세대: 시장=W214 · 마스터순번=W213). 그 숫자로 매핑하면 틀린다
 *    (사장님 2026-09-04 「6세대 214라고 확인된다」). 섀시코드·최초등록만 믿는다.
 */
function resolveGen(maker: unknown, model: unknown, curSub: string, firstReg: string, rawN: string): string {
  let gens: { sub: string; gen: string; ys: number; ye: number }[] = [];
  for (const a of makerGroup(N(maker))) { const g = GENS.get(`${a}|${N(model)}`); if (g) { gens = g; break; } }
  if (gens.length < 2) return curSub;
  if (gens.some((g) => g.gen.length >= 3 && rawN.includes(g.gen))) return curSub; // ① 원문에 섀시코드 → 그대로
  const [ry, rm] = regYearMonth(firstReg); if (!ry) return curSub;                 // ② 최초등록으로 신형 판별
  const cands = gens.filter((g) => g.ys <= ry && ry <= g.ye).sort((a, b) => b.ys - a.ys);
  if (!cands.length || N(cands[0].sub) === N(curSub)) return curSub;
  if (ry === cands[0].ys && rm && rm < 7) return curSub; // 교체연도 상반기면 애매 → snap 유지
  return cands[0].sub;
}
const yearOf = (firstReg: string) => {
  const s = S(firstReg);
  const full = s.match(/(20\d{2}|19\d{2})/); if (full) return full[1];
  const yy = s.match(/^\s*(\d{2})[.\-/]/); return yy ? `20${yy[1]}` : '';
};

// ★전기차 배기량 청소 — «원천 연료»가 전기·수소면 배기량은 없다(내연 형제의 998·1580cc 가 샌 것).
//   ⚠ 세부모델 «이름»(일렉트리파이드 등)으로는 «판단하지 않는다» — 이름이 오매핑될 수 있다.
//     실측 2026-09-05: 원문 「가솔린 2.5 G80」이 세부모델 「일렉트리파이드 G80」으로 잘못 붙어 있었다.
//     이름을 믿고 연료를 전기로 바꾸면 가솔린차를 가짜 전기차로 만든다. 원천 연료만 믿는다.
const FUEL_EV = /^(전기|수소)$|\bev\b|electric|fcev/i;
const evEngineCc = (fuel: string, cc: string): string => (FUEL_EV.test(fuel) ? '' : cc);

// 상태 디테일 — mirror-to-firestore 와 «같은» 분류(한 값에 안 뭉침). status·status_kind·status_reason·listable.
const AVAIL = new Set(['즉시출고', '출고가능']);
function statusDetail(rawStatus: string, locked?: unknown) {
  const raw = S(rawStatus);
  let cur = canonSheetVehicleStatus(raw) || '차량검수';
  if (/계약중/.test(raw)) cur = '계약중';
  else if (/점검|검수|정비/.test(raw)) cur = '차량검수';
  let kind = '불가', reason = '';
  if (cur === '즉시출고' || cur === '출고가능') kind = '가용';
  else if (cur === '출고협의') { kind = '협의'; reason = '공급사협의'; }
  else if (cur === '상품화중') { kind = '준비'; reason = '상품화중'; }
  else if (cur === '차량검수') { kind = '준비'; reason = '검수대기'; }
  else if (cur === '계약중') { kind = '선점'; reason = locked ? '계약선점' : '공급사표기'; }
  else if (cur === '출고불가') { kind = '불가'; reason = (AVAIL.has(raw) || raw === '출고협의') ? '시트이탈' : (raw ? '공급사불가' : '정보없음'); }
  return { status: cur, status_kind: kind, status_reason: reason, listable: kind !== '불가', status_label_raw: raw };
}

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
    dep: find(['장기보증', '보증금']), periods: Object.fromEntries(PERIOD_ALIAS.map(([k, c]) => [k, find(c)])) as Record<string, number>,
  };
}
// 시트/홈피 행에서 요금 = {개월: {rent, deposit}}. rent=개월열(원화) · deposit=장기보증(무보증=0, 전 기간 공통).
function sheetPrice(get: (i: number) => string, ci: { dep: number; periods: Record<string, number> }): Price {
  const dep = won(ci.dep >= 0 ? get(ci.dep) : '');
  const price: Price = {};
  for (const [pk, idx] of Object.entries(ci.periods)) { if (idx < 0) continue; const rent = won(get(idx)); if (rent > 0) price[pk] = { rent, deposit: dep }; }
  return price;
}

// ── 원천 리더 — 종류마다 «우리필드 키 행(Row)»을 낸다. 원자화는 하나로 공유한다. ──────
type Row = { car: string; status: string; kind: string; maker: string; model: string; vname: string; trim: string; fuel: string; ext: string; int: string; km: string; opt: string; firstReg: string; cc: string; klass: string; price: Price; tab: string; row: string };
const blank: Omit<Row, 'car' | 'tab' | 'row'> = { status: '', kind: '', maker: '', model: '', vname: '', trim: '', fuel: '', ext: '', int: '', km: '', opt: '', firstReg: '', cc: '', klass: '', price: {} };

// 번호판 꼴만 차로 본다 — 헤더 밑 제목·프로모 배너·빈 행이 «차»로 새는 걸 막는다(오토플러스 실측).
const isPlate = (s: string) => /\d{2,3}\s*[가-힣]\s*\d{4}/.test(S(s));
async function readRows(): Promise<Row[]> {
  const out: Row[] = [];
  const seen = new Set<string>();
  const push = (o: Partial<Row> & { car: string; tab: string; row: string }) => {
    if (!o.car || seen.has(o.car) || !isPlate(o.car)) return; seen.add(o.car);
    out.push({ ...blank, ...o });
  };
  if (src.kind === 'iron') {
    const { rowsFromIronCatalog } = await import('../lib/domain/mirror-iron-source');
    const got = await rowsFromIronCatalog();
    console.log(`  원본 ironrentcar.com — 목록 ${got.listings} · 활성 ${got.active} · 판매완료 ${got.sold} · 상세실패 ${got.errors}`);
    const g = (m: Map<string, string>, col: string) => S(m.get(N(col)));
    for (const [plate, m] of got.rows) {
      const dep = won(g(m, '장기보증')); const price: Price = {};
      for (const [pk, cands] of PERIOD_ALIAS) { for (const c of cands) { const rent = won(g(m, c)); if (rent > 0) { price[pk] = { rent, deposit: dep }; break; } } }
      push({ car: g(m, '차량번호') || plate, status: g(m, '상태'), kind: g(m, '분류'), maker: g(m, '제조사'), model: g(m, '모델명'), vname: g(m, '차명(세부모델+트림)'), fuel: g(m, '연료'), ext: g(m, '외부색상'), int: g(m, '내부색상'), km: g(m, '주행거리'), opt: g(m, '옵션'), firstReg: g(m, '최초등록일') || g(m, '연식'), cc: g(m, '배기량'), klass: g(m, '분류'), price, tab: 'ironrentcar.com', row: plate });
    }
    return out;
  }
  if (src.kind === 'sonokong') {
    const dump = JSON.parse(readFileSync('sonokong/lib/wonja/손오공차량.json', 'utf8')) as { 차량?: Record<string, unknown>[] };
    const cars = dump.차량 || [];
    console.log(`  원본 손오공 API 덤프 — ${cars.length}대`);
    for (const c of cars) {
      const car = S(c.차번); if (!car) continue;
      const status = c.계약중 ? '계약중' : (S(c.계약가능) === 'Y' ? '출고가능' : '출고협의');
      // 요금 = 저신용월납. RETURN=반납형(개월키) · BUYOUT=인수형(개월_인수형). deposit=(개월/12)×rent(현행 규칙).
      const price: Price = {};
      const low = (c.저신용월납 || {}) as { SUBSCRIBE_RETURN?: Record<string, number>; SUBSCRIBE_BUYOUT?: Record<string, number> };
      for (const [p, rent] of Object.entries(low.SUBSCRIBE_RETURN || {})) { const r = won(rent); if (r > 0) price[p] = { rent: r, deposit: Math.round((Number(p) / 12) * r) }; }
      for (const [p, rent] of Object.entries(low.SUBSCRIBE_BUYOUT || {})) { const r = won(rent); if (r > 0) price[`${p}_인수형`] = { rent: r, deposit: Math.round((Number(p) / 12) * r) }; }
      push({ car, status, kind: c.중고 ? '중고구독' : '', maker: S(c.제조사), model: S(c.모델), vname: S(c.차명) || S(c.세부), fuel: S(c.연료), ext: S(c.외장), int: S(c.내장), km: c.주행거리 == null ? '' : String(c.주행거리), opt: S(c.옵션), firstReg: S(c.최초등록) || S(c.연식), cc: c.배기량 == null ? '' : String(c.배기량), klass: '', price, tab: '손오공API', row: S(c.id) });
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
      const price = sheetPrice((i) => S(r[i]), ci);
      push({ car, status: S(r[ci.status]), kind: ci.kind >= 0 ? S(r[ci.kind]) : '', maker: ci.maker >= 0 ? S(r[ci.maker]) : '', model, vname: composeVehicleName(model, trim), trim, fuel: ci.fuel >= 0 ? S(r[ci.fuel]) : '', ext: ci.ext >= 0 ? S(r[ci.ext]) : '', int: ci.int >= 0 ? S(r[ci.int]) : '', km: ci.km >= 0 ? S(r[ci.km]) : '', opt: ci.opt >= 0 ? S(r[ci.opt]) : '', firstReg: ci.firstReg >= 0 ? S(r[ci.firstReg]) : '', cc: ci.cc >= 0 ? S(r[ci.cc]) : '', klass: ci.klass >= 0 ? S(r[ci.klass]) : '', price, tab, row: String(rowNo) });
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
    // ★세대 판별 — 원문의 「N세대」·섀시코드가 답, 없으면 최초등록으로 신형.
    if (canon) identity.sub_model = resolveGen(identity.maker, identity.model, identity.sub_model, row.firstReg, N(vname));
    state = confirmed ? 'new-high' : 'new-review';
    spec = {
      ext_color: snapColor(row.ext, 'ext'), int_color: snapColor(row.int, 'int'),
      year: yearOf(row.firstReg), fuel_type: normFuel(row.fuel),
      engine_cc: row.cc, vehicle_class: row.klass, first_registration_date: row.firstReg,
    };
  }
  return {
    car_number: car,
    maker: identity.maker, model: identity.model, sub_model: identity.sub_model, trim_name: identity.trim_name, origin: identity.origin, ...spec, engine_cc: evEngineCc(S(spec.fuel_type), S(spec.engine_cc)),
    product_type: canonProductType(row.kind),
    ...statusDetail(row.status, pin?.locked_by_contract), mileage: row.km, options: row.opt,
    ...(Object.keys(row.price).length ? { price: row.price } : null),
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
let both = 0, idSame = 0, priceSame = 0, priceBoth = 0;
// 깊은 정렬 JSON — 안쪽 {rent,deposit} 키 순서 차이로 «다르다」 오판하지 않게(현행은 {deposit,rent}).
const jsonP = (o: unknown) => JSON.stringify(o ?? {}, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort()) : v);
for (const a of now) {
  const c = cur.get(a.car_number); if (!c) continue; both++;
  if (IDF.every((f) => N(a[f]) === N(c[f]))) idSame++;
  if (Object.keys(a.price).length && c.price) { priceBoth++; if (jsonP(a.price) === jsonP(c.price)) priceSame++; }
}
const gone = [...cur.keys()].filter((k) => !ingestedCars.has(k)); // 우리 것엔 있는데 원천에서 사라진 차
const fresh = now.filter((a) => !cur.has(a.car_number)).length; // 원천엔 있는데 우리 것에 없던 새 차
console.log(`  대조: 아는 차 불변일치 ${both ? Math.round((idSame / both) * 100) : 0}% (${idSame}/${both}) · 새 차 ${fresh} · 사라진 차(정리대상) ${gone.length}`);
console.log(`  요금 일치: ${priceBoth ? Math.round((priceSame / priceBoth) * 100) : 0}% (${priceSame}/${priceBoth}, 양쪽에 요금 있는 차)`);

const VARIABLE = process.argv.includes('--variable');
const docId = (car: string) => car.replace(/\s/g, '').replace(/[/#.$[\]]/g, '_');
const VAR_FIELDS = ['status', 'status_kind', 'status_reason', 'listable', 'status_label_raw', 'mileage', 'price'] as const;

// ── 검증(--verify) — 원자를 «차종마스터 ↔ 원문»과 대조. 제대로 당겼나 한 번 본다. ──
if (process.argv.includes('--verify')) {
  let mValid = 0, mOut = 0, tMatch = 0, tOut = 0, tEmpty = 0, rawMiss = 0;
  const outL: string[] = [], tOutL: string[] = [], rawL: string[] = [];
  for (const a of now) {
    const raw = S((a.원문 as { 차명?: string })?.차명);
    const label = `${a.car_number} 「${raw.slice(0, 30)}」 → ${a.maker} ${a.model}/${a.sub_model}/${S(a.trim_name) || '(트림공백)'}`;
    const valid = !!validCanon(a.maker, a.model, a.sub_model);
    if (valid) mValid++; else { mOut++; if (outL.length < 15) outL.push('  ✗마스터밖 ' + label); }
    const trims = trimsFor(a.maker, a.model, a.sub_model);
    const t = S(a.trim_name);
    if (!t) tEmpty++;
    else if (trims.some((x) => N(x) === N(t))) tMatch++;
    else { tOut++; if (tOutL.length < 15) tOutL.push(`  ✗트림밖 ${a.car_number} 트림「${t}」 ∉ [${trims.slice(0, 6).join('·') || '마스터 트림없음'}]`); }
    // 원문 대조 — 세부모델의 마스터 표기 핵심 글자가 원문에 없으면 오매칭 의심.
    if (valid && N(a.model) && raw && !N(raw).includes(N(a.model))) { rawMiss++; if (rawL.length < 15) rawL.push('  ?원문불일치 ' + label); }
  }
  console.log(`\n■ 검증 (차종마스터 ↔ 원문) — ${PROV}(${src.name}) ${now.length}대`);
  console.log(`  마스터 유효: ${mValid}/${now.length} (${Math.round((mValid / (now.length || 1)) * 100)}%) · 마스터 밖 ${mOut}`);
  console.log(`  트림: 마스터트림 일치 ${tMatch} · 트림있는데 마스터밖 ${tOut} · 트림공백 ${tEmpty}`);
  console.log(`  원문에 모델글자 없음(오매칭 의심) ${rawMiss}`);
  for (const l of outL) console.log(l);
  for (const l of tOutL) console.log(l);
  for (const l of rawL) console.log(l);
  process.exit(0);
}

if (!APPLY) { console.log(`\n미리보기 — Firestore 안 씀. 쓰려면 --apply${VARIABLE ? '(변동만)' : ''}.`); process.exit(0); }

// ── 변동 폴링(--variable) — 아는 차의 상태·주행만 delta. 불변은 «절대» 안 건드린다. ──
//   사장님 「한 번 정확히 가져오면 그 다음은 상태값만 읽어 바뀐 거 체크. 제일 바뀌는 게 차량상태.」
if (VARIABLE) {
  const items = now.filter((a) => cur.has(a.car_number)); // 아는 차만(새 차는 --apply 몫)
  let changed = 0, sChg = 0, mChg = 0, pChg = 0;
  for (let i = 0; i < items.length; i += 400) {
    const batch = fs.batch(); let any = false;
    for (const a of items.slice(i, i + 400)) {
      const c = cur.get(a.car_number)!;
      const jsonSorted = (o: unknown) => JSON.stringify(o ?? {}, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort()) : v);
      const sMoved = S(a.status) !== S(c.status) || a.listable !== c.listable || S(a.status_kind) !== S(c.status_kind);
      const mMoved = S(a.mileage) !== S(c.mileage);
      const pMoved = Object.keys(a.price).length > 0 && jsonSorted(a.price) !== jsonSorted(c.price);
      if (!sMoved && !mMoved && !pMoved) continue;
      const upd: Record<string, unknown> = { _var_polled_at: Date.now() };
      for (const f of VAR_FIELDS) if (a[f] !== undefined) upd[f] = a[f];
      batch.set(fs.collection('products').doc(docId(a.car_number)), upd, { merge: true });
      changed++; if (sMoved) sChg++; if (mMoved) mChg++; if (pMoved) pChg++; any = true;
    }
    if (any) await batch.commit();
  }
  console.log(`\n변동 폴링 완료 — ${PROV} 아는 차 ${items.length} 중 바뀐 ${changed} 씀 (상태 ${sChg} · 주행 ${mChg} · 요금 ${pChg}). 불변 안 건드림.`);
  process.exit(0);
}

// ── 전체 반영(불변+상태) = «한 번 정확히» + (--retire 일 때만) 사라진 차 listable=false ──
// ⚠ 사라진-차 마킹은 오탐이 곧 «차가 사라져 보임»이라 별도 플래그(--retire)로만. 안전판도 함께:
//   수집분이 우리 것의 절반도 안 되면(원천 읽기 실패 의심) 마킹하지 않는다.
const RETIRE = process.argv.includes('--retire');
const safeToRetire = RETIRE && (cur.size === 0 || now.length >= cur.size * 0.5);
let wrote = 0, retired = 0;
for (let i = 0; i < now.length; i += 400) {
  const batch = fs.batch();
  for (const a of now.slice(i, i + 400)) {
    const { _pin_state, ...doc } = a; void _pin_state;
    batch.set(fs.collection('products').doc(docId(a.car_number)), { ...doc, _direct_ingest_at: Date.now() }, { merge: true });
    wrote++;
  }
  await batch.commit();
}
if (safeToRetire && gone.length) {
  // ★계약중(락 걸린) 차는 «안» 내린다 — 원천에서 잠깐 빠져도 진행 중인 거래를 숨기면 안 된다.
  const locked = gone.filter((car) => { const c = cur.get(car) || {}; return S(c.status) === '계약중' || S(c.status_kind) === '선점' || S(c.locked_by_contract) || S(c.vehicle_status) === '계약중'; });
  const toRetire = gone.filter((car) => !locked.includes(car));
  for (let i = 0; i < toRetire.length; i += 400) {
    const batch = fs.batch();
    for (const car of toRetire.slice(i, i + 400)) { batch.set(fs.collection('products').doc(docId(car)), { listable: false, status_reason: '원천 이탈(직접수집)', _direct_ingest_at: Date.now() }, { merge: true }); retired++; }
    await batch.commit();
  }
  if (locked.length) console.log(`  · 사라진 차 중 계약중(락) ${locked.length}건은 안 내림(거래 진행중).`);
} else if (gone.length) {
  console.log(`  · 사라진 차 ${gone.length}건 마킹 안 함 — ${RETIRE ? `안전판(수집 ${now.length} < 우리 것 ${cur.size}의 절반, 원천 읽기 의심)` : '--retire 없음(오탐 방지, 기본 끔)'}.`);
}
console.log(`\n반영 완료 — ${PROV} 직접 원자 ${wrote}건 merge(불변+상태) · 사라진 차 listable=false ${retired}건. 요금은 별도(가격블록).`);
process.exit(0);
