/**
 * 차종 오매칭(원본 model ↔ 스냅 model) 전수 분류 + 재스냅.
 *
 * audit-snap-fidelity 의 «다른 차로 붙음»에는 정상 보강(그랜져→그랜저, 벤츠E→E-클래스)이
 * 섞인다. 여기서는 브랜드가 바뀌거나 계열이 다른 **사고**만 골라 `_raw_vehicle` 기준으로
 * 다시 스냅한다(apply-remsnap-backlog 과 같은 입력 규칙).
 *
 *   npx tsx scripts/fix-snap-brand-misfit.mts           # 분류+dry-run
 *   npx tsx scripts/fix-snap-brand-misfit.mts --apply   # v4 패치
 *
 * 백업 권장: BACKUP_STAMP=… npx tsx scripts/backup-products.mts
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { snapToMaster, applySnap, type MasterEntry } from '../lib/domain/vehicle-master-match';
import { isListableProduct } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || !!r?.deletedAt || S(r?.status) === 'deleted';
const norm = (v: unknown) => S(v).toLowerCase().replace(/[\s\-_]/g, '');

/** vehicle-master-match MODEL_ALIAS 와 동일 취지 + fidelity 보강 */
const MODEL_ALIAS: Record<string, string> = {
  e클래스: 'e-클래스', e클라스: 'e-클래스', 벤츠e: 'e-클래스', 벤츠e클래스: 'e-클래스',
  c클래스: 'c-클래스', s클래스: 's-클래스', a클래스: 'a-클래스',
  팰리: '팰리세이드', 아반데: '아반떼', 그랜져: '그랜저', 소나타: '쏘나타',
  펠리세이드: '팰리세이드', bmw5: '5시리즈', '5': '5시리즈',
};

const BRAND_OF_MODEL: Array<{ re: RegExp; brand: string }> = [
  { re: /^(k5|k7|k8|k9|모닝|레이|쏘렌토|카니발|셀토스|스포티지|니로|스팅어|EV6|EV9)/i, brand: '기아' },
  { re: /^(아반떼|쏘나타|그랜저|그랜져|투싼|싼타페|팰리|아이오닉|캐스퍼|스타리아|베뉴|코나|제네시스|G80|G90|GV70|GV80|로체)/i, brand: '현대' },
  { re: /^(벤츠|e클래스|c클래스|s클래스|eqe|eqs)/i, brand: '벤츠' },
  { re: /^(bmw|5시리즈|3시리즈|x[1-7])/i, brand: 'BMW' },
  { re: /^(아우디|a[1-8]|q[2-8]|e-tron)/i, brand: '아우디' },
  { re: /^(캐딜락|xt[456]|에스컬레이드)/i, brand: '캐딜락' },
  { re: /^(테슬라|모델)/i, brand: '테슬라' },
  { re: /^(폭스바겐|파사트|티구안|골프)/i, brand: '폭스바겐' },
];

const BRAND_GROUP: Record<string, string> = {
  현대: '현대', 현대자동차: '현대', hyundai: '현대',
  기아: '기아', 기아자동차: '기아', kia: '기아',
  제네시스: '현대', genesis: '현대',
  벤츠: '벤츠', 메르세데스: '벤츠', mercedes: '벤츠', 'mercedes-benz': '벤츠',
  bmw: 'BMW', 비엠더블유: 'BMW',
  아우디: '아우디', audi: '아우디',
  캐딜락: '캐딜락', cadillac: '캐딜락',
  테슬라: '테슬라', tesla: '테슬라',
  폭스바겐: '폭스바겐', volkswagen: '폭스바겐', vw: '폭스바겐',
};

function brandKey(v: unknown): string {
  const n = norm(v);
  if (!n) return '';
  for (const [k, g] of Object.entries(BRAND_GROUP)) if (n.includes(norm(k))) return g;
  return n;
}

function brandFromModel(model: string): string {
  const m = S(model);
  for (const { re, brand } of BRAND_OF_MODEL) if (re.test(m.replace(/\s/g, ''))) return brand;
  return '';
}

function canonModel(v: unknown): string {
  let n = norm(v);
  n = MODEL_ALIAS[n] ?? n;
  for (const [a, c] of Object.entries(MODEL_ALIAS)) {
    if (n.includes(a)) n = n.replace(a, norm(c));
  }
  return n;
}

/** 원본 model 이 스냅 model/sub 계열인가 (보강·표기정리 허용) */
function sameFamily(rawModel: string, snapModel: string, snapSub: string): boolean {
  const rm = canonModel(rawModel);
  const sm = canonModel(snapModel);
  const ss = canonModel(snapSub);
  if (!rm) return false;
  if (sm === rm || ss === rm) return true;
  if (sm.includes(rm) || rm.includes(sm) || ss.includes(rm) || rm.includes(ss)) return true;
  // «벤츠E» / «BMW 5» 처럼 메이커+약어
  const stripped = rm
    .replace(/^(벤츠|bmw|아우디|현대|기아|캐딜락|테슬라|폭스바겐)/, '');
  if (stripped && (sm.includes(stripped) || ss.includes(stripped) || stripped.includes(sm))) return true;
  return false;
}

