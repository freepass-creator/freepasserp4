/**
 * **RTDB 를 뿌리 뽑기 «전»에, 아직 안 옮겨진 것을 통째로 건져 둔다.** 기본 미리보기 · `--apply` 로 저장.
 *
 * > 사장님 2026-09-10 「코덱스가 지금 마무리하고 있고 **RTDB 지금 뿌리 뽑는** 거야」
 *
 * ⚠⚠ **되돌릴 수 없는 것은 이것 하나다.** 스크립트·npm 명령은 git 이 들고 있어 언제든 되살린다.
 *   그런데 **RTDB 에만 있는 데이터는 RTDB 를 지우면 끝이다** — 어디에도 사본이 없다.
 *   실측 2026-09-10(`audit-firestore-parity`):
 * ```
 *   sheet_sync_backups   231 → 0     통째로 안 옮겨졌다
 *   ops                    1 → 0     통째로 안 옮겨졌다
 *   report                 1 → 0     통째로 안 옮겨졌다
 *   sheet_edits           93 → 45    48건 없음
 *   sheet_sync_runs      356 → 323   33건 없음
 * ```
 *   ★짚인 원인 — `sheet_sync_backups` 의 한 문서가 **1.43 MB** 로 Firestore 한도 1 MiB 를 넘는다.
 *     이관 명단 순서가 `… sheet_sync_backups → ops → report` 라, 거기서 터지면 **뒤 둘은 아예 못 돈다.**
 *     셋이 나란히 0 인 것과 맞는다. ⚠ 정황이 맞을 뿐 이관 실행 로그로 확인한 것은 아니다.
 *
 * ★**이 스크립트는 Firestore 에 «쓰지 않는다».** 1 MiB 를 넘는 문서를 억지로 밀어 넣으면 또 터진다.
 *   판단(쪼갤지 · GCS 로 뺄지 · 그냥 파일로 둘지)은 사람 몫이라, 여기서는 **파일로 건지기만** 한다.
 *   ⇒ 뿌리를 뽑아도 데이터는 남는다. 어디로 넣을지는 그다음에 천천히 정한다.
 *
 * ★건진 것은 노드마다 한 파일(JSON)로 두고, 1 MiB 넘는 문서는 «몇 바이트인지» 따로 적어 둔다.
 *
 *   npx tsx --require ./scripts/lib/server-only-shim.cjs scripts/rescue-rtdb-leftovers.mts [--apply]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(process.cwd());
const S = (v: unknown) => String(v ?? '').trim();
const APPLY = process.argv.includes('--apply');
if (!S(process.env.GOOGLE_APPLICATION_CREDENTIALS)) process.env.GOOGLE_APPLICATION_CREDENTIALS = 'tmp/firebase-auth/sa.json';
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS), 'utf8'));
const app = initializeApp({
  credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: S(sa.private_key).replace(/\\n/g, '\n') }),
  databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app',
});
const rtdb = getDatabase(app);
const fs = getFirestore(app);

/** 파리티가 ⛔ 로 찍은 노드 — RTDB 에 있는데 Firestore 에 없거나 모자란 것. */
const 노드 = ['sheet_sync_backups', 'ops', 'report', 'sheet_edits', 'sheet_sync_runs'];
const 나갈곳 = 'tmp/rtdb-rescue';
const MIB = 1024 * 1024;

let 총건짐 = 0, 총바이트 = 0;
const 큰문서: string[] = [];
const 요약: string[] = [];

for (const node of 노드) {
  const snap = await rtdb.ref(`v4/${node}`).get();
  const val = (snap.val() || {}) as Record<string, unknown>;
  const keys = Object.keys(val);
  if (!keys.length) { 요약.push(`  ○ ${node.padEnd(20)} RTDB 에도 없다 — 건질 것 없음`); continue; }

  /** Firestore 에 «이미» 있는 것은 건질 까닭이 없다 — 없는 것만 센다(그래도 파일엔 통째로 담는다). */
  const 있는것 = new Set((await fs.collection(node).listDocuments()).map((d) => d.id));
  const 없는키 = keys.filter((k) => !있는것.has(k.replace(/[/#.$[\]]/g, '_')));

  let bytes = 0;
  for (const k of keys) {
    const n = Buffer.byteLength(JSON.stringify(val[k] ?? null), 'utf8');
    bytes += n;
    if (n > MIB) 큰문서.push(`${node}/${k} — ${n.toLocaleString()} 바이트 (한도 ${MIB.toLocaleString()} 초과)`);
  }
  총건짐 += keys.length; 총바이트 += bytes;
  요약.push(`  ✓ ${node.padEnd(20)} RTDB ${String(keys.length).padStart(4)}건 · Firestore 에 없는 것 ${String(없는키.length).padStart(4)}건 · ${(bytes / 1024).toFixed(0)} KB`);

  if (APPLY) {
    mkdirSync(나갈곳, { recursive: true });
    writeFileSync(`${나갈곳}/${node}.json`, JSON.stringify(val, null, 1), 'utf8');
  }
}

console.log(`\n■ RTDB 남은 것 건지기 — 노드 ${노드.length}곳`);
for (const l of 요약) console.log(l);
console.log(`\n  합계 ${총건짐}건 · ${(총바이트 / MIB).toFixed(2)} MB`);
if (큰문서.length) {
  console.log(`\n  ⚠ Firestore 한도(1 MiB)를 넘는 문서 ${큰문서.length}개 — 그냥 넣으면 또 터진다`);
  for (const x of 큰문서) console.log(`     ${x}`);
  console.log(`     ⇒ 쪼개거나 GCS 로 빼야 한다. 이 스크립트는 «판단하지 않고» 파일로만 건진다.`);
}
if (!APPLY) { console.log(`\n미리보기 — 파일로 건지려면 --apply (나갈 곳: ${나갈곳}/)\n`); process.exit(0); }
console.log(`\n✓ ${나갈곳}/ 에 건졌다 — 이제 RTDB 를 지워도 이 데이터는 남는다\n`);
process.exit(0);
