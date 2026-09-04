/**
 * 아이카(RP004) «원천 직접 → Firestore 원자화» 파일럿 — 정제시트를 안 거친다.
 *
 * 사장님 2026-09-04 「정제 필요 없고, 공급사가 입력하는 곳에서 네가 직접 따서 원자화하고 상품시트에
 *   뿌린다. 정제를 파이어베이스에서.」 · 「한 번만 정확히 가져오면 이건 동일하잖아. 그 다음부턴
 *   상태값만 읽어 바뀐 거 체크. 제일 바뀌는 게 차량상태, 그 다음 대여료·주행거리.」
 *
 * 이 스크립트가 증명하는 것: 아이카 «원본 시트»를 직접 읽어 코드가 정제·원자화하면,
 *   지금 정제시트를 거쳐 만든 Firestore 원자와 «같은가».  같으면 이 공급사에선 정제시트를 걷어도 된다.
 *
 * 기본 = 대조(dry-run, Firestore 읽기만). --apply 로만 Firestore products 에 쓴다(불변+렌더 merge).
 *   변동(상태·요금·주행)은 매시간 따로 폴링할 몫이라 여기선 «한 번» 불변 원자화에 집중한다.
 *
 * 실행:
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json \
 *     npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/ingest-aica-to-firestore.mts
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
import { composeVehicleName } from '../lib/domain/mirror-sheet-mapping';
import { snapColor } from '../lib/domain/color-master';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => S(v).toLowerCase().replace(/\s+/g, '');
const SRC = '1LqWVs2o1-wpPqFiYkOjcQldmIXqtBMKYp0A1SKEir5w'; // 아이카 원본
const CODE = 'RP004';
const CAR_TABS = new Set(['장기특별이벤트', '중고재렌트', '신차선출고']); // 요금표(월렌트)·수수료는 차 목록 아님

// ── 마스터(불변 매칭 근거) ────────────────────────────────────────────────
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
/** 최초등록 → 연식. 아이카 원본은 «YY-M-D»(26-5-22)라 두 자리 연도를 20YY 로. 네 자리면 그대로. */
const yearOf = (firstReg: string) => {
  const s = S(firstReg);
  const full = s.match(/(20\d{2}|19\d{2})/); if (full) return full[1];
  const yy = s.match(/^\s*(\d{2})[.\-/]/); return yy ? `20${yy[1]}` : '';
};

// ── 원천 직접 읽기 → 원자 ──────────────────────────────────────────────────
type Atom = Record<string, unknown> & { car_number: string };
async function ingest(): Promise<Atom[]> {
  const tabs = (await listSheetTabs(SRC)).filter((t) => CAR_TABS.has(t));
  const atoms: Atom[] = [];
  const seen = new Set<string>();
  for (const tab of tabs) {
    const grid = await readSheetGrid(SRC, tab);
    const hdr = grid.header.map(N);
    const col = (name: string) => hdr.indexOf(N(name));
    const ci = {
      status: col('배차상태'), kind: col('구분'), car: col('차량번호'), klass: col('차급'),
      model: col('차종분류'), trim: col('트림'), fuel: col('연료'), ext: col('외장'), int: col('내장'),
      km: col('Km'), opt: col('옵션'), firstReg: col('최초등록'), cc: col('배기량'), maker: col('제조사'),
    };
    let rowNo = 1; // 머리행이 1
    for (const r of grid.rows) {
      rowNo += 1;
      const car = S(r[ci.car]); if (!car || seen.has(car)) continue; seen.add(car);
      const rawModel = S(r[ci.model]);
      const rawTrim = S(r[ci.trim]);
      const maker = S(r[ci.maker]);
      const vname = composeVehicleName(rawModel, rawTrim); // 차종분류 + 트림 → 차명(원문)
      // 불변 정체 = 마스터 매칭(정제시트 경로와 같은 snapToMaster).
      const snap = snapToMaster({ maker, model: rawModel, vehicle_name: vname, sub_model: vname, fuel_type: S(r[ci.fuel]), year: yearOf(S(r[ci.firstReg])) } as EntityRecord, MASTER) as
        { maker?: string; model?: string; sub_model?: string; trim_name?: string; origin?: string; confidence?: string } | null;
      const canon = snap ? validCanon(snap.maker, snap.model, snap.sub_model) : null;
      const conf = snap?.confidence || 'none';
      const confirmed = !!canon && (conf === 'high');
      const identity = canon
        ? { maker: canon.maker, model: canon.model, sub_model: canon.sub_model, trim_name: S(snap?.trim_name) || rawTrim, origin: S(snap?.origin) }
        : { maker, model: rawModel, sub_model: '', trim_name: rawTrim, origin: '' };
      atoms.push({
        car_number: car,
        // 불변
        maker: identity.maker, model: identity.model, sub_model: identity.sub_model, trim_name: identity.trim_name,
        origin: identity.origin, ext_color: snapColor(S(r[ci.ext]), 'ext'), int_color: snapColor(S(r[ci.int]), 'int'), year: yearOf(S(r[ci.firstReg])),
        fuel_type: normFuel(S(r[ci.fuel])), engine_cc: S(r[ci.cc]), vehicle_class: S(r[ci.klass]),
        first_registration_date: S(r[ci.firstReg]),
        product_type: canonProductType(S(r[ci.kind])),
        // 변동(참고 — 대조용. 매시간 폴링이 정본)
        status: canonSheetVehicleStatus(S(r[ci.status])), mileage: S(r[ci.km]),
        options: S(r[ci.opt]),
        // 원자화 메타 + 정밀타격(어디서 왔나)
        확정: confirmed, 검수상태: confirmed ? '확정' : (identity.sub_model ? '검수대기' : (vname ? '매칭실패' : '원문없음')),
        원문: { 차명: vname, ...(S(r[ci.opt]) ? { 옵션: S(r[ci.opt]) } : null) },
        provider_company_code: CODE, partner_code: CODE,
        source: 'sheet', source_schema: CODE, sheet_source_tab: tab, sheet_source_row: String(rowNo),
      });
    }
  }
  return atoms;
}

