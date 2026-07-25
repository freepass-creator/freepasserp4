/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * RtdbAdapter — freepasserp3 라이브 RTDB를 v4 StoreAdapter로 브리지(회원·데이터 그대로 반영).
 *   · 읽기 = v3 라이브 노드 직접(products/policies/partners/users/contracts/rooms/messages/settlements) — read-only 무해.
 *   · 쓰기 = v4 네임스페이스 오버레이 `v4/{node}/{key}` (라이브 v3 무변경, 프로덕션 보호).
 *   · list = merge(v3 라이브 ∪ v4 오버레이, 같은 _key는 필드단위 v4 우선).
 *   · soft-delete = 오버레이 톰스톤 `_deleted/deletedAt`. v3 boolean `_deleted`도 함께 필터.
 *   · 조인 enrich: product._policy(policies 조인), settlement.contract_date(contracts 조인), room.vehicle_name 합성.
 * 스키마 매핑 근거 = 워크플로 wgt6khvjq(6도메인 매핑→v4 실사용 대조검증→합성).
 */
import { ref, get, query, orderByChild, equalTo, update as dbUpdate, type DataSnapshot } from 'firebase/database';
import { getRtdb, getAuthClient } from './client';
import { ENTITIES, type EntityRecord } from '../intake/entities';
import { withProviderNames } from '@/lib/domain/identity';
import { currentActor } from '../session';
import { getSession } from '../auth-session';
import type { StoreAdapter, SaveResult } from '../store';
import { buildAuditEntry, buildMasterSnapBulkEntry } from '@/lib/domain/audit';
import { toV4Record } from './rtdb-records';
import {
  canSeeProductCost,
  dedupeProductsByVehicle,
  isExcludedProduct,
  stripProductCost,
} from './rtdb-products';

type Rec = Record<string, any>;

// RTDB update()/set()는 값에 undefined 있으면 throw. 저장 직전 undefined 키 제거(applySnap의 미매칭 variant/trim 등 방어).
const stripUndef = (o: Rec): Rec => { const r: Rec = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v; return r; };

// v4 엔티티키 → v3 RTDB 노드명
const NODE: Record<string, string> = {
  product: 'products', policy: 'policies', partner: 'partners', user: 'users',
  contract: 'contracts', room: 'rooms', message: 'messages', settlement: 'settlements', admin_settlement: 'admin_settlements', audit_log: 'audit_logs',
  customer: 'customers', // ← 누락 시 단수 'customer' 경로로 새어 v4/$other(오픈) 규칙에 걸림. 복수 노드로 강제.
};
const OVERLAY = 'v4'; // 쓰기 격리 루트
// v3 라이브에서 당겨오는 엔티티 = 매물·회원·채팅·계약(+매물 표시에 필요한 정책·공급사).
//  정산·감사는 v4 네이티브(오버레이만). 쓰기는 전부 v4/ 오버레이(v3 라이브 무변경).
const BRIDGE_FROM_V3 = new Set(['product', 'policy', 'partner', 'user', 'room', 'message', 'contract']);

// 카슝(구독차량 연동)만 카탈로그서 제외 — 연동 끊겨 현재 0대. 빌린카(RP021 자체매물)는 포함(erp3도 포함).
//  ※ 과거엔 RP021(빌린카)까지 묶어 뺐으나 오분류였음 — 빌린카는 정상 공급사(자체매물). 카슝=PT-0024.

function naturalKey(entity: string, rec: Rec): string {
  const e = ENTITIES[entity];
  if (!e) return String(rec._key ?? '');
  const v = e.idFrom ? rec[e.idFrom] : undefined;
  if (v != null && v !== '') return String(v);
  if (e.keyFields) { const parts = e.keyFields.map((k) => String(rec[k] ?? '')).filter(Boolean); if (parts.length) return parts.join('|'); }
  return String(rec._key ?? '');
}

// v3 계약 첨부(customer_docs 중첩맵 + doc_attachments 배열) → v4 attachments 배열
// 문자열 URL만 있는 경우 name=URL 로 들어가 목록이 링크 덤프·NaNKB 로 깨짐 → 정규화.
export class RtdbAdapter implements StoreAdapter {
  backend = 'rtdb(freepasserp3)';
  private db() { const d = getRtdb(); if (!d) throw new Error('RTDB 미연결'); return d; }

