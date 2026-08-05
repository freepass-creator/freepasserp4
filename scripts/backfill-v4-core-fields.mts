/**
 * **v3 브리지를 꺼도 화면이 같도록 v4 레코드의 빈 필드를 메운다** — 계약·문의방·정산.
 *
 * 왜 필요한가: 앞선 이관은 «v4 에 없는 키»만 복사했다. 양쪽에 있는 키는 건드리지 않았는데,
 * 그 v4 쪽이 앱이 상태만 패치한 **부분 오버레이**인 경우가 있다. 지금은 rtdb-adapter.merged() 가
 * v3 로 빈칸을 메워 정상으로 보이지만, 브리지를 끄면 계약 5건·문의방 44건이 이름도 금액도 없는
 * 껍데기가 된다. 그래서 «지금 화면에 보이는 값»을 v4 에 물리적으로 굳히는 작업이다.
 *
 * 병합 규칙은 merged() 를 그대로 따른다(rtdb-adapter.ts):
 *     for (const [kk, vv] of Object.entries(r)) if (vv !== undefined) cur[kk] = vv;
 *   RTDB 는 null 을 키 삭제로 저장하므로 실질 규칙은 **«v4 에 키가 있으면 v4 가 이긴다»**.
 *   빈 문자열('')도 v4 에 있으면 이긴다 — inventory resetForm 의 «의도적 클리어»이기 때문이다.
 *   따라서 여기서도 **키가 아예 없을 때만** v3 값을 넣는다. ''를 덮으면 클리어를 되살리는 사고가 된다.
 *
 * v3 는 읽기만 한다. 되돌리려면 백업(tmp/backfill-core-backup.json)으로 복원한다.
 *
 *   npx tsx scripts/backfill-v4-core-fields.mts            dry-run
 *   npx tsx scripts/backfill-v4-core-fields.mts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
type Rec = Record<string, unknown>;
const CHUNK = 200;

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
  const now = new Date().toISOString();

  const [c3, c4, r3, r4, s3, s4] = await Promise.all([
    db.ref('contracts').get(), db.ref('v4/contracts').get(),
    db.ref('rooms').get(), db.ref('v4/rooms').get(),
    db.ref('settlements').get(), db.ref('v4/settlements').get(),
  ]);

  const alive = (v: Rec | undefined) => !!v && v._deleted !== true && S(v.status) !== 'deleted';
  const plan: { path: string; value: unknown }[] = [];
  const backup: Record<string, unknown> = {};
  const report: string[] = [];

  for (const [label, node, v3raw, v4raw] of [
    ['계약', 'contracts', c3.val(), c4.val()],
    ['문의방', 'rooms', r3.val(), r4.val()],
    ['정산', 'settlements', s3.val(), s4.val()],
  ] as const) {
    const A = (v3raw || {}) as Record<string, Rec>;
    const B = (v4raw || {}) as Record<string, Rec>;
    let touched = 0, fields = 0;
    const fieldTally = new Map<string, number>();

    for (const [k, v3] of Object.entries(A)) {
      if (!alive(v3)) continue;
      const v4 = B[k];
      if (v4 === undefined) continue;  // 키 자체가 없는 건 이관 스크립트 소관(현재 0건)
      if (!alive(v4)) continue;        // v4 에서 지운 것 — 되살리지 않는다
      const patch: Rec = {};
      for (const [f, val] of Object.entries(v3)) {
        if (f === '_key' || f === '_deleted') continue;
        if (val === undefined || val === null) continue;
        if (f in v4) continue;         // v4 에 키가 있으면 v4 가 이긴다('' 포함 — 의도적 클리어 보존)
        patch[f] = val;
        fieldTally.set(f, (fieldTally.get(f) || 0) + 1);
      }
      if (!Object.keys(patch).length) continue;
      patch.field_backfilled_from_v3_at = now;
      backup[`${node}/${k}`] = { ...v4 };
      for (const [f, val] of Object.entries(patch)) plan.push({ path: `${node}/${k}/${f}`, value: val });
      touched++; fields += Object.keys(patch).length - 1;
    }

    report.push(`  ${label.padEnd(8)} 레코드 ${String(touched).padStart(4)}건 · 필드 ${String(fields).padStart(5)}개`);
    if (fieldTally.size) {
      const top = [...fieldTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      report.push(`           ${top.map(([f, n]) => `${f}:${n}`).join(' · ')}${fieldTally.size > 6 ? ` … +${fieldTally.size - 6}종` : ''}`);
    }
  }

  console.log('\n══ v4 빈 필드 보강 (v3 읽기만 · v4 에 있는 키는 안 건드림) ══\n');
  report.forEach((r) => console.log(r));
  console.log(`\n  총 쓰기 ${plan.length}건 · 청크 ${Math.ceil(plan.length / CHUNK)}회`);

  if (!plan.length) { console.log('\n보강할 것 없음.\n'); return; }
  if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply\n'); return; }

  writeFileSync('tmp/backfill-core-backup.json', JSON.stringify(backup, null, 1), 'utf8');
  console.log('\n  백업 → tmp/backfill-core-backup.json');

  for (let i = 0; i < plan.length; i += CHUNK) {
    const patch: Record<string, unknown> = {};
    for (const { path, value } of plan.slice(i, i + CHUNK)) patch[path] = value;
    await db.ref('v4').update(patch);
    console.log(`  청크 ${Math.floor(i / CHUNK) + 1}/${Math.ceil(plan.length / CHUNK)} · ${Object.keys(patch).length}건 반영`);
  }
  console.log('\n반영 완료\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
