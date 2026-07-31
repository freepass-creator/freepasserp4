/**
 * 이관 직전 점검 — ① 전체 백업 ② 선정리(3단계) 반영 여부 ③ 충돌 경로 사전 탐지
 *
 * 왜 필요한가: v4-payload 는 **로컬에서 선정리한 백업본**(backup-cleaned.json)에서 만들었다.
 * 프로덕션에 선정리가 안 들어가 있으면 이관 결과가 페이로드 전제와 어긋난다
 * (중복 U0001 이 살아있고, SP999 채널이 없고, 만료 서명이 남아있다).
 *
 * 실행:
 *   GOOGLE_APPLICATION_CREDENTIALS=tmp/firebase-auth/sa.json npx tsx scripts/preflight-migration.mts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

const DB_URL = 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app';

const saJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
initializeApp({
  credential: saJson ? cert(JSON.parse(saJson)) : applicationDefault(),
  databaseURL: DB_URL,
});
const db = getDatabase();

const S = (v: unknown) => String(v ?? '');
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main() {
  const t = stamp();
  mkdirSync('tmp/migration', { recursive: true });

  // ── ① 전체 백업 ──────────────────────────────────────────────────────
  console.log('① 전체 백업 받는 중…');
  const rootSnap = await db.ref('/').get();
  const root = (rootSnap.val() || {}) as Record<string, any>;
  const backupPath = `tmp/migration/pre-apply-${t}.json`;
  writeFileSync(backupPath, JSON.stringify(root), 'utf8');
  const sizeMb = (readFileSync(backupPath).length / 1024 / 1024).toFixed(1);
  console.log(`   → ${backupPath} (${sizeMb} MB)`);
  console.log(`   루트 노드: ${Object.keys(root).join(', ')}`);

  // ── ② 선정리 반영 여부 ───────────────────────────────────────────────
  console.log('\n② 선정리(3단계) 반영 여부');
  const patch = JSON.parse(readFileSync('tmp/migration/cleanup-patch.json', 'utf8')) as Record<string, unknown>;
  const getPath = (p: string): unknown => p.split('/').reduce<any>((o, k) => (isObj(o) ? o[k] : undefined), root);

  let applied = 0; const missing: string[] = []; const ignored: string[] = [];
  for (const [path, want] of Object.entries(patch)) {
    const cur = getPath(path);
    const ok = want === null ? cur === undefined || cur === null : S(cur) === S(want);
    if (ok) { applied += 1; continue; }
    // 타임스탬프는 패치를 다시 생성할 때마다 달라진다 — 값이 들어있기만 하면 반영된 것으로 본다.
    if (/_(at)$/.test(path) && cur !== undefined && cur !== null) { ignored.push(`${path} (타임스탬프 차이)`); continue; }
    // users/* 는 이관 페이로드가 건드리지 않는다 — 이관 전제가 아니라 별건이다.
    if (path.startsWith('users/')) { ignored.push(`${path} (users는 이관 대상 아님 — 별건)`); continue; }
    missing.push(`${path}  기대=${JSON.stringify(want)}  실제=${JSON.stringify(cur)}`);
  }
  console.log(`   ${applied}/${Object.keys(patch).length} 일치`);
  if (ignored.length) {
    console.log('   무시(이관과 무관):');
    for (const m of ignored) console.log('    ·', m);
  }
  if (missing.length) {
    console.log('   ⛔ 미반영(이관 전제):');
    for (const m of missing) console.log('    ·', m);
  }

  // ── ③ 페이로드 충돌 사전 탐지 ────────────────────────────────────────
  console.log('\n③ 페이로드가 덮어쓸 뻔한 기존 값(적용 시 건너뛸 경로)');
  const payload = JSON.parse(readFileSync('tmp/migration/v4-payload.json', 'utf8')) as Record<string, any>;
  const v4 = (root.v4 || {}) as Record<string, any>;
  const rows: string[] = [];
  let total = 0, collide = 0;
  for (const [node, bag] of Object.entries(payload)) {
    if (!isObj(bag)) continue;
    const cur = (v4[node] || {}) as Record<string, any>;
    const keys = Object.keys(bag);
    const hit = keys.filter((k) => cur[k] !== undefined);
    total += keys.length; collide += hit.length;
    rows.push(`   v4/${node}: 이관 ${keys.length} · 이미 있음 ${hit.length}${hit.length ? ` (예: ${hit.slice(0, 3).join(', ')})` : ''}`);
  }
  for (const r of rows) console.log(r);
  console.log(`   합계: 이관 ${total} · 충돌 ${collide} → 충돌분은 --apply 에서 자동 건너뜀`);

  // ── 참고: 현재 v4 규모 ───────────────────────────────────────────────
  console.log('\n④ 현재 v4 노드 규모(이관과 무관한 운영 데이터 포함)');
  for (const [k, v] of Object.entries(v4)) {
    if (isObj(v)) console.log(`   v4/${k}: ${Object.keys(v).length}`);
  }

  console.log(`\n판정: ${missing.length === 0 ? '✅ 선정리 반영 완료 — 적용 진행 가능' : '⛔ 선정리 미반영 — 먼저 cleanup-patch 를 적용해야 한다'}`);
  process.exit(missing.length === 0 ? 0 : 2);
}

main().catch((e) => { console.error('실패:', e?.message || e); process.exit(1); });