  // message = 중첩 messages/{roomId}/{pushId} → flat + room_id 실체화. 오버레이는 flat v4/messages/{pushId}.
  // v3 rules = $room_id 단위 읽기만 허용 → roomIds 로 스코프 조회(통째 get 금지).
  private async readMessages(co: string, overlay: boolean, roomIds: string[] = []): Promise<EntityRecord[]> {
    const out: EntityRecord[] = [];
    if (overlay) {
      // v4 rules = room_id 쿼리 스코프(통째 get = permission_denied). roomIds 별 orderByChild('room_id') 조회.
      //  통째 get + 클라 필터는 보안경계가 아님(raw SDK로 전량 유출) → 방 소유권을 rules가 판정하는 쿼리로 전환.
      await Promise.all(roomIds.map(async (roomId) => {
        try {
          const val: Rec = (await get(query(ref(this.db(), `${OVERLAY}/messages`), orderByChild('room_id'), equalTo(roomId)))).val() || {};
          for (const [k, m] of Object.entries<any>(val)) {
            if (m && typeof m === 'object') out.push({ ...m, _key: String(k), room_id: m.room_id || roomId, companyId: co } as EntityRecord);
          }
        } catch { /* 권한 없는 방 스킵 */ }
      }));
      return out;
    }
    await Promise.all(roomIds.map(async (roomId) => {
      try {
        const val: Rec = (await get(ref(this.db(), `messages/${roomId}`))).val() || {};
        for (const [pushId, m] of Object.entries<any>(val)) {
          if (m && typeof m === 'object') out.push({ ...m, _key: String(pushId), room_id: m.room_id || roomId, companyId: co } as EntityRecord);
        }
      } catch { /* 권한 없는 방 스킵 */ }
    }));
    return out;
  }

  /**
   * rooms 스코프 조회 — v3 `rooms` · v4 `v4/rooms` 양쪽. rules가 query.orderByChild 스코프 요구 → 통째 get 금지.
   * v4 오버레이 방도 소유필드(agent_uid·agent_channel_code·provider_company_code)를 담아야 스코프 조회됨(update()에서 승계 스탬프).
   */
  private async readRoomsScoped(co: string, overlay: boolean): Promise<EntityRecord[]> {
    const node = overlay ? `${OVERLAY}/rooms` : 'rooms';
    const auth = getAuthClient()?.currentUser;
    const sess = getSession();
    const role = sess?.role || 'agent';
    const db = this.db();
    const out: EntityRecord[] = [];
    const pushVal = (val: Rec | null) => {
      if (!val) return;
      for (const [childKey, rec] of Object.entries<any>(val)) {
        if (rec && typeof rec === 'object') out.push(toV4Record('room', childKey, rec, co));
      }
    };
    const take = (snap: DataSnapshot | null) => { if (snap) pushVal(snap.val()); };
    try {
      if (role === 'admin') {
        take(await get(ref(db, node)));
        return out;
      }
      if (!auth) return out;
      if (role === 'provider') {
        const company = sess?.company_code || sess?.code || '';
        if (company) take(await get(query(ref(db, node), orderByChild('provider_company_code'), equalTo(company))));
        return out;
      }
      // agent: 사람(uid) + 채널(레거시·팀뷰) 병합 후 앱이 agent_code 로 재필터
      const snaps = await Promise.allSettled([
        get(query(ref(db, node), orderByChild('agent_uid'), equalTo(auth.uid))),
        sess?.agent_channel_code
          ? get(query(ref(db, node), orderByChild('agent_channel_code'), equalTo(sess.agent_channel_code)))
          : Promise.resolve(null as DataSnapshot | null),
      ]);
      for (const s of snaps) {
        if (s.status === 'fulfilled') take(s.value);
      }
    } catch (e) {
      console.warn(`RTDB rooms(${node}) 스코프 조회 실패:`, (e as Error).message);
    }
    const map = new Map(out.map((r) => [String(r._key), r]));
    return [...map.values()];
  }

