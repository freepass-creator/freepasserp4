/**
 * 약관·개인정보 동의 증적 실사 — 「누가 동의 없이 쓰고 있는가」.
 *
 * 재동의 게이트(NEXT_PUBLIC_REQUIRE_LEGAL_RECONSENT)를 켜기 전에 규모를 안다.
 * 켜면 해당 계정은 **다음 로그인에서 동의 화면에 막힌다** — 몇 명이 그 화면을 보게 되는지
 * 모르고 켜면 그날 아침 문의가 폭주한다. 값은 출력하지 않고 사람 수만 센다.
 */
import { readFileSync } from 'node:fs';
import { needsLegalReconsent, type Session } from '@/lib/auth-session';
import { LEGAL_VERSION } from '@/lib/legal';

const S = (v: unknown) => String(v ?? '').trim();

async function main() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');
  if (!getApps().length) {
    const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
    initializeApp({ credential: cert(sa), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
  }
  const users = ((await getDatabase().ref('users').get()).val() || {}) as Record<string, any>;

  const byRole = new Map<string, { alive: number; needs: number }>();
  let alive = 0, needs = 0, noneAtAll = 0, oldVersion = 0;
  for (const u of Object.values(users)) {
    const active = S(u?.status) !== 'pending' && S(u?.status) !== 'deleted' && S(u?.status) !== 'rejected'
      && u?.is_active !== false && S(u?.is_active) !== '아니오';
    if (!active) continue;
    alive++;
    const role = S(u?.role) || '(역할없음)';
    const bucket = byRole.get(role) || { alive: 0, needs: 0 };
    bucket.alive++;
    // 앱과 **같은 함수**로 판정한다 — 여기서 따로 세면 화면과 숫자가 갈린다.
    const session = {
      terms_agreed_at: Number(u?.terms_agreed_at || 0),
      privacy_agreed_at: Number(u?.privacy_agreed_at || 0),
      legal_version: S(u?.legal_version),
    } as Session;
    if (needsLegalReconsent(session, LEGAL_VERSION)) {
      needs++; bucket.needs++;
      if (!Number(u?.terms_agreed_at) && !Number(u?.privacy_agreed_at)) noneAtAll++;
      else if (S(u?.legal_version) !== LEGAL_VERSION) oldVersion++;
    }
    byRole.set(role, bucket);
  }

  console.log(`\n현재 법적 문서 버전 ${LEGAL_VERSION}`);
  console.log(`활성 계정 ${alive} · 재동의 필요 ${needs} (${alive ? Math.round((needs / alive) * 100) : 0}%)`);
  console.log(`   동의 기록이 아예 없음   ${noneAtAll}`);
  console.log(`   옛 버전에 동의함        ${oldVersion}`);
  console.log('\n역할별');
  for (const [role, b] of [...byRole].sort((a, b) => b[1].needs - a[1].needs)) {
    console.log(`   ${role.padEnd(16)} 활성 ${String(b.alive).padStart(4)} · 재동의 필요 ${String(b.needs).padStart(4)}`);
  }
  console.log('\n※ 게이트를 켜면 위 인원이 다음 로그인에서 동의 화면을 본다(동의하면 바로 통과).\n');
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
