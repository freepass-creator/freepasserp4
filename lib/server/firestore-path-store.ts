import 'server-only';

import { getFirestore, FieldValue, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { firebaseAdminApp } from './firebase-admin';

/**
 * 레거시 경로형 저장소 호출을 Firestore 컬렉션/문서로 보내는 어댑터.
 *
 * 왜 심인가: 계약·정산·전자서명 라우트 28개가 `db.ref('v4/…')` 를 직접 판다(178곳·규격상 getStore 위반).
 *   로직을 안 건드리고 «저장소만» 바꿔야 계약 사고가 안 난다. 그래서 get/set/update/remove/push/transaction/child
 *   시그니처를 RTDB 와 동일하게 맞춘 심을 두고, 라우트는 `const db = …` 한 줄만 firestorePathStore() 로 바꾼다.
 *
 * 경로 규칙 = 데이터 이관(scripts/migrate-firestore-project.mts)과 «동일»:
 *   v4/{node}/{k1}[/{k2..}]  →  컬렉션 map(node) · 문서 k1 · (k2.. = 문서 안 중첩 필드경로)
 *   예) v4/contracts/CT-1              → doc('contract','CT-1')
 *       v4/esign_private/CT-1/HASH     → doc('esign_private','CT-1') 의 필드 'HASH'
 *       v4/esign_sessions/H/snapshot/x → doc('esign_sessions','H') 의 필드 'snapshot.x'
 *
 * 읽기와 쓰기는 모두 Firestore 전용이며 다른 데이터베이스로 폴백하지 않는다.
 */

// RTDB 노드 → Firestore 컬렉션. 이관 스크립트 NODES 와 반드시 일치.
const COL: Record<string, string> = {
  contracts: 'contract', settlements: 'settlement', policies: 'policy', partners: 'partner',
  customers: 'customer', users: 'user', products: 'products',
};
const ENTITY = new Set(['contracts', 'settlements', 'policies', 'partners', 'customers', 'users']);
const ROOT_TRANSACTION_NODES = [
  'products', 'partners', 'inventory_sync_runs', 'inventory_sync_control', 'audit_logs',
];
const docSafe = (s: string) => s.replace(/[/#.$\[\]]/g, '_');
/** 서버 요청이 무기한 대기하지 않도록 Firestore 읽기 상한을 둔다. */
const FS_TIMEOUT_MS = Number(process.env.FIRESTORE_READ_TIMEOUT_MS || 10_000);
const companyOf = (v: any) => String(v?.companyId || v?.provider_company_code || v?.company_code || v?.partner_code || 'PT-0000');
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const stored = (node: string, docId: string, val: any) => (
  ENTITY.has(node) && val && typeof val === 'object' && !Array.isArray(val)
    ? { ...val, companyId: companyOf(val), _key: docId }
    : val
);

type Parsed = { col: string; node: string; docId: string | null; field: string[] };
function parse(rawPath: string): Parsed {
  const parts = String(rawPath).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (parts[0] === 'v4') parts.shift();
  const node = parts.shift() || '';
  const col = COL[node] || node;
  const docId = parts.length ? docSafe(parts.shift()!) : null;
  return { col, node, docId, field: parts };
}

const logicalKey = (node: string, docId: string, value: Record<string, any>) => (
  node === 'products' ? String(value.product_code || value.car_number || value._key || docId) : String(value._key || docId)
);

async function resolvedDocRef(fs: Firestore, parsed: Parsed): Promise<DocumentReference | null> {
  if (!parsed.docId) return null;
  const col = fs.collection(parsed.col);
  if (parsed.node !== 'products') return col.doc(parsed.docId);
  const byCode = await col.where('product_code', '==', parsed.docId).limit(2).get();
  if (byCode.size > 1) throw new Error(`중복 product_code: ${parsed.docId}`);
  if (byCode.docs[0]) return byCode.docs[0].ref;
  const byCarNumber = await col.where('car_number', '==', parsed.docId).limit(2).get();
  if (byCarNumber.size > 1) throw new Error(`중복 car_number: ${parsed.docId}`);
  return byCarNumber.docs[0]?.ref || col.doc(parsed.docId);
}

class Snap {
  constructor(private _val: any, readonly key: string | null) {}
  val() { return this._val === undefined ? null : this._val; }
  exists() { return this._val !== undefined && this._val !== null; }
  get(child: string) { return this._val?.[child]; }
  forEach(cb: (c: Snap) => void) { if (this._val && typeof this._val === 'object') for (const [k, v] of Object.entries(this._val)) cb(new Snap(v, k)); }
}

function dig(obj: any, field: string[]) { let cur = obj; for (const f of field) { if (cur == null) return undefined; cur = cur[f]; } return cur; }
/** 필드경로 → «중첩 객체». Firestore set(merge)는 «점 든 키»를 문자 그대로 저장한다(중첩 아님) — dig 읽기와 어긋난다.
 *  그래서 { snapshot: { status: v } } 로 만들어 set-merge 하면 깊은 병합으로 중첩 저장돼 dig 와 대칭이 된다. */
function nest(field: string[], val: any): any { return field.length ? { [field[0]]: nest(field.slice(1), val) } : val; }
/** target 에 «중첩 경로»로 값을 심는다(여러 키를 한 patch 로 모을 때). */
function deepSet(target: Record<string, any>, path: string[], val: any): void {
  let cur = target;
  for (let i = 0; i < path.length - 1; i++) { if (cur[path[i]] == null || typeof cur[path[i]] !== 'object') cur[path[i]] = {}; cur = cur[path[i]]; }
  cur[path[path.length - 1]] = val;
}

class RefShim {
  private p: Parsed;
  constructor(private fs: Firestore, readonly path: string) { this.p = parse(path); }
  get key() { return this.p.field.length ? this.p.field[this.p.field.length - 1] : (this.p.docId ?? this.p.node); }
  child(k: string) { return new RefShim(this.fs, `${this.path}/${k}`); }

  private docRef() { return resolvedDocRef(this.fs, this.p); }

  async get(): Promise<Snap> {
    const guard = <T,>(work: Promise<T>) => Promise.race([
      work,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('firestore-timeout')), FS_TIMEOUT_MS)),
    ]);
    if (!this.p.docId) {
      const q = await guard(this.fs.collection(this.p.col).get());
      const out: Record<string, any> = {};
      q.forEach((d) => { const x: any = d.data(); out[logicalKey(this.p.node, d.id, x)] = x; });
      return new Snap(out, this.p.node);
    }
    const ref = await this.docRef();
    const d = await guard(ref!.get());
    return new Snap(d.exists ? (this.p.field.length ? dig(d.data(), this.p.field) : d.data()) : null, this.key);
  }

  private withMeta(val: any) {
    if (ENTITY.has(this.p.node) && val && typeof val === 'object' && !Array.isArray(val)) return { ...val, companyId: companyOf(val), _key: this.p.docId };
    return val;
  }

  async set(val: any): Promise<void> {
    const ref = await this.docRef(); if (!ref) throw new Error(`set 은 문서 경로여야 함: ${this.path}`);
    if (val === null) {
      if (this.p.field.length) await ref.set(nest(this.p.field, FieldValue.delete()), { mergeFields: [this.p.field.join('.')] });
      else await ref.delete();
      return;
    }
    if (this.p.field.length) {
      await ref.set(nest(this.p.field, val), { mergeFields: [this.p.field.join('.')] });
      return;
    }
    await ref.set(this.withMeta(val));
  }

  async update(obj: Record<string, any>): Promise<void> {
    const ref = await this.docRef();
    if (!ref) {
      // ★루트/노드 팬아웃 업데이트(RTDB `db.ref('v4').update({'esign_events/CT/e':X, 'contracts/CT/f':Y})`).
      //   각 «경로키»를 매핑해 문서 쓰기로 분해하고 한 배치로 원자 반영한다.
      //   한도를 넘으면 시작 전에 거부해 여러 배치가 부분 반영되는 상태를 만들지 않는다.
      const entries = Object.entries(obj);
      if (entries.length > 450) throw new Error(`Firestore atomic update write limit 초과: ${entries.length}`);
      const batch = this.fs.batch();
      for (const [rawKey, val] of entries) {
        const sub = parse(`${this.path}/${rawKey}`.replace(/\/+/g, '/'));
        if (!sub.docId) throw new Error(`update 경로키가 문서까지 못 감: ${this.path} / ${rawKey}`);
        const dref = (await resolvedDocRef(this.fs, sub))!;
        if (val === null) {
          if (sub.field.length) batch.set(dref, nest(sub.field, FieldValue.delete()), { merge: true });
          else batch.delete(dref);
        } else if (sub.field.length) batch.set(dref, nest(sub.field, val), { merge: true });
        else batch.set(dref, ENTITY.has(sub.node) && val && typeof val === 'object' && !Array.isArray(val) ? { ...val, companyId: companyOf(val), _key: sub.docId } : val, { merge: true });
      }
      await batch.commit();
      return;
    }
    // ★중첩 경로를 «중첩 객체»로 심는다(점/슬래시 든 키 포함) — set-merge 는 점 키를 문자 그대로 저장하므로 nest 필요.
    const patch: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) deepSet(
      patch,
      [...this.p.field, ...k.split(/[/.]/).filter(Boolean)],
      v === null ? FieldValue.delete() : v,
    );
    await ref.set(patch, { merge: true }); // set-merge = RTDB update(없으면 생성) 의미와 동일
  }

  async remove(): Promise<void> {
    const ref = await this.docRef(); if (!ref) return;
    if (this.p.field.length) {
      await ref.set(nest(this.p.field, FieldValue.delete()), { mergeFields: [this.p.field.join('.')] });
      return;
    }
    await ref.delete();
  }

  async push(val?: any): Promise<{ key: string }> {
    const id = this.fs.collection('_ids').doc().id; // 자동 id
    if (!this.p.docId) { if (val !== undefined) await this.fs.collection(this.p.col).doc(id).set(this.withMeta(val)); return { key: id }; }
    if (val !== undefined) await (await this.docRef())!.set(nest([...this.p.field, id], val), { merge: true });
    return { key: id };
  }

  /** 경로형 transaction(fn) → 문서 단위 Firestore 트랜잭션. */
  async transaction(fn: (current: any) => any, _onComplete?: unknown, _applyLocally?: boolean): Promise<{ committed: boolean; snapshot: Snap }> {
    const ref = await this.docRef();
    if (!ref) {
      const result = await this.fs.runTransaction(async (tx) => {
        const nodes = this.p.node ? [this.p.node] : ROOT_TRANSACTION_NODES;
        const beforeRoot: Record<string, Record<string, any>> = {};
        const physicalIds: Record<string, Record<string, string>> = {};
        for (const node of nodes) {
          const col = COL[node] || node;
          const q = await tx.get(this.fs.collection(col));
          const rows: Record<string, any> = {};
          const ids: Record<string, string> = {};
          q.forEach((d) => {
            const value = d.data();
            const key = logicalKey(node, d.id, value);
            rows[key] = value;
            ids[key] = d.id;
          });
          beforeRoot[node] = rows;
          physicalIds[node] = ids;
        }
        const current = this.p.node ? beforeRoot[this.p.node] : beforeRoot;
        const next = fn(current);
        if (next === undefined) return { committed: false, value: current };
        const afterRoot = this.p.node ? { [this.p.node]: next } : next as Record<string, Record<string, any>>;
        const writes: Array<{ node: string; id: string; before: any; after: any }> = [];
        for (const node of nodes) {
          const before = beforeRoot[node] || {};
          const after = afterRoot?.[node] && typeof afterRoot[node] === 'object' ? afterRoot[node] : {};
          for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
            if (!same(before[id], after[id])) writes.push({ node, id, before: before[id], after: after[id] });
          }
        }
        if (writes.length > 450) throw new Error(`Firestore transaction write limit 초과: ${writes.length}`);
        for (const write of writes) {
          const dref = this.fs.collection(COL[write.node] || write.node).doc(physicalIds[write.node]?.[write.id] || docSafe(write.id));
          if (write.after == null) tx.delete(dref);
          else tx.set(dref, stored(write.node, write.id, write.after));
        }
        return { committed: true, value: next };
      });
      return { committed: result.committed, snapshot: new Snap(result.value, this.key) };
    }
    const fieldKey = this.p.field.length ? this.p.field.join('.') : '';
    const result = await this.fs.runTransaction(async (tx) => {
      const d = await tx.get(ref);
      let current: any;
      if (!d.exists) current = undefined;
      else current = fieldKey ? dig(d.data(), this.p.field) : d.data();
      const next = fn(current === null ? undefined : current);
      if (next === undefined) return { committed: false, value: current };
      if (next === null) {
        if (this.p.field.length) tx.set(ref, nest(this.p.field, FieldValue.delete()), { merge: true });
        else tx.delete(ref);
      } else if (this.p.field.length) tx.set(ref, nest(this.p.field, next), { merge: true });
      else tx.set(ref, this.withMeta(next));
      return { committed: true, value: next };
    });
    return { committed: result.committed, snapshot: new Snap(result.value, this.key) };
  }
}

class DbShim {
  constructor(private fs: Firestore) {}
  ref(path: string) { return new RefShim(this.fs, path); }
}

/** 라우트가 `db` 파라미터 타입에 쓸 별칭 — `ReturnType<typeof getDatabase>` 대체. */
export type AdminRef = DbShim;

let cached: DbShim | null = null;
/** RTDB `firebaseAdminStore()` 대체 — 같은 `.ref(path)` 인터페이스, Firestore 백엔드. */
export function firestorePathStore(): DbShim {
  if (cached) return cached;
  const app = firebaseAdminApp();
  cached = new DbShim(getFirestore(app));
  return cached;
}