  /**
   * 계약 스코프 조회 — 고객 PII(이름·전화)를 담아 역할별 격리 필수(readRoomsScoped 선례).
   * v3 `contracts` · v4 `v4/contracts` 양쪽에 적용. admin=전량 · provider=자기 회사 · agent=본인 uid+채널.
   * rules가 스코프 쿼리를 요구해도(게시 후) 통과, 열린 규칙(게시 전)에서도 부분집합만 → 게시 전/후 모두 안전.
   */
  private async readContractsScoped(co: string, overlay: boolean): Promise<EntityRecord[]> {
    const node = overlay ? `${OVERLAY}/contracts` : 'contracts';
    const auth = getAuthClient()?.currentUser;
    const sess = getSession();
    const role = sess?.role || 'agent';
    const db = this.db();
    const out: EntityRecord[] = [];
    const take = (snap: DataSnapshot | null) => {
      const val = snap?.val() as Rec | null; if (!val) return;
      for (const [k, rec] of Object.entries<any>(val)) if (rec && typeof rec === 'object') out.push(toV4Record('contract', k, rec, co));
    };
    try {
      if (role === 'admin') { take(await get(ref(db, node))); }
      else if (auth) {
        if (role === 'provider') {
          const company = sess?.company_code || sess?.code || '';
          if (company) take(await get(query(ref(db, node), orderByChild('provider_company_code'), equalTo(company))));
        } else {
          const snaps = await Promise.allSettled([
            get(query(ref(db, node), orderByChild('agent_uid'), equalTo(auth.uid))),
            sess?.agent_channel_code
              ? get(query(ref(db, node), orderByChild('agent_channel_code'), equalTo(sess.agent_channel_code)))
              : Promise.resolve(null as DataSnapshot | null),
          ]);
          for (const s of snaps) if (s.status === 'fulfilled') take(s.value);
        }
      }
    } catch (e) {
      console.warn(`RTDB contracts(${node}) 스코프 조회 실패:`, (e as Error).message);
    }
    const map = new Map(out.map((r) => [String(r._key), r]));
    return [...map.values()];
  }

  /**
   * 정산 스코프 조회 — v4 `v4/settlements`(정산=오버레이 네이티브). 정산 레코드엔 agent_uid 없음 →
   * 영업자는 agent_channel_code + agent_code(사람키) 병합(채널 재키잉 고아 폴백), 공급사는 provider_company_code.
   */
  private async readSettlementsScoped(co: string, overlay: boolean, joinMap?: Rec): Promise<EntityRecord[]> {
    const node = overlay ? `${OVERLAY}/settlements` : 'settlements';
    const auth = getAuthClient()?.currentUser;
    const sess = getSession();
    const role = sess?.role || 'agent';
    const db = this.db();
    const out: EntityRecord[] = [];
    const take = (snap: DataSnapshot | null) => {
      const val = snap?.val() as Rec | null; if (!val) return;
      for (const [k, rec] of Object.entries<any>(val)) if (rec && typeof rec === 'object') out.push(toV4Record('settlement', k, rec, co, joinMap));
    };
    try {
      if (role === 'admin') { take(await get(ref(db, node))); }
      else if (auth) {
        if (role === 'provider') {
          const company = sess?.company_code || sess?.code || '';
          if (company) take(await get(query(ref(db, node), orderByChild('provider_company_code'), equalTo(company))));
        } else {
          // 채널 + 사람키(agent_code) 병합 — 채널 재배정 후에도 본인 정산 열람 유지.
          const agentCode = String(sess?.user_code || sess?.code || auth.uid || '').trim();
          const snaps = await Promise.allSettled([
            sess?.agent_channel_code
              ? get(query(ref(db, node), orderByChild('agent_channel_code'), equalTo(sess.agent_channel_code)))
              : Promise.resolve(null as DataSnapshot | null),
            agentCode
              ? get(query(ref(db, node), orderByChild('agent_code'), equalTo(agentCode)))
              : Promise.resolve(null as DataSnapshot | null),
          ]);
          for (const s of snaps) if (s.status === 'fulfilled') take(s.value);
        }
      }
    } catch (e) {
      console.warn(`RTDB settlements(${node}) 스코프 조회 실패:`, (e as Error).message);
    }
    const map = new Map(out.map((r) => [String(r._key), r]));
    return [...map.values()];
  }

  /** 고객 스코프 조회 — v4 `v4/customers`. 비관리자는 본인 생성분(created_by === 내 uid)만. */
  private async readCustomersScoped(co: string, overlay: boolean): Promise<EntityRecord[]> {
    const node = overlay ? `${OVERLAY}/customers` : 'customers';
    const auth = getAuthClient()?.currentUser;
    const sess = getSession();
    const role = sess?.role || 'agent';
    const db = this.db();
    const out: EntityRecord[] = [];
    const take = (snap: DataSnapshot | null) => {
      const val = snap?.val() as Rec | null; if (!val) return;
      for (const [k, rec] of Object.entries<any>(val)) if (rec && typeof rec === 'object') out.push(toV4Record('customer', k, rec, co));
    };
    try {
      if (role === 'admin') { take(await get(ref(db, node))); }
      else if (auth) { take(await get(query(ref(db, node), orderByChild('created_by'), equalTo(auth.uid)))); }
    } catch (e) {
      console.warn(`RTDB customers(${node}) 스코프 조회 실패:`, (e as Error).message);
    }
    const map = new Map(out.map((r) => [String(r._key), r]));
    return [...map.values()];
  }

