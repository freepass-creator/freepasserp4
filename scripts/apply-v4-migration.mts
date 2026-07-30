/**
 * v3 → v4 이관 — ② 적용 (owner 권한 필요)
 * MIGRATION_PLAN.md 5단계.
 *
 * 기본은 **드라이런**이다. 실제 쓰기는 `--apply`를 명시해야만 일어난다.
 *
 * 실행:
 *   # 드라이런 — 무엇을 쓸지 계산만(네트워크 읽기는 함)
 *   npx tsx scripts/apply-v4-migration.mts tmp/migration/v4-payload.json
 *   # 실제 적용
 *   npx tsx scripts/apply-v4-migration.mts tmp/migration/v4-payload.json --apply
 *
 * 사전 준비:
 *   npm i -D firebase-admin
 *   서비스계정 키를 GOOGLE_APPLICATION_CREDENTIALS 로 지정(또는 FIREBASE_SERVICE_ACCOUNT_JSON 에 JSON 문자열)
 *   .gitignore 에 키 파일 등록 필수
 *
 * ── 안전 설계 ──
 *  · **update() 멀티패스만 쓴다. set() 금지** — v4에는 이관과 무관한 운영 데이터가 이미 있다
 *    (백업 실측: v4/products 5,629 · v4/rooms 48 · v4/contracts 4 …). set()은 그걸 날린다.
 *  · 쓰기 전에 해당 경로의 **현재 값을 읽어 JSONL 로그**로 남긴다 → 경로 단위 역재생이 롤백 수단.
 *  · 500경로씩 청크. 한 청크가 실패하면 거기서 멈춘다(이미 쓴 청크는 로그로 되돌린다).
 *  · **기존 값이 있는 경로는 기본적으로 건너뛴다**(--overwrite 로만 덮어씀).
 *    이관은 "빈 곳을 채우는 것"이지 운영 데이터를 갈아엎는 게 아니다.
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

type Rec = Record<string, any>;

const PAYLOAD = process.argv[2];
const APPLY = process.argv.includes('--apply');
const OVERWRITE = process.argv.includes('--overwrite');
const CHUNK = 500;

if (!PAYLOAD) {
  console.error('사용법: npx tsx scripts/apply-v4-migration.mts <v4-payload.json> [--apply] [--overwrite]');
  process.exit(1);
}

/** 페이로드(노드→키→레코드)를 RTDB 멀티패스 경로 맵으로 편다. */
function flatten(payload: Rec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [node, bag] of Object.entries(payload)) {
    if (!bag || typeof bag !== 'object') continue;
    for (const [key, rec] of Object.entries(bag as Rec)) {
      // 레코드 단위 경로 — 필드 단위로 더 쪼개면 경로 수가 폭증하고,
      // 레코드 통째 쓰기가 규칙(.validate hasChildren)에도 맞는다.
      out[`v4/${node}/${key}`] = rec;
    }
  }
  return out;
}

async function main() {
  const payload: Rec = JSON.parse(readFileSync(PAYLOAD, 'utf8'));
  const paths = flatten(payload);
  const keys = Object.keys(paths).sort(); // 결정적 순서 — 재실행 시 같은 청크 경계
  console.log(`페이로드 경로 ${keys.length.toLocaleString()}개 (${Object.keys(payload).join(', ')})`);

  if (!APPLY) {
    const byNode = new Map<string, number>();
    for (const k of keys) { const n = k.split('/')[1]; byNode.set(n, (byNode.get(n) || 0) + 1); }
    console.log('\n노드별:');
    for (const [n, c] of [...byNode].sort((a, b) => b[1] - a[1])) console.log(`  v4/${n}: ${c.toLocaleString()}`);
    console.log(`\n청크 ${Math.ceil(keys.length / CHUNK)}회 (${CHUNK}경로씩)`);
    console.log('\n드라이런 — 실제 쓰기 없음. 적용하려면 --apply');
    console.log('※ --apply 전에 반드시 전체 백업을 떠 둘 것');
    return;
  }

  // ── 여기부터 실제 적용 ──
  let admin: any;
  try {
    admin = await import('firebase-admin');
  } catch {
    console.error('firebase-admin 이 없다. `npm i -D firebase-admin` 후 다시 실행할 것.');
    process.exit(1);
  }
  const dbUrl = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || process.env.FIREBASE_DATABASE_URL;
  if (!dbUrl) { console.error('DB URL 없음 — NEXT_PUBLIC_FIREBASE_DATABASE_URL 를 설정할 것.'); process.exit(1); }

  const svcJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const credential = svcJson
    ? admin.credential.cert(JSON.parse(svcJson))
    : admin.credential.applicationDefault(); // GOOGLE_APPLICATION_CREDENTIALS
  const app = admin.initializeApp({ credential, databaseURL: dbUrl });
  const db = app.database();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath = join('tmp/migration', `apply-${stamp}.jsonl`);
  mkdirSync(dirname(logPath), { recursive: true });
  const log = (o: unknown) => appendFileSync(logPath, JSON.stringify(o) + '\n', 'utf8');
  log({ t: 'start', at: new Date().toISOString(), payload: PAYLOAD, paths: keys.length, overwrite: OVERWRITE });

  let written = 0; let skipped = 0; let chunkNo = 0;
  try {
    for (let i = 0; i < keys.length; i += CHUNK) {
      const slice = keys.slice(i, i + CHUNK);
      chunkNo++;

      // 1) 기존 값 읽기 — 롤백 로그 + 덮어쓰기 판정
      const before: Record<string, unknown> = {};
      await Promise.all(slice.map(async (p) => {
        const snap = await db.ref(p).get();
        before[p] = snap.exists() ? snap.val() : null;
      }));

      // 2) 대상 선별 — 기존 값이 있으면 기본 스킵(운영 데이터 보호)
      const patch: Record<string, unknown> = {};
      for (const p of slice) {
        if (before[p] != null && !OVERWRITE) { skipped++; continue; }
        patch[p] = paths[p];
      }
      if (!Object.keys(patch).length) {
        console.log(`  청크 ${chunkNo}: 전부 기존값 존재 → 건너뜀`);
        continue;
      }

      log({ t: 'chunk-before', chunk: chunkNo, before: Object.fromEntries(Object.keys(patch).map((p) => [p, before[p]])) });
      await db.ref().update(patch); // ★ set() 금지 — 멀티패스 update만
      written += Object.keys(patch).length;
      log({ t: 'chunk-done', chunk: chunkNo, wrote: Object.keys(patch).length });
      console.log(`  청크 ${chunkNo}/${Math.ceil(keys.length / CHUNK)} — ${Object.keys(patch).length}경로 기록 (누적 ${written})`);
    }
    log({ t: 'end', written, skipped });
    console.log(`\n완료 — 기록 ${written.toLocaleString()} · 기존값 보존으로 건너뜀 ${skipped.toLocaleString()}`);
    console.log(`로그: ${logPath}`);
    console.log('\n다음: npx tsx scripts/verify-v4-migration.mts <백업.json> — 검증을 통과해야 7단계로 간다');
  } catch (e) {
    log({ t: 'error', chunk: chunkNo, message: (e as Error).message });
    console.error(`\n⛔ 청크 ${chunkNo}에서 실패: ${(e as Error).message}`);
    console.error(`이미 기록된 청크는 ${logPath} 의 chunk-before 로 되돌린다.`);
    process.exit(2);
  } finally {
    await app.delete().catch(() => undefined);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
