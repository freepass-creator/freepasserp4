/**
 * 데이터 저장 레이어 — 멀티테넌트(companyId 스코프) + 어댑터 seam.
 *   · Firebase 설정 있으면 → FirestoreAdapter (실 저장, 회사별 격리)
 *   · 없으면            → LocalAdapter (localStorage, dev 미리보기)
 * 어느 쪽이든 동일 인터페이스 → Firestore 전환은 설정값만 넣으면 됨.
 * 모든 문서: { ...record, companyId, _key(자연키), createdAt, createdBy }. dedup = 자연키(entity.idFrom).
 */
import { ENTITIES, type EntityRecord } from './intake/entities';
import { currentActor } from './session';
import { getSession } from './auth-session';   // 역할 격리 쿼리(계약·정산)용 — 세션의 격리키(user_code/company_code)
import { getFirebaseApp, firebaseReady } from './firebase/client';
import { RtdbAdapter } from './firebase/rtdb-adapter';
import { COMPANIES, ALL_COMPANIES } from './companies';
import { buildAuditEntry, buildMasterSnapBulkEntry } from './domain/audit';
import {
  productPatchPreconditionMatches,
  type GuardedProductPatch,
  type GuardedProductPatchResult,
} from './domain/product-write-guard';

export type SaveResult = { saved: number; duplicates: number; backend: string };
export type FreshListHealth = {
  rows: EntityRecord[];
  complete: boolean;
  failures?: string[];
};
export interface StoreAdapter {
  backend: string;
  save(entityKey: string, companyId: string, records: EntityRecord[]): Promise<SaveResult>;
  list(entityKey: string, companyId: string): Promise<EntityRecord[]>;
  /** 상품찾기 첫 화면 전용: 공급사명 보정은 뒤로 미루고 판매 가능한 상품 원본을 먼저 준다. */
  listForFinder?(companyId: string): Promise<EntityRecord[]>;
  /** 경합 판정용 목록 — DispatchStore의 세션 캐시를 우회한다. */
  listFresh?(entityKey: string, companyId: string): Promise<EntityRecord[]>;
  /** 쓰기 전 검증용: 원본 source 일부가 실패했는지 함께 반환한다. */
  listFreshWithHealth?(entityKey: string, companyId: string): Promise<FreshListHealth>;
  /** 방 하나 메시지 스코프 조회(전 방 list 회피). 미구현 어댑터는 list+필터로 폴백. */
  listMessagesForRoom?(companyId: string, roomId: string): Promise<EntityRecord[]>;
  /**
   * 참조 조회용 원본 목록 — 판매용 가공(중복정리·제외공급사·출고상태) 없이 erp3∪erp4 원본 그대로.
   * 문의·계약이 예전/비노출 매물을 가리켜도 차량을 찾아내야 하므로 list와 분리한다.
   * 미구현 어댑터는 list로 폴백.
   */
  listRaw?(entityKey: string, companyId: string): Promise<EntityRecord[]>;
  /**
   * 경합 판정용 원본 목록 — DispatchStore의 세션 캐시를 우회한다.
   * 시트 검증→커밋 사이 다른 사용자의 재고 변경을 확인할 때만 사용한다.
   */
  listRawFresh?(entityKey: string, companyId: string): Promise<EntityRecord[]>;
  listRawFreshWithHealth?(entityKey: string, companyId: string): Promise<FreshListHealth>;
  /** 삭제 tombstone까지 같은 source snapshot에서 받은 전체 원본. */
  listAllFreshWithHealth?(entityKey: string, companyId: string): Promise<FreshListHealth>;
  get(entityKey: string, companyId: string, key: string): Promise<EntityRecord | null>;
  /**
   * 캐시 우회 단건 조회 — 경합 판정 전용(이중판매 가드 등).
   * 캐시가 없는 어댑터는 get과 동일하다. 디스패처가 구현을 덮어쓴다.
   */
  getFresh?(entityKey: string, companyId: string, key: string): Promise<EntityRecord | null>;
  update(entityKey: string, companyId: string, key: string, patch: EntityRecord): Promise<void>;
  bulkPatch(entityKey: string, companyId: string, patches: { key: string; patch: EntityRecord }[]): Promise<number>; // 다건 부분갱신(멀티패스) — 일괄 차종 재구현 등
  /** 시트 병합 전용: 검증 때 읽은 상품이 그대로일 때만 patch(CAS). */
  bulkPatchGuardedProduct(companyId: string, patches: GuardedProductPatch[]): Promise<GuardedProductPatchResult>;
  remove(entityKey: string, companyId: string, key: string, reason?: string): Promise<void>;   // #6 소프트삭제
  listDeleted(entityKey: string, companyId: string): Promise<EntityRecord[]>;
  restore(entityKey: string, companyId: string, key: string): Promise<void>;
}

function naturalKey(entityKey: string, rec: EntityRecord): string {
  const e = ENTITIES[entityKey];
  if (!e) return '';
  const v = e.idFrom ? rec[e.idFrom] : undefined;
  if (v != null && v !== '') return String(v);
  // 복합 자연키 (거래내역 등) — keyFields 값을 join 해 dedup
  if (e.keyFields) {
    const parts = e.keyFields.map((k) => String(rec[k] ?? '')).filter(Boolean);
    if (parts.length) return parts.join('|');
  }
  return '';
}