  private async readNode(entity: string, co: string, overlay: boolean, joinMap?: Rec, roomIds?: string[]): Promise<EntityRecord[]> {
    if (entity === 'message') return this.readMessages(co, overlay, roomIds || []);
    if (entity === 'room') return this.readRoomsScoped(co, overlay);
    if (entity === 'contract') return this.readContractsScoped(co, overlay);
    if (entity === 'settlement') return this.readSettlementsScoped(co, overlay, joinMap);
    if (entity === 'customer') return this.readCustomersScoped(co, overlay);
    const node = NODE[entity] || entity;
    const val: Rec = (await get(ref(this.db(), overlay ? `${OVERLAY}/${node}` : node))).val() || {};
    const out: EntityRecord[] = [];
    for (const [childKey, rec] of Object.entries<any>(val)) if (rec && typeof rec === 'object') out.push(toV4Record(entity, childKey, rec, co, joinMap));
    return out;
  }

  // v3 라이브 ∪ v4 오버레이 필드단위 병합(같은 _key는 오버레이 필드 우선). 필터 전 전량.
  private async merged(entity: string, co: string): Promise<EntityRecord[]> {
    try {
      // 매물 = 공급사이름 부착용 파트너 목록을 정책·매물 조회와 동시에 선발사(직렬 워터폴 제거).
      //  partnersForNames는 내부에서 .catch(() => []) 처리 → 아래 흐름이 먼저 throw해도 미처리 reject 없음.
      const partnersP = entity === 'product' ? this.partnersForNames(co) : undefined;
      let joinMap: Rec | undefined;
      if (entity === 'product') joinMap = (await get(ref(this.db(), 'policies'))).val() || {};
      else if (entity === 'settlement') {
        // 계약 규칙은 역할별 쿼리 스코프를 요구한다. 전체 get은 비관리자에서 거부되므로
        // 같은 역할 스코프 계약 목록으로 contract_date 조인 맵을 만든다.
        const contracts = await this.merged('contract', co);
        joinMap = Object.fromEntries(
          contracts.map((contract) => [
            String(contract.contract_code || contract._key),
            contract,
          ]),
        ) as Rec;
      }
      // 매물·회원·채팅·계약(+정책·공급사) = v3 라이브 ∪ 오버레이. 정산·감사 = 오버레이만.
      const bridge = BRIDGE_FROM_V3.has(entity);

      // message = 방 목록 먼저 → roomId별 messages/$id (rules 스코프)
      let roomIds: string[] = [];
      if (entity === 'message' && bridge) {
        const rooms = await this.merged('room', co);
        roomIds = rooms.map((r) => String(r._key)).filter(Boolean);
      }

      const [live, over] = await Promise.all([
        bridge ? this.readNode(entity, co, false, joinMap, roomIds).catch(() => [] as EntityRecord[]) : Promise.resolve([] as EntityRecord[]),
        this.readNode(entity, co, true, joinMap, roomIds).catch(() => [] as EntityRecord[]),
      ]);
      const map = new Map<string, EntityRecord>();
      for (const r of live) map.set(String(r._key), r);
      for (const r of over) {
        const k = String(r._key);
        // 오버레이 부분패치의 undefined 값이 v3 파생필드(_policy·photos 등)를 덮어 유실시키던 결함 수정:
        //  undefined 값 키는 병합에서 스킵. 단 빈 문자열('')은 의도적 클리어(inventory resetForm)이므로 덮어쓰기 유지.
        const cur: Rec = { ...(map.get(k) || {}) };
        for (const [kk, vv] of Object.entries(r)) if (vv !== undefined) cur[kk] = vv;
        map.set(k, cur as EntityRecord);
      }
      const result = [...map.values()];
      // 매물엔 공급사 한글이름(provider_name) 부착 — 상세·목록 SSOT(파인더와 동일). 코드만 보이던 문제 해결.
      if (entity === 'product') return withProviderNames(result, await partnersP!);
      return result;
    } catch (e) {
      console.warn(`RTDB merged(${entity}) 실패(로그인·규칙 확인):`, (e as Error).message);
      return [];
    }
  }

