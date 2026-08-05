/**
 * **같은 회사가 파트너 코드 두 개로 등록된 것을 하나로 합친다.**
 *
 * 왜 문제인가: 같은 차를 두 코드에 각각 올려 두면 중복정리(dedupeProductsByVehicle)가
 * 매번 하나만 승자로 뽑는다. 그래서 어느 쪽도 온전한 대수가 안 나오고
 * (빌린카 45대 중 33대만 표시), 계약이 걸리면 **정산이 어느 공급사로 가는지 갈린다.**
 *
 * 사용자 확인(2026-08-05):
 *   RP021 빌린카 = PT-0024 주식회사 빌린카   (렌트/구독 구분일 뿐 같은 회사)
 *   RP018 스타   = RP005 (주)스타스카이
 *   PT-0001      = PT-0014 (주)렌트존
 *   PT-0026 엘씨 는 별개 — 건드리지 않는다.
 *
 * 하는 일:
 *   ① 흡수될 코드의 매물에 `provider_company_code` 를 대표 코드로 바꾼다.
 *   ② 대표 코드에 같은 실물이 이미 있으면 흡수분을 `_merged_into` 로 접는다.
 *   ③ 계약이 걸린 매물은 접지 않는다(코드 변경만 한다 — 계약이 가리키는 product_code 는 그대로).
 *
 * v3 원본은 건드리지 않고 v4 오버레이에만 쓴다.
 *
 *   npx tsx scripts/merge-provider-codes.mts            dry-run
 *   ... --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { vehicleIdentity } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
type Rec = Record<string, unknown>;

/** [흡수될 코드, 대표 코드] — 대표는 시트가 연결된 쪽으로 잡았다. */
const MERGES: { from: string; to: string; why: string }[] = [
  { from: 'PT-0024', to: 'RP021', why: '주식회사 빌린카 = 빌린카. 렌트/구독 구분일 뿐 같은 회사(사용자 확인)' },
  { from: 'RP005', to: 'RP018', why: '(주)스타스카이 = 스타(사용자 확인). 시트는 RP018 에 있다' },
  { from: 'PT-0014', to: 'PT-0001', why: '(주)렌트존 두 코드. 시트는 PT-0001 에 있다(사용자 확인)' },
];

const mergeN = (a: Record<string, Rec>, b: Record<string, Rec>) => {
  const m: Record<string, Rec> = {};
  for (const [k, v] of Object.entries(a || {})) m[k] = { ...v, _key: k };
  for (const [k, v] of Object.entries(b || {})) m[k] = { ...(m[k] || {}), ...v, _key: k };
  return m;
};

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();
  const [p3, p4, c3, c4] = await Promise.all([
    db.ref('products').get(), db.ref('v4/products').get(),
    db.ref('contracts').get(), db.ref('v4/contracts').get(),
  ]);
  const v3All = (p3.val() || {}) as Record<string, Rec>;
  const v4All = (p4.val() || {}) as Record<string, Rec>;
  const all = mergeN(v3All, v4All);
  const live = Object.values(all).filter((x) => x && x._deleted !== true && !x.deletedAt && S(x.status) !== 'deleted');
  const contracted = new Set(Object.values(mergeN((c3.val() || {}) as Record<string, Rec>, (c4.val() || {}) as Record<string, Rec>))
    .filter((c) => c && c._deleted !== true && S(c.contract_status) !== '계약취소')
    .map((c) => S(c.product_code)).filter(Boolean));

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};
  const backup: Record<string, unknown> = {};
  const ofCode = (x: Rec, code: string) => S(x.provider_company_code) === code || S(x._key).startsWith(`${code}_`);

  for (const m of MERGES) {
    const fromRows = live.filter((x) => ofCode(x, m.from));
    const toRows = live.filter((x) => ofCode(x, m.to));
    const toIds = new Map<string, Rec>();
    for (const x of toRows) { const id = vehicleIdentity(x as EntityRecord); if (id && !toIds.has(id)) toIds.set(id, x); }

    let moved = 0, folded = 0, held = 0;
    console.log(`\n■ ${m.from} → ${m.to}   (${m.why})`);
    console.log(`   흡수될 쪽 ${fromRows.length}대 · 대표 쪽 ${toRows.length}대`);
    for (const x of fromRows) {
      const key = S(x._key);
      const id = vehicleIdentity(x as EntityRecord);
      const twin = id ? toIds.get(id) : undefined;
      const hasContract = contracted.has(S(x.product_code)) || contracted.has(key);
      if (!backup[key]) backup[key] = { v3: v3All[key] ?? null, v4: v4All[key] ?? null };

      if (twin && !hasContract) {
        // 대표 쪽에 같은 실물이 이미 있다 → 접는다
        patch[`products/${key}/_deleted`] = true;
        patch[`products/${key}/_merged_into`] = S(twin._key);
        patch[`products/${key}/_merged_reason`] = `공급사 코드 통합 ${m.from}→${m.to}`;
        patch[`products/${key}/updatedAt`] = now;
        folded++;
      } else {
        // 대표 쪽에 없다(또는 계약이 걸렸다) → 소유 코드만 옮긴다
        patch[`products/${key}/provider_company_code`] = m.to;
        patch[`products/${key}/partner_code`] = m.to;
        patch[`products/${key}/provider_merged_from`] = m.from;
        patch[`products/${key}/updatedAt`] = now;
        moved++;
        if (hasContract && twin) held++;
      }
    }
    console.log(`   → 대표로 이동 ${moved} · 중복이라 접음 ${folded}${held ? ` · 계약이 있어 접지 않고 이동만 ${held}` : ''}`);
  }

  console.log(`\n총 ${Object.keys(backup).length}개 매물 변경`);
  if (!APPLY) { console.log('※ dry-run. 반영은 --apply\n'); return; }
  writeFileSync('tmp/merge-provider-backup.json', JSON.stringify(backup), 'utf8');
  console.log(`백업 → tmp/merge-provider-backup.json`);
  await db.ref('v4').update(patch);
  console.log('반영 완료\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
