/**
 * 번호판이 «키에는 있는데 car_number 필드엔 없는» v3 레거시 매물 백필.
 *
 * 왜 필요한가: 차량 신원(`vehicleIdentity`)은 `car_number`·`vin` 만 본다. 키는 안 본다.
 * 그래서 이 매물들은 —
 *   · 트윈 판정에서 빠진다(같은 차가 두 코드로 있어도 못 잡는다)
 *   · **원자 선점이 거부된다** — `차량번호 또는 VIN이 없어 원자 선점을 진행할 수 없습니다`
 *     즉 후보 Rules 게시 + claim ON 이후 이 매물로는 계약금 체크가 아예 안 된다.
 *
 * 실측(2026-08-04): 신원 없는 매물 489건 = **전부 키에서 번호판 복구 가능**(실패 0). 둘로 갈린다.
 *   · 단순 백필 191건 — 같은 번호판을 쓰는 매물이 없다. 전부 가격 없는 v3 잔재라 급하지 않다.
 *   · **번호판 충돌 292건**(가격 있는 것 34건) — 같은 번호판 매물이 이미 있다.
 *     = **이미 트윈인데 한쪽이 번호판 공란이라 안 잡히고 있던 것.** 실제 위험은 여기다.
 *     신원이 null 이면 `dedupeProductsByVehicle` 이 unidentified 로 분류해 **항상 노출**하므로
 *     같은 차가 목록에 두 번 뜨고, 그 매물로 계약하면 선점이 거부된다.
 *     백필하면 트윈이 «보이게» 되어 dedup 이 합치고 이중판매 가드가 잡는다.
 *
 * 안전장치:
 *   · v3 원본은 건드리지 않는다. v4 오버레이에 car_number 만 쓴다.
 *   · 키에서 뽑은 값이 정확한 번호판 형식일 때만 쓴다(부분일치·임시번호 금지).
 *   · 이미 car_number·VIN 이 있는 레코드는 절대 덮지 않는다.
 *   · 충돌분은 기본 대상이 아니다 — `--collisions` 로 «명시적으로» 골라야 반영된다.
 *
 * 실행(기본 dry-run):
 *   npx tsx scripts/backfill-car-number-from-key.mts                        단순 백필 191건 미리보기
 *   ... --collisions --priced-only                                          실제 위험 34건 미리보기
 *   ... --collisions --priced-only --apply                                  ← 오픈 직전 최소 조치
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync, writeFileSync } from 'node:fs';

const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';
const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert(sa), databaseURL: DB });
const db = getDatabase();

const APPLY = process.argv.includes('--apply');
const PRICED_ONLY = process.argv.includes('--priced-only');
/** 번호판 충돌분(=이미 트윈인데 한쪽이 번호판 공란이라 안 잡히던 것)을 대상으로 삼는다. */
const COLLISIONS = process.argv.includes('--collisions');
const S = (v: unknown) => String(v ?? '').trim();
const PLATE = /^(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}$/;
const TEMP = /^100신\d{4,}$/;

/** 키에서 번호판 추출 — 키 전체가 번호판이거나, `공급사_번호판` 형태의 꼬리만 인정한다. */
function plateFromKey(key: string): string {
  const t = key.replace(/\s/g, '');
  if (PLATE.test(t) && !TEMP.test(t)) return t;
  const tail = t.match(/([0-9]{2,3}[가-힣][0-9]{4})$/);
  return tail && !TEMP.test(tail[1]) ? tail[1] : '';
}

const merge = (a: unknown, b: unknown) => {
  const m: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of Object.entries((a || {}) as Record<string, Record<string, unknown>>)) m[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((b || {}) as Record<string, Record<string, unknown>>)) m[k] = { ...(m[k] || {}), ...v, _key: k };
  return m;
};

