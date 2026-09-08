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
async function ingest(pinned: Map<string, Record<string, unknown>>): Promise<Atom[]> {
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

      // ★차량번호로 «우리가 박아둔 것»을 먼저 본다. 있으면 그대로 — 원천 텍스트를 다시 snap하지 않는다.
      //   차번은 영구 키라, 한 번 마스터와 맞춰 확정하면 그 차의 정체는 안 바뀐다(틀릴 일이 없다).
      const pin = pinned.get(car);
      const pinConfirmed = !!pin && !!S(pin.sub_model) && (pin.확정 === true || S(pin.검수상태) === '확정');
      let identity: { maker: string; model: string; sub_model: string; trim_name: string; origin: string };
      let confirmed: boolean;
      let state: 'pinned' | 'new-high' | 'new-review';
      let spec: Record<string, string>;
      if (pinConfirmed && pin) {
        identity = { maker: S(pin.maker), model: S(pin.model), sub_model: S(pin.sub_model), trim_name: S(pin.trim_name), origin: S(pin.origin) };
        confirmed = true; state = 'pinned';
        // 불변 스펙(색·연식·연료·배기…)도 박아둔 우리 값을 지킨다.
        spec = { ext_color: S(pin.ext_color), int_color: S(pin.int_color), year: S(pin.year), fuel_type: S(pin.fuel_type), engine_cc: S(pin.engine_cc), vehicle_class: S(pin.vehicle_class), first_registration_date: S(pin.first_registration_date) };
      } else {
        // 새 차(또는 미확정) → 차종마스터 첫 학습. high 아니면 검수대기(사람이 한 번 확인해 박는다).
        const snap = snapToMaster({ maker, model: rawModel, vehicle_name: vname, sub_model: vname, fuel_type: S(r[ci.fuel]), year: yearOf(S(r[ci.firstReg])) } as EntityRecord, MASTER) as
          { maker?: string; model?: string; sub_model?: string; trim_name?: string; origin?: string; confidence?: string } | null;
        const canon = snap ? validCanon(snap.maker, snap.model, snap.sub_model) : null;
        const conf = snap?.confidence || 'none';
        confirmed = !!canon && conf === 'high';
        identity = canon
          ? { maker: canon.maker, model: canon.model, sub_model: canon.sub_model, trim_name: S(snap?.trim_name) || rawTrim, origin: S(snap?.origin) }
          : { maker, model: rawModel, sub_model: '', trim_name: rawTrim, origin: '' };
        state = 'new-review'; if (confirmed) state = 'new-high';
        spec = { ext_color: snapColor(S(r[ci.ext]), 'ext'), int_color: snapColor(S(r[ci.int]), 'int'), year: yearOf(S(r[ci.firstReg])), fuel_type: normFuel(S(r[ci.fuel])), engine_cc: S(r[ci.cc]), vehicle_class: S(r[ci.klass]), first_registration_date: S(r[ci.firstReg]) };
      }
      atoms.push({
        car_number: car,
        // 불변 (pinned = 우리 것 지킴 · new = 마스터 학습)
        maker: identity.maker, model: identity.model, sub_model: identity.sub_model, trim_name: identity.trim_name,
        origin: identity.origin, ...spec,
        product_type: canonProductType(S(r[ci.kind])),
        // 변동(참고 — 대조용. 매시간 폴링이 정본)
        status: canonSheetVehicleStatus(S(r[ci.status])), mileage: S(r[ci.km]),
        options: S(r[ci.opt]),
        // 원자화 메타 + 정밀타격(어디서 왔나)
        확정: confirmed, 검수상태: confirmed ? '확정' : (identity.sub_model ? '검수대기' : (vname ? '매칭실패' : '원문없음')),
        _pin_state: state,
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

// ★우리 것(차량번호로 박아둔 확정 원자) 먼저 읽는다 — 이게 정체의 정본이다.
const cur = new Map<string, Record<string, unknown>>();
{
  const snap = await fs.collection('products').where('provider_company_code', '==', CODE).get();
  for (const d of snap.docs) cur.set(S((d.data() as { car_number?: unknown }).car_number), d.data() as Record<string, unknown>);
}

const now = await ingest(cur);
console.log(`■ 원천 직접 수집 — 아이카 원본에서 ${now.length}대 (정제시트 안 거침 · 우리 것 ${cur.size}대 참조)`);

// ── 품질 리포트 — 직접 가져오면 «어떤가» ──────────────────────────────────
if (process.argv.includes('--quality') || !process.argv.includes('--apply')) {
  const n = now.length;
  const pct = (x: number) => `${x}/${n} (${Math.round((x / n) * 100)}%)`;
  const has = (f: string) => now.filter((a) => S(a[f])).length;
  const byPin: Record<string, number> = {};
  for (const a of now) byPin[S(a._pin_state)] = (byPin[S(a._pin_state)] || 0) + 1;
  const byState: Record<string, number> = {};
  for (const a of now) byState[S(a.검수상태)] = (byState[S(a.검수상태)] || 0) + 1;
  console.log('\n■ 품질 (직접 원자화)');
  console.log(`  정체 출처: 박은 것 그대로(pinned) ${byPin.pinned || 0} · 새 차 자동확정(new-high) ${byPin['new-high'] || 0} · 새 차 검수필요(new-review) ${byPin['new-review'] || 0}`);
  console.log(`  검수상태: ${Object.entries(byState).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  console.log(`  세부모델(sub_model) 있음 ${pct(has('sub_model'))}`);
  console.log(`  세부트림(trim_name) 있음 ${pct(has('trim_name'))}`);
  console.log(`  제조사 ${pct(has('maker'))} · 연식 ${pct(has('year'))} · 연료 ${pct(has('fuel_type'))} · 배기량 ${pct(has('engine_cc'))}`);
  console.log(`  외장색 ${pct(has('ext_color'))} · 내장색 ${pct(has('int_color'))} · 상태 ${pct(has('status'))} · 주행 ${pct(has('mileage'))}`);
  console.log('  ── 잘 나온 표본(확정) ──');
  for (const a of now.filter((x) => x.확정).slice(0, 6)) console.log(`   ${a.car_number}  ${a.maker} ${a.model} / ${a.sub_model} / ${a.trim_name || '(트림공백)'} · ${a.year} · ${a.ext_color}`);
  console.log('  ── 검수 필요 표본(비확정) ──');
  for (const a of now.filter((x) => !x.확정).slice(0, 8)) console.log(`   ${a.car_number}  [${a.검수상태}] 원문「${S((a.원문 as { 차명?: string })?.차명).slice(0, 30)}」 → ${a.maker || '?'} ${a.model || '?'} / ${a.sub_model || '(세부모델 없음)'} / ${a.trim_name || '(트림 없음)'}`);
}

const confN = now.filter((a) => a.확정).length;
console.log(`\n  확정 ${confN} · 검수대기/실패 ${now.length - confN}`);
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
