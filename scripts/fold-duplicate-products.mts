/**
 * 같은 실물이 여러 레코드로 있을 때 하나로 접는다 — 공급사 하나씩.
 *
 * 왜: 번호판이 «키에는 있는데 car_number 필드엔 없는» 레코드는 `vehicleIdentity` 가 null 이라
 * `dedupeProductsByVehicle` 에서 unidentified 로 분류돼 **항상 노출**된다. 그래서 같은 차가
 * 목록에 두 번 뜨고, 그 레코드로 계약하면 원자 선점이 거부된다.
 *
 * 접는 방향(승자 선정)은 **자동으로 정하지 않는다.** 근거를 표로 찍고 사람이 고른다.
 * 실제로 이런 게 섞여 있다 — 같은 번호판인데 한쪽은 「벤츠 E-클래스 W213」, 다른 쪽은
 * 「기아 EV6 CV1」(차종마스터가 트림 문자열에 낚인 오매칭). 자동으로 골랐다간 틀린 쪽을 남긴다.
 *
 * 기본 규칙(`--prefer`):
 *   ext    EXT_ 키를 남긴다(외부 원본이 트림·연료까지 갖고 있는 경우가 많다)
 *   plate  car_number 필드가 실제로 채워진 쪽을 남긴다
 *
 * 안전장치: 계약이 걸린 레코드는 절대 접지 않는다. v3 원본은 건드리지 않고 v4 오버레이에만 쓴다.
 *
 *   npx tsx scripts/fold-duplicate-products.mts --code=PT-0023
 *   ... --apply
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync, writeFileSync } from 'node:fs';
import type { EntityRecord } from '../lib/intake/entities';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: DB });
const db = getDatabase();

const APPLY = process.argv.includes('--apply');
const CODE = (process.argv.find((a) => a.startsWith('--code=')) || '').slice('--code='.length).trim();
const PREFER = ((process.argv.find((a) => a.startsWith('--prefer=')) || '').slice('--prefer='.length).trim() || 'ext') as 'ext' | 'plate';
const S = (v: unknown) => String(v ?? '').trim();
const PLATE = /^(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}$/;

const plateOf = (x: EntityRecord): string => {
  const c = S(x.car_number).replace(/\s/g, '');
  if (c && PLATE.test(c)) return c;
  const m = S(x._key).match(/([0-9]{2,3}[가-힣][0-9]{4})$/);
  return m ? m[1] : '';
};
const priceCount = (x: EntityRecord) => (x.price && typeof x.price === 'object' ? Object.keys(x.price).length : 0);
const mergeNodes = (a: unknown, b: unknown) => {
  const m: Record<string, EntityRecord> = {};
  for (const [k, v] of Object.entries((a || {}) as Record<string, EntityRecord>)) m[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((b || {}) as Record<string, EntityRecord>)) m[k] = { ...(m[k] || {}), ...v, _key: k };
  return m;
};

async function main() {
  if (!CODE) { console.log('--code=<공급사코드> 가 필요하다'); return; }
  const [p3, p4, c3, c4] = await Promise.all([
    db.ref('products').get(), db.ref('v4/products').get(),
    db.ref('contracts').get(), db.ref('v4/contracts').get(),
  ]);
  const products = mergeNodes(p3.val(), p4.val());
  const contracts = mergeNodes(c3.val(), c4.val());
  // ⚠ 빈 문자열을 넣으면 안 된다. product_code 가 빈 계약이 하나라도 있으면
  //   product_code 가 빈 매물이 전부 «계약 걸림»으로 오판돼 접기가 통째로 멈춘다(실제로 그랬다).
  const referenced = new Set(Object.values(contracts)
    .filter((c) => c && c._deleted !== true && S(c.contract_status) !== '계약취소')
    .map((c) => S(c.product_code))
    .filter(Boolean));

  const mine = Object.values(products).filter((x) => x && x._deleted !== true && S(x.status) !== 'deleted'
    && (S(x.provider_company_code) === CODE || S(x._key).startsWith(`${CODE}_`)));
  const groups = new Map<string, EntityRecord[]>();
  for (const x of mine) { const p = plateOf(x); if (!p) continue; if (!groups.has(p)) groups.set(p, []); groups.get(p)!.push(x); }
  const dups = [...groups.entries()].filter(([, v]) => v.length > 1);

  console.log(`\n══ ${CODE} — 중복 접기 (승자 규칙: ${PREFER})`);
  console.log(`보유 ${mine.length}대 · 같은 번호판 그룹 ${dups.length}\n`);
  if (!dups.length) { console.log('접을 것 없음.'); return; }

  const plan: { plate: string; keep: string; fold: string[] }[] = [];
  let blocked = 0;
  for (const [plate, rows] of dups) {
    const pick = (r: EntityRecord) => PREFER === 'ext'
      ? (S(r._key).startsWith('EXT_') ? 1 : 0)
      : (S(r.car_number).replace(/\s/g, '') && PLATE.test(S(r.car_number).replace(/\s/g, '')) ? 1 : 0);
    const sorted = [...rows].sort((a, b) => pick(b) - pick(a) || priceCount(b) - priceCount(a));
    const keep = sorted[0];
    const fold = sorted.slice(1);
    // 계약이 걸린 레코드는 접지 않는다 — 계약이 가리키는 코드가 사라지면 안 된다.
    const held = fold.filter((f) => referenced.has(S(f.product_code)) || referenced.has(S(f._key)));
    if (held.length) {
      blocked++;
      console.log(`  ⏸ ${plate}  계약이 걸린 레코드가 있어 건너뜀 — ${held.map((h) => S(h._key)).join(', ')}`);
      continue;
    }
    plan.push({ plate, keep: S(keep._key), fold: fold.map((f) => S(f._key)) });
    const nameOf = (r: EntityRecord) => `${S(r.maker)} ${S(r.sub_model) || S(r.model)} ${S(r.trim_name)}`.trim();
    const differ = new Set(rows.map((r) => S(r.maker))).size > 1;
    console.log(`  ${plate}${differ ? '  ⚠ 제조사 불일치' : ''}`);
    console.log(`     남김 ${S(keep._key).padEnd(22)} 가격${priceCount(keep)} [${S(keep.vehicle_status) || '빈값'}] ${nameOf(keep)}`);
    fold.forEach((f) => console.log(`     접음 ${S(f._key).padEnd(22)} 가격${priceCount(f)} [${S(f.vehicle_status) || '빈값'}] ${nameOf(f)}`));
  }

  console.log(`\n접을 그룹 ${plan.length} · 계약으로 보류 ${blocked}`);
  if (!plan.length) return;
  const backup: Record<string, unknown> = {};
  for (const g of plan) for (const k of g.fold) backup[k] = { v3: (p3.val() || {})[k] ?? null, v4: (p4.val() || {})[k] ?? null };
  writeFileSync(`tmp/fold-${CODE}-backup.json`, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`백업 → tmp/fold-${CODE}-backup.json`);
  if (!APPLY) { console.log('※ dry-run. 위 «남김/접음»이 맞는지 확인한 뒤 --apply'); return; }

  const patch: Record<string, unknown> = {};
  const now = new Date().toISOString();
  for (const g of plan) for (const k of g.fold) {
    patch[`products/${k}/_deleted`] = true;
    patch[`products/${k}/_merged_into`] = g.keep;
    patch[`products/${k}/_merged_reason`] = `${CODE} 중복 정리 — 같은 번호판 ${g.plate}`;
    patch[`products/${k}/updatedAt`] = now;
  }
  await db.ref('v4').update(patch);
  const foldedCount = plan.reduce((a, g) => a + g.fold.length, 0);
  console.log(`\n반영 완료 — ${plan.length}그룹 ${foldedCount}건 접음`);
  const after = mergeNodes((await db.ref('products').get()).val(), (await db.ref('v4/products').get()).val());
  const ok = plan.every((g) => g.fold.every((k) => after[k]?._deleted === true) && after[g.keep]?._deleted !== true);
  console.log(`  검증 ${ok ? '✓ 접힘·남김 모두 정상' : '❌ 불일치 — 백업 확인'}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
