/**
 * 인피니티로 잘못 남은 BMW 3대(+동일 패턴) 정리.
 *
 * EXT_* 살아 있는 키에 인피니티 I30 이 박혀 있고,
 * 삭제된 RP023_{차번} shadow 에 올바른 BMW high 스냅이 남아 있다(_merged_into → EXT).
 * 원문만으로 재스냅하면 「BMW 120i」가 X3 로 새는 low 가 나와서,
 * shadow 의 확정 신원 필드를 EXT 로 되돌린다.
 *
 *   npx tsx scripts/fix-infiniti-bmw-mismatch.mts
 *   npx tsx scripts/fix-infiniti-bmw-mismatch.mts --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { snapToMaster, applySnap, type MasterEntry } from '../lib/domain/vehicle-master-match';
import { isOfferableProduct } from '../lib/domain/product';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || !!r?.deletedAt || S(r?.status) === 'deleted';
const APPLY = process.argv.includes('--apply');
const PLATES = new Set(['133라1401', '192머7372', '321라9324']);
const BMW_TELL = /xDrive|M\s?스포츠|\b\d{3}i\b|BMW|비엠|1시리즈|2시리즈/i;

const COPY_FIELDS = [
  'maker', 'model', 'sub_model', 'catalog_id', 'gen_year_start', 'gen_year_end',
  'variant', 'trim_name', 'trim_extra', 'fuel_type', 'engine_cc', 'seats', 'drive_type',
  'year', 'vehicle_class',
  '_raw_vehicle', '_snapped', '_snap_confidence', '_snap_history', '_snap_at',
] as const;

function isWrongInfiniti(p: Rec): boolean {
  if (!/인피니티|인피티니|infiniti/i.test(S(p.maker))) return false;
  const pl = S(p.car_number).replace(/\s/g, '');
  if (PLATES.has(pl)) return true;
  const blob = [S(p.model), S(p.sub_model), S(p.trim_name), JSON.stringify(p._raw_vehicle || {})].join(' ');
  return BMW_TELL.test(blob) || S(p.model) === 'I' || /^I30$/i.test(S(p.sub_model));
}

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

/** plate → shadow (삭제된 RP023_*) */
const shadowByPlate = new Map<string, { key: string; rec: Rec }>();
for (const [k, p] of Object.entries(products)) {
  if (!p || typeof p !== 'object') continue;
  if (!dead(p)) continue;
  if (!/^RP023_/.test(k)) continue;
  if (!/BMW/i.test(S(p.maker))) continue;
  const pl = k.replace(/^RP023_/, '').replace(/\s/g, '');
  if (pl) shadowByPlate.set(pl, { key: k, rec: p });
  const into = S(p._merged_into);
  if (into) shadowByPlate.set(`into:${into}`, { key: k, rec: p });
}

const targets = Object.entries(products)
  .filter(([, p]) => p && !dead(p) && isOfferableProduct(p as any) && isWrongInfiniti(p));

const report: string[] = [];
const log = (...a: unknown[]) => { const line = a.map(String).join(' '); report.push(line); console.log(line); };

log(`\n══ 인피니티←BMW 정리 ${APPLY ? '반영' : '미리보기'} ══`);
log(`대상 ${targets.length}대 · BMW shadow ${shadowByPlate.size}건\n`);

let ok = 0;
let skip = 0;
let written = 0;
const errors: string[] = [];

for (const [key, p] of targets) {
  const pl = S(p.car_number).replace(/\s/g, '');
  const before = `${S(p.maker)} / ${S(p.model)} / ${S(p.sub_model)} / ${S(p.variant)} / ${S(p.trim_name)}`;
  const shadow = shadowByPlate.get(pl) || shadowByPlate.get(`into:${key}`);

  let patch: Rec | null = null;
  let how = '';

  if (shadow && /BMW/i.test(S(shadow.rec.maker))) {
    patch = {};
    for (const f of COPY_FIELDS) {
      if (shadow.rec[f] !== undefined) patch[f] = shadow.rec[f];
    }
    // shadow trim 이 비고 raw 에만 있으면 채움
    if (!S(patch.trim_name) && shadow.rec._raw_vehicle?.trim_name) {
      patch.trim_name = shadow.rec._raw_vehicle.trim_name;
    }
    if (shadow.rec._raw_vehicle) patch._raw_vehicle = shadow.rec._raw_vehicle;
    patch._needs_master_review = null;
    patch._snapped = true;
    patch._snap_confidence = shadow.rec._snap_confidence || 'high';
    how = `shadow ${shadow.key}`;
  } else {
    // fallback: shadow raw 또는 정제 입력으로 재스냅
    const raw = (shadow?.rec?._raw_vehicle || p._raw_vehicle || {}) as Rec;
    const input: Rec = {
      fuel_type: S(raw.fuel_type) || S(p.fuel_type),
      year: S(raw.year) || S(p.year),
      maker: S(raw.maker) || undefined,
      model: S(raw.model) || undefined,
      sub_model: S(raw.sub_model) || undefined,
      trim_name: S(raw.trim_name) || undefined,
      variant: S(raw.variant) || undefined,
    };
    // 「BMW 120i」단독은 X3 로 샐 수 있어, maker 토큰이면 maker+N시리즈로 올린다
    const m = /BMW\s*([1-8])\d{2}\s*i/i.exec(S(input.model));
    if (m) {
      input.maker = 'BMW';
      input.model = `${m[1]}시리즈`;
    }
    const res = snapToMaster(input as any, entries);
    if (!res || (res.confidence !== 'high' && res.confidence !== 'medium')) {
      skip++;
      log(`SKIP ${pl || key} conf=${res?.confidence || 'none'} before=${before}`);
      continue;
    }
    const after = applySnap(input as any, res, { source: 'fix-infiniti-bmw' }) as Rec;
    if (/인피니티|infiniti/i.test(S(after.maker))) {
      skip++;
      log(`SKIP-inf ${pl || key}`);
      continue;
    }
    patch = {};
    for (const f of COPY_FIELDS) if (after[f] !== undefined) patch[f] = after[f];
    patch._raw_vehicle = Object.keys(raw).length ? raw : after._raw_vehicle;
    patch._needs_master_review = null;
    how = `resnap ${res.confidence}`;
  }

  if (!patch || !/BMW/i.test(S(patch.maker))) {
    skip++;
    log(`SKIP-no-bmw ${pl || key}`);
    continue;
  }

  const afterLabel = `${S(patch.maker)} / ${S(patch.model)} / ${S(patch.sub_model)} / ${S(patch.variant)} / ${S(patch.trim_name)}`;
  ok++;
  log(`${APPLY ? 'WRITE' : 'PLAN'} ${pl.padEnd(10)} ${before}`);
  log(`       → ${afterLabel}  (${how})`);

  if (!APPLY) continue;
  try {
    await db.ref(`v4/products/${key}`).update(patch);
    written++;
  } catch (e) {
    errors.push(`${key}: ${(e as Error)?.message || String(e)}`);
  }
}

log(`\nok ${ok} · skip ${skip} · written ${written}`);
if (errors.length) {
  log(`errors ${errors.length}`);
  for (const e of errors) log(' ', e);
}

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/fix-infiniti-bmw-mismatch.txt', `${report.join('\n')}\n`, 'utf8');
log(APPLY ? '\n끝. 재확인: npx tsx scripts/audit-maker-mismatch.mts' : '\n※ dry-run. 반영은 --apply');
process.exit(errors.length ? 1 : 0);