const IDENTITY_ATOMS = ['maker', 'model', 'sub_model', 'trim_name', 'variant'] as const;
/**
 * 재스냅 입력 — 옛 스냅 신원은 버리고 `_raw_vehicle` 만.
 * 원본에 제조사가 비어 모델만 있으면(빌린카) 모델→브랜드 추론을 넣어
 * «아우디 K5» 같은 오염 없이 매처가 맞게 붙게 한다.
 */
function resnapInput(p: Rec): EntityRecord {
  const raw = (p._raw_vehicle && typeof p._raw_vehicle === 'object' ? p._raw_vehicle : {}) as Rec;
  const input: Rec = { ...p, ...raw };
  for (const f of IDENTITY_ATOMS) {
    if (!(f in raw) || S(raw[f]) === '') delete input[f];
  }
  // 틀린 스냅이 남긴 catalog_id 는 재매칭을 왜곡한다.
  delete input.catalog_id;
  if (!S(input.maker) && S(input.model)) {
    const guessed = brandFromModel(String(input.model));
    if (guessed) input.maker = guessed;
  }
  // «벤츠 E클래스» 처럼 모델 칸에 메이커가 섞인 경우 — 모델만 남긴다.
  const m = S(input.model);
  if (/^벤츠\s*/i.test(m)) {
    input.maker = input.maker || '벤츠';
    input.model = m.replace(/^벤츠\s*/i, '').trim() || m;
  }
  return input as EntityRecord;
}

const SNAP_FIELDS = [
  'maker', 'model', 'sub_model', 'catalog_id', 'gen_year_start', 'gen_year_end',
  'variant', 'trim_name', 'trim_extra', 'fuel_type', 'engine_cc', 'seats', 'drive_type',
  'year', 'vehicle_class',
  '_raw_vehicle', '_snapped', '_snap_confidence', '_snap_history', '_snap_at', '_needs_master_review',
  '_snap_defaults',
] as const;

type Kind = 'ok_enrich' | 'brand_swap' | 'wrong_model' | 'weak_raw';