// ── 로컬 어댑터 (dev) ──
class LocalAdapter implements StoreAdapter {
  backend = 'local(localStorage)';
  private k(entityKey: string, companyId: string) { return `freepasserp4:${companyId}:${entityKey}`; }
  private read(entityKey: string, companyId: string): EntityRecord[] {
    if (typeof window === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem(this.k(entityKey, companyId)) || '[]'); } catch { return []; }
  }
  async list(entityKey: string, companyId: string) { return this.read(entityKey, companyId).filter((r) => !r.deletedAt); }
  async listMessagesForRoom(companyId: string, roomId: string) {
    return (await this.list('message', companyId)).filter((m) => String(m.room_id) === roomId);
  }
  async get(entityKey: string, companyId: string, key: string) {
    return this.read(entityKey, companyId).find((r) => String(r._key) === key) || null;
  }
  async remove(entityKey: string, companyId: string, key: string, reason = '') {
    await this.update(entityKey, companyId, key, { deletedAt: new Date().toISOString(), deletedReason: reason });
  }
  async listDeleted(entityKey: string, companyId: string) { return this.read(entityKey, companyId).filter((r) => r.deletedAt); }
  async restore(entityKey: string, companyId: string, key: string) {
    await this.update(entityKey, companyId, key, { deletedAt: null, deletedReason: null });
  }
  async update(entityKey: string, companyId: string, key: string, patch: EntityRecord) {
    const arr = this.read(entityKey, companyId);
    const i = arr.findIndex((r) => String(r._key) === key);
    if (i >= 0) { const before = arr[i]; arr[i] = { ...arr[i], ...patch, updatedAt: new Date().toISOString() }; localStorage.setItem(this.k(entityKey, companyId), JSON.stringify(arr)); this.logAudit(entityKey, companyId, key, 'update', before, arr[i]); }
  }
  async bulkPatch(entityKey: string, companyId: string, patches: { key: string; patch: EntityRecord }[]) {
    const arr = this.read(entityKey, companyId);
    const idx = new Map(arr.map((r, i) => [String(r._key), i]));
    const now = new Date().toISOString();
    let n = 0;
    for (const { key, patch } of patches) { const i = idx.get(key); if (i == null) continue; arr[i] = { ...arr[i], ...patch, updatedAt: now }; n++; }
    localStorage.setItem(this.k(entityKey, companyId), JSON.stringify(arr));
    const snapish = patches.some((p) => p.patch._snapped);
    if (snapish && n) this.pushAudit(buildMasterSnapBulkEntry(companyId, patches.slice(0, n), currentActor()));
    else this.logAudit(entityKey, companyId, `bulk:${n}`, 'update', null, { count: n } as EntityRecord);
    return n;
  }
  async bulkPatchGuardedProduct(companyId: string, patches: GuardedProductPatch[]): Promise<GuardedProductPatchResult> {
    const arr = this.read('product', companyId);
    const idx = new Map(arr.map((r, i) => [String(r._key), i]));
    const now = new Date().toISOString();
    const conflict = patches.find(({ key, patch, expected }) => {
      const i = idx.get(key);
      return !productPatchPreconditionMatches(i == null ? null : arr[i], expected, patch);
    });
    if (conflict) return { updated: 0, conflicts: [conflict.key] };
    let updated = 0;
    for (const { key, patch, expected } of patches) {
      const i = idx.get(key);
      const current = i == null ? null : arr[i];
      // 위 preflight와 같은 동기 localStorage snapshot. 여기서 불일치할 수 없다.
      if (!productPatchPreconditionMatches(current, expected, patch)) return { updated: 0, conflicts: [key] };
      arr[i!] = { ...current, ...patch, updatedAt: now };
      updated++;
    }
    if (updated) {
      localStorage.setItem(this.k('product', companyId), JSON.stringify(arr));
      this.logAudit('product', companyId, `guarded-bulk:${updated}`, 'update', null, { count: updated } as EntityRecord);
    }
    return { updated, conflicts: [] };
  }
  async save(entityKey: string, companyId: string, records: EntityRecord[]) {
    const existing = this.read(entityKey, companyId);
    const seen = new Set(existing.map((r) => r._key));
    let saved = 0, duplicates = 0;
    for (const rec of records) {
      const key = naturalKey(entityKey, rec);
      if (key && seen.has(key)) { duplicates++; continue; }
      const stored = { ...rec, companyId, _key: key, createdAt: new Date().toISOString(), createdBy: 'local' };
      existing.push(stored);
      this.logAudit(entityKey, companyId, String(key), 'create', null, stored);
      if (key) seen.add(key);
      saved++;
    }
    localStorage.setItem(this.k(entityKey, companyId), JSON.stringify(existing));
    return { saved, duplicates, backend: this.backend };
  }
  private pushAudit(entry: EntityRecord | null) {
    if (!entry || typeof window === 'undefined') return;
    try {
      const companyId = String(entry.companyId || '');
      const ak = this.k('audit_log', companyId);
      const arr = JSON.parse(localStorage.getItem(ak) || '[]') as EntityRecord[];
      arr.push(entry);
      if (arr.length > 5000) arr.splice(0, arr.length - 5000);
      localStorage.setItem(ak, JSON.stringify(arr));
    } catch { /* best-effort */ }
  }
  private logAudit(entityKey: string, companyId: string, key: string, action: string, before: EntityRecord | null, after: EntityRecord | null) {
    if (typeof window === 'undefined' || entityKey === 'audit_log') return;
    this.pushAudit(buildAuditEntry(entityKey, companyId, key, action, before, after, currentActor()));
  }
}