async function main() {
  const [p3, p4] = await Promise.all([db.ref('products').get(), db.ref('v4/products').get()]);
  const all = Object.values(merge(p3.val(), p4.val()))
    .filter((p) => p && p._deleted !== true && S(p.status) !== 'deleted');

  // 이미 쓰이고 있는 번호판 — 백필로 트윈을 새로 만들지 않기 위해.
  const taken = new Set<string>();
  for (const p of all) {
    const pl = S(p.car_number).replace(/\s/g, '');
    if (pl && PLATE.test(pl)) taken.add(pl);
  }

  type Row = { key: string; plate: string; priced: boolean; label: string; collidesWith?: string };
  const targets: Row[] = [];
  const collisions: Row[] = [];
  let skipHasPlate = 0, skipNoKey = 0;
  const ownerOfPlate = new Map<string, string>();
  for (const p of all) {
    const pl = S(p.car_number).replace(/\s/g, '');
    if (pl && PLATE.test(pl) && !ownerOfPlate.has(pl)) ownerOfPlate.set(pl, S(p._key));
  }
  for (const p of all) {
    const cur = S(p.car_number).replace(/\s/g, '');
    if (cur && PLATE.test(cur)) { skipHasPlate++; continue; }
    if (S(p.vin).length >= 11) { skipHasPlate++; continue; }
    const plate = plateFromKey(S(p._key));
    if (!plate) { skipNoKey++; continue; }
    const priced = !!(p.price && typeof p.price === 'object' && Object.keys(p.price).length);
    const row: Row = {
      key: S(p._key), plate, priced,
      label: `${S(p.maker)} ${S(p.sub_model) || S(p.model)} [${S(p.vehicle_status) || '빈값'}]`,
    };
    // 충돌 = 같은 번호판을 가진 매물이 이미 있다 = **이미 트윈인데 한쪽이 번호판이 비어 못 잡히고 있다.**
    //  건너뛰면 그 상태가 그대로 남는다(신원 null → dedup 에서 unidentified 로 항상 노출 + 선점 거부).
    //  백필하면 트윈이 «보이게» 되어 dedup 이 합치고 이중판매 가드가 잡는다. 그래서 숨기지 않고 분리 보고한다.
    if (taken.has(plate)) { row.collidesWith = ownerOfPlate.get(plate) || '(불명)'; collisions.push(row); continue; }
    targets.push(row);
    taken.add(plate); // 같은 배치 안에서도 중복 부여 금지
  }

  const pool = COLLISIONS ? collisions : targets;
  const chosen = PRICED_ONLY ? pool.filter((t) => t.priced) : pool;
  console.log(`매물 ${all.length}`);
  console.log(`  이미 신원 있음(건너뜀)     ${skipHasPlate}`);
  console.log(`  키에서 못 뽑음(건너뜀)     ${skipNoKey}`);
  console.log(`  단순 백필 대상            ${targets.length}  (가격 있음 ${targets.filter((t) => t.priced).length})`);
  console.log(`  ★ 번호판 충돌            ${collisions.length}  (가격 있음 ${collisions.filter((t) => t.priced).length})  ← 이미 트윈인데 안 잡히던 것`);
  console.log(`\n  선택된 반영 대상          ${chosen.length}  [${COLLISIONS ? '--collisions' : '기본'}${PRICED_ONLY ? ' --priced-only' : ''}]`);
  chosen.slice(0, 12).forEach((t) => console.log(`     ${t.key.padEnd(24)} → ${t.plate.padEnd(10)} ${t.priced ? "가격O" : "가격X"} ${t.label}${t.collidesWith ? "  ↔ 기존 " + t.collidesWith : ""}`));
  if (chosen.length > 12) console.log(`     … 외 ${chosen.length - 12}건`);

  if (!chosen.length) { console.log('\n대상 없음.'); return; }
  writeFileSync('tmp/backfill-car-number-plan.json', JSON.stringify(chosen, null, 2), 'utf8');
  console.log('\n계획 → tmp/backfill-car-number-plan.json');

  if (!APPLY) { console.log('※ dry-run. 실제 반영은 --apply'); return; }

  const patch: Record<string, unknown> = {};
  const now = new Date().toISOString();
  for (const t of chosen) {
    patch[`products/${t.key}/car_number`] = t.plate;
    patch[`products/${t.key}/car_number_backfilled_at`] = now;
    patch[`products/${t.key}/updatedAt`] = now;
  }
  await db.ref('v4').update(patch);
  console.log(`\n반영 완료 ${chosen.length}건. 검증:`);
  const after = merge((await db.ref('products').get()).val(), (await db.ref('v4/products').get()).val());
  const ok = chosen.filter((t) => S(after[t.key]?.car_number).replace(/\s/g, '') === t.plate).length;
  console.log(`  car_number 일치 ${ok}/${chosen.length}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
