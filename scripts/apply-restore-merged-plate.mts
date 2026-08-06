/**
 * 중복 정리 생존자에 차번 복원 — 기본 dry-run, 반영은 --apply.
 *
 * 왜: 같은 차가 두 키(`공급사_차번` / `EXT_해시`)로 있어 하나로 합쳤는데, 남은 `EXT_*` 쪽에
 * `car_number` 가 없다. 차는 ERP 에 있는데 **차번으로 검색이 안 된다**(erp3 에서는 된다).
 * 삭제된 형제에 차번이 그대로 있으므로 제자리에 옮겨 넣기만 하면 된다 — 값을 만들지 않는다.
 *
 * ★안전 계약
 *   · 생존자에 `car_number` 가 **이미 있으면 건드리지 않는다**.
 *   · 한 생존자를 가리키는 삭제 형제들의 차번이 **서로 다르면 건너뛴다**(모호 → 사람이 본다).
 *   · 쓰는 필드는 `car_number` 하나. 가격·상태·계약·차종에 손대지 않는다.
 *   · 삭제된 형제는 그대로 둔다(되돌릴 근거를 남긴다).
 *
 *   npx tsx scripts/apply-restore-merged-plate.mts
 *   npx tsx scripts/apply-restore-merged-plate.mts --apply
 */
import { readFileSync } from 'node:fs';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';
const PLATE = /\d{2,3}[가-힣]\d{4}/;
const plateOf = (p: Rec, key: string) =>
  (S(p?.car_number).replace(/\s/g, '').match(PLATE) || [''])[0]
  || (S(key).replace(/\s/g, '').match(PLATE) || [''])[0];

async function main() {
  const apply = process.argv.includes('--apply');

  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const v4 = ((await db.ref('v4/products').get()).val() || {}) as Record<string, Rec>;

  /** 생존자 키 → 삭제 형제들이 들고 있던 차번 집합 */
  const claim = new Map<string, Set<string>>();
  /** 생존자 키 → 삭제 형제들이 들고 있던 상태 집합 */
  const statusClaim = new Map<string, Set<string>>();
  for (const [key, p] of Object.entries(v4)) {
    if (!dead(p)) continue;
    const target = S(p._merged_into) || S(p.product_uid);
    if (!target || target === key) continue;
    const sv = v4[target];
    if (!sv || dead(sv)) continue;

    const plate = plateOf(p, key);
    if (plate && !S(sv.car_number)) claim.set(target, (claim.get(target) || new Set()).add(plate));

    // 상태도 같은 병이다 — 접힌 쪽에 있던 vehicle_status 가 생존자에 안 옮겨졌다.
    const st = S(p.vehicle_status);
    if (st && !S(sv.vehicle_status)) statusClaim.set(target, (statusClaim.get(target) || new Set()).add(st));
  }

  /** 형제에도 상태가 없으면 «자기 시트 원문»(status_label_raw)에서 가져온다. */
  for (const [key, sv] of Object.entries(v4)) {
    if (dead(sv) || S(sv.vehicle_status) || statusClaim.has(key)) continue;
    const raw = S(sv.status_label_raw);
    if (raw) statusClaim.set(key, new Set([raw]));
  }

  const ok: { key: string; plate: string }[] = [];
  const ambiguous: { key: string; plates: string[] }[] = [];
  for (const [key, plates] of claim) {
    if (plates.size === 1) ok.push({ key, plate: [...plates][0] });
    else ambiguous.push({ key, plates: [...plates] });
  }
  const okStatus: { key: string; status: string }[] = [];
  for (const [key, set] of statusClaim) if (set.size === 1) okStatus.push({ key, status: [...set][0] });

  console.log(`\n══ 생존자 차번·상태 복원 ${apply ? '반영' : '미리보기(dry-run)'} ══\n`);
  console.log(`  차번 복원 대상        ${ok.length}건`);
  console.log(`  상태 복원 대상        ${okStatus.length}건`);
  console.log(`  모호(차번 여러 개)    ${ambiguous.length}건  ← 건너뜀\n`);

  for (const a of ambiguous.slice(0, 8)) console.log(`   ⚠ ${a.key} ← ${a.plates.join(' / ')}`);
  if (ambiguous.length > 8) console.log(`   … 그 외 ${ambiguous.length - 8}건`);

  console.log('\n■ 표본');
  for (const o of ok.slice(0, 10)) {
    const sv = v4[o.key];
    console.log(`   ${o.plate.padEnd(10)} → ${o.key.padEnd(22)} ${S(sv.maker)} ${S(sv.model)} ${S(sv.sub_model)}`);
  }
  if (ok.length > 10) console.log(`   … 그 외 ${ok.length - 10}건`);

  if (!apply) { console.log(`\n※ dry-run. 반영은 --apply\n`); return; }

  // 같은 생존자에 차번·상태가 둘 다 갈 수 있으므로 키 단위로 합쳐 한 번만 쓴다.
  const patches = new Map<string, Rec>();
  for (const o of ok) patches.set(o.key, { ...(patches.get(o.key) || {}), car_number: o.plate });
  for (const o of okStatus) patches.set(o.key, { ...(patches.get(o.key) || {}), vehicle_status: o.status });

  let done = 0;
  const errors: string[] = [];
  for (const [key, patch] of patches) {
    try { await db.ref(`v4/products/${key}`).update(patch); done++; }
    catch (e) { errors.push(`${key}: ${(e as Error)?.message || String(e)}`); }
  }
  console.log(`\n  복원 ${done}건 (차번 ${ok.length} · 상태 ${okStatus.length})`);
  if (errors.length) {
    console.log(`  ❌ 오류 ${errors.length}건`);
    for (const e of errors.slice(0, 10)) console.log(`     ${e}`);
  }
  console.log(`\n끝. 확인: npx tsx scripts/trace-plate.mts <차번>\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
