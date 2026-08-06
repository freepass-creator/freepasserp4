/**
 * 검토대기 적체를 «지금 매처»로 재스냅해 반영 — 기본 dry-run, 실제 반영은 --apply.
 *
 * 왜 필요한가: 저장된 레코드가 옛 스냅 결과로 굳어 있다. `_needs_master_review` 인 매물의
 * 제조사·차명이 비어 목록에 «빈 줄»로 뜨고, 그래서 공급사가 올린 상품이 안 보이는 것처럼 보인다.
 * 원본은 `_raw_vehicle` 에 보존돼 있으므로 다시 물리기만 하면 대부분 복구된다.
 *
 * ★안전 계약
 *   · reconcileToMaster(mode='auto') — **high·medium 만 패치**. low·미매칭은 손대지 않는다.
 *   · 입력은 `_raw_vehicle` 우선 병합 — 옛 스냅이 지운 원본 신호를 되살려 넣는다.
 *   · 패치는 레코드당 단일 update. 가격·상태·계약 관련 필드는 스냅 대상이 아니라 그대로 둔다.
 *   · 백업 선행 필수: BACKUP_STAMP=… npx tsx scripts/backup-products.mts
 *
 *   npx tsx scripts/apply-remsnap-backlog.mts            (미리보기)
 *   npx tsx scripts/apply-remsnap-backlog.mts --apply    (반영)
 */
import { readFileSync } from 'node:fs';
import { snapToMaster, applySnap, type MasterEntry } from '../lib/domain/vehicle-master-match';
import { isOfferableProduct } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';

/**
 * 재스냅 입력 — **이전 스냅의 산출물을 증거로 재사용하지 않는다.**
 *
 * 실측(2026-08-06): 빌린카 시트에는 제조사 칸이 아예 없는데 레코드의 `maker` 가 「아우디」였다.
 * 과거의 틀린 스냅이 써넣은 값이다. 그것을 그대로 입력에 두면 매처가 마스터에 없는
 * 「아우디 K5」를 찾다가 실패한다 — 자기 오답을 근거로 다시 쓰는 구조다.
 *
 * 그래서 신원 원자(제조사·모델·세부·트림·variant)는 **원본(`_raw_vehicle`)에 있는 것만** 넘긴다.
 * 원본에 없으면 «수집된 적 없는 신호»이므로 비워서 넘겨야 매처가 억지 추측을 안 한다.
 * 연식·연료·배기 같은 스펙은 원본 우선으로 병합하되 레코드 값도 남긴다(수집 신호일 수 있다).
 */
const IDENTITY_ATOMS = ['maker', 'model', 'sub_model', 'trim_name', 'variant'] as const;

function resnapInput(p: Rec): EntityRecord {
  const raw = (p._raw_vehicle && typeof p._raw_vehicle === 'object' ? p._raw_vehicle : {}) as Rec;
  const input: Rec = { ...p, ...raw };
  for (const f of IDENTITY_ATOMS) {
    if (!(f in raw) || S(raw[f]) === '') delete input[f];
  }
  return input as EntityRecord;
}

/** 스냅이 만지는 필드만 골라 패치한다 — 가격·상태·계약 필드에 손대지 않기 위해. */
const SNAP_FIELDS = [
  'maker', 'model', 'sub_model', 'catalog_id', 'gen_year_start', 'gen_year_end',
  'variant', 'trim_name', 'trim_extra', 'fuel_type', 'engine_cc', 'seats', 'drive_type',
  'year', 'vehicle_class', 'ext_color', 'int_color',
  '_raw_vehicle', '_snapped', '_snap_confidence', '_snap_history', '_snap_at', '_needs_master_review',
] as const;

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
    if (!Array.isArray(e) || !e.length) throw new Error('차종마스터가 비어 있다 — 중단');
    return e;
  })();

  const products = ((await db.ref('v4/products').get()).val() || {}) as Record<string, Rec>;
  const targets = Object.entries(products)
    .filter(([, p]) => !dead(p) && isOfferableProduct(p as any) && p._needs_master_review === true);

  console.log(`\n══ 검토대기 재스냅 ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);
  console.log(`  차종마스터 ${entries.length}세대 · 대상 ${targets.length}대\n`);

  let high = 0, medium = 0, low = 0, unmatched = 0, written = 0;
  const errors: string[] = [];

  for (const [key, p] of targets) {
    const input = resnapInput(p);
    const res = snapToMaster(input, entries);
    if (!res) { unmatched++; continue; }
    if (res.confidence === 'high') high++;
    else if (res.confidence === 'medium') medium++;
    else { low++; continue; }          // ★low 는 반영하지 않는다

    if (!apply) continue;
    const after = applySnap(input, res, { source: 'resnap-backlog' });
    const patch: Rec = {};
    for (const f of SNAP_FIELDS) if (after[f] !== undefined) patch[f] = after[f];
    try {
      await db.ref(`v4/products/${key}`).update(patch);
      written++;
    } catch (e) {
      errors.push(`${key}: ${(e as Error)?.message || String(e)}`);
    }
  }

  console.log(`  high ${high} · medium ${medium}  → 자동확정 ${high + medium}대`);
  console.log(`  low ${low} · 미매칭 ${unmatched}  → 손대지 않음(검토 유지)`);
  if (apply) console.log(`\n  반영 ${written}대`);
  if (errors.length) {
    console.log(`\n  ❌ 오류 ${errors.length}건`);
    for (const e of errors.slice(0, 10)) console.log(`     ${e}`);
  }
  console.log(apply
    ? `\n끝. 확인: npx tsx scripts/audit-master-review-backlog.mts (빈칸 0 이어야 한다)\n`
    : `\n※ dry-run. 반영은 --apply\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
