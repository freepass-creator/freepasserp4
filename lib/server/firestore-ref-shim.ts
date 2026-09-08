import 'server-only';

import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { getDatabase, type Database } from 'firebase-admin/database';
import { firebaseAdminApp } from './firebase-admin';

/**
 * RTDB `db.ref(path)` 를 그대로 흉내내 Firestore 로 보내는 심(shim) — RTDB 폐기(사장님 2026-09-05).
 *
 * 왜 심인가: 계약·정산·전자서명 라우트 28개가 `db.ref('v4/…')` 를 직접 판다(178곳·규격상 getStore 위반).
 *   로직을 안 건드리고 «저장소만» 바꿔야 계약 사고가 안 난다. 그래서 get/set/update/remove/push/transaction/child
 *   시그니처를 RTDB 와 동일하게 맞춘 심을 두고, 라우트는 `const db = …` 한 줄만 firestoreAdminRef() 로 바꾼다.
 *
 * 경로 규칙 = 데이터 이관(scripts/migrate-rtdb-to-firestore-full.mts)과 «동일»:
 *   v4/{node}/{k1}[/{k2..}]  →  컬렉션 map(node) · 문서 k1 · (k2.. = 문서 안 중첩 필드경로)
 *   예) v4/contracts/CT-1              → doc('contract','CT-1')
 *       v4/esign_private/CT-1/HASH     → doc('esign_private','CT-1') 의 필드 'HASH'
 *       v4/esign_sessions/H/snapshot/x → doc('esign_sessions','H') 의 필드 'snapshot.x'
 *
 * 안전: 읽기는 «Firestore 먼저 · 실패/부재 시 RTDB 폴백»(이관 창 동안 구멍 방지). 쓰기는 Firestore 전용
 *   (데이터는 이미 이관됨 · 원본 RTDB 는 얼려 두어 롤백 자산). 완전 검증 뒤 폴백을 걷는다.
 */

