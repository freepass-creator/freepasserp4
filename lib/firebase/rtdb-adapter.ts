/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * RtdbAdapter — ERP4 네이티브 데이터 + 필요한 ERP3 업무이력만 v4 StoreAdapter로 브리지.
 *   · ERP4 직접 정본 = products. 재고는 공급사 원본에서 v4로 새로 구축한다.
 *   · ERP3 브리지 = 회원·파트너·정책과 채팅/계약/정산/감사 등 기존 비재고 자료만 이어 쓴다.
 *   · 쓰기 = v4 네임스페이스 오버레이 `v4/{node}/{key}` (라이브 v3 무변경, 프로덕션 보호).
 *   · 상품 list = v4 단독. 그 밖의 브리지 대상만 v3 라이브 ∪ v4 오버레이.
 *   · soft-delete = 오버레이 톰스톤 `_deleted/deletedAt`. v3 boolean `_deleted`도 함께 필터.
 *   · 조인 enrich: product._policy(policies 조인), settlement.contract_date(contracts 조인), room.vehicle_name 합성.
 * 스키마 매핑 근거 = 워크플로 wgt6khvjq(6도메인 매핑→v4 실사용 대조검증→합성).
 */
import { ref, get, query, orderByChild, equalTo, update as dbUpdate, runTransaction, type DataSnapshot } from 'firebase/database';
import { getRtdb, getAuthClient } from './client';
import { ENTITIES, type EntityRecord } from '../intake/entities';
import { withProviderNames } from '@/lib/domain/identity';
import { currentActor } from '../session';
import { getSession } from '../auth-session';
import { isAgentOrgAdmin } from '@/lib/domain/authorization';
import type { FreshListHealth, StoreAdapter, SaveResult } from '../store';
import { buildAuditEntry, buildMasterSnapBulkEntry } from '@/lib/domain/audit';
import { toV4Record } from './rtdb-records';
import {
  productPatchPreconditionMatches,
  type GuardedProductPatch,
  type GuardedProductPatchResult,
} from '@/lib/domain/product-write-guard';
import {
  canSeeProductCost,
  dedupeProductsByVehicle,
  isExcludedProduct,
  mergeProductPrivate,
  splitProductPrivate,
  stripProductCost,
} from './rtdb-products';
import { mergeSettlementPrivate, splitSettlementPrivate } from './rtdb-settlements';
import { resolveMergedProduct } from '@/lib/domain/product-alias';

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
/**
 * v3 라이브에서 당겨오는 엔티티 — erp3 절연 전환의 스위치(MIGRATION_PLAN.md 8단계).
 *  · `NEXT_PUBLIC_BRIDGE_V3=''`(빈값) → v4 단독. 이관 완료 후 이 한 줄로 끄고, 문제 시 되돌린다(롤백 1분)
 *  · 쉼표 구분으로 일부만 남길 수도 있다(단계적 축소)
 * 주의: 여기서 빼기 전에 v4로 이관이 끝나 있어야 한다. 데이터 없이 끄면 화면이 빈다.
 *
 * 2026-08-05 «채팅·계약·정산 독자화» — room·message·contract·settlement 를 뺐다.
 *   근거는 키가 아니라 **필드**까지 맞춘 감사다(scripts/audit-v4-standalone-core.mts):
 *   키 누락 0 · 필드 누락 0 · 메시지 room_id 전량 실체화.
 *   그 전에 걸림돌이 둘 있었고 둘 다 닫았다 —
 *     ① 계약 6건·문의방 46건의 v4 레코드가 «agent_channel_code 한 필드»뿐인 부분 오버레이였다.
 *        merged() 의 필드 단위 병합이 v3 로 빈칸을 메워 정상으로 보였을 뿐, 끄면 껍데기가 된다.
 *        → backfill-v4-core-fields.mts 로 v3 값을 v4 에 굳혔다(v4 에 «키가 있으면» 안 건드림 — '' 는 의도적 클리어).
 *     ② 방이 v4 에 없는 메시지 724건은 전부 v3 에서 «삭제된» 방의 것 → 지금도 화면에 못 온다(어댑터가 방 목록으로 읽는다).
 *   남은 policy·partner·user 는 계약·문의 화면이 이름을 조인하는 참조라 유지한다. audit_log 는 이력이라 유지.
 * 2026-08-05 사용자 승인으로 product 브리지는 영구 제외한다. 환경변수에 product를 적어도
 * 다시 열리지 않는다. ERP4 상품은 공급사 원본에서 v4/products로 독립 구축한다.
 */