// ── 현행 Firestore 아이카 원자(정제시트 경로) ─────────────────────────────
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore();

const now = await ingest();
console.log(`■ 원천 직접 수집 — 아이카 원본에서 ${now.length}대 (정제시트 안 거침)`);
const confN = now.filter((a) => a.확정).length;
console.log(`  확정(마스터 high) ${confN} · 검수대기/실패 ${now.length - confN}`);

const cur = new Map<string, Record<string, unknown>>();
const snap = await fs.collection('products').where('provider_company_code', '==', CODE).get();
for (const d of snap.docs) cur.set(S((d.data() as { car_number?: unknown }).car_number), d.data() as Record<string, unknown>);
console.log(`■ 현행 Firestore 아이카 원자 ${cur.size}대`);

// ── 대조: 「이건 동일하잖아」 ──────────────────────────────────────────────
const IDF = ['maker', 'model', 'sub_model', 'trim_name', 'ext_color', 'int_color', 'year', 'fuel_type'] as const;
let both = 0, idSame = 0, statusSame = 0;
const diffs: string[] = [];
const onlyNew: string[] = [];
for (const a of now) {
  const c = cur.get(a.car_number);
  if (!c) { onlyNew.push(a.car_number); continue; }
  both++;
  const bad = IDF.filter((f) => N(a[f]) !== N(c[f]));
  if (!bad.length) idSame++;
  else if (diffs.length < 15) diffs.push(`  ≠ ${a.car_number}: ${bad.map((f) => `${f}[직:${S(a[f])}|현:${S(c[f])}]`).join(' ')}`);
  if (N(a.status) === N(c.status)) statusSame++;
}
const onlyCur = [...cur.keys()].filter((k) => !now.some((a) => a.car_number === k));
console.log(`\n■ 대조 (직접 ↔ 현행)`);
console.log(`  둘 다 있는 차 ${both} · 직접에만 ${onlyNew.length} · 현행에만 ${onlyCur.length}`);
console.log(`  불변 8필드 완전일치 ${idSame}/${both} (${both ? Math.round((idSame / both) * 100) : 0}%)`);
console.log(`  상태 일치 ${statusSame}/${both}`);
if (diffs.length) { console.log('  불변 어긋남 표본:'); for (const d of diffs) console.log(d); }
if (onlyNew.length) console.log(`  직접에만(현행 없음) 표본: ${onlyNew.slice(0, 8).join(' · ')}`);
if (onlyCur.length) console.log(`  현행에만(원천 없음) 표본: ${onlyCur.slice(0, 8).join(' · ')}`);

if (!APPLY) { console.log(`\n미리보기 — Firestore 안 씀. 쓰려면 --apply (불변+렌더 merge, 변동은 폴링 몫).`); process.exit(0); }
let w = 0;
for (let i = 0; i < now.length; i += 400) {
  const batch = fs.batch();
  for (const a of now.slice(i, i + 400)) {
    const id = a.car_number.replace(/\s/g, '').replace(/[/#.$[\]]/g, '_');
    const { status, mileage, ...invariant } = a; // 변동은 폴링이 쓴다 — 여기선 불변만 merge
    void status; void mileage;
    batch.set(fs.collection('products').doc(id), { ...invariant, _direct_ingest_at: Date.now() }, { merge: true });
    w++;
  }
  await batch.commit();
}
console.log(`\n반영 완료 — 직접 원자 ${w}건 merge(불변). 변동은 매시간 폴링.`);
process.exit(0);