async function main() {
  const apply = process.argv.includes('--apply');
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const entries = (() => {
    const d = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8'));
    const e = (d.entries || d) as MasterEntry[];
    if (!Array.isArray(e) || !e.length) throw new Error('차종마스터 비어 있음');
    return e;
  })();

  const products = ((await db.ref('v4/products').get()).val() || {}) as Record<string, Rec>;

  type Row = {
    key: string; plate: string; kind: Kind;
    rawMaker: string; rawModel: string; snapMaker: string; snapModel: string; snapSub: string;
    conf: string; provider: string;
    next?: { maker: string; model: string; sub: string; conf: string; review: boolean };
  };
  const rows: Row[] = [];

  for (const [key, p] of Object.entries(products)) {
    if (!p || typeof p !== 'object' || dead(p) || !isListableProduct(p as never)) continue;
    const raw = (p._raw_vehicle && typeof p._raw_vehicle === 'object' ? p._raw_vehicle : null) as Rec | null;
    if (!raw) continue;
    const rawModel = S(raw.model);
    if (!rawModel) continue;
    if (sameFamily(rawModel, S(p.model), S(p.sub_model))) continue;

    const rawMaker = S(raw.maker) || brandFromModel(rawModel);
    const snapMaker = S(p.maker);
    const rb = brandKey(rawMaker) || brandFromModel(rawModel);
    const sb = brandKey(snapMaker);
    let kind: Kind = 'wrong_model';
    if (!rb) kind = 'weak_raw';
    else if (sb && rb !== sb) kind = 'brand_swap';
    else kind = 'wrong_model';

    rows.push({
      key, plate: S(p.car_number) || key,
      kind,
      rawMaker: S(raw.maker), rawModel,
      snapMaker, snapModel: S(p.model), snapSub: S(p.sub_model),
      conf: S(p._snap_confidence), provider: S(p.provider_company_code),
    });
  }

  // 사고 건만 재스냅 미리보기 — 브랜드 바뀜 우선. 같은 브랜드 계열애매(캐딜락→XT6)는 자동 반영 안 함.
  const accidents = rows.filter((r) => r.kind === 'brand_swap');
  const skipAuto = rows.filter((r) => r.kind === 'wrong_model');
  let wouldWrite = 0;
  let stayLow = 0;
  let stillBad = 0;
  let fixed = 0;

  for (const r of accidents) {
    const p = products[r.key];
    const input = resnapInput(p);
    const res = snapToMaster(input, entries);
    if (!res || (res.confidence !== 'high' && res.confidence !== 'medium')) {
      stayLow++;
      r.next = { maker: '', model: '', sub: '', conf: res?.confidence || 'none', review: true };
      continue;
    }
    const after = applySnap(input, res, { source: 'fix-brand-misfit' });
    r.next = {
      maker: S(after.maker), model: S(after.model), sub: S(after.sub_model),
      conf: S(after._snap_confidence), review: after._needs_master_review === true,
    };
    const ok = sameFamily(r.rawModel, r.next.model, r.next.sub)
      || (brandKey(r.next.maker) === (brandKey(r.rawMaker) || brandFromModel(r.rawModel)));
    if (ok) { fixed++; wouldWrite++; }
    else { stillBad++; wouldWrite++; }
  }

  console.log(`\n══ 차종 오매칭 분류 ${apply ? '반영' : 'dry-run'} ══\n`);
  console.log(`  fidelity «다른 차» 재분류 ${rows.length}대`);
  const byKind = (k: Kind) => rows.filter((r) => r.kind === k);
  console.log(`  · brand_swap(브랜드 바뀜)  ${byKind('brand_swap').length}`);
  console.log(`  · wrong_model(계열 다름)   ${byKind('wrong_model').length}  ← 자동반영 제외`);
  console.log(`  · weak_raw(원본 약함)      ${byKind('weak_raw').length}`);
  console.log(`\n  재스냅 대상(brand_swap) ${accidents.length} · high/medium ${wouldWrite} · low유지 ${stayLow} · 계열애매 ${stillBad}`);
  if (skipAuto.length) {
    console.log(`  (참고) wrong_model ${skipAuto.length}대는 브랜드 동일·원본 약함 — 사람이 볼 것`);
  }

  const show = (title: string, list: Row[]) => {
    if (!list.length) return;
    console.log(`\n■ ${title}`);
    for (const r of list) {
      const n = r.next
        ? ` → 재스냅 «${r.next.maker} ${r.next.model} ${r.next.sub}» (${r.next.conf})`
        : '';
      console.log(
        `  ${r.plate.padEnd(10)} ${r.provider.padEnd(8)} `
        + `원본«${r.rawMaker} ${r.rawModel}» → 지금«${r.snapMaker} ${r.snapModel} ${r.snapSub}»${n}`,
      );
    }
  };
  show('브랜드 바뀜 (brand_swap)', byKind('brand_swap'));
  show('계열 다름 (wrong_model)', byKind('wrong_model'));
  show('원본 약함 (weak_raw) — 자동 반영 안 함', byKind('weak_raw'));

  mkdirSync('tmp', { recursive: true });
  writeFileSync('tmp/fix-snap-brand-misfit.json', JSON.stringify({ at: new Date().toISOString(), rows, accidents: accidents.length }, null, 2));

  if (!apply) {
    console.log(`\n※ dry-run. 반영: npx tsx scripts/fix-snap-brand-misfit.mts --apply`);
    console.log(`   백업: BACKUP_STAMP=20260808-pre-brand-misfit npx tsx scripts/backup-products.mts\n`);
    return;
  }

  // 백업 스냅샷(패치 키만)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  mkdirSync('tmp/migration-backups', { recursive: true });
  const backup: Rec = {};
  let written = 0;
  let quarantined = 0;
  const errors: string[] = [];

  for (const r of accidents) {
    const p = products[r.key];
    const input = resnapInput(p);
    const res = snapToMaster(input, entries);
    const before: Rec = {};
    for (const f of SNAP_FIELDS) before[f] = p[f] ?? null;
    backup[r.key] = before;

    try {
      if (res && (res.confidence === 'high' || res.confidence === 'medium')) {
        const after = applySnap(input, res, { source: 'fix-brand-misfit' });
        const patch: Rec = {};
        for (const f of SNAP_FIELDS) {
          if (after[f] !== undefined) patch[f] = after[f];
          else if (f === '_snap_defaults') patch[f] = null;
        }
        await db.ref(`v4/products/${r.key}`).update(patch);
        written++;
      } else {
        // low — 틀린 브랜드를 손님 화면에 두지 않는다. 원본+추론 제조사만 남기고 검수.
        const maker = S(input.maker) || brandFromModel(S(input.model) || r.rawModel) || null;
        const model = S(input.model) || r.rawModel || null;
        await db.ref(`v4/products/${r.key}`).update({
          maker,
          model,
          sub_model: null,
          catalog_id: null,
          variant: null,
          trim_name: null,
          _snapped: false,
          _snap_confidence: 'none',
          _needs_master_review: true,
          _snap_at: Date.now(),
        });
        quarantined++;
      }
    } catch (e) {
      errors.push(`${r.key}: ${(e as Error).message}`);
    }
  }
  writeFileSync(`tmp/migration-backups/${stamp}-brand-misfit-before.json`, JSON.stringify(backup, null, 2));
  console.log(`\n  반영(고신뢰) ${written}대 · 검수격리(low) ${quarantined}대`);
  console.log(`  백업 tmp/migration-backups/${stamp}-brand-misfit-before.json`);
  if (errors.length) {
    console.log(`  ❌ ${errors.length}`);
    for (const e of errors.slice(0, 8)) console.log('   ' + e);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
