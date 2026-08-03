/**
 * 데이터 원자 감사 — 선언(ENTITIES) × 코드 소비처 × 운영 RTDB 필드 존재 건수.
 *
 * 값은 절대 출력하지 않는다. 운영 write 없음.
 *
 * 사용:
 *   npx tsx scripts/audit-data-atoms.mts
 *   GOOGLE_APPLICATION_CREDENTIALS=... npx tsx scripts/audit-data-atoms.mts --live
 *   ... --live --entity=product
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { ENTITIES, type EntityRecord } from '../lib/intake/entities';
import { toV4Record } from '../lib/firebase/rtdb-records';

type Rec = Record<string, unknown>;

const ROOT = process.cwd();
const LIVE = process.argv.includes('--live');
const ONLY = process.argv.find((arg) => arg.startsWith('--entity='))?.slice('--entity='.length).trim();
const NODE: Record<string, string> = {
  product: 'products', policy: 'policies', room: 'rooms', message: 'messages',
  contract: 'contracts', customer: 'customers', partner: 'partners', report: 'report',
  user: 'users', settlement: 'settlements', quote: 'quote',
  admin_settlement: 'admin_settlements', audit_log: 'audit_logs',
};
const SOURCE_DIRS = ['app', 'components', 'features', 'lib'];
const EXT = /\.(?:ts|tsx|mts)$/;
const META_FIELDS = new Set([
  'companyId', 'createdAt', 'created_at', 'createdBy', 'created_by', 'updatedAt', 'updated_at',
  'updatedBy', 'deletedAt', 'deleted_at', 'status', '_deleted', '_key', '_rtdb_key',
]);
const LIVE_READ_TIMEOUT_MS = 20_000;

async function snapshotValue(path: string): Promise<unknown> {
  const db = getDatabase();
  return Promise.race([
    db.ref(path).get().then((snapshot) => snapshot.val()),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`RTDB read timeout: ${path}`)), LIVE_READ_TIMEOUT_MS);
    }),
  ]);
}

function filesUnder(dir: string): string[] {
  const full = join(ROOT, dir);
  const out: string[] = [];
  for (const name of readdirSync(full)) {
    const path = join(full, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...filesUnder(relative(ROOT, path)));
    else if (EXT.test(name)) out.push(path);
  }
  return out;
}

const sourceFiles = SOURCE_DIRS.flatMap(filesUnder)
  .filter((path) => !path.endsWith(join('lib', 'intake', 'entities.ts')))
  .map((path) => ({
    path: relative(ROOT, path).replace(/\\/g, '/'),
    text: readFileSync(path, 'utf8'),
  }));

function refFiles(field: string): string[] {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`);
  return sourceFiles.filter((file) => pattern.test(file.text)).map((file) => file.path);
}

function isConsumerFile(path: string): boolean {
  if (/^(?:app|components|features)\//.test(path)) return true;
  if (!path.startsWith('lib/domain/')) return false;
  return !/\/(?:sheet-|master-ingress|audit|ids|product-duplicate|settlement-import)/.test(path);
}

function rawRows(entity: string, raw: unknown, overlay: boolean): Array<[string, Rec]> {
  if (!raw || typeof raw !== 'object') return [];
  if (entity === 'message') {
    // v3 messages/{roomId}/{pushId}, v4/messages/{pushId}. 같은 노드명이지만 구조가 다르다.
    if (overlay) {
      return Object.entries(raw as Rec)
        .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value)) as Array<[string, Rec]>;
    }
    const rows: Array<[string, Rec]> = [];
    for (const [roomId, messages] of Object.entries(raw as Rec)) {
      if (!messages || typeof messages !== 'object' || Array.isArray(messages)) continue;
      for (const [key, value] of Object.entries(messages as Rec)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          rows.push([key, { ...(value as Rec), room_id: (value as Rec).room_id || roomId }]);
        }
      }
    }
    return rows;
  }
  return Object.entries(raw as Rec).filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value)) as Array<[string, Rec]>;
}

function mergeRows(entity: string, v3: unknown, v4: unknown): EntityRecord[] {
  const merged = new Map<string, EntityRecord>();
  for (const [childKey, raw] of rawRows(entity, v3, false)) {
    const row = toV4Record(entity, childKey, raw, 'freepass');
    merged.set(String(row._key || childKey), row);
  }
  for (const [childKey, raw] of rawRows(entity, v4, true)) {
    const row = toV4Record(entity, childKey, raw, 'freepass');
    const key = String(row._key || childKey);
    const current = { ...(merged.get(key) || {}) };
    for (const [field, value] of Object.entries(row)) if (value !== undefined) current[field] = value;
    merged.set(key, current);
  }
  return [...merged.values()].filter((row) => row._deleted !== true && !row.deletedAt && String(row.status || '') !== 'deleted');
}

const present = (row: EntityRecord, field: string): boolean => {
  const value = row[field];
  if (value == null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Rec).length > 0;
  return true;
};

async function liveRows(): Promise<Record<string, EntityRecord[]>> {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  initializeApp({
    credential: serviceAccount ? cert(JSON.parse(serviceAccount)) : applicationDefault(),
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL
      || process.env.FIREBASE_DATABASE_URL
      || 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app',
  });
  const names = Object.keys(ENTITIES).filter((name) => !ONLY || name === ONLY);
  const entries = await Promise.all(names.map(async (entity) => {
    const node = NODE[entity];
    if (!node) return [entity, []] as const;
    const [v3, v4] = await Promise.all([snapshotValue(node), snapshotValue(`v4/${node}`)]);
    return [entity, mergeRows(entity, v3, v4)] as const;
  }));
  return Object.fromEntries(entries);
}

async function main() {
  const live = LIVE ? await liveRows() : {};
  const names = Object.keys(ENTITIES).filter((name) => !ONLY || name === ONLY);
  console.log(`=== 데이터 원자 감사${LIVE ? ' · 운영 필드 존재 건수(값 미출력)' : ' · 정적'} ===`);
  for (const entity of names) {
    const fields = ENTITIES[entity].fields.map((field) => field.key);
    const rows = live[entity] || [];
    const stats = fields.map((field) => {
      const refs = refFiles(field);
      const consumers = refs.filter(isConsumerFile);
      return { field, refs, consumers, populated: rows.filter((row) => present(row, field)).length };
    });
    const staticDead = stats.filter((item) => item.refs.length === 0).map((item) => item.field);
    const populatedNoConsumer = stats.filter((item) => item.populated > 0 && item.consumers.length === 0);
    const emptyButConsumed = stats.filter((item) => LIVE && item.populated === 0 && item.consumers.length > 0);
    const declared = new Set(fields);
    const unknown = new Map<string, number>();
    for (const row of rows) {
      for (const field of Object.keys(row)) {
        if (declared.has(field) || META_FIELDS.has(field) || field.startsWith('_')) continue;
        unknown.set(field, (unknown.get(field) || 0) + 1);
      }
    }
    console.log(`\n[${entity}] 선언 ${fields.length}${LIVE ? ` · 활성 레코드 ${rows.length} · 값 존재 원자 ${stats.filter((item) => item.populated > 0).length}` : ''}`);
    console.log(`  코드 직접참조 0: ${staticDead.length ? staticDead.join(', ') : '없음'}`);
    if (LIVE) {
      console.log(`  값은 있으나 소비처 0: ${populatedNoConsumer.length ? populatedNoConsumer.map((item) => `${item.field}(${item.populated})`).join(', ') : '없음'}`);
      console.log(`  소비처는 있으나 운영값 0: ${emptyButConsumed.length ? emptyButConsumed.map((item) => item.field).join(', ') : '없음'}`);
      const unknownTop = [...unknown.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
      console.log(`  스키마 밖 저장원자 상위: ${unknownTop.length ? unknownTop.map(([field, count]) => `${field}(${count})`).join(', ') : '없음'}`);
    }
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('데이터 원자 감사 실패:', String((error as Error)?.message || error));
  process.exit(1);
});