// RTDB 노드 → Firestore 컬렉션. 이관 스크립트 NODES 와 반드시 일치.
const COL: Record<string, string> = {
  contracts: 'contract', settlements: 'settlement', policies: 'policy', partners: 'partner',
  customers: 'customer', users: 'user', products: 'products',
};
const ENTITY = new Set(['contracts', 'settlements', 'policies', 'partners', 'customers', 'users']);
const docSafe = (s: string) => s.replace(/[/#.$\[\]]/g, '_');
/**
 * 파이어스토어가 이 시간 안에 대답 못 하면 RTDB 로 간다 — 매달려 죽는 것보다 낫다.
 *
 * ⚠⚠ **1,500 이었고, 그것 때문에 손님 화면이 «폐기된 원장»을 보고 있었다**(2026-09-08 실측).
 *   함수가 미국(iad1)에서 돌고 파이어스토어는 서울(asia-northeast3)이라, 재고 1,438건을
 *   통째로 읽으면 매번 1.5초를 넘겼다. 그래서 **항상** RTDB 로 떨어졌다 —
 *   화면 703대 = RTDB v4 의 수였고, 파이어스토어(정본)는 709 였다.
 *   같은 차의 «출고불가»가 화면에서는 «출고가능»으로 팔리고 있었다.
 * ⇒ 뿌리는 «거리»라 `vercel.json` 에서 함수를 **서울(icn1)** 로 옮겼다(사장님 2026-09-08 승인).
 *   그러면 서울↔서울이라 실측 600ms 안쪽이다. 제한시간은 **그 위에 넉넉히** 둔다 —
 *   이 값은 «정상 속도»가 아니라 «장애를 얼마나 참을까»다. 짧게 잡으면 잠깐 느린 것이
 *   곧바로 «틀린 데이터»가 된다.
 */
const FS_TIMEOUT_MS = Number(process.env.FIRESTORE_READ_TIMEOUT_MS || 6000);
/**
 * **막히면 잠깐 쉬었다 다시 두드린다.**
 *
 * ⚠⚠ 2026-09-05 운영. 자격증명이 파이어스토어를 못 열자 읽는 곳마다 제한시간을 꼬박 기다렸고
 *   (재고·정책·공급사·사용자 넷이면 그것만으로 십수 초), 함수가 통째로 타임아웃 나서
 *   **손님 화면에 차가 한 대도 안 나왔다.** 폴백이 있어도 «매번 기다리면» 폴백이 아니다.
 * ⇒ 그래서 「한 번 막히면 그 인스턴스는 영영 RTDB」로 두었는데, **그게 이번 사고를 굳혔다.**
 *   한 번 늦었을 뿐인데 그 서버는 죽을 때까지 폐기된 원장을 내보냈다.
 * ★★**RTDB 는 폐기됐다**(사장님 2026-09-08 「알티디비는 안 쓸 거야 폐기했음」).
 *   그러니 폴백은 «옛 데이터로 버티는 길»이 아니라 **빈 화면을 막는 마지막 비상구**다.
 *   비상구는 늘 열려 있으면 안 된다 — **60초 뒤 다시 파이어스토어를 두드린다.**
 */
const BLOCK_MS = 60_000;
let blockedUntil = 0;
/** 마지막으로 폴백한 때·이유 — 조용히 넘어가지 않게 밖에서 읽는다(`storeHealth`). */
let lastFallback: { at: number; col: string; why: string } | null = null;

/**
 * **지금 이 서버가 어디를 읽고 있나** — `/api/version` 이 실어 보낸다.
 *
 * ⚠ 이번 사고가 여섯 달 갈 뻔한 이유는 폴백이 **조용해서**다. `console.error` 한 줄이 전부였고
 *   아무도 그 로그를 안 봤다. 화면은 멀쩡해 보였다 — 숫자만 조용히 틀렸다.
 * ⇒ 「지금 파이어스토어를 읽고 있나」를 **밖에서 물어볼 수 있게** 내놓는다.
 */
export function storeHealth() {
  return {
    store: Date.now() < blockedUntil ? 'rtdb-fallback' : 'firestore',
    timeoutMs: FS_TIMEOUT_MS,
    lastFallback,
  };
}
const companyOf = (v: any) => String(v?.companyId || v?.provider_company_code || v?.company_code || v?.partner_code || 'PT-0000');

type Parsed = { col: string; node: string; docId: string | null; field: string[] };
function parse(rawPath: string): Parsed {
  const parts = String(rawPath).replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (parts[0] === 'v4') parts.shift();
  const node = parts.shift() || '';
  const col = COL[node] || node;
  const docId = parts.length ? docSafe(parts.shift()!) : null;
  return { col, node, docId, field: parts };
}

class Snap {
  constructor(private _val: any, readonly key: string | null) {}
  val() { return this._val === undefined ? null : this._val; }
  exists() { return this._val !== undefined && this._val !== null; }
  get(child: string) { return this._val?.[child]; }
  forEach(cb: (c: Snap) => void) { if (this._val && typeof this._val === 'object') for (const [k, v] of Object.entries(this._val)) cb(new Snap(v, k)); }
}

function dig(obj: any, field: string[]) { let cur = obj; for (const f of field) { if (cur == null) return undefined; cur = cur[f]; } return cur; }

class RefShim {
  private p: Parsed;
  constructor(private fs: Firestore, private rtdb: Database, readonly path: string) { this.p = parse(path); }
  get key() { return this.p.field.length ? this.p.field[this.p.field.length - 1] : (this.p.docId ?? this.p.node); }
  child(k: string) { return new RefShim(this.fs, this.rtdb, `${this.path}/${k}`); }

  private docRef() { return this.p.docId ? this.fs.collection(this.p.col).doc(this.p.docId) : null; }

  async get(): Promise<Snap> {
    if (Date.now() < blockedUntil) return new Snap((await this.rtdb.ref(this.path).get()).val(), this.key);
    try {
      /*
       * ⚠⚠ 2026-09-05 운영 사고. 배포한 서버에서 파이어스토어가 `16 UNAUTHENTICATED` 로 막히자
       *   SDK 가 **재시도하며 매달렸고**, 함수가 타임아웃 나서 손님 화면에 **차가 한 대도 안 나왔다**
       *   (로그 상태코드 0). 폴백이 있어도 «빠르게 실패»하지 않으면 폴백까지 못 간다.
       * ⇒ 파이어스토어에 **시간 제한**을 건다. 그 안에 못 읽으면 RTDB 로 떨어진다.
       *   손님 화면에서 제일 나쁜 것은 옛 데이터가 아니라 빈 화면이다.
       */
      const guard = <T,>(work: Promise<T>) => Promise.race([
        work,
        new Promise<never>((_, no) => setTimeout(() => no(new Error('firestore-timeout')), FS_TIMEOUT_MS)),
      ]);
      if (!this.p.docId) {
        // 노드 전체 → { docId: data } 맵 (RTDB 노드 읽기 흉내)
        const q = await guard(this.fs.collection(this.p.col).get());
        if (!q.empty) { const out: Record<string, any> = {}; q.forEach((d) => { const x: any = d.data(); out[String(x._key || d.id)] = x; }); return new Snap(out, this.p.node); }
      } else {
        const d = await guard(this.docRef()!.get());
        if (d.exists) return new Snap(this.p.field.length ? dig(d.data(), this.p.field) : d.data(), this.key);
      }
    } catch (e) {
      /* ★왜 떨어졌는지 «한 번만» 남긴다 — 조용히 옛 데이터가 나가면 아무도 눈치채지 못한다. */
      const why = e instanceof Error ? e.message : 'unknown';
      /* ★★매번 남긴다 — 「한 번만」 남겼더니 그 한 줄을 아무도 못 봤다(위 `storeHealth` 머리말). */
      console.error('[firestore-shim] 폴백 — 폐기된 RTDB 를 읽습니다', this.p.col, why);
      lastFallback = { at: Date.now(), col: this.p.col, why };
      /* 자격증명·연결이 막힌 것이면 «잠깐» 쉬었다 다시 두드린다(위 `BLOCK_MS` 머리말). */
      if (/UNAUTHENTICATED|PERMISSION_DENIED|firestore-timeout|UNAVAILABLE|DEADLINE/i.test(why)) blockedUntil = Date.now() + BLOCK_MS;
    }
    const snap = await this.rtdb.ref(this.path).get();
    return new Snap(snap.val(), this.key);
  }

  private withMeta(val: any) {
    if (ENTITY.has(this.p.node) && val && typeof val === 'object' && !Array.isArray(val)) return { ...val, companyId: companyOf(val), _key: this.p.docId };
    return val;
  }

  async set(val: any): Promise<void> {
    const ref = this.docRef(); if (!ref) throw new Error(`set 은 문서 경로여야 함: ${this.path}`);
    if (this.p.field.length) { await ref.set({ [this.p.field.join('.')]: val }, { merge: true }); return; }
    await ref.set(this.withMeta(val));
  }

  async update(obj: Record<string, any>): Promise<void> {
    const ref = this.docRef();
    if (!ref) {
      // ★루트/노드 팬아웃 업데이트(RTDB `db.ref('v4').update({'esign_events/CT/e':X, 'contracts/CT/f':Y})`).
      //   각 «경로키»를 매핑해 문서 쓰기로 분해. ≤450은 한 배치(원자적). 시트동기 등 대량은 450단위로 쪼개 커밋.
      const entries = Object.entries(obj);
      for (let i = 0; i < entries.length; i += 450) {
        const batch = this.fs.batch();
        for (const [rawKey, val] of entries.slice(i, i + 450)) {
          const sub = parse(`${this.path}/${rawKey}`.replace(/\/+/g, '/'));
          if (!sub.docId) throw new Error(`update 경로키가 문서까지 못 감: ${this.path} / ${rawKey}`);
          const dref = this.fs.collection(sub.col).doc(sub.docId);
          if (sub.field.length) batch.set(dref, { [sub.field.join('.')]: val }, { merge: true });
          else batch.set(dref, ENTITY.has(sub.node) && val && typeof val === 'object' && !Array.isArray(val) ? { ...val, companyId: companyOf(val), _key: sub.docId } : val, { merge: true });
        }
        await batch.commit();
      }
      return;
    }
    const prefix = this.p.field.length ? this.p.field.join('.') + '.' : '';
    const patch: Record<string, any> = {}; for (const [k, v] of Object.entries(obj)) patch[prefix + k] = v;
    await ref.set(patch, { merge: true }); // set-merge = RTDB update(없으면 생성) 의미와 동일
  }

  async remove(): Promise<void> {
    const ref = this.docRef(); if (!ref) return;
    if (this.p.field.length) { await ref.update({ [this.p.field.join('.')]: FieldValue.delete() }); return; }
    await ref.delete();
  }

  async push(val?: any): Promise<{ key: string }> {
    const id = this.fs.collection('_ids').doc().id; // 자동 id
    if (!this.p.docId) { if (val !== undefined) await this.fs.collection(this.p.col).doc(id).set(this.withMeta(val)); return { key: id }; }
    if (val !== undefined) await this.docRef()!.set({ [[...this.p.field, id].join('.')]: val }, { merge: true });
    return { key: id };
  }

  /** RTDB transaction(fn) → 문서 단위 Firestore 트랜잭션. fn 이 undefined 반환 시 중단(committed:false). */
  async transaction(fn: (current: any) => any, _onComplete?: unknown, _applyLocally?: boolean): Promise<{ committed: boolean; snapshot: Snap }> {
    const ref = this.docRef(); if (!ref) throw new Error(`transaction 은 문서 경로여야 함: ${this.path}`);
    const fieldKey = this.p.field.length ? this.p.field.join('.') : '';
    const result = await this.fs.runTransaction(async (tx) => {
      const d = await tx.get(ref);
      let current: any;
      if (!d.exists) {
        // Firestore 부재 → RTDB 폴백값을 시드(이관 창 안전)
        try { const rt = await this.rtdb.ref(this.path).get(); current = rt.val(); } catch { current = undefined; }
      } else { current = fieldKey ? dig(d.data(), this.p.field) : d.data(); }
      const next = fn(current === null ? undefined : current);
      if (next === undefined) return { committed: false, value: current };
      if (fieldKey) tx.set(ref, { [fieldKey]: next }, { merge: true });
      else tx.set(ref, this.withMeta(next));
      return { committed: true, value: next };
    });
    return { committed: result.committed, snapshot: new Snap(result.value, this.key) };
  }
}

class DbShim {
  constructor(private fs: Firestore, private rtdb: Database) {}
  ref(path: string) { return new RefShim(this.fs, this.rtdb, path); }
}

/** 라우트가 `db` 파라미터 타입에 쓸 별칭 — `ReturnType<typeof getDatabase>` 대체. */
export type AdminRef = DbShim;

let cached: DbShim | null = null;
/** RTDB `firebaseAdminDatabase()` 대체 — 같은 `.ref(path)` 인터페이스, Firestore 백엔드. */
export function firestoreAdminRef(): DbShim {
  if (cached) return cached;
  const app = firebaseAdminApp();
  cached = new DbShim(getFirestore(app), getDatabase(app));
  return cached;
}
