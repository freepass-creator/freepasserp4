/**
 * 계정 비활성화 — 삭제가 아니라 «운영에서 끄기». 되살릴 수 있다.
 *
 * 대상은 사장님 본인이 만든 잔재 계정 3개다(본인 확인 완료).
 *   · jpkpyh@gmail.com provider 2개 — 소속 RP003 「테스트공급사 주식회사」가 이미 삭제됐다.
 *     본계정은 pyh@teamjpk.com(admin)이라 이 둘은 쓰이지 않는다.
 *   · dddd@naver.com  「테스트」 agent — 실제 영업채널 SP001 에 붙어 영업자 목록에 노출된다.
 *
 * 왜 v3 `users` 에 쓰는가: 앱이 그렇게 한다(`lib/firebase/auth.ts` updateUserProfile → `users/{uid}`).
 * 그리고 **RTDB 규칙이 보는 곳도 v3 다** — `root.child('users').child(auth.uid).child('is_active')`.
 * v4 에만 쓰면 화면에서만 꺼지고 보안 경계는 그대로 열려 있다. 그래서 여기만은 v3 에 쓴다.
 *
 * v4 는 «이미 그 키가 있을 때만» 함께 갱신한다. 없는데 만들면 필드 하나짜리 껍데기가 생기고,
 * 그건 오늘 계약·문의방에서 실제로 사고가 됐던 그 부분 오버레이다.
 *
 *   npx tsx scripts/deactivate-accounts.mts            dry-run
 *   npx tsx scripts/deactivate-accounts.mts --apply
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildAuditEntry } from '../lib/domain/audit.ts';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
type Rec = Record<string, unknown>;

const TARGETS = [
  { uid: 'jfzpwyVxmpZuf8XQQaMXYMSyHiS2', why: 'jpkpyh provider 잔재 (RP003 삭제됨) — 본계정은 pyh@teamjpk.com(admin)' },
  { uid: 'wjBCFU4nNJP1fvVxADH1yDK1zVa2', why: 'jpkpyh provider 잔재 (RP003 삭제됨) — 중복 활성 계정' },
  { uid: 'N5XHBO7Tq0VFlpIvlgIbUaPIAnk2', why: 'dddd@naver.com 테스트 영업자 — 실제 채널 SP001 목록 노출 제거' },
];

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

  const [u3, u4, logs] = await Promise.all([
    db.ref('users').get(), db.ref('v4/users').get(), db.ref('v4/audit_logs').limitToLast(1).get(),
  ]);
  const V3 = (u3.val() || {}) as Record<string, Rec>;
  const V4 = (u4.val() || {}) as Record<string, Rec>;

  // companyId 는 기존 감사로그에서 그대로 물려받는다 — 스크립트가 자기 값을 지어내면 화면에서 안 걸린다.
  const companyId = S(Object.values((logs.val() || {}) as Record<string, Rec>)[0]?.companyId) || 'freepass';
  const actor = { uid: 'script:deactivate-accounts', role: 'admin', name: '관리자(정리 스크립트)' };

  console.log('\n══ 계정 비활성화 (삭제 아님 · 되돌릴 수 있음) ══\n');

  const plan: { uid: string; before: Rec; after: Rec; inV4: boolean; why: string }[] = [];
  for (const t of TARGETS) {
    const cur = { ...(V3[t.uid] || {}), ...(V4[t.uid] || {}) } as Rec;
    if (!Object.keys(cur).length) { console.log(`  ⚠ ${t.uid} — 계정이 없다. 건너뛴다`); continue; }
    const already = S(cur.is_active) === '아니오';
    console.log(`  ${S(cur.email) || t.uid}`);
    console.log(`     ${S(cur.name) || '(이름없음)'} · ${S(cur.role)} · ${S(cur.company_code) || '소속없음'} · 현재 활성=${S(cur.is_active) || '(빈값=활성)'}${already ? '  → 이미 비활성' : ''}`);
    console.log(`     ${t.why}`);
    if (already) continue;
    plan.push({ uid: t.uid, before: cur, after: { ...cur, is_active: '아니오' }, inV4: V4[t.uid] !== undefined, why: t.why });
  }

  console.log(`\n  바꿀 계정 ${plan.length}개`);
  if (!plan.length) { console.log('\n할 일 없음.\n'); return; }
  if (!APPLY) { console.log('\n※ dry-run. 반영은 --apply\n'); return; }

  writeFileSync('tmp/deactivate-accounts-backup.json', JSON.stringify(Object.fromEntries(plan.map((p) => [p.uid, p.before])), null, 1), 'utf8');
  console.log('  백업 → tmp/deactivate-accounts-backup.json');

  for (const p of plan) {
    // ① 규칙이 보는 v3
    await db.ref(`users/${p.uid}`).update({ is_active: '아니오' });
    // ② v4 는 이미 있을 때만 — 없는데 만들면 껍데기 레코드가 된다
    if (p.inV4) await db.ref(`v4/users/${p.uid}`).update({ is_active: '아니오' });
    // ③ 앱과 같은 형식의 감사로그
    const entry = buildAuditEntry('user', companyId, p.uid, 'update', p.before as never, p.after as never, actor, {
      summary: `계정 비활성화 — ${p.why}`,
    });
    if (entry) await db.ref(`v4/audit_logs/${String(entry._key)}`).update(entry as Record<string, unknown>);
    console.log(`     ✅ ${S(p.before.email) || p.uid} 비활성 (v3${p.inV4 ? '+v4' : ''} · 감사로그 기록)`);
  }
  console.log('\n되돌리려면 백업의 is_active 값을 다시 쓰면 된다.\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
