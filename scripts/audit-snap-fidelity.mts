/**
 * 차종·옵션이 «맞게» 들어갔나 — 원본(_raw_vehicle)과 대조. 읽기 전용.
 *
 * 채움률은 품질이 아니다. 스냅이 **다른 차로 붙으면** 채워져 있어도 틀린 것이다.
 * 그래서 두 가지를 잰다:
 *   1) 차종 충실도 — 원본 model 과 스냅된 model 이 어긋난 건
 *      (원본에 model 이 없는데 스냅이 model 을 만들어낸 것도 포함 — 근거 없는 추측)
 *   2) 옵션 채움 — 옵션은 스냅 대상이 아니라 시트 원문 그대로여야 한다
 *
 * npx tsx scripts/audit-snap-fidelity.mts
 */
import { readFileSync } from 'node:fs';
import { isListableProduct } from '../lib/domain/product';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (r: Rec) => r?._deleted === true || S(r?.status) === 'deleted';
/** 표기 차이를 없앤 비교 — 공백·하이픈·대소문자 무시. */
const norm = (v: unknown) => S(v).toLowerCase().replace(/[\s\-_]/g, '');

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const v4 = ((await db.ref('v4/products').get()).val() || {}) as Record<string, Rec>;
  const rows = Object.values(v4).filter((p) => !dead(p) && isListableProduct(p as any));

  console.log(`\n══ 차종·옵션이 맞게 들어갔나 — 목록 노출 ${rows.length}대 ══\n`);

  let sameModel = 0, diffModel = 0, inventedModel = 0, noRaw = 0;
  const diffs: string[] = [];
  const invented: string[] = [];

  for (const p of rows) {
    const raw = (p._raw_vehicle && typeof p._raw_vehicle === 'object' ? p._raw_vehicle : null) as Rec | null;
    if (!raw) { noRaw++; continue; }
    const rm = norm(raw.model);
    const pm = norm(p.model);
    if (!rm) {
      if (pm) {
        inventedModel++;
        if (invented.length < 12) invented.push(`   원본 model 없음 → «${S(p.maker)} ${S(p.model)} ${S(p.sub_model)}»  (${S(p.car_number) || '차번없음'})`);
      }
      continue;
    }
    // 원본이 스냅 결과에 포함되면 같은 계열로 본다(«카니발» → «카니발 KA4»).
    if (pm === rm || pm.includes(rm) || rm.includes(pm) || norm(p.sub_model).includes(rm)) sameModel++;
    else {
      diffModel++;
      if (diffs.length < 20) diffs.push(`   원본 «${S(raw.maker)} ${S(raw.model)}» → 스냅 «${S(p.maker)} ${S(p.model)} ${S(p.sub_model)}»  (${S(p.car_number) || '차번없음'})`);
    }
  }

  console.log('■ 차종 충실도 (원본 model 대비)');
  console.log(`   ✅ 원본과 같은 계열      ${sameModel}대`);
  console.log(`   ❌ 다른 차로 붙음        ${diffModel}대`);
  console.log(`   ⚠ 원본에 없는데 만들어냄  ${inventedModel}대`);
  console.log(`   · 원본 기록 없음(수기 등) ${noRaw}대\n`);

  if (diffs.length) { console.log('■ 다른 차로 붙은 것'); for (const d of diffs) console.log(d); if (diffModel > diffs.length) console.log(`   … 그 외 ${diffModel - diffs.length}대`); console.log(''); }
  if (invented.length) { console.log('■ 원본에 모델이 없는데 채워진 것'); for (const d of invented) console.log(d); if (inventedModel > invented.length) console.log(`   … 그 외 ${inventedModel - invented.length}대`); console.log(''); }

  // ── 옵션 ──
  const withOpts = rows.filter((p) => S(p.options)).length;
  const rawHadOpts = rows.filter((p) => {
    const raw = (p._raw_vehicle && typeof p._raw_vehicle === 'object' ? p._raw_vehicle : null) as Rec | null;
    return raw && S(raw.options);
  }).length;
  const lostOpts = rows.filter((p) => {
    const raw = (p._raw_vehicle && typeof p._raw_vehicle === 'object' ? p._raw_vehicle : null) as Rec | null;
    return raw && S(raw.options) && !S(p.options);
  }).length;

  console.log('■ 옵션');
  console.log(`   옵션이 있는 매물         ${withOpts}/${rows.length}대`);
  console.log(`   원본에 옵션이 있던 매물   ${rawHadOpts}대`);
  console.log(`   ${lostOpts ? '❌' : '✅'} 원본엔 있는데 사라진 것  ${lostOpts}대\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
