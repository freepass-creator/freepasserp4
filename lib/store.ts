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
import { COMPANIES, ALL_COMPANIES } from './companies';

export type SaveResult = { saved: number; duplicates: number; backend: string };

export interface StoreAdapter {
  backend: string;
  save(entityKey: string, companyId: string, records: EntityRecord[]): Promise<SaveResult>;
  list(entityKey: string, companyId: string): Promise<EntityRecord[]>;
  get(entityKey: string, companyId: string, key: string): Promise<EntityRecord | null>;
  update(entityKey: string, companyId: string, key: string, patch: EntityRecord): Promise<void>;
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
  // 전 write 자동 감사 — 페이지가 신경 안 쓰게 writer 레벨에서 강제(ERP 30원칙). audit_log·message는 제외(자기자신·고빈도).
  private logAudit(entityKey: string, companyId: string, key: string, action: string, before: EntityRecord | null, after: EntityRecord | null) {
    if (typeof window === 'undefined' || entityKey === 'audit_log' || entityKey === 'message') return;
    try {
      const ak = this.k('audit_log', companyId);
      const arr = JSON.parse(localStorage.getItem(ak) || '[]') as EntityRecord[];
      const a = currentActor();
      arr.push({ _key: `AL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, entity: entityKey, target_key: key, action, actor_uid: a.uid, actor_role: a.role, actor_name: a.name, at: Date.now(), before: before ? JSON.stringify(before).slice(0, 600) : '', after: after ? JSON.stringify(after).slice(0, 600) : '' });
      if (arr.length > 1000) arr.splice(0, arr.length - 1000);
      localStorage.setItem(ak, JSON.stringify(arr));
    } catch { /* 감사는 best-effort */ }
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
      await withTimeout(setDoc(doc(col, id), { ...rec, companyId, _key: key, createdAt: new Date().toISOString(), createdBy: 'system' }));
      if (key) seen.add(key);
      saved++;
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
    const { getFirestore, doc, setDoc } = await import('firebase/firestore');
    const db = getFirestore(getFirebaseApp()!);
    await setDoc(doc(db, entityKey, `${companyId}__${key}`), { ...patch, updatedAt: new Date().toISOString() }, { merge: true });
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
function _invalidate(entityKey: string) { for (const k of [..._listCache.keys()]) if (k.startsWith(entityKey + '::')) _listCache.delete(k); }
export function clearStoreCache() { _listCache.clear(); }

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
      p = this.all(companyId)
        ? Promise.all(COMPANIES.map((c) => this.base.list(entityKey, c))).then((a) => a.flat())
        : this.base.list(entityKey, companyId);
      _listCache.set(ck, p);
      p.catch(() => _listCache.delete(ck)); // 실패는 캐시 안 함(다음에 재시도)
    }
    return p;
  }
  async listDeleted(entityKey: string, companyId: string) {
    if (!this.all(companyId)) return this.base.listDeleted(entityKey, companyId);
    return (await Promise.all(COMPANIES.map((c) => this.base.listDeleted(entityKey, c)))).flat();
  }
  async get(entityKey: string, companyId: string, key: string) {
    if (!this.all(companyId)) return this.base.get(entityKey, companyId, key);
    for (const c of COMPANIES) { const r = await this.base.get(entityKey, c, key); if (r) return r; }
    return null;
  }
  private async ownerOf(entityKey: string, key: string): Promise<string | null> {
    for (const c of COMPANIES) { const r = await this.base.get(entityKey, c, key); if (r) return c; }
    return null;
  }
  async update(entityKey: string, companyId: string, key: string, patch: EntityRecord) {
    if (!this.all(companyId)) { const r = await this.base.update(entityKey, companyId, key, patch); _invalidate(entityKey); return r; }
    const c = await this.ownerOf(entityKey, key); if (c) await this.base.update(entityKey, c, key, patch); _invalidate(entityKey);
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
  // 데이터 백엔드는 명시 opt-in(NEXT_PUBLIC_DATA_BACKEND=firestore)일 때만 원격.
  // Firebase Auth 설정(NEXT_PUBLIC_FIREBASE_*)이 있어도 데이터는 기본 Local 유지 —
  // freepasserp3 는 RTDB 라 Firestore 로 붙으면 빈 데이터. RTDB 브리지는 후속(RtdbAdapter).
  const backend = process.env.NEXT_PUBLIC_DATA_BACKEND;
  const base = backend === 'firestore' && firebaseReady() ? new FirestoreAdapter() : new LocalAdapter();
  return new DispatchStore(base);
}
