/**
 * RTDB v4(라이브 v3 ∪ v4 오버레이) → Firestore «전량» 복사 — RTDB 폐기 데이터 파리티.
 *   사장님 2026-09-05 「오늘 다 이관하자 · RTDB 안 쓴다」.
 *
 * ★기존 그림자복사(shadow-copy)는 문서 id 를 복합키 `{companyId}__{key}` 로 썼다.
 *   esign 엔진·심(shim)은 «원시 키»로 직접 접근한다(v4/contracts/{code}).
 *   ⇒ 여기서 «원시 키 = 문서 id» 로 통일한다(companyId·_key 는 필드로 유지 → FirestoreAdapter where 쿼리 그대로).
 *   현재 복합키 문서는 운영에서 «읽는 곳이 없다»(getStore=rtdb) → 지금 재키잉이 가장 안전. 복합키(id에 '__') 문서는 지운다.
 *
 * 레이아웃 = 심 규칙과 동일: v4/{node}/{k1}[/{k2..}] → 컬렉션 map(node)·문서 k1·(k2.. = 중첩 필드).
 *   그래서 node[k1] 서브트리를 «통째로» 문서 데이터로 둔다(중첩 맵 보존). 6엔티티+products 는 레코드라 companyId/_key 부여.
 * 기본 dry-run · --apply 로 쓰기.
 */
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getFirestore } from 'firebase-admin/firestore';

const APPLY = process.argv.includes('--apply');
const S = (v: unknown) => String(v ?? '').trim();
const sa = JSON.parse(readFileSync('tmp/firebase-auth/sa.json', 'utf8'));
const app = initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key.replace(/\\n/g, '\n') }), databaseURL: 'https://freepasserp3-default-rtdb.asia-southeast1.firebasedatabase.app' });
const rtdb = getDatabase(app);
const fs = getFirestore(app);

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const docSafe = (s: string) => s.replace(/[/#.$\[\]]/g, '_');
const companyOf = (v: Record<string, any>) => S(v.companyId) || S(v.provider_company_code) || S(v.company_code) || S(v.partner_code) || 'PT-0000';

// RTDB 노드 → { col: Firestore 컬렉션, v3: 라이브 v3도 병합, entity: 레코드(companyId/_key 부여) }
type Spec = { col: string; v3?: boolean; entity?: boolean };
const NODES: Record<string, Spec> = {
  // 6 엔티티 (v3∪v4, 레코드) — 원시 키로 재키잉
  contracts:   { col: 'contract',   v3: true, entity: true },
  settlements: { col: 'settlement', v3: true, entity: true },
  policies:    { col: 'policy',     v3: true, entity: true },
  partners:    { col: 'partner',    v3: true, entity: true },
  customers:   { col: 'customer',   v3: true, entity: true },
  users:       { col: 'user',       v3: true, entity: true },
  // products 제외 — Firestore 가 이미 «정제된 정본»(gencode 교정·마스터명·1375>RTDB 1273). RTDB 원본으로 덮으면 정제분 소실.
  // esign 엔진 (v4 전용, 중첩 보존)
  esign_sessions:        { col: 'esign_sessions' },
  esign_private:         { col: 'esign_private' },
  esign_events:          { col: 'esign_events' },
  esign_verifications:   { col: 'esign_verifications' },
  esign_issue_claims:    { col: 'esign_issue_claims' },
  esign_manual_offers:   { col: 'esign_manual_offers' },
  esign_create_requests: { col: 'esign_create_requests' },
  esign_contract_seals:  { col: 'esign_contract_seals' },
  esign_issuance:        { col: 'esign_issuance' },
  // 정산 부속
  settlement_rows:              { col: 'settlement_rows' },
  settlement_events:            { col: 'settlement_events' },
  settlement_contacts:          { col: 'settlement_contacts' },
  settlement_clawbacks:         { col: 'settlement_clawbacks' },
  settlement_invoices:          { col: 'settlement_invoices' },
  admin_settlements:            { col: 'admin_settlements' },
  settlements_provider_private: { col: 'settlements_provider_private' },
  settlements_admin_private:    { col: 'settlements_admin_private' },
  settlements_agent_private:    { col: 'settlements_agent_private' },
  // 사설/락/시스템/시트/장부 (라우트가 읽거나 쓰는 것)
  users_private:              { col: 'users_private' },
  partners_private:           { col: 'partners_private' },
  system_locks:               { col: 'system_locks' },
  system_status:              { col: 'system_status' },
  inventory_sync_runs:        { col: 'inventory_sync_runs' },
  inventory_sync_control:     { col: 'inventory_sync_control' },
  plate_registry:             { col: 'plate_registry' },
  audit_logs:                 { col: 'audit_logs' },
  sheet_conflict_resolutions: { col: 'sheet_conflict_resolutions' },
  sheet_edits:                { col: 'sheet_edits' },
  sheet_sync_runs:            { col: 'sheet_sync_runs' },
  sheet_sync_backups:         { col: 'sheet_sync_backups' },
  ops:                        { col: 'ops' },
  report:                     { col: 'report' },
  // 제외: messages·rooms(폐기 채팅) · _client_errors · esign_test_sessions
};

let grand = 0, delComposite = 0;
for (const [node, spec] of Object.entries(NODES)) {
  const v4 = (await rtdb.ref(`v4/${node}`).get()).val() as Record<string, any> || {};
  const merged = new Map<string, any>();
  if (spec.v3) { const v3 = (await rtdb.ref(node).get()).val() as Record<string, any> || {}; for (const [k, v] of Object.entries(v3)) merged.set(k, v); }
  for (const [k, v] of Object.entries(v4)) { const prev = merged.get(k); merged.set(k, isObj(prev) && isObj(v) ? { ...prev, ...v } : v); }

  const items: { id: string; doc: any }[] = [];
  let skip = 0;
  for (const [k, v] of merged) {
    const id = docSafe(k); if (!id) { skip++; continue; }
    let doc: any = isObj(v) ? v : { _value: v };
    if (spec.entity) { const companyId = companyOf(doc); doc = { ...doc, companyId, _key: k }; }
    items.push({ id, doc });
  }
  console.log(`${node.padEnd(28)} → ${spec.col.padEnd(28)} ${items.length}건${skip ? ` (스킵 ${skip})` : ''}`);
  grand += items.length;

  if (APPLY) {
    for (let i = 0; i < items.length; i += 400) {
      const batch = fs.batch();
      for (const { id, doc } of items.slice(i, i + 400)) batch.set(fs.collection(spec.col).doc(id), doc);
      await batch.commit();
    }
    // 복합키(id에 '__') 잔재 삭제 — 재키잉으로 대체됨
    if (spec.entity) {
      const old = await fs.collection(spec.col).get();
      const stale = old.docs.filter((d) => d.id.includes('__'));
      for (let i = 0; i < stale.length; i += 400) { const b = fs.batch(); for (const d of stale.slice(i, i + 400)) b.delete(d.ref); await b.commit(); delComposite += Math.min(400, stale.length - i); }
    }
  }
}
console.log(`\n${APPLY ? '반영 완료' : '미리보기'} — 총 ${grand}건${APPLY ? ` · 복합키 잔재 삭제 ${delComposite}건` : ''}. 실제 반영: --apply`);
process.exit(0);
