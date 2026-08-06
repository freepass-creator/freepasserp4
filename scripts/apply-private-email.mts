/**
 * **회원 email(PII)을 `v4/users_private` 로 옮긴다. 기본 미리보기, `--apply` 로 실행.**
 *
 * 지금 `users/{uid}/email` 은 로그인한 아무나 읽을 수 있다(규칙: users read = auth != null).
 * 167명분 이메일이 그 상태다. 화면은 폴백 계약(private ?? 본노드) 덕에 이관 전후 똑같이 돈다 —
 * 그래서 「화면이 멀쩡함」은 이관됐다는 증거가 되지 못한다. 본노드에 값이 남았는지로만 판단한다.
 *
 * 이관 규칙은 화면 경로(`lib/firebase/migrate-private.ts`)와 «같아야» 한다:
 *   · private 우선(멱등) — 이미 private 에 있으면 base 옛값으로 덮지 않는다.
 *   · 본노드는 delete 가 아니라 null — RTDB update 는 merge 라 delete 로는 옛값이 남는다.
 *   · v3(`users`)·v4(`v4/users`) 양쪽을 함께 비운다. 한쪽만 비우면 오버레이 병합으로 되살아난다.
 *
 * ⚠ `users` 는 erp3 와 같은 인스턴스다. erp3 회원 화면이 이메일을 읽고 있다면 그쪽 표시가 빈다.
 *    (v4 는 관리자 화면에서 users_private 를 병합해 계속 보인다.)
 *
 * 실행 전 원본을 파일로 남긴다 — 되돌릴 수 있어야 «지운다»고 말할 수 있다.
 *
 *   npx tsx scripts/apply-private-email.mts            # 미리보기
 *   npx tsx scripts/apply-private-email.mts --apply    # 실행
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

type Rec = Record<string, unknown>;
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
const DB = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const sa = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  : JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || 'tmp/firebase-auth/sa.json', 'utf8'));
if (!getApps().length) initializeApp({ credential: cert(sa), databaseURL: DB });

async function main() {
  const db = getDatabase();
  const [liveU, overU, privU] = await Promise.all([
    db.ref('users').get().then((s) => (s.val() || {}) as Record<string, Rec>),
    db.ref('v4/users').get().then((s) => (s.val() || {}) as Record<string, Rec>),
    db.ref('v4/users_private').get().then((s) => (s.val() || {}) as Record<string, Rec>),
  ]);

  const patch: Rec = {};
  const backup: Array<{ uid: string; key: string; email: string; where: string[] }> = [];
  let scanned = 0, already = 0, nameless = 0;

  for (const key of new Set([...Object.keys(liveU), ...Object.keys(overU)])) {
    const live = liveU[key] || {};
    const over = overU[key] || {};
    scanned++;
    const uid = S(over.uid || live.uid || key);
    const existing = privU[uid]?.email;
    const email = existing ?? over.email ?? live.email;
    if (email == null || S(email) === '') continue;
    if (existing != null && live.email == null && over.email == null) { already++; continue; }
    const where: string[] = [];
    if (existing == null) { patch[`v4/users_private/${uid}/email`] = email; where.push('→private'); }
    if (live.email != null) { patch[`users/${key}/email`] = null; where.push('users'); }
    if (over.email != null) { patch[`v4/users/${key}/email`] = null; where.push('v4/users'); }
    if (!S(over.name || live.name)) nameless++;
    backup.push({ uid, key, email: S(email), where });
  }

  console.log(`\n══ 회원 email → v4/users_private ${APPLY ? '(실행)' : '(미리보기)'} ══\n`);
  console.log(`  회원 ${scanned}명 · 이관 대상 ${backup.length}명 · 이미 완료 ${already}명`);
  console.log(`  이름이 비어 이메일이 표시명이던 회원 ${nameless}명 — 목록에서 회원코드로 표시된다(관리자는 이메일 계속 보임)`);
  console.log(`  쓰기 경로 ${Object.keys(patch).length}개\n`);
  for (const b of backup.slice(0, 8)) console.log(`   ${b.uid.padEnd(14)} ${b.email.padEnd(32)} ${b.where.join(' ')}`);
  if (backup.length > 8) console.log(`   … 외 ${backup.length - 8}명`);

  if (!APPLY) { console.log('\n  --apply 로 실행\n'); return; }
  if (!Object.keys(patch).length) { console.log('\n  바꿀 것 없음\n'); return; }

  mkdirSync('tmp/backup', { recursive: true });
  const file = `tmp/backup/users-email-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(file, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`\n  원본 백업 ${file}`);

  await db.ref().update(patch);
  console.log(`  ✅ ${backup.length}명 이관 완료\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