  private _partnersForNames?: EntityRecord[];
  /** provider_name 부착용 파트너 목록(1회 캐시). */
  private async partnersForNames(co: string): Promise<EntityRecord[]> {
    if (this._partnersForNames?.length) return this._partnersForNames;
    const p = await this.merged('partner', co).catch(() => [] as EntityRecord[]);
    if (p.length) this._partnersForNames = p;
    return p;
  }

  async list(entity: string, co: string): Promise<EntityRecord[]> {
    const rows = (await this.merged(entity, co)).filter((r) => !r._deleted && !r.deletedAt);
    if (entity !== 'product') return rows;
    // erp3 소프트삭제 정합: status==='deleted' 도 제외(_deleted 불리언과 별개 마커 — 이걸 안 걸러 재고가 부풀었음)
    const live = rows.filter((r) => String((r as Rec).status) !== 'deleted');
    const shown = dedupeProductsByVehicle(live.filter((r) => !isExcludedProduct(r as Rec)));
    return shown.map((r) => (canSeeProductCost(r) ? r : stripProductCost(r)));
  }

  /** 단일 방 메시지 — 전 방 roomIds 스캔 없이 roomId 1개만 v3∪v4 병합. */
  async listMessagesForRoom(co: string, roomId: string): Promise<EntityRecord[]> {
    if (!roomId) return [];
    const [live, over] = await Promise.all([
      this.readMessages(co, false, [roomId]).catch(() => [] as EntityRecord[]),
      this.readMessages(co, true, [roomId]).catch(() => [] as EntityRecord[]),
    ]);
    const map = new Map<string, EntityRecord>();
    for (const r of live) map.set(String(r._key), r);
    for (const r of over) {
      const k = String(r._key);
      const cur: Rec = { ...(map.get(k) || {}) };
      for (const [kk, vv] of Object.entries(r as Rec)) if (vv !== undefined) cur[kk] = vv;
      map.set(k, cur as EntityRecord);
    }
    return [...map.values()].filter((r) => !r._deleted && !r.deletedAt);
  }

  async listDeleted(entity: string, co: string): Promise<EntityRecord[]> {
    return (await this.merged(entity, co)).filter((r) => r._deleted || r.deletedAt);
  }

  /**
   * 단건 get — product/policy/partner/user 는 keyed-read(노드/{key}∪v4 병합)로 전량 merged 회피.
   *  contract/room/settlement/message 는 규칙이 쿼리 스코프라 keyed get이 거부될 수 있어 기존 merged find 유지.
   */
  async get(entity: string, co: string, key: string): Promise<EntityRecord | null> {
    // ※ keyed get 최적화는 야간검증서 revert(HIGH) — v3 라이브 childKey≠product_code 매물을 miss(merged 폴백은 throw만 탐). merged 전량 스캔이 정합 SSOT.
    const r = (await this.merged(entity, co)).find((row) => String(row._key) === key && !row._deleted && !row.deletedAt) || null;
    if (!r || entity !== 'product') return r;
    if (String((r as Rec).status) === 'deleted') return null;
    if (isExcludedProduct(r as Rec)) return null;
    return canSeeProductCost(r) ? r : stripProductCost(r);
  }

  async save(entity: string, co: string, records: EntityRecord[]): Promise<SaveResult> {
    const node = NODE[entity] || entity;
    // dedup = 전량 merged 의 _key 집합(소프트삭제·제외 레코드 포함). keyed get 확인은 삭제/제외 자연키 재저장(부활·오카운트)을 못 막아 야간검증서 revert.
    const seen = new Set((await this.merged(entity, co)).map((r) => String(r._key)));
    let saved = 0, duplicates = 0;
    for (const rec of records) {
      let key = naturalKey(entity, rec as Rec);
      if (key && seen.has(key)) { duplicates++; continue; }
      if (!key) key = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const stored: Rec = stripUndef({ ...rec, companyId: co, _key: key, createdAt: new Date().toISOString(), createdBy: 'rtdb', ...(entity === 'customer' ? { created_by: (rec as Rec).created_by || getAuthClient()?.currentUser?.uid } : {}) });
      await dbUpdate(ref(this.db(), `${OVERLAY}/${node}/${key}`), stored);
      this.writeAudit(entity, co, key, 'create', null, stored);
      seen.add(key); saved++;
    }
    return { saved, duplicates, backend: this.backend };
  }

