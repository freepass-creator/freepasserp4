/**
 * 차종마스터 단일정본을 RTDB `vehicle_master` 에 박는다 — 엔진이 파일 대신 이걸 호출하게.
 *
 * 정본 소스 = `public/data/vehicle-master.json`(MasterEntry[] — snapToMaster·fill 이 쓰는 그것).
 * 노드 모양 = { [sanitizedId]: MasterEntry }. 로더 = lib/domain/vehicle-master-rtdb.ts (한 번 읽어 캐시).
 *
 * 기본 dry-run. 반영은 --apply (반영 전 현재 노드를 tmp 에 백업).
 *   npx tsx scripts/publish-master-to-rtdb.mts
 *   npx tsx scripts/publish-master-to-rtdb.mts --apply
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { masterEntriesFromRtdbValue } from '../lib/domain/vehicle-master-rtdb';
import type { MasterEntry } from '../lib/domain/vehicle-master-types';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync(S(process.env.GOOGLE_APPLICATION_CREDENTIALS) || 'tmp/firebase-auth/sa.json', 'utf8'));
initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const db = getDatabase();

const raw = JSON.parse(readFileSync('public/data/vehicle-master.json', 'utf8')) as any;
const entries = ((Array.isArray(raw) ? raw : raw.entries) || []) as MasterEntry[];
const keyOf = (e: MasterEntry, i: number) => String(e.id || `${e.maker}_${e.model}_${e.sub_model}_${i}`).replace(/[.#$/\[\]]/g, '_');
const node: Record<string, MasterEntry> = {};
for (let i = 0; i < entries.length; i++) { const e = entries[i]; if (e && e.model) node[keyOf(e, i)] = e; }

const cur = masterEntriesFromRtdbValue((await db.ref('vehicle_master').get()).val());
console.log(`정본 vehicle-master.json: ${entries.length} MasterEntry → RTDB 원자 ${Object.keys(node).length}`);
console.log(`현재 RTDB vehicle_master: ${cur.length} 원자`);
console.log('샘플 3:');
for (const e of entries.slice(0, 3)) console.log(`  ${e.maker} ${e.model} ${e.sub_model} [${(e as any).gen_code || ''}] · variant ${(e.variants || []).length}`);

if (!APPLY) {
  console.log(`\n미리보기 — 반영하면 vehicle_master 를 정본 MasterEntry ${Object.keys(node).length}원자로 교체(호출용 단일정본).`);
  console.log('실제 반영: --apply (반영 전 tmp 백업)');
  process.exit(0);
}
mkdirSync('tmp', { recursive: true });
const backup = `tmp/vehicle_master-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(backup, JSON.stringify((await db.ref('vehicle_master').get()).val() ?? {}, null, 1));
console.log(`\n백업 → ${backup}`);
await db.ref('vehicle_master').set(node);
console.log(`반영 완료 — vehicle_master = 정본 MasterEntry ${Object.keys(node).length}원자. 엔진·검증이 이걸 호출한다.`);
process.exit(0);
