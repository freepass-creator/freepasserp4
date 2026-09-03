/**
 * 계약·정산·정책·파트너·고객·사용자를 RTDB → Firestore 그림자복사 (RTDB 폐기 준비).
 *   사장님 2026-09-03 「RTDB 안 쓸 테니 계약·정산·정책 다 Firestore 로」.
 *   읽기는 안 바꾼다(위험 0) — 데이터를 Firestore 에 «같이» 둔다. RTDB 는 그대로.
 *
 * 레이아웃 = 범용 FirestoreAdapter 가 읽는 그대로: 컬렉션 `{entity}`, 문서 `{companyId}__{자연키}`,
 *   필드에 companyId·_key 실어 둔다. 자연키 = ENTITIES[entity].idFrom(contract_code 등).
 * 채팅(room·message)은 없앨 것이라 제외. 기본 dry-run · --apply.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';
import { ENTITIES } from '../lib/intake/entities';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const app = initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const rtdb = getDatabase(app);
const fs = getFirestore(app);

// entity → RTDB 노드 이름(복수)
const NODE: Record<string, string> = { contract: 'contracts', settlement: 'settlements', policy: 'policies', partner: 'partners', customer: 'customers', user: 'users' };
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const alive = (v: Record<string, any>) => v._deleted !== true && S(v.status) !== 'deleted' && !v.deletedAt;
const docSafe = (s: string) => s.replace(/[/#.$\[\]]/g, '_');
const companyOf = (v: Record<string, any>) => S(v.companyId) || S(v.provider_company_code) || S(v.company_code) || S(v.partner_code) || 'PT-0000';

let grand = 0;
for (const [entity, node] of Object.entries(NODE)) {
  const idFrom = ENTITIES[entity]?.idFrom || '_key';
  // v3 라이브 ∪ v4 오버레이 — 같은 키는 v4 필드가 이김(RtdbAdapter 규칙).
  const v3 = (await rtdb.ref(node).get()).val() as Record<string, any> || {};
  const v4 = (await rtdb.ref(`v4/${node}`).get()).val() as Record<string, any> || {};
  const merged = new Map<string, Record<string, any>>();
  for (const [k, v] of Object.entries(v3)) if (isObj(v)) merged.set(k, { ...v, _key: v._key || k });
  for (const [k, v] of Object.entries(v4)) if (isObj(v)) merged.set(k, { ...(merged.get(k) || {}), ...v, _key: v._key || k });
  const rows = [...merged.values()].filter(alive);

  const items: { id: string; doc: Record<string, any> }[] = [];
  const seen = new Set<string>(); let dup = 0, nokey = 0;
  for (const v of rows) {
    const key = S(v[idFrom]) || S(v._key);
    if (!key) { nokey++; continue; }
    const companyId = companyOf(v);
    const id = docSafe(`${companyId}__${key}`);
    if (seen.has(id)) { dup++; continue; } seen.add(id);
    items.push({ id, doc: { ...v, companyId, _key: key } });
  }
  console.log(`${entity.padEnd(10)} v3 ${Object.keys(v3).length} ∪ v4 ${Object.keys(v4).length} → 살아있음 ${rows.length} → 쓸 것 ${items.length} (중복 ${dup} · 키없음 ${nokey})`);
  if (items[0]) console.log(`   예: ${items[0].id}`);
  grand += items.length;

  if (APPLY) {
    let w = 0;
    for (let i = 0; i < items.length; i += 400) {
      const batch = fs.batch();
      for (const { id, doc } of items.slice(i, i + 400)) { batch.set(fs.collection(entity).doc(id), doc); w++; }
      await batch.commit();
    }
    console.log(`   → Firestore ${entity} ${w}건 씀`);
  }
}
console.log(`\n${APPLY ? '반영 완료' : '미리보기'} — 총 ${grand}건. 앱 읽기 안 바꿈(RTDB 그대로). 실제: --apply`);
process.exit(0);
