/**
 * 데이터 저장 레이어 — 멀티테넌트(companyId 스코프) + 어댑터 seam.
 *   · Firebase 설정 있으면 → FirestoreAdapter (실 저장, 회사별 격리)
 *   · 없으면            → LocalAdapter (localStorage, dev 미리보기)
 * 어느 쪽이든 동일 인터페이스 → Firestore 전환은 설정값만 넣으면 됨.
 * 모든 문서: { ...record, companyId, _key(자연키), createdAt, createdBy }. dedup = 자연키(entity.idFrom).
 */
import { ENTITIES, type EntityRecord } from './intake/entities';
import { currentActor } from './session';
import { getFirebaseApp, firebaseReady } from './firebase/client';
import { RtdbAdapter } from './firebase/rtdb-adapter';
import { COMPANIES, ALL_COMPANIES } from './companies';
import { buildAuditEntry, buildMasterSnapBulkEntry } from './domain/audit';

export type SaveResult = { saved: number; duplicates: number; backend: string };

export interface StoreAdapter {
  backend: string;
  save(entityKey: string, companyId: string, records: EntityRecord[]): Promise<SaveResult>;
  list(entityKey: string, companyId: string): Promise<EntityRecord[]>;
  /** 방 하나 메시지 스코프 조회(전 방 list 회피). 미구현 어댑터는 list+필터로 폴백. */
  listMessagesForRoom?(companyId: string, roomId: string): Promise<EntityRecord[]>;
  get(entityKey: string, companyId: string, key: string): Promise<EntityRecord | null>;
  update(entityKey: string, companyId: string, key: string, patch: EntityRecord): Promise<void>;
  bulkPatch(entityKey: string, companyId: string, patches: { key: string; patch: EntityRecord }[]): Promise<number>; // 다건 부분갱신(멀티패스) — 일괄 차종 재구현 등
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
      const snap = await withTimeout(getDocs(query(collection(db, entityKey), where('companyId', '==', companyId))));
      return snap.docs.map((d) => d.data() as EntityRecord).filter((r) => !r.deletedAt);
    } catch (e) { console.warn(`Firestore list(${entityKey}) 대기 실패(DB·규칙 확인):`, (e as Error).message); return []; }
  }
  async get(entityKey: string, companyId: string, key: string): Promise<EntityRecord | null> {
    try {
      const { getFirestore, doc, getDoc } = await import('firebase/firestore');
      const db = getFirestore(getFirebaseApp()!);
      const snap = await withTimeout(getDoc(doc(db, entityKey, `${companyId}__${key}`)));
      return snap.exists() ? (snap.data() as EntityRecord) : null;
    } catch (e) { console.warn(`Firestore get(${entityKey}) 대기 실패(DB·규칙 확인):`, (e as Error).message); return null; }
  }
  async update(entityKey: string, companyId: string, key: string, patch: EntityRecord): Promise<void> {
    const before = await this.get(entityKey, companyId, key);
    const { getFirestore, doc, setDoc } = await import('firebase/firestore');
    const db = getFirestore(getFirebaseApp()!);
    const after = { ...(before || {}), ...patch, updatedAt: new Date().toISOString() };
    await setDoc(doc(db, entityKey, `${companyId}__${key}`), { ...patch, updatedAt: after.updatedAt }, { merge: true });
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
function _invalidate(entityKey: string) {
  for (const k of [..._listCache.keys()]) if (k.startsWith(entityKey + '::')) _listCache.delete(k);
  for (const k of [..._listResolved.keys()]) if (k.startsWith(entityKey + '::')) _listResolved.delete(k);
}
export function clearStoreCache() { _listCache.clear(); _listResolved.clear(); }

/** list 캐시 부분 패치 — update 후 전량 무효화 대신 해당 레코드만 병합. 캐시 없으면 no-op(다음 list가 신선 조회). */
export function patchListCache(entityKey: string, companyId: string, key: string, patch: EntityRecord): void {
  const ck = `${entityKey}::${companyId}`;
  const rows = _listResolved.get(ck);
  if (!rows) return;
  const i = rows.findIndex((r) => String(r._key) === key);
  const next = rows.slice();
  if (i >= 0) next[i] = { ...next[i], ...patch, _key: key };
  else next.push({ ...patch, _key: key } as EntityRecord);
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
    let p = _listCache.get(ck);
    if (!p) {
      p = (this.all(companyId)
        ? Promise.all(COMPANIES.map((c) => this.base.list(entityKey, c))).then((a) => a.flat())
        : this.base.list(entityKey, companyId)
      ).then((rows) => { _listResolved.set(ck, rows); return rows; });
      _listCache.set(ck, p);
      p.catch(() => { _listCache.delete(ck); _listResolved.delete(ck); }); // 실패는 캐시 안 함(다음에 재시도)
    }
    return p;
  }
  async listMessagesForRoom(companyId: string, roomId: string) {
    const ck = `message::${companyId}::room::${roomId}`;
    let p = _listCache.get(ck);
    if (!p) {
      const base = this.base;
      p = (typeof base.listMessagesForRoom === 'function'
        ? base.listMessagesForRoom(companyId, roomId)
        : base.list('message', companyId).then((all) => all.filter((m) => String(m.room_id) === roomId))
      ).then((rows) => { _listResolved.set(ck, rows); return rows; });
      _listCache.set(ck, p);
      p.catch(() => { _listCache.delete(ck); _listResolved.delete(ck); });
    }
    return p;
  }
  async listDeleted(entityKey: string, companyId: string) {
    if (!this.all(companyId)) return this.base.listDeleted(entityKey, companyId);
    return (await Promise.all(COMPANIES.map((c) => this.base.listDeleted(entityKey, c)))).flat();
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
