/**
 * 민감필드(_private) 이관이 실데이터에 «실제로» 끝났나 — 읽기 전용 프로브.
 *
 * private-fields.ts 는 폴백 계약이라, 이관이 안 끝났어도 화면은 멀쩡히 돈다.
 * 따라서 «화면이 정상»은 이관 완료의 증거가 못 된다. 본노드에 민감값이 남아 있는지를 직접 센다.
 *
 * 규칙(users read = auth만)이 좁혀지지 않은 상태에서 본노드에 값이 남아 있으면
 * 로그인한 아무나 전 회원 연락처를 읽을 수 있다.
 *
 * ★ phone·agent_payout_rate 는 «의도적 보존»이다(migrate-private.ts RETAINED) —
 *   /q 공개견적 연락 CTA 와 공급사 대리 계약생성의 payout 해석이 본노드를 읽는다.
 *   그래서 이 스크립트는 그 둘을 «남아야 하는 것»으로 표시하고, email 만 이관 대상으로 센다.
 *
 * 이관 전 안전점검도 함께 낸다 — rtdb-records.ts 가 `name || email` 로 표시명을 만들므로
 * 이름이 빈 회원은 email 제거 시 «이름 없는 회원»이 된다.
 *
 * 읽기 전용. npx tsx scripts/audit-private-fields.mts
 */
import { readFileSync } from 'node:fs';

type Rec = Record<string, unknown>;
const S = (v: unknown) => String(v ?? '').trim();
const has = (v: unknown) => v !== undefined && v !== null && S(v) !== '';

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

  const [p, pp, u, up, p4, u4] = await Promise.all([
    db.ref('partners').get(), db.ref('v4/partners_private').get(),
    db.ref('users').get(), db.ref('v4/users_private').get(),
    db.ref('v4/partners').get(), db.ref('v4/users').get(),
  ]);

  const priv = { partner: (pp.val() || {}) as Record<string, Rec>, user: (up.val() || {}) as Record<string, Rec> };

  console.log('\n══ 민감필드가 공개 노드에 남아 있나 ══\n');

  const FIELDS = {
    partner: [{ f: 'fee_rate', move: true }],
    user: [
      { f: 'email', move: true },
      { f: 'phone', move: false },
      { f: 'agent_payout_rate', move: false },
    ],
  } as const;

  for (const [label, kind, snap] of [
    ['공급사 partners(v3)', 'partner', p],
    ['공급사 v4/partners', 'partner', p4],
    ['회원 users(v3)', 'user', u],
    ['회원 v4/users', 'user', u4],
  ] as const) {
    const rows = (snap.val() || {}) as Record<string, Rec>;
    const total = Object.keys(rows).length;
    console.log(`■ ${label}  ${total}건   ·  private ${Object.keys(priv[kind]).length}건`);
    if (!total) { console.log('   (없음)\n'); continue; }
    for (const { f, move } of FIELDS[kind]) {
      const exposed = Object.values(rows).filter((r) => has(r?.[f])).length;
      const moved = Object.values(priv[kind]).filter((r) => has(r?.[f])).length;
      const mark = !move ? '·' : exposed ? '❌' : '✓';
      const tail = move ? '' : '   ← 의도적 보존(RETAINED)';
      console.log(`   ${mark} ${f.padEnd(20)} 본노드 ${String(exposed).padStart(4)}건 · private ${String(moved).padStart(4)}건${tail}`);
    }
    console.log('');
  }

  // ── 이관 전 안전점검 ──────────────────────────────────
  // rtdb-records.ts: name = record.name || record.email → 이름이 비면 email 이 표시명이다.
  const users = (u.val() || {}) as Record<string, Rec>;
  const nameless = Object.entries(users).filter(([, r]) => !has(r?.name) && has(r?.email));
  console.log('── 이관 전 안전점검 ──');
  console.log(`  이름이 비어 email 이 표시명인 회원  ${nameless.length}건${nameless.length ? '  ← 이관하면 이름 없는 회원이 된다' : '  ✓'}`);
  for (const [k, r] of nameless.slice(0, 12)) {
    console.log(`     ${k.slice(0, 12).padEnd(14)} ${S(r.email).padEnd(32)} ${S(r.role) || '역할없음'} · ${S(r.status) || '상태없음'}`);
  }
  if (nameless.length > 12) console.log(`     … 그 외 ${nameless.length - 12}건`);

  console.log('\n※ 읽기 전용. email 본노드 노출이 0 이어야 규칙을 좁히지 않아도 유출이 없다.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
