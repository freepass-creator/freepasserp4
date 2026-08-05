/**
 * 차종마스터 오매칭 교정 — **벤츠를 다른 브랜드로 광고하고 있는 매물**을 바로잡는다.
 *
 * 대상은 추측으로 고르지 않는다. 아래 5개 번호판은 전부 —
 *   · 트림에 브랜드 고유 표기가 있고(4MATIC · 아방가르드 · AVANTGARDE)
 *   · 같은 번호판에 «맞게 적힌» 형제 레코드가 있거나, 배기량이 오답 브랜드와 안 맞는다
 *     (161호1256 engine_cc 1998 — 크라이슬러 200 은 2.4L/2360cc 다)
 * 라는 두 근거를 모두 만족한 것만이다. `audit-maker-mismatch.mts` 가 찾아낸 5건 그대로다.
 *
 * 표기 관례는 살아있는 벤츠 매물의 다수결을 따른다 — maker="벤츠" · model="E-클래스"(23건).
 * `catalog_id` 는 건드리지 않는다. 현재 3가지가 섞여 있어(mercedes_e_w214 · W213 · W214)
 * 무엇이 정본인지 알 수 없다 — 모르는 것을 지어내지 않는다.
 *
 * v3 원본은 건드리지 않고 v4 오버레이에만 쓴다. 되돌리기는 백업 파일로.
 *
 *   npx tsx scripts/fix-maker-mismatch.mts            dry-run
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
const S = (v: unknown) => String(v ?? '').trim();

/** 번호판 → 정답. 근거를 같이 적는다 — 나중에 이 표를 의심할 사람을 위해. */
const CORRECTIONS: { plate: string; maker: string; model: string; sub_model: string; why: string }[] = [
  { plate: '161호1256', maker: '벤츠', model: 'E-클래스', sub_model: 'E-클래스 W214',
    why: '같은 번호판 EXT_7821fe8f8f1c 가 벤츠 E-클래스 W214 E200 · engine_cc 1998(크라이슬러 200 은 2.4L)' },
  { plate: '161호1257', maker: '벤츠', model: 'E-클래스', sub_model: 'E-클래스 W214',
    why: '같은 번호판 EXT_0803a1761cd2 가 벤츠 E200 W214 아방가르드 · 트림 "E200 2.0 아방가르드"' },
  { plate: '142호7629', maker: '벤츠', model: 'E-클래스', sub_model: 'E-클래스 W214',
    why: '시트 원본 차종 "E200" · 트림 "AVANTGARDE KR3(25MY)" · 25년식 → W214(2024~)' },
  { plate: '08주6722', maker: '벤츠', model: 'S-클래스', sub_model: 'S-클래스 W222',
    why: '시트 원본 "벤츠 S클래스 / S 350d 4MATIC" · 16년식 → W222(2013~2020). 4MATIC 은 벤츠 상표' },
  { plate: '04모4866', maker: '벤츠', model: 'S-클래스', sub_model: 'S-클래스 W222',
    why: '트림 "S클래스(6세대) S350 d 4매틱" · sub_model 이 이미 S-클래스 W222 인데 maker 만 아우디' },
];

const mergeNodes = (a: unknown, b: unknown) => {
  const m: Record<string, EntityRecord> = {};
  for (const [k, v] of Object.entries((a || {}) as Record<string, EntityRecord>)) m[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries((b || {}) as Record<string, EntityRecord>)) m[k] = { ...(m[k] || {}), ...v, _key: k };
  return m;
};

async function main() {
  const [p3, p4] = await Promise.all([db.ref('products').get(), db.ref('v4/products').get()]);
  const prods = mergeNodes(p3.val(), p4.val());
  const live = Object.values(prods).filter((x) => x && x._deleted !== true);

  const plan: { key: string; plate: string; from: string; to: string; fix: Record<string, string> }[] = [];
  for (const c of CORRECTIONS) {
    const rows = live.filter((x) => S(x.car_number).replace(/\s/g, '') === c.plate);
    if (!rows.length) { console.log(`⚠ ${c.plate} — 살아있는 레코드 없음, 건너뜀`); continue; }
    console.log(`\n■ ${c.plate} → ${c.maker} ${c.sub_model}`);
    console.log(`   근거: ${c.why}`);
    for (const r of rows) {
      const cur = S(r.maker);
      if (cur === c.maker) { console.log(`   ✓ 이미 정상  ${S(r._key).padEnd(24)} ${cur} ${S(r.sub_model)}`); continue; }
      plan.push({
        key: S(r._key), plate: c.plate,
        from: `${cur} ${S(r.model)} ${S(r.sub_model)}`,
        to: `${c.maker} ${c.model} ${c.sub_model}`,
        fix: { maker: c.maker, model: c.model, sub_model: c.sub_model },
      });
      console.log(`   ★ 고침      ${S(r._key).padEnd(24)} ${cur} ${S(r.model)} ${S(r.sub_model)}  →  ${c.maker} ${c.model} ${c.sub_model}`);
    }
  }

  console.log(`\n━━ 고칠 레코드 ${plan.length}건`);
  if (!plan.length) return;
  const backup: Record<string, unknown> = {};
  for (const p of plan) backup[p.key] = {
    v3: ((p3.val() || {}) as Record<string, unknown>)[p.key] ?? null,
    v4: ((p4.val() || {}) as Record<string, unknown>)[p.key] ?? null,
  };
  writeFileSync('tmp/fix-maker-backup.json', JSON.stringify(backup, null, 2), 'utf8');
  console.log('백업 → tmp/fix-maker-backup.json');
  if (!APPLY) { console.log('※ dry-run. 위 «고침»이 맞는지 확인한 뒤 --apply'); return; }

  const patch: Record<string, unknown> = {};
  const now = new Date().toISOString();
  for (const p of plan) {
    for (const [f, v] of Object.entries(p.fix)) patch[`products/${p.key}/${f}`] = v;
    patch[`products/${p.key}/maker_corrected_at`] = now;
    patch[`products/${p.key}/updatedAt`] = now;
  }
  await db.ref('v4').update(patch);
  console.log(`\n반영 완료 ${plan.length}건. 검증:`);
  const after = mergeNodes((await db.ref('products').get()).val(), (await db.ref('v4/products').get()).val());
  const ok = plan.filter((p) => S(after[p.key]?.maker) === p.fix.maker && S(after[p.key]?.sub_model) === p.fix.sub_model).length;
  console.log(`  maker·sub_model 일치 ${ok}/${plan.length}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