const BRIDGE_DEFAULT = 'policy,partner,user,audit_log';
const BRIDGE_ENV = process.env.NEXT_PUBLIC_BRIDGE_V3;
const BRIDGE_FROM_V3 = new Set(
  (BRIDGE_ENV === undefined ? BRIDGE_DEFAULT : BRIDGE_ENV)
    .split(',').map((s) => s.trim()).filter((entity) => !!entity && entity !== 'product'),
);
/** 진단·검증용 — /diag에서 현재 브리지 상태를 눈으로 확인한다. */
export function bridgedEntities(): string[] { return [...BRIDGE_FROM_V3]; }

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
      // 일반 영업자는 개인 UID, 영업채널 관리자는 채널 전체(+본인 레거시 방)를 조회한다.
      const scopedReads = [
        get(query(ref(db, node), orderByChild('agent_uid'), equalTo(auth.uid))),
      ];
      if (isAgentOrgAdmin(sess) && sess?.agent_channel_code) {
        scopedReads.push(get(query(ref(db, node), orderByChild('agent_channel_code'), equalTo(sess.agent_channel_code))));
      }
      const snaps = await Promise.allSettled(scopedReads);
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
          const scopedReads = [
            get(query(ref(db, node), orderByChild('agent_uid'), equalTo(auth.uid))),
          ];
          if (isAgentOrgAdmin(sess) && sess?.agent_channel_code) {
            scopedReads.push(get(query(ref(db, node), orderByChild('agent_channel_code'), equalTo(sess.agent_channel_code))));
          }
          const snaps = await Promise.allSettled(scopedReads);
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
          // 일반 영업자는 개인 정산, 영업채널 관리자는 채널 전체(+본인 레거시 정산)를 조회한다.
          const agentCode = String(sess?.user_code || sess?.code || auth.uid || '').trim();
          const scopedReads: Promise<DataSnapshot | null>[] = [];
          if (agentCode) scopedReads.push(get(query(ref(db, node), orderByChild('agent_code'), equalTo(agentCode))));
          if (isAgentOrgAdmin(sess) && sess?.agent_channel_code) {
            scopedReads.push(get(query(ref(db, node), orderByChild('agent_channel_code'), equalTo(sess.agent_channel_code))));
          }
          const snaps = await Promise.allSettled(scopedReads);
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

  private async readSettlementPrivate(): Promise<{
    provider: Map<string, EntityRecord>;
    agent: Map<string, EntityRecord>;
    admin: Map<string, EntityRecord>;
  }> {
    const empty = () => new Map<string, EntityRecord>();
    const output = { provider: empty(), agent: empty(), admin: empty() };
    const auth = getAuthClient()?.currentUser;
    const sess = getSession();
    if (!auth || !sess) return output;
    const take = (snap: DataSnapshot, target: Map<string, EntityRecord>) => {
      const val = snap.val() as Rec | null;
      for (const [key, record] of Object.entries<any>(val || {})) {
        if (record && typeof record === 'object') target.set(String(record.settlement_code || key), { ...record, _key: key });
      }
    };
    try {
      if (sess.role === 'admin') {
        const [provider, agent, admin] = await Promise.all([
          get(ref(this.db(), `${OVERLAY}/settlements_provider_private`)),
          get(ref(this.db(), `${OVERLAY}/settlements_agent_private`)),
          get(ref(this.db(), `${OVERLAY}/settlements_admin_private`)),
        ]);
        take(provider, output.provider); take(agent, output.agent); take(admin, output.admin);
      } else if (sess.role === 'provider') {
        const company = String(sess.company_code || sess.code || '');
        if (company) take(await get(query(ref(this.db(), `${OVERLAY}/settlements_provider_private`), orderByChild('provider_company_code'), equalTo(company))), output.provider);
      } else {
        const reads: Promise<DataSnapshot>[] = [];
        const code = String(sess.user_code || sess.code || auth.uid);
        if (code) reads.push(get(query(ref(this.db(), `${OVERLAY}/settlements_agent_private`), orderByChild('agent_code'), equalTo(code))));
        if (isAgentOrgAdmin(sess) && sess.agent_channel_code) {
          reads.push(get(query(ref(this.db(), `${OVERLAY}/settlements_agent_private`), orderByChild('agent_channel_code'), equalTo(sess.agent_channel_code))));
        }
        for (const snap of await Promise.all(reads)) take(snap, output.agent);
      }
    } catch (e) {
      console.warn('RTDB settlement private 조회 실패:', (e as Error).message);
    }
    return output;
  }

  /** 관리자·자기 회사 공급사만 private 상품 원자를 읽어 공개 레코드에 병합한다. */
  private async readProductPrivate(strict = false): Promise<Map<string, EntityRecord>> {
    const auth = getAuthClient()?.currentUser;
    const session = getSession();
    const role = session?.role || 'agent';
    const output = new Map<string, EntityRecord>();
    if (!auth || (role !== 'admin' && role !== 'provider')) return output;
    try {
      const node = `${OVERLAY}/products_private`;
      const company = String(session?.company_code || session?.code || '');
      if (role === 'provider' && !company) return output;
      const snapshot = role === 'admin'
        ? await get(ref(this.db(), node))
        : await get(query(
            ref(this.db(), node),
            orderByChild('provider_company_code'),
            equalTo(company),
          ));
      const value = snapshot.val() as Rec | null;
      if (!value) return output;
      for (const [key, record] of Object.entries<any>(value)) {
        if (!record || typeof record !== 'object') continue;
        output.set(String(record.product_code || record._key || key), {
          ...record,
          _key: String(record._key || key),
          product_code: String(record.product_code || key),
        } as EntityRecord);
      }
    } catch (error) {
      if (strict) throw error;
      console.warn('RTDB products_private 조회 실패:', (error as Error).message);
    }
    return output;
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
  private async merged(entity: string, co: string, strict = false): Promise<EntityRecord[]> {
    try {
      // 매물 = 공급사이름 부착용 파트너 목록을 정책·매물 조회와 동시에 선발사(직렬 워터폴 제거).
      //  partnersForNames는 내부에서 .catch(() => []) 처리 → 아래 흐름이 먼저 throw해도 미처리 reject 없음.
      const partnersP = entity === 'product'
        ? (strict ? this.merged('partner', co, true) : this.partnersForNames(co))
        : undefined;
      let joinMap: Rec | undefined;
      if (entity === 'product') {
        // 정책 조인 — 브리지 설정을 따른다. 예전엔 루트 'policies'를 무조건 읽어 절연 후에도 v3 의존이 남았다.
        //  브리지 ON = v3 ∪ v4(오버레이 우선) · OFF = v4 단독.
        const livePolicyRead = BRIDGE_FROM_V3.has('policy')
          ? get(ref(this.db(), 'policies')).then((s) => (s.val() || {}) as Rec)
          : Promise.resolve({} as Rec);
        const overlayPolicyRead = get(ref(this.db(), `${OVERLAY}/policies`))
          .then((s) => (s.val() || {}) as Rec);
        const [livePol, overPol] = strict
          ? await Promise.all([livePolicyRead, overlayPolicyRead])
          : await Promise.all([
              livePolicyRead.catch(() => ({} as Rec)),
              overlayPolicyRead.catch(() => ({} as Rec)),
            ]);
        joinMap = { ...livePol, ...overPol };
      } else if (entity === 'settlement') {
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
      //  ★ bridge 조건을 걸면 안 된다 — v4 오버레이 메시지 조회도 roomIds를 순회하므로(readMessages),
      //    브리지를 끄는 순간 roomIds=[]가 되어 v4 메시지까지 0건이 된다(대화 전량 소실).
      let roomIds: string[] = [];
      if (entity === 'message') {
        const rooms = await this.merged('room', co);
        roomIds = rooms.map((r) => String(r._key)).filter(Boolean);
      }

      const liveRead = bridge
        ? this.readNode(entity, co, false, joinMap, roomIds)
        : Promise.resolve([] as EntityRecord[]);
      const overlayRead = this.readNode(entity, co, true, joinMap, roomIds);
      const [live, over] = strict
        ? await Promise.all([liveRead, overlayRead])
        : await Promise.all([
            liveRead.catch(() => [] as EntityRecord[]),
            overlayRead.catch(() => [] as EntityRecord[]),
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
      if (entity === 'settlement') {
        const privateMaps = await this.readSettlementPrivate();
        return result.map((settlement) => {
          const code = String(settlement.settlement_code || settlement._key);
          return mergeSettlementPrivate(
            settlement,
            privateMaps.provider.get(code),
            privateMaps.agent.get(code),
            privateMaps.admin.get(code),
          );
        });
      }
      // 매물엔 공급사 한글이름(provider_name) 부착 — 상세·목록 SSOT(파인더와 동일). 코드만 보이던 문제 해결.
      if (entity === 'product') {
        const privateMap = await this.readProductPrivate(strict);
        const mergedProducts = result.map((product) => mergeProductPrivate(
          product,
          privateMap.get(String(product.product_code || product._key)),
        ));
        return withProviderNames(mergedProducts, await partnersP!);
      }
      return result;
    } catch (e) {
      if (strict) throw e;
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

  /**
   * 참조 조회용 원본. 상품은 v4 단독, 다른 브리지 대상은 v3∪v4. 판매용 가공 없음.
   * 문의·계약이 가리키는 차는 출고불가·중복정리된 쌍둥이여도 "살아있는 차"로 찾아져야 한다.
   * 삭제 톰스톤만 제외(그건 listDeleted 담당). 원가 노출 규칙은 list와 동일하게 유지.
   */
  async listRaw(entity: string, co: string): Promise<EntityRecord[]> {
    const rows = (await this.merged(entity, co)).filter((r) => !r._deleted && !r.deletedAt);
    if (entity !== 'product') return rows;
    return rows.map((r) => (canSeeProductCost(r) ? r : stripProductCost(r)));
  }

  async listDeleted(entity: string, co: string): Promise<EntityRecord[]> {
    const rows = (await this.merged(entity, co)).filter((r) => r._deleted || r.deletedAt);
    if (entity !== 'product') return rows;
    // 삭제 상품에도 원가·VIN이 섞일 수 있다. live/raw 목록과 같은 역할별 마스킹을
    // 삭제 목록에도 적용하지 않으면, 채팅·계약의
    // 삭제매물 이름 복원 경로만으로 영업자/타 공급사에 비공개 원가가 다시 노출된다.
    return rows.map((row) => (canSeeProductCost(row) ? row : stripProductCost(row)));
  }

  private async strictHealth(entity: string, co: string): Promise<FreshListHealth> {
    try {
      return { rows: await this.merged(entity, co, true), complete: true };
    } catch (error) {
      return {
        rows: [],
        complete: false,
        failures: [String((error as Error).message || error)],
      };
    }
  }

  /**
   * ⚠ fresh 계열도 **원가 마스킹을 반드시 거친다.**
   * v4 공개 상품과 private 조인 결과도 역할별 원가 마스킹을 반드시 거친다.
   * 다른 읽기 경로(list·listRaw·listDeleted·listFreshWithHealth·get)는 전부 적용하는데
   * 이 둘만 빠져 있었고, 하필 시트 저장 경로(sheet-merge)가 쓰는 게 이 둘이다.
   */
  private maskCost(health: FreshListHealth, entity: string): FreshListHealth {
    if (!health.complete || entity !== 'product') return health;
    return { ...health, rows: health.rows.map((row) => (canSeeProductCost(row) ? row : stripProductCost(row))) };
  }

  async listAllFreshWithHealth(entity: string, co: string): Promise<FreshListHealth> {
    return this.maskCost(await this.strictHealth(entity, co), entity);
  }

  async listRawFreshWithHealth(entity: string, co: string): Promise<FreshListHealth> {
    const health = await this.strictHealth(entity, co);
    if (!health.complete) return health;
    return this.maskCost(
      { ...health, rows: health.rows.filter((row) => !row._deleted && !row.deletedAt) },
      entity,
    );
  }

  async listFreshWithHealth(entity: string, co: string): Promise<FreshListHealth> {
    const health = await this.strictHealth(entity, co);
    if (!health.complete) return health;
    const rows = health.rows.filter((row) => !row._deleted && !row.deletedAt);
    if (entity !== 'product') return { ...health, rows };
    const live = rows.filter((row) => String((row as Rec).status) !== 'deleted');
    const shown = dedupeProductsByVehicle(live.filter((row) => !isExcludedProduct(row as Rec)));
    return {
      ...health,
      rows: shown.map((row) => (canSeeProductCost(row) ? row : stripProductCost(row))),
    };
  }

  /**
   * 단건 get — product/policy/partner/user 는 keyed-read(노드/{key}∪v4 병합)로 전량 merged 회피.
   *  contract/room/settlement/message 는 규칙이 쿼리 스코프라 keyed get이 거부될 수 있어 기존 merged find 유지.
   */
  async get(entity: string, co: string, key: string): Promise<EntityRecord | null> {
    // ※ keyed get 최적화는 야간검증서 revert(HIGH) — v3 라이브 childKey≠product_code 매물을 miss(merged 폴백은 throw만 탐). merged 전량 스캔이 정합 SSOT.
    const rows = await this.merged(entity, co);
    const r = entity === 'product'
      ? resolveMergedProduct(rows, key)
      : rows.find((row) => String(row._key) === key && !row._deleted && !row.deletedAt) || null;
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
      if (entity === 'product') {
        const { publicRecord, privateRecord } = splitProductPrivate(stored as EntityRecord);
        const multi: Rec = { [`products/${key}`]: stripUndef(publicRecord as Rec) };
        if (privateRecord) {
          multi[`products_private/${key}`] = stripUndef({
            ...privateRecord,
            companyId: co,
            _key: key,
            product_code: stored.product_code || key,
            provider_company_code: stored.provider_company_code,
            createdAt: stored.createdAt,
            createdBy: stored.createdBy,
          });
        }
        await dbUpdate(ref(this.db(), OVERLAY), multi);
      } else if (entity === 'settlement') {
        const { publicRecord, providerRecord, agentRecord, adminRecord } = splitSettlementPrivate(stored as EntityRecord);
        const multi: Rec = { [`settlements/${key}`]: stripUndef(publicRecord as Rec) };
        if (providerRecord) multi[`settlements_provider_private/${key}`] = stripUndef(providerRecord as Rec);
        if (agentRecord) multi[`settlements_agent_private/${key}`] = stripUndef(agentRecord as Rec);
        if (adminRecord && currentActor().role === 'admin') multi[`settlements_admin_private/${key}`] = stripUndef(adminRecord as Rec);
        await dbUpdate(ref(this.db(), OVERLAY), multi);
      } else {
        await dbUpdate(ref(this.db(), `${OVERLAY}/${node}/${key}`), stored);
      }
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
    //  ⚠ contract_status 는 **일부러 넣지 않는다.** 넣으면 레거시 계약완료 12건이 상태 leaf validate
    //   (11게이트 전부 'yes')에 걸린다 — v3 게이트는 boolean true 이고 agent_final_paid 는 아예 없다.
    //   그 조건을 맞추려면 "잔금 완납"을 지어내야 하므로, 상태는 v3 에 그대로 두고(필드병합이라 화면엔 보인다)
    //   규칙 쪽 hasChildren 에서 contract_status 를 뺐다.
    if ((entity === 'room' || entity === 'contract' || entity === 'settlement') && before) {
      for (const f of ['contract_code', 'agent_uid', 'agent_code', 'agent_channel_code', 'provider_company_code', 'provider_uid', 'product_code'] as const) {
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
    if (entity === 'product') {
      const { publicRecord, privateRecord } = splitProductPrivate(p as EntityRecord);
      const multi: Rec = {};
      for (const [field, value] of Object.entries(publicRecord)) {
        if (value !== undefined) multi[`products/${key}/${field}`] = value;
      }
      if (privateRecord) {
        const privatePatch = stripUndef({
          ...privateRecord,
          _key: key,
          product_code: (before as Rec | null)?.product_code || key,
          provider_company_code: privateRecord.provider_company_code || (before as Rec | null)?.provider_company_code,
          updatedAt: p.updatedAt,
        });
        for (const [field, value] of Object.entries(privatePatch)) {
          if (value !== undefined) multi[`products_private/${key}/${field}`] = value;
        }
      }
      await dbUpdate(ref(this.db(), OVERLAY), multi);
    } else if (entity === 'settlement') {
      const { publicRecord, providerRecord, agentRecord, adminRecord } = splitSettlementPrivate(p as EntityRecord);
      const multi: Rec = {};
      for (const [field, value] of Object.entries(publicRecord)) if (value !== undefined) multi[`settlements/${key}/${field}`] = value;
      for (const [field, value] of Object.entries(providerRecord || {})) if (value !== undefined) multi[`settlements_provider_private/${key}/${field}`] = value;
      for (const [field, value] of Object.entries(agentRecord || {})) if (value !== undefined) multi[`settlements_agent_private/${key}/${field}`] = value;
      if (currentActor().role === 'admin') {
        for (const [field, value] of Object.entries(adminRecord || {})) if (value !== undefined) multi[`settlements_admin_private/${key}/${field}`] = value;
      }
      await dbUpdate(ref(this.db(), OVERLAY), multi);
    } else {
      await dbUpdate(ref(this.db(), `${OVERLAY}/${node}/${key}`), p);
    }
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
        if (entity === 'product') {
          const { publicRecord, privateRecord } = splitProductPrivate(patch);
          for (const [field, value] of Object.entries(publicRecord)) {
            if (value !== undefined) multi[`products/${key}/${field}`] = value;
          }
          multi[`products/${key}/_key`] = key;
          multi[`products/${key}/updatedAt`] = now;
          if (privateRecord) {
            for (const [field, value] of Object.entries(privateRecord)) {
              if (value !== undefined) multi[`products_private/${key}/${field}`] = value;
            }
            multi[`products_private/${key}/_key`] = key;
            multi[`products_private/${key}/product_code`] = key;
            multi[`products_private/${key}/updatedAt`] = now;
          }
        } else {
          for (const [k, v] of Object.entries(patch)) if (v !== undefined) multi[`${key}/${k}`] = v;
          multi[`${key}/_key`] = key;
          multi[`${key}/updatedAt`] = now;
        }
      }
      await dbUpdate(ref(this.db(), entity === 'product' ? OVERLAY : `${OVERLAY}/${node}`), multi);
      done += Math.min(CHUNK, patches.length - i);
    }
    const snapish = patches.some((p) => p.patch._snapped);
    if (snapish && done) this.writeAuditRec(buildMasterSnapBulkEntry(co, patches, currentActor()));
    else this.writeAudit(entity, co, `bulk:${done}`, 'update', null, { count: done } as EntityRecord);
    return done;
  }
  /**
   * 시트 병합용 상품 CAS. 공개 상품 레코드 transaction이 계약 엔진의 상태 leaf write와
   * 같은 서버 경로에서 경합하므로, 검증 직후 계약 잠금이 생기면 transaction 재시도에서
   * expected 불일치로 중단한다. v3는 쓰지 않고 v4 오버레이만 갱신한다.
   */
  async bulkPatchGuardedProduct(co: string, patches: GuardedProductPatch[]): Promise<GuardedProductPatchResult> {
    const conflicts: string[] = [];
    let updated = 0;
    for (const { key, patch, expected } of patches) {
      const now = new Date().toISOString();
      const { publicRecord, privateRecord } = splitProductPrivate(patch);
      const expectedSplit = splitProductPrivate(expected);
      const publicResult = await runTransaction(
        ref(this.db(), `${OVERLAY}/products/${key}`),
        (raw) => {
          const current = raw && typeof raw === 'object' ? raw as EntityRecord : null;
          if (!productPatchPreconditionMatches(current, expectedSplit.publicRecord, publicRecord, { overlayFallback: true })) {
            return undefined;
          }
          return stripUndef({ ...(current || {}), ...publicRecord, _key: key, updatedAt: now });
        },
        { applyLocally: false },
      );
      if (!publicResult.committed) {
        conflicts.push(key);
        break;
      }

      if (privateRecord) {
        const expectedPrivate = expectedSplit.privateRecord || {};
        const privateResult = await runTransaction(
          ref(this.db(), `${OVERLAY}/products_private/${key}`),
          (raw) => {
            const current = raw && typeof raw === 'object' ? raw as EntityRecord : null;
            if (!productPatchPreconditionMatches(current, expectedPrivate, privateRecord, {
              overlayFallback: true,
              guardFields: [],
            })) return undefined;
            return stripUndef({
              ...(current || {}),
              ...privateRecord,
              _key: key,
              product_code: expected.product_code || key,
              provider_company_code: privateRecord.provider_company_code || expected.provider_company_code,
              updatedAt: now,
            });
          },
          { applyLocally: false },
        );
        if (!privateResult.committed) {
          conflicts.push(key);
          // ⚠ 공개 트랜잭션은 **이미 커밋됐다.** 여기서 updated 를 안 올리면
          //  (1) 호출부가 updated===0 을 보고 "저장 안 됨"으로 보고하는데 실제로는 공개 가격·스펙이
          //      서버에 반영돼 손님·영업자 화면에 게시된 상태이고,
          //  (2) store 의 _invalidate('product') 가 안 돌아 운영자 화면이 저장 전 값을 계속 보여
          //      그 오판을 확증해 준다.
          //  절반이라도 반영된 사실은 반드시 올려 보낸다. 충돌은 conflicts 로 따로 알린다.
          updated++;
          break;
        }
      }
      updated++;
    }
    if (updated) this.writeAudit('product', co, `guarded-bulk:${updated}`, 'update', null, { count: updated } as EntityRecord);
    return { updated, conflicts };
  }
  async remove(entity: string, co: string, key: string, reason = ''): Promise<void> {
    await this.update(entity, co, key, { _deleted: true, deletedAt: new Date().toISOString(), deletedReason: reason });
  }
  async restore(entity: string, co: string, key: string): Promise<void> {
    await this.update(entity, co, key, { _deleted: false, deletedAt: null });
  }

  // 전 write 감사 — 쓰기는 v4 오버레이로(절연). 읽기는 브리지가 켜져 있는 동안 v3 ∪ v4로 합쳐 보인다.
  //  예전엔 루트 audit_logs에 계속 쌓아 "erp3 노드에 쓰지 않는다" 원칙을 위반했다.
  // audit_log 자기제외. 메시지도 기록(채팅 관장).
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
