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

const APPLY = process.argv.includes('--apply');
const CODE = (process.argv.find((a) => a.startsWith('--code='))?.split('=')[1] || 'RP004').trim();
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/\s+/g, '');

const src = MIRROR_SOURCES.find((m) => m.code === CODE);
if (!src) throw new Error(`MIRROR_SOURCES 에 ${CODE} 없음`);
if (src.kind !== 'sheet' || !src.from) throw new Error(`${CODE}(${src.name})=${src.kind} — 시트형만 지원(홈페이지·API 는 전용 리더 필요)`);
const SHEET = src.from;

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

// ── 원천 직접 읽기 → 원자 (pin: 차번으로 박은 것 지킴) ─────────────────────
type Atom = Record<string, unknown> & { car_number: string };
async function ingest(pinned: Map<string, Record<string, unknown>>): Promise<Atom[]> {
  const tabs = await listSheetTabs(SHEET);
  const atoms: Atom[] = [];
  const seen = new Set<string>();
  for (const tab of tabs) {
    const grid = await readSheetGrid(SHEET, tab);
    // 머리행 자동탐지 — 제목·날짜가 1행에 있고 진짜 머리가 2~3행인 경우(오토플러스)까지 잡는다.
    const allRows = [grid.header, ...grid.rows];
    let hi = -1;
    for (let k = 0; k < Math.min(allRows.length, 8); k++) {
      const c = resolveCols(allRows[k]);
      if (c.car >= 0 && c.status >= 0) { hi = k; break; }
    }
    if (hi < 0) continue; // 차 탭이 아니다(차량번호·상태 없음) — 요금표·수수료 등
    const ci = resolveCols(allRows[hi]);
    let rowNo = hi + 1; // 머리행의 실제 행 번호(1-based)
    for (const r of allRows.slice(hi + 1)) {
      rowNo += 1;
      const car = S(r[ci.car]); if (!car || seen.has(car)) continue; seen.add(car);
      const rawModel = ci.model >= 0 ? S(r[ci.model]) : '';
      const rawTrim = ci.trim >= 0 ? S(r[ci.trim]) : '';
      const maker = ci.maker >= 0 ? S(r[ci.maker]) : '';
      const vname = composeVehicleName(rawModel, rawTrim);

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
        const snap = snapToMaster({ maker, model: rawModel, vehicle_name: vname, sub_model: vname, fuel_type: ci.fuel >= 0 ? S(r[ci.fuel]) : '', year: yearOf(ci.firstReg >= 0 ? S(r[ci.firstReg]) : '') } as EntityRecord, MASTER) as
          { maker?: string; model?: string; sub_model?: string; trim_name?: string; origin?: string; confidence?: string } | null;
        const canon = snap ? validCanon(snap.maker, snap.model, snap.sub_model) : null;
        const conf = snap?.confidence || 'none';
        confirmed = !!canon && conf === 'high';
        identity = canon
          ? { maker: canon.maker, model: canon.model, sub_model: canon.sub_model, trim_name: S(snap?.trim_name) || rawTrim, origin: S(snap?.origin) }
          : { maker, model: rawModel, sub_model: '', trim_name: rawTrim, origin: '' };
        state = confirmed ? 'new-high' : 'new-review';
        spec = {
          ext_color: ci.ext >= 0 ? snapColor(S(r[ci.ext]), 'ext') : '', int_color: ci.int >= 0 ? snapColor(S(r[ci.int]), 'int') : '',
          year: yearOf(ci.firstReg >= 0 ? S(r[ci.firstReg]) : ''), fuel_type: ci.fuel >= 0 ? normFuel(S(r[ci.fuel])) : '',
          engine_cc: ci.cc >= 0 ? S(r[ci.cc]) : '', vehicle_class: ci.klass >= 0 ? S(r[ci.klass]) : '', first_registration_date: ci.firstReg >= 0 ? S(r[ci.firstReg]) : '',
        };
      }
      atoms.push({
        car_number: car,
        maker: identity.maker, model: identity.model, sub_model: identity.sub_model, trim_name: identity.trim_name, origin: identity.origin, ...spec,
        product_type: canonProductType(ci.kind >= 0 ? S(r[ci.kind]) : ''),
        status: canonSheetVehicleStatus(S(r[ci.status])), mileage: ci.km >= 0 ? S(r[ci.km]) : '',
        options: ci.opt >= 0 ? S(r[ci.opt]) : '',
        확정: confirmed, 검수상태: confirmed ? '확정' : (identity.sub_model ? '검수대기' : (vname ? '매칭실패' : '원문없음')),
        _pin_state: state,
        원문: { 차명: vname, ...(ci.opt >= 0 && S(r[ci.opt]) ? { 옵션: S(r[ci.opt]) } : null) },
        provider_company_code: CODE, partner_code: CODE,
        source: 'sheet', source_schema: CODE, sheet_source_tab: tab, sheet_source_row: String(rowNo),
      });
    }
  }
  return atoms;
}

// ── Firestore ──────────────────────────────────────────────────────────────
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();

const cur = new Map<string, Record<string, unknown>>();
{
  const snap = await fs.collection('products').where('provider_company_code', '==', CODE).get();
  for (const d of snap.docs) cur.set(S((d.data() as { car_number?: unknown }).car_number), d.data() as Record<string, unknown>);
}

const now = await ingest(cur);
console.log(`\n■ ${CODE}(${src.name}) 원천 직접 수집 — ${now.length}대 (정제시트 안 거침 · 우리 것 ${cur.size}대 참조)`);
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
console.log(`\n반영 완료 — ${CODE} 직접 원자 ${wrote}건 merge(불변) · 사라진 차 listable=false ${retired}건. 변동(상태·요금·주행)은 폴링 몫.`);
process.exit(0);