// Firestore 응답 지연/미설정(규칙 잠김·DB 미생성) 시 UI 무한대기 방지 — 타임아웃 후 실패로 처리.
function withTimeout<T>(p: Promise<T>, ms = 8000): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`Firestore timeout ${ms}ms — DB 생성·규칙(test mode) 확인`)), ms))]);
}

// ── Firestore 어댑터 (실 저장, 회사별 격리) ──
class FirestoreAdapter implements StoreAdapter {
  backend = 'firestore';
  async save(entityKey: string, companyId: string, records: EntityRecord[]): Promise<SaveResult> {
    const { getFirestore, collection, query, where, getDocs, doc, setDoc } = await import('firebase/firestore');
    const db = getFirestore(getFirebaseApp()!);
    const col = collection(db, entityKey);
    // dedup: 같은 회사·자연키 존재 확인
    const snap = await withTimeout(getDocs(query(col, where('companyId', '==', companyId))));
    const seen = new Set<string>();
    snap.forEach((d) => { const k = (d.data() as EntityRecord)._key; if (k) seen.add(String(k)); });
    let saved = 0, duplicates = 0;
    for (const rec of records) {
      const key = naturalKey(entityKey, rec);
      if (key && seen.has(key)) { duplicates++; continue; }
      const id = key ? `${companyId}__${key}` : `${companyId}__${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const stored = { ...rec, companyId, _key: key, createdAt: new Date().toISOString(), createdBy: 'system' };
      await withTimeout(setDoc(doc(col, id), stored));
      if (key) seen.add(key);
      saved++;
      this.logAudit(entityKey, companyId, String(key || id), 'create', null, stored);
    }
    return { saved, duplicates, backend: this.backend };
  }
  async list(entityKey: string, companyId: string): Promise<EntityRecord[]> {
    try {
      const { getFirestore, collection, query, where, getDocs } = await import('firebase/firestore');
      const db = getFirestore(getFirebaseApp()!);
      const col = collection(db, entityKey);
      // ★역할 격리 엔티티(계약·정산)는 «규칙과 같은 제약»으로 쿼리해야 Firestore 가 거부하지 않는다(규칙=필터가 아니라 검증).
      //   공급사=provider_company_code · 영업자=agent_code(=user_code) · 관리자=companyId(또는 전체). getSession 이 격리키를 안다.
      const ROLE_ISOLATED = entityKey === 'contract' || entityKey === 'settlement';
      const GLOBAL_READ = entityKey === 'policy' || entityKey === 'partner';   // 참조데이터 — 로그인이면 전체 read(규칙과 일치)
      const s = getSession();
      let q;
      if (GLOBAL_READ) {
        q = query(col);
      } else if (ROLE_ISOLATED && s && s.role === 'agent' && s.user_code) {
        q = query(col, where('agent_code', '==', s.user_code));
      } else if (ROLE_ISOLATED && s && s.role === 'provider' && s.company_code) {
        q = query(col, where('provider_company_code', '==', s.company_code));
      } else if (entityKey === 'customer' && s && s.role !== 'admin' && s.uid) {
        q = query(col, where('created_by', '==', s.uid));   // 손님 = 만든 사람만
      } else {
        q = query(col, where('companyId', '==', companyId));   // 관리자·회사격리 엔티티
      }
      const snap = await withTimeout(getDocs(q));
      return snap.docs.map((d) => d.data() as EntityRecord).filter((r) => !r.deletedAt);
    } catch (e) { console.warn(`Firestore list(${entityKey}) 대기 실패(DB·규칙 확인):`, (e as Error).message); return []; }
  }
  /** 역할 격리 엔티티(계약·정산)의 실제 문서를 «_key + 역할제약»으로 찾는다 — doc-id 프리픽스(공급사코드)와 세션 회사가 달라도 맞춘다. */
  private async findRoleIsolated(entityKey: string, key: string): Promise<{ id: string; data: EntityRecord } | null> {
    const { getFirestore, collection, query, where, getDocs } = await import('firebase/firestore');
    const db = getFirestore(getFirebaseApp()!);
    const col = collection(db, entityKey);
    const s = getSession();
    let q;
    if (s && s.role === 'agent' && s.user_code) q = query(col, where('_key', '==', key), where('agent_code', '==', s.user_code));
    else if (s && s.role === 'provider' && s.company_code) q = query(col, where('_key', '==', key), where('provider_company_code', '==', s.company_code));
    else q = query(col, where('_key', '==', key));   // 관리자
    const snap = await withTimeout(getDocs(q));
    return snap.empty ? null : { id: snap.docs[0].id, data: snap.docs[0].data() as EntityRecord };
  }
  async get(entityKey: string, companyId: string, key: string): Promise<EntityRecord | null> {
    try {
      const { getFirestore, doc, getDoc } = await import('firebase/firestore');
      const db = getFirestore(getFirebaseApp()!);
      if (entityKey === 'contract' || entityKey === 'settlement') {
        const hit = await this.findRoleIsolated(entityKey, key);
        return hit ? hit.data : null;
      }
      const snap = await withTimeout(getDoc(doc(db, entityKey, `${companyId}__${key}`)));
      return snap.exists() ? (snap.data() as EntityRecord) : null;
    } catch (e) { console.warn(`Firestore get(${entityKey}) 대기 실패(DB·규칙 확인):`, (e as Error).message); return null; }
  }
  async update(entityKey: string, companyId: string, key: string, patch: EntityRecord): Promise<void> {
    const { getFirestore, doc, setDoc } = await import('firebase/firestore');
    const db = getFirestore(getFirebaseApp()!);
    // 역할 격리 엔티티는 «실제 문서 id»(공급사코드 프리픽스)로 써야 한다 — 세션 회사로 만든 id 로 쓰면 엉뚱한 새 문서가 생긴다.
    let docId = `${companyId}__${key}`;
    let before: EntityRecord | null;
    if (entityKey === 'contract' || entityKey === 'settlement') {
      const hit = await this.findRoleIsolated(entityKey, key);
      before = hit?.data ?? null;
      if (hit) docId = hit.id;
    } else {
      before = await this.get(entityKey, companyId, key);
    }
    const after = { ...(before || {}), ...patch, updatedAt: new Date().toISOString() };
    await setDoc(doc(db, entityKey, docId), { ...patch, updatedAt: after.updatedAt }, { merge: true });
    this.logAudit(entityKey, companyId, key, patch.deletedAt ? 'delete' : 'update', before, after);
  }
  async bulkPatch(entityKey: string, companyId: string, patches: { key: string; patch: EntityRecord }[]): Promise<number> {
    const { getFirestore, doc, writeBatch } = await import('firebase/firestore');
    const db = getFirestore(getFirebaseApp()!);
    const now = new Date().toISOString();
    let n = 0, batch = writeBatch(db), inB = 0;
    for (const { key, patch } of patches) {
      batch.set(doc(db, entityKey, `${companyId}__${key}`), { ...patch, updatedAt: now }, { merge: true });
      n++; if (++inB >= 400) { await batch.commit(); batch = writeBatch(db); inB = 0; }
    }
    if (inB) await batch.commit();
    const snapish = patches.some((p) => p.patch._snapped);
    if (snapish && n) this.pushAudit(buildMasterSnapBulkEntry(companyId, patches, currentActor()));
    else this.logAudit(entityKey, companyId, `bulk:${n}`, 'update', null, { count: n } as EntityRecord);
    return n;
  }
  async bulkPatchGuardedProduct(companyId: string, patches: GuardedProductPatch[]): Promise<GuardedProductPatchResult> {
    const { getFirestore, doc, runTransaction } = await import('firebase/firestore');
    const db = getFirestore(getFirebaseApp()!);
    const conflicts: string[] = [];
    let updated = 0;
    for (const { key, patch, expected } of patches) {
      const applied = await runTransaction(db, async (tx) => {
        const target = doc(db, 'product', `${companyId}__${key}`);
        const snapshot = await tx.get(target);
        const current = snapshot.exists() ? snapshot.data() as EntityRecord : null;
        if (!productPatchPreconditionMatches(current, expected, patch)) return false;
        tx.set(target, { ...patch, updatedAt: new Date().toISOString() }, { merge: true });
        return true;
      });
      if (applied) updated++;
      else {
        conflicts.push(key);
        break;
      }
    }
    if (updated) this.logAudit('product', companyId, `guarded-bulk:${updated}`, 'update', null, { count: updated } as EntityRecord);
    return { updated, conflicts };
  }
  async remove(entityKey: string, companyId: string, key: string, reason = ''): Promise<void> {
    await this.update(entityKey, companyId, key, { deletedAt: new Date().toISOString(), deletedReason: reason });
  }
  async listDeleted(entityKey: string, companyId: string): Promise<EntityRecord[]> {
    const { getFirestore, collection, query, where, getDocs } = await import('firebase/firestore');
    const db = getFirestore(getFirebaseApp()!);
    const snap = await getDocs(query(collection(db, entityKey), where('companyId', '==', companyId)));
    return snap.docs.map((d) => d.data() as EntityRecord).filter((r) => r.deletedAt);
  }
  async restore(entityKey: string, companyId: string, key: string): Promise<void> {
    await this.update(entityKey, companyId, key, { deletedAt: null, deletedReason: null });
  }
  private async pushAudit(entry: EntityRecord | null) {
    if (!entry) return;
    try {
      const { getFirestore, doc, setDoc } = await import('firebase/firestore');
      const db = getFirestore(getFirebaseApp()!);
      const id = String(entry._key);
      const companyId = String(entry.companyId || '');
      await setDoc(doc(db, 'audit_log', `${companyId}__${id}`), entry);
    } catch { /* best-effort */ }
  }
  private logAudit(entityKey: string, companyId: string, key: string, action: string, before: EntityRecord | null, after: EntityRecord | null) {
    if (entityKey === 'audit_log') return;
    void this.pushAudit(buildAuditEntry(entityKey, companyId, key, action, before, after, currentActor()));
  }
}

/**
 * 디스패치 스토어 — 호출 시점 companyId 인자를 보고 분기. 페이지는 항상 getStore().xxx(entity, companyId) 그대로.
 *   · companyId === ALL_COMPANIES (운영자 합본): 전 회사를 가로질러 동작
 *       - 조회(list/get/listDeleted): 모든 회사에서 모아 반환 (각 레코드 companyId 보유 → 페이지에서 회사 표시)
 *       - 변경(update/remove/restore): 키가 속한 회사를 찾아 위임 (합본에서 바로 입금기록/삭제)
 *       - 저장(save): 대상 회사 모호 → 회사 선택 필요 (에러)
 *   · 그 외(위탁사·단일회사): base 어댑터로 그대로 통과
 */
// 모듈 레벨 인메모리 캐시 — list 결과(Promise)를 재사용해 재조회·화면 전환을 즉시로.
// 저장/수정/삭제 시 해당 엔티티 캐시만 무효화(다음 list에서 신선하게 재조회). 세션 한정(새로고침 시 초기화).
const _listCache = new Map<string, Promise<EntityRecord[]>>();
const _listResolved = new Map<string, EntityRecord[]>(); // Promise settle 후 동기 peek용(홈→상세 즉시 페인팅)
const _listAt = new Map<string, number>();               // 실조회 시각 — LIVE 엔티티 TTL 판정용
// 인증 전환·write 무효화 뒤 이전 권한으로 시작한 Promise가 늦게 끝나 캐시를 되살리지 못하게 한다.
// key별 token이 현재 요청과 같을 때만 resolved/cache cleanup을 허용한다.
const _listToken = new Map<string, symbol>();
const _matchesEntityCacheKey = (key: string, entityKey: string) => (
  key.startsWith(`${entityKey}::`) || key.startsWith(`raw::${entityKey}::`)
);
function _invalidate(entityKey: string) {
  const keys = new Set([
    ..._listCache.keys(), ..._listResolved.keys(), ..._listAt.keys(), ..._listToken.keys(),
  ]);
  for (const key of keys) {
    if (!_matchesEntityCacheKey(key, entityKey)) continue;
    _listCache.delete(key);
    _listResolved.delete(key);
    _listAt.delete(key);
    _listToken.delete(key);
  }
}
function _invalidateRaw(entityKey: string) {
  const prefix = `raw::${entityKey}::`;
  const keys = new Set([..._listCache.keys(), ..._listResolved.keys(), ..._listToken.keys()]);
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    _listCache.delete(key);
    _listResolved.delete(key);
    _listToken.delete(key);
  }
}
export function clearStoreCache() {
  _listCache.clear();
  _listResolved.clear();
  _listAt.clear();
  _listToken.clear();
}

/**
 * **상대가 계속 쓰는 엔티티** — 세션 영구 캐시 금지.
 * 내 조작(save/update)만 캐시를 무효화하므로, 상대가 보낸 새 문의·새 메시지·계약 진행은
 * 무효화 계기가 없다. 포커스 복귀·fp:unread 로 refreshRooms·refreshBadges 가 다시 물어봐도
 * 같은 옛 배열이 그대로 돌아와, 새 대화가 세션 내내 목록·뱃지에 안 붙었다(QA CACHE-1/SYNC-1).
 * TTL이 지나면 다음 list()가 실조회한다. _listResolved 는 지우지 않는다 —
 * 옛 값으로 즉시 그리고(peekList) 새 값이 도착하면 갈아끼우는 stale-while-revalidate.
 */
// message 전량 fallback만 TTL을 길게 둔다. 일반 RTDB 경로의 roomsWithUnread는 last_read가 있는
//  방만 listMessagesForRoom으로 조회하고, scoped API가 없는 어댑터에서만 이 캐시를 사용한다.
//  열린 대화방 본문은 listMessagesForRoom(캐시 없음·5초 폴링)이 따로 최신을 유지한다.
/**
 * ★**모르는 엔티티는 「낡았다」로 본다**(2026-08-10에 기본값을 뒤집음).
 *
 *   전에는 목록에 없으면 `return false` — 즉 «영원히 신선함»이었다.
 *   그러면 엔티티를 새로 추가할 때마다 **아무도 의도하지 않은 영구 캐시**가 하나씩 생긴다.
 *   실제로 `product` 가 그렇게 빠져 있었고, 재고는 공급사 시트 동기화·유입 스크립트가 바꾸는데
 *   캐시는 «내 화면 조작»만 무효화하니 그 변화엔 무효화 계기가 없었다 —
 *   **세션 내내 옛 목록이 그대로 돌아왔다.** 실측: RTDB 활성 582건인데 화면은 555건에 멈춰,
 *   시트와 ERP 가 안 맞는 것처럼 보였고 원인을 찾는 데 반나절이 갔다.
 *
 *   기본을 30초로 두면 «빠뜨림»이 조용한 버그가 아니라 **살짝 잦은 재조회**로 끝난다.
 *   stale-while-revalidate 라 화면은 옛 값으로 즉시 그리고 새 값이 오면 갈아끼운다 — 깜빡임이 없다.
 *   영구 캐시가 정말 필요한 엔티티가 생기면 `NEVER_STALE` 에 **이유와 함께** 적어라.
 */
const DEFAULT_TTL_MS = 30_000;
const LIVE_TTL_MS: Record<string, number> = { room: 10_000, contract: 10_000, settlement: 10_000, message: 60_000 };
/** 세션 내내 안 바뀌는 것만. 비워 두는 게 정상이다 — 넣을 땐 왜 안 바뀌는지 적어라. */
const NEVER_STALE = new Set<string>([]);
function _isStale(ck: string, entityKey: string): boolean {
  if (NEVER_STALE.has(entityKey)) return false;
  const ttl = LIVE_TTL_MS[entityKey] ?? DEFAULT_TTL_MS;
  return Date.now() - (_listAt.get(ck) ?? 0) > ttl;
}

/** list 캐시 부분 패치 — update 후 전량 무효화 대신 해당 레코드만 병합. 캐시 없으면 no-op(다음 list가 신선 조회). */
export function patchListCache(entityKey: string, companyId: string, key: string, patch: EntityRecord): void {
  // listRaw는 판매용 가공 전 원본이라 일반 list와 별도 cache key를 쓴다. write 뒤 함께 폐기해야 한다.
  _invalidateRaw(entityKey);
  const ck = `${entityKey}::${companyId}`;
  // 아직 resolved가 없는 진행중 read도 세대를 끊는다. 그렇지 않으면 write 전 snapshot이
  // write 완료 뒤 도착해 새 값처럼 캐시될 수 있다.
  _listToken.set(ck, Symbol(ck));
  const rows = _listResolved.get(ck);
  if (!rows) {
    _listCache.delete(ck);
    _listAt.delete(ck);
    return;
  }
  const i = rows.findIndex((r) => String(r._key) === key);
  // 캐시에 없으면 얇은(부분필드) 행 주입 금지 — 무효화해 다음 list가 신선 전량 재조회(반쪽 레코드 오염 방지).
  if (i < 0) { _invalidate(entityKey); return; }
  const next = rows.slice();
  next[i] = { ...next[i], ...patch, _key: key };
  _listResolved.set(ck, next);
  _listCache.set(ck, Promise.resolve(next));
}

function findCached(rows: EntityRecord[], key: string): EntityRecord | null {
  return rows.find((r) => String(r._key) === key) || null;
}
/** 이미 list된 엔티티를 동기 조회 — 홈→상세 첫 페인트에서 Loading 스킵. 없으면 null. */
export function peekCached(entityKey: string, companyId: string, key: string): EntityRecord | null {
  const rows = _listResolved.get(`${entityKey}::${companyId}`);
  return rows ? findCached(rows, key) : null;
}
/** 이미 list된 엔티티 전체를 동기 조회 — 반복 진입 첫 페인트에서 Loading 스킵(stale-while-revalidate). 없으면 null. */
export function peekList(entityKey: string, companyId: string): EntityRecord[] | null {
  return _listResolved.get(`${entityKey}::${companyId}`) ?? null;
}

class DispatchStore implements StoreAdapter {
  backend: string;
  constructor(private base: StoreAdapter) { this.backend = base.backend; }
  private all(companyId: string) { return companyId === ALL_COMPANIES; }
  async save(entityKey: string, companyId: string, records: EntityRecord[]) {
    if (this.all(companyId)) throw new Error('전체 합본 보기에서는 저장 대상 회사를 먼저 선택하세요.');
    const r = await this.base.save(entityKey, companyId, records); _invalidate(entityKey); return r;
  }
  async list(entityKey: string, companyId: string) {
    const ck = `${entityKey}::${companyId}`;
    if (_isStale(ck, entityKey)) _listCache.delete(ck); // resolved 는 남긴다 — 옛 값으로 즉시 그리고 새 값이 오면 교체
    let p = _listCache.get(ck);
    if (!p) {
      const token = Symbol(ck);
      _listToken.set(ck, token);
      _listAt.set(ck, Date.now());
      p = (this.all(companyId)
        ? Promise.all(COMPANIES.map((c) => this.base.list(entityKey, c))).then((a) => a.flat())
        : this.base.list(entityKey, companyId)
      ).then((rows) => {
        if (_listToken.get(ck) === token) _listResolved.set(ck, rows);
        return rows;
      });
      _listCache.set(ck, p);
      p.catch(() => {
        if (_listToken.get(ck) !== token) return;
        _listCache.delete(ck);
        _listResolved.delete(ck);
        _listToken.delete(ck);
      }); // 실패는 캐시 안 함(다음에 재시도)
    }
    return p;
  }
  async listForFinder(companyId: string): Promise<EntityRecord[]> {
    const base = this.base;
    // 일반 list 캐시에는 공급사명이 보정된 행을 유지한다. 상품찾기만 먼저 그린 행은
    // 별도 경로로 두어 다른 업무 화면의 표시 계약을 바꾸지 않는다.
    return typeof base.listForFinder === 'function'
      ? base.listForFinder(companyId)
      : this.list('product', companyId);
  }
  async listMessagesForRoom(companyId: string, roomId: string) {
    const ck = `message::${companyId}::room::${roomId}`;
    let p = _listCache.get(ck);
    if (!p) {
      const base = this.base;
      const token = Symbol(ck);
      _listToken.set(ck, token);
      p = (typeof base.listMessagesForRoom === 'function'
        ? base.listMessagesForRoom(companyId, roomId)
        : this.list('message', companyId).then((all) => all.filter((m) => String(m.room_id) === roomId))
      ).then((rows) => {
        if (_listToken.get(ck) === token) _listResolved.set(ck, rows);
        return rows;
      });
      _listCache.set(ck, p);
      // 채팅은 다른 사용자가 계속 추가하므로 일반 목록처럼 성공 결과를 영구 캐시하면
      // 열린 대화방이 새 메시지를 다시 읽지 못한다. 동시 호출만 합치고 완료 후 새 조회를 허용한다.
      p.then(
        () => {
          if (_listToken.get(ck) !== token || _listCache.get(ck) !== p) return;
          _listCache.delete(ck);
          _listToken.delete(ck);
        },
        () => {
          if (_listToken.get(ck) !== token || _listCache.get(ck) !== p) return;
          _listCache.delete(ck);
          _listResolved.delete(ck);
          _listToken.delete(ck);
        },
      );
    }
    return p;
  }
  async listDeleted(entityKey: string, companyId: string) {
    if (!this.all(companyId)) return this.base.listDeleted(entityKey, companyId);
    return (await Promise.all(COMPANIES.map((c) => this.base.listDeleted(entityKey, c)))).flat();
  }
  /** 참조 조회용 원본 — 미구현 어댑터는 list 폴백. 캐시는 list와 분리(가공 여부가 다름). */
  async listRaw(entityKey: string, companyId: string): Promise<EntityRecord[]> {
    const base = this.base;
    const call = (co: string) => (typeof base.listRaw === 'function'
      ? base.listRaw(entityKey, co)
      : base.list(entityKey, co));
    const ck = `raw::${entityKey}::${companyId}`;
    let p = _listCache.get(ck);
    if (!p) {
      const token = Symbol(ck);
      _listToken.set(ck, token);
      p = (this.all(companyId)
        ? Promise.all(COMPANIES.map(call)).then((a) => a.flat())
        : call(companyId)
      ).then((rows) => {
        if (_listToken.get(ck) === token) _listResolved.set(ck, rows);
        return rows;
      });
      _listCache.set(ck, p);
      p.catch(() => {
        if (_listToken.get(ck) !== token) return;
        _listCache.delete(ck);
        _listResolved.delete(ck);
        _listToken.delete(ck);
      });
    }
    return p;
  }
  /** 일반 목록 캐시 우회 — roster처럼 커밋 직전 최신 설정을 확인할 때 사용한다. */
  async listFresh(entityKey: string, companyId: string): Promise<EntityRecord[]> {
    return this.all(companyId)
      ? (await Promise.all(COMPANIES.map((c) => this.base.list(entityKey, c)))).flat()
      : this.base.list(entityKey, companyId);
  }
  /** 원본 목록 캐시 우회 — base adapter를 직접 호출해 다른 세션의 최신 write를 본다. */
  async listRawFresh(entityKey: string, companyId: string): Promise<EntityRecord[]> {
    const base = this.base;
    const call = (co: string) => (typeof base.listRawFresh === 'function'
      ? base.listRawFresh(entityKey, co)
      : typeof base.listRaw === 'function'
        ? base.listRaw(entityKey, co)
        : base.list(entityKey, co));
    return this.all(companyId)
      ? (await Promise.all(COMPANIES.map(call))).flat()
      : call(companyId);
  }
  async listFreshWithHealth(entityKey: string, companyId: string): Promise<FreshListHealth> {
    const base = this.base;
    const call = async (company: string): Promise<FreshListHealth> => (
      typeof base.listFreshWithHealth === 'function'
        ? base.listFreshWithHealth(entityKey, company)
        : { rows: await base.list(entityKey, company), complete: true }
    );
    if (!this.all(companyId)) return call(companyId);
    const results = await Promise.all(COMPANIES.map(call));
    return {
      rows: results.flatMap((result) => result.rows),
      complete: results.every((result) => result.complete),
      failures: results.flatMap((result) => result.failures || []),
    };
  }
  async listRawFreshWithHealth(entityKey: string, companyId: string): Promise<FreshListHealth> {
    const base = this.base;
    const call = async (company: string): Promise<FreshListHealth> => {
      if (typeof base.listRawFreshWithHealth === 'function') {
        return base.listRawFreshWithHealth(entityKey, company);
      }
      const rows = typeof base.listRawFresh === 'function'
        ? await base.listRawFresh(entityKey, company)
        : typeof base.listRaw === 'function'
          ? await base.listRaw(entityKey, company)
          : await base.list(entityKey, company);
      return { rows, complete: true };
    };
    if (!this.all(companyId)) return call(companyId);
    const results = await Promise.all(COMPANIES.map(call));
    return {
      rows: results.flatMap((result) => result.rows),
      complete: results.every((result) => result.complete),
      failures: results.flatMap((result) => result.failures || []),
    };
  }
  async listAllFreshWithHealth(entityKey: string, companyId: string): Promise<FreshListHealth> {
    const base = this.base;
    const call = async (company: string): Promise<FreshListHealth> => {
      if (typeof base.listAllFreshWithHealth === 'function') {
        return base.listAllFreshWithHealth(entityKey, company);
      }
      const [active, deleted] = await Promise.all([
        typeof base.listRawFresh === 'function'
          ? base.listRawFresh(entityKey, company)
          : typeof base.listRaw === 'function'
            ? base.listRaw(entityKey, company)
            : base.list(entityKey, company),
        base.listDeleted(entityKey, company),
      ]);
      return { rows: [...active, ...deleted], complete: true };
    };
    if (!this.all(companyId)) return call(companyId);
    const results = await Promise.all(COMPANIES.map(call));
    return {
      rows: results.flatMap((result) => result.rows),
      complete: results.every((result) => result.complete),
      failures: results.flatMap((result) => result.failures || []),
    };
  }
  async get(entityKey: string, companyId: string, key: string) {
    // 홈 list 캐시 우선 — RTDB get이 전량 재다운로드하는 비용 회피(홈→상세 즉시).
    const ck = `${entityKey}::${companyId}`;
    const synced = _listResolved.get(ck);
    if (synced) { const hit = findCached(synced, key); if (hit) return hit; }
    const pending = _listCache.get(ck);
    if (pending) { const hit = findCached(await pending, key); if (hit) return hit; }
    if (!this.all(companyId)) return this.base.get(entityKey, companyId, key);
    for (const c of COMPANIES) { const r = await this.base.get(entityKey, c, key); if (r) return r; }
    return null;
  }
  /**
   * 캐시 우회 단건 조회 — **경합 판정 전용**.
   * list 캐시는 세션 내내 유지되므로 `get()`은 다른 사용자가 방금 만든 변화를 못 본다.
   * 이중판매 가드처럼 "남이 방금 선점했는가"를 물어야 하는 자리에서 캐시를 읽으면
   * 가드가 통과해 같은 차가 두 번 팔린다. 그런 자리에서만 이걸 쓴다(비용이 크다).
   */
  async getFresh(entityKey: string, companyId: string, key: string) {
    if (!this.all(companyId)) return this.base.get(entityKey, companyId, key);
    for (const c of COMPANIES) { const r = await this.base.get(entityKey, c, key); if (r) return r; }
    return null;
  }
  private async ownerOf(entityKey: string, key: string): Promise<string | null> {
    for (const c of COMPANIES) { const r = await this.base.get(entityKey, c, key); if (r) return c; }
    return null;
  }
  async update(entityKey: string, companyId: string, key: string, patch: EntityRecord) {
    if (!this.all(companyId)) {
      await this.base.update(entityKey, companyId, key, patch);
      // 전량 무효화 대신 해당 레코드만 패치(다음 list가 RTDB 전량 재다운로드 안 함).
      patchListCache(entityKey, companyId, key, patch);
      // 방 메시지 스코프 캐시도 메시지 write 시 무효(append는 호출부가 담당).
      if (entityKey === 'message') _invalidate('message');
      return;
    }
    const c = await this.ownerOf(entityKey, key); if (c) await this.base.update(entityKey, c, key, patch); _invalidate(entityKey);
  }
  async bulkPatch(entityKey: string, companyId: string, patches: { key: string; patch: EntityRecord }[]) {
    if (this.all(companyId)) throw new Error('전체 합본에서는 대상 회사를 먼저 선택하세요.');
    const n = await this.base.bulkPatch(entityKey, companyId, patches); _invalidate(entityKey); return n;
  }
  async bulkPatchGuardedProduct(companyId: string, patches: GuardedProductPatch[]) {
    if (this.all(companyId)) throw new Error('전체 합본에서는 대상 회사를 먼저 선택하세요.');
    const result = await this.base.bulkPatchGuardedProduct(companyId, patches);
    if (result.updated) _invalidate('product');
    return result;
  }
  async remove(entityKey: string, companyId: string, key: string, reason = '') {
    if (!this.all(companyId)) { const r = await this.base.remove(entityKey, companyId, key, reason); _invalidate(entityKey); return r; }
    const c = await this.ownerOf(entityKey, key); if (c) await this.base.remove(entityKey, c, key, reason); _invalidate(entityKey);
  }
  async restore(entityKey: string, companyId: string, key: string) {
    if (!this.all(companyId)) { const r = await this.base.restore(entityKey, companyId, key); _invalidate(entityKey); return r; }
    const c = await this.ownerOf(entityKey, key); if (c) await this.base.restore(entityKey, c, key); _invalidate(entityKey);
  }
}

export function getStore(): StoreAdapter {
  // 데이터 백엔드 opt-in(NEXT_PUBLIC_DATA_BACKEND). 기본 Local(seed).
  //   · rtdb  = v3 라이브 읽기 + 쓰기 v4/ 오버레이. Firebase 준비되면 세션 여부와 무관(시드 잔재 방지).
  //   · firestore = v4 전용 Firestore.
  // 공개면(/q·/catalog·/sign) 플래그는 Auth 게이트·공개 서명 슬롯용(isPublicAccess) — 스토어 선택과 분리.
  const backend = process.env.NEXT_PUBLIC_DATA_BACKEND;
  let base: StoreAdapter;
  const rtdbOk = backend === 'rtdb' && firebaseReady();
  if (rtdbOk) base = new RtdbAdapter();
  else if (backend === 'firestore' && firebaseReady()) base = new FirestoreAdapter();
  else base = new LocalAdapter();
  return new DispatchStore(base);
}
