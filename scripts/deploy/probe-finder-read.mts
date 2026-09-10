/**
 * **「인증된 사람이 상품찾기 자료를 정말 읽나」를 라이브 규칙에 물어본다.** 읽기 전용.
 *
 * ⚠⚠ 2026-09-04 사고의 정확한 자리다 — `NEXT_PUBLIC_FINDER_FROM_FIRESTORE=1` 이 운영에 켜지자
 *   파인더가 Firestore `products` 를 구독했다가 **규칙에 막혔고**, 실패한 핸들을 쥔 채 재구독도
 *   RTDB 폴백도 안 해서 `rows=null` 이 굳었다. 본문은 스켈레톤인데 머리는 예전에 센 「742대」를 보여 줬다.
 *   ★**숫자가 맞는데 화면이 빈** 꼴이라, 데이터 상태판으로는 안 잡힌다.
 *
 * ★**브라우저 로그인이 필요 없다.** `scripts/deploy/rules-probe.mts` 와 같은 길 —
 *   서비스계정으로 실제 사용자 uid 의 커스텀 토큰을 발급 → ID 토큰으로 교환 →
 *   Firestore REST 에 `Authorization: Bearer <idToken>` 으로 직접 쏜다.
 *   이 경로는 admin SDK 우회가 없어 **라이브 규칙이 그대로 판정한다.**
 *
 * ★**아무것도 안 만들고 안 쓴다.** 계정을 만들지 않고(있는 사람의 uid 를 빌린다), 읽기만 한다.
 *   ⚠ 남의 이름으로 «쓰는» 일에는 이 길을 쓰지 않는다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/deploy/probe-finder-read.mts
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
if (!S(process.env.GOOGLE_APPLICATION_CREDENTIALS)) process.env.GOOGLE_APPLICATION_CREDENTIALS = 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS), 'utf8'));
const app = initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }) });
const fs = getFirestore(app);

const apiKey = (() => {
  const env = readFileSync('.env.local', 'utf8');
  const line = env.split(/\r?\n/).find((l) => l.startsWith('NEXT_PUBLIC_FIREBASE_API_KEY='));
  return (line || '').split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
})();
if (!apiKey) { console.error('✗ .env.local 에 NEXT_PUBLIC_FIREBASE_API_KEY 가 없다 — 규칙을 «사람으로» 물어볼 수 없다.'); process.exit(1); }

async function idTokenFor(uid: string): Promise<string> {
  const custom = await getAuth(app).createCustomToken(uid);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const j = await r.json() as { idToken?: string; error?: { message?: string } };
  if (!j.idToken) throw new Error(`ID 토큰 교환 실패(${uid}): ${j.error?.message || r.status}`);
  return j.idToken;
}

/** 역할마다 한 사람씩 빌린다 — 이름은 찍되 «읽기»만 한다. */
const 역할 = ['agent', 'provider', 'admin'] as const;
const 결과: string[] = [];
let 막힘 = 0;
console.log(`\n■ 상품찾기 읽기 실사격 — 라이브 규칙에 «사람으로» 물어본다 (읽기만)\n`);
for (const role of 역할) {
  const pick = (await fs.collection('user').where('role', '==', role).limit(1).get()).docs[0];
  if (!pick) { console.log(`  ${role.padEnd(9)} 그 역할인 사람이 없다 — 건너뜀`); continue; }
  const who = `${pick.id.slice(0, 8)}… ${S((pick.data() as { name?: unknown }).name)}`;
  try {
    const tok = await idTokenFor(pick.id);
    const q = await fetch(`https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/products?pageSize=3`, { headers: { Authorization: `Bearer ${tok}` } });
    const body = await q.text();
    const ok = q.ok;
    const n = ok ? (JSON.parse(body).documents || []).length : 0;
    console.log(`  ${role.padEnd(9)} ${who.padEnd(22)} ${q.status} ${ok ? `✔ 읽힌다 (표본 ${n}건)` : '✗ 막힌다'}`);
    if (!ok) { 막힘++; 결과.push(`${role}: ${body.slice(0, 160)}`); }
  } catch (e) {
    막힘++; 결과.push(`${role}: ${(e as Error).message.slice(0, 160)}`);
    console.log(`  ${role.padEnd(9)} ${who.padEnd(22)} ✗ ${(e as Error).message.slice(0, 80)}`);
  }
}
for (const x of 결과) console.log(`     ${x}`);
if (막힘) {
  console.log(`\n⛔ ${막힘}개 역할이 상품찾기 자료를 못 읽는다 — 그 역할로 로그인하면 «본문이 빈 화면»을 본다.`);
  console.log('   되돌리기 = 운영 환경변수 NEXT_PUBLIC_FINDER_FROM_FIRESTORE=0 (배포 없이 됨)\n');
  process.exit(1);
}
console.log(`\n✓ 세 역할 다 읽는다 — 로그인한 사람은 목록을 본다\n`);
process.exit(0);
