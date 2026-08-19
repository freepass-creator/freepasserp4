/**
 * 회원 email(PII) → `v4/users_private/{uid}/email` 이관 — 서버(Admin SDK)판.
 *
 * 왜 서버판이 필요한가: 같은 로직이 `lib/firebase/migrate-private.ts` 에 있고 관리자
 * 개발도구(`/dev` 민감 필드 분리)의 버튼으로 돈다. 그런데 그건 «관리자로 로그인한 브라우저»가 있어야 한다.
 * 재설치 후 실계정 로그인 없이 오픈 준비를 진행해야 해서, 같은 패치를 서버에서 낸다.
 *
 * ★클라판과 «동일해야 하는» 계약 — 어긋나면 데이터가 갈린다:
 *   · uid = over.uid ?? live.uid ?? key   (private 노드의 키. rtdb-records/members 병합 기준과 같다)
 *   · private 우선(멱등) — 이미 private 에 있으면 본노드 옛값으로 덮지 않는다
 *   · private 기록 + 본노드 제거를 **레코드당 단일 멀티패스 update** 로 (둘 다 사라지는 창 없음)
 *   · email 이 없거나 '' 이면 건너뛴다
 *
 * ★이관 대상은 email 뿐이다. phone·agent_payout_rate 는 의도적 보존(RETAINED) —
 *   /q 공개견적 연락 CTA 와 공급사 대리 계약생성의 payout 해석이 본노드를 읽는다.
 *
 * ⚠ Admin SDK 는 보안규칙을 우회한다. 즉 이 스크립트의 성공은 «규칙이 이 write 를 허용한다»는
 *   증거가 아니다. 규칙 검증은 별도(scripts/ruleprobe/)다.
 *
 * 기본 dry-run. 실제 반영은 --apply.
 *   npx tsx scripts/migrate-email-to-private.mts
 *   npx tsx scripts/migrate-email-to-private.mts --apply
 */
import { readFileSync } from 'node:fs';

type Rec = Record<string, unknown>;
const S = (v: unknown) => String(v ?? '').trim();

async function main() {
  const apply = process.argv.includes('--apply');

  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const db = getDatabase();

  const [liveSnap, overSnap, privSnap] = await Promise.all([
    db.ref('users').get(), db.ref('v4/users').get(), db.ref('v4/users_private').get(),
  ]);
  const liveU = (liveSnap.val() || {}) as Record<string, Rec>;
  const overU = (overSnap.val() || {}) as Record<string, Rec>;
  const privU = (privSnap.val() || {}) as Record<string, Rec>;

  console.log(`\n══ 회원 email → v4/users_private ${apply ? '실행' : '미리보기(dry-run)'} ══\n`);
  console.log(`  users ${Object.keys(liveU).length}건 · v4/users ${Object.keys(overU).length}건 · private ${Object.keys(privU).length}건\n`);

  let scanned = 0, moved = 0, removed = 0, skipped = 0;
  const errors: string[] = [];
  const samples: string[] = [];

  for (const key of new Set([...Object.keys(liveU), ...Object.keys(overU)])) {
    const live = liveU[key] || {};
    const over = overU[key] || {};
    scanned++;

    const uid = S(over.uid || live.uid || key);
    const existingPriv = (privU[uid] as Rec | undefined)?.email;
    const email = existingPriv ?? over.email ?? live.email;

    if (email == null || S(email) === '') { skipped++; continue; }
    moved++;
    if (samples.length < 8) samples.push(`${uid.slice(0, 12)}… ${S(email)}`);

    if (!apply) continue;

    try {
      const patch: Rec = {};
      // 이미 private 에 있으면 미기입 — 회원관리에서 편집한 값을 본노드 옛값으로 되돌리지 않는다.
      if (existingPriv == null) patch[`v4/users_private/${uid}/email`] = email;
      if (live.email != null) patch[`users/${key}/email`] = null;
      if (over.email != null) patch[`v4/users/${key}/email`] = null;
      if (Object.keys(patch).length) await db.ref().update(patch);
      removed++;
    } catch (e) {
      errors.push(`${uid}: ${(e as Error)?.message || String(e)}`);
    }
  }

  console.log(`  스캔 ${scanned} · 대상 ${moved} · 건너뜀(email 없음) ${skipped}`);
  if (apply) console.log(`  반영 ${removed}건`);
  if (samples.length) {
    console.log(`\n  표본:`);
    for (const s of samples) console.log(`     ${s}`);
  }
  if (errors.length) {
    console.log(`\n  ❌ 오류 ${errors.length}건`);
    for (const e of errors.slice(0, 10)) console.log(`     ${e}`);
  }
  console.log(apply
    ? `\n끝. 확인: npx tsx scripts/audit-private-fields.mts (email 본노드 0건이어야 한다)\n`
    : `\n※ dry-run. 실제 반영은 --apply\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