  async update(entity: string, co: string, key: string, patch: EntityRecord): Promise<void> {
    const node = NODE[entity] || entity;
    const before = await this.get(entity, co, key);
    const p: Rec = stripUndef({ ...patch, _key: key, updatedAt: new Date().toISOString() });
    // room·contract·settlement·product = v4 오버레이 규칙이 소유필드 기반.
    //  부분 패치엔 소유필드가 없어 레거시(v3전용) 레코드를 처음 오버레이에 쓸 때 생성분기가 소유필드 null → permission_denied.
    //  기존(merged) 레코드에서 소유필드를 승계 스탬프해 자기기술형으로 유지.
    if ((entity === 'room' || entity === 'contract' || entity === 'settlement') && before) {
      for (const f of ['agent_uid', 'agent_code', 'agent_channel_code', 'provider_company_code', 'provider_uid', 'product_code'] as const) {
        if (p[f] === undefined && (before as Rec)[f] != null && (before as Rec)[f] !== '') p[f] = (before as Rec)[f];
      }
    }
    // product 소유코드 승계 = provider 자기매물 부분패치일 때만. (색·마스터스냅 첫 v4 오버레이가 회사코드 누락으로 거부되던 것 방지)
    //  ★영업자 락-write(계약금입금·취소·완료 → vehicle_status/locked_by_contract)엔 절대 스탬프 금지:
    //   provider_company_code 리프는 v4/products 자식 .write가 없어 부모규칙(admin|provider only)로 판정됨 →
    //   영업자에 딸려 들어가면 원자 멀티패스 write 전체가 permission_denied(딜 진행 전부 막힘). 영업자는 이 필드 불필요.
    if (entity === 'product' && before && currentActor().role === 'provider') {
      if (p.provider_company_code === undefined && (before as Rec).provider_company_code != null && (before as Rec).provider_company_code !== '') {
        p.provider_company_code = (before as Rec).provider_company_code;
      }
    }
    await dbUpdate(ref(this.db(), `${OVERLAY}/${node}/${key}`), p);
    this.writeAudit(entity, co, key, (patch as Rec)._deleted ? 'delete' : 'update', before, { ...(before || {}), ...p });
  }

  // 다건 부분갱신 = v4 오버레이에 단일 멀티패스 write(청크). 일괄 차종 재구현용 — per-record get() 회피(O(n²)→O(n)).
  async bulkPatch(entity: string, co: string, patches: { key: string; patch: EntityRecord }[]): Promise<number> {
    if (!patches.length) return 0;
    const node = NODE[entity] || entity;
    const now = new Date().toISOString();
    const CHUNK = 150;
    let done = 0;
    for (let i = 0; i < patches.length; i += CHUNK) {
      const multi: Rec = {};
      for (const { key, patch } of patches.slice(i, i + CHUNK)) {
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) multi[`${key}/${k}`] = v; // RTDB update는 undefined 거부
        multi[`${key}/_key`] = key;
        multi[`${key}/updatedAt`] = now;
      }
      await dbUpdate(ref(this.db(), `${OVERLAY}/${node}`), multi);
      done += Math.min(CHUNK, patches.length - i);
    }
    const snapish = patches.some((p) => p.patch._snapped);
    if (snapish && done) this.writeAuditRec(buildMasterSnapBulkEntry(co, patches, currentActor()));
    else this.writeAudit(entity, co, `bulk:${done}`, 'update', null, { count: done } as EntityRecord);
    return done;
  }
  async remove(entity: string, co: string, key: string, reason = ''): Promise<void> {
    await this.update(entity, co, key, { _deleted: true, deletedAt: new Date().toISOString(), deletedReason: reason });
  }
  async restore(entity: string, co: string, key: string): Promise<void> {
    await this.update(entity, co, key, { _deleted: false, deletedAt: null });
  }

  // 전 write 감사 — v4/audit_logs. audit_log 자기제외. 메시지도 기록(채팅 관장).
  private writeAuditRec(entry: EntityRecord | null): void {
    if (!entry) return;
    try {
      const id = String(entry._key);
      void dbUpdate(ref(this.db(), `${OVERLAY}/audit_logs/${id}`), stripUndef(entry as Rec)).catch(() => {});
    } catch { /* best-effort */ }
  }
  private writeAudit(entity: string, co: string, key: string, action: string, before: EntityRecord | null, after: EntityRecord | null): void {
    if (entity === 'audit_log') return;
    this.writeAuditRec(buildAuditEntry(entity, co, key, action, before, after, currentActor()));
  }
}
