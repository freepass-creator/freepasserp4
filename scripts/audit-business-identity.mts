/**
 * 사업자등록번호 별칭 정합성 읽기 전용 감사.
 *
 * 원문 값과 레코드 식별자는 출력하지 않는다. 운영 RTDB 쓰기 없음.
 * 실행: npx tsx scripts/audit-business-identity.mts
 */
import { applicationDefault, cert, initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import {
  businessRegistrationIdentity,
  normalizeBusinessRegistrationNumber,
  type BusinessIdentityKind,
} from '../lib/domain/business-identity';
import type { EntityRecord } from '../lib/intake/entities';
import { toV4Record } from '../lib/firebase/rtdb-records';

type RawRecord = Record<string, unknown>;

const COMPANY_ID = process.env.COMPANY_ID || 'freepass';
const READ_TIMEOUT_MS = 20_000;
const TARGETS: Array<{ kind: BusinessIdentityKind; node: string; primary: string; aliases: readonly string[] }> = [
  { kind: 'partner', node: 'partners', primary: 'business_number', aliases: ['business_number', 'business_no', 'biz_no'] },
  { kind: 'user', node: 'users', primary: 'business_no', aliases: ['business_no', 'business_number', 'biz_no'] },
  { kind: 'customer', node: 'customers', primary: 'business_no', aliases: ['business_no', 'business_number', 'customer_business_number', 'biz_no'] },
  { kind: 'contract', node: 'contracts', primary: 'customer_business_number', aliases: ['customer_business_number', 'business_number', 'business_no', 'biz_no'] },
];

async function read(path: string): Promise<unknown> {
  return Promise.race([
    getDatabase().ref(path).get().then((snapshot) => snapshot.val()),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`RTDB read timeout: ${path}`)), READ_TIMEOUT_MS);
    }),
  ]);
}

function rows(raw: unknown): Array<[string, RawRecord]> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw as RawRecord)
    .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value)) as Array<[string, RawRecord]>;
}

function merge(node: string, v3: unknown, v4: unknown): EntityRecord[] {
  const merged = new Map<string, EntityRecord>();
  for (const [childKey, raw] of rows(v3)) {
    const record = toV4Record(node.replace(/s$/, ''), childKey, raw, COMPANY_ID);
    merged.set(String(record._key || childKey), record);
  }
  for (const [childKey, raw] of rows(v4)) {
    const record = toV4Record(node.replace(/s$/, ''), childKey, raw, COMPANY_ID);
    const key = String(record._key || childKey);
    const current = { ...(merged.get(key) || {}) };
    for (const [field, value] of Object.entries(record)) {
      if (value !== undefined) current[field] = value;
    }
    merged.set(key, current);
  }
  return [...merged.values()].filter((record) => (
    record._deleted !== true
    && !record.deletedAt
    && !record.deleted_at
    && String(record.status || '') !== 'deleted'
  ));
}

function rawPresent(record: EntityRecord, field: string): boolean {
  return String(record[field] ?? '').trim().length > 0;
}

async function main() {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const credential = serviceAccount ? cert(JSON.parse(serviceAccount)) : applicationDefault();
  try {
    await credential.getAccessToken();
  } catch {
    throw new Error('Firebase 관리자 읽기 자격증명이 없습니다. FIREBASE_SERVICE_ACCOUNT_JSON 또는 GOOGLE_APPLICATION_CREDENTIALS를 설정하세요.');
  }
  initializeApp({
    credential,
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL
      || process.env.FIREBASE_DATABASE_URL
      || 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app',
  });

  console.log('=== 사업자등록번호 별칭 정합성 감사 (값·식별자 미출력 / 읽기 전용) ===');
  for (const target of TARGETS) {
    const [v3, v4] = await Promise.all([read(target.node), read(`v4/${target.node}`)]);
    const records = merge(target.node, v3, v4);
    let populated = 0;
    let primaryPopulated = 0;
    let fallbackUsed = 0;
    let conflicts = 0;
    let invalidLength = 0;
    const aliasPopulation = Object.fromEntries(target.aliases.map((field) => [field, 0])) as Record<string, number>;

    for (const record of records) {
      for (const field of target.aliases) if (rawPresent(record, field)) aliasPopulation[field]++;
      const identity = businessRegistrationIdentity(record, target.kind);
      if (!identity.value) continue;
      populated++;
      if (rawPresent(record, target.primary)) primaryPopulated++;
      if (identity.source !== target.primary) fallbackUsed++;
      if (identity.conflict) conflicts++;
      if (normalizeBusinessRegistrationNumber(identity.value).length !== 10) invalidLength++;
    }

    console.log(`\n[${target.kind}] 활성 ${records.length} · 번호 있음 ${populated}`);
    console.log(`  기본 필드(${target.primary}) 있음: ${primaryPopulated}`);
    console.log(`  별칭 fallback 사용: ${fallbackUsed}`);
    console.log(`  서로 다른 별칭 값 충돌: ${conflicts}`);
    console.log(`  canonical 10자리 아님: ${invalidLength}`);
    console.log(`  필드별 원문 존재: ${Object.entries(aliasPopulation).map(([field, count]) => `${field}=${count}`).join(' · ')}`);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('사업자등록번호 감사 실패:', String((error as Error)?.message || error));
  process.exit(1);
});
