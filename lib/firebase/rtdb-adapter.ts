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
import { carYear } from '@/lib/domain/vehicle-master-match';
import { vehicleIdentity } from '@/lib/domain/product';
import { currentActor } from '../session';
import { getSession } from '../auth-session';
import type { StoreAdapter, SaveResult } from '../store';
import { buildAuditEntry, buildMasterSnapBulkEntry } from '@/lib/domain/audit';

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

// 카슝(=빌린카) 불러온 매물은 v4에서 제외 — 사용자 결정. 빌린카 = 공급사 RP021 / PT-0024(35대).
//  브리지 read 단에서 걸러 v4 목록·상세서 안 보이게(v3 원본은 무변경).
const KASHUNG_PROVIDERS = new Set(['RP021', 'PT-0024']);
const isKashungProduct = (r: Rec): boolean =>
  KASHUNG_PROVIDERS.has(String(r.provider_company_code)) || KASHUNG_PROVIDERS.has(String(r.partner_code));

// 만 10년 이상 노후차는 취급 안 함(사용자 룰) — 연식/최초등록 기준 나이. 매년 자동 노후차 제외. 연식불명은 유지.
const MAX_AGE = 10;
const isTooOld = (r: Rec): boolean => { const y = carYear(r as EntityRecord); return y > 0 && (new Date().getFullYear() - y) >= MAX_AGE; };

// 공급 원가(vehicle_price) = 마진 노출 필드. 영업자·손님에겐 read 단에서 가린다(관리자·공급사만 조회).
//  ※ 수수료(price.*.fee)는 영업자 수익 판단 기준이라 유지. vin도 유지(식별자).
//  RTDB는 필드단위 규칙이 안 되므로 앱 어댑터에서 차단 — 완전 격리는 v4/products_private 이관(부채) 후.
function seesProductCost(): boolean { const role = getSession()?.role; return role === 'admin' || role === 'provider'; }
function stripProductCost(p: EntityRecord): EntityRecord {
  if (p.vehicle_price == null) return p;
  const out: Rec = { ...(p as Rec) };
  delete out.vehicle_price;
  return out as EntityRecord;
}

// v4 매물에서 제외할 것 종합(카슝 + 10년 이상).
const isExcludedProduct = (r: Rec): boolean => isKashungProduct(r) || isTooOld(r);

// 실물 유일신원(실번호판→VIN, product.vehicleIdentity SSOT) 기준 중복 제거 — v3 누적·v3∪v4 혼재로
//  같은 차가 다른 product_code 로 두 번 들어오는 것 방지(카탈로그 대수 부풀림 차단).
//  ※ 신원 불명(번호판 placeholder·VIN 없음)은 합치지 않고 각각 유지 — 미등록차 오합치기(과소집계) 방지.
//  중복이면 product_code 있는 것 → 최신(updatedAt/created_at) 것 우선.
function dedupeByVehicleIdentity(rows: EntityRecord[]): EntityRecord[] {
  const ts = (p: Rec) => Number(p.updatedAt ?? p.updated_at ?? p.created_at ?? 0);
  const keep: EntityRecord[] = []; // 신원 불명 = 각각 유지
  const byId = new Map<string, EntityRecord>();
  for (const p of rows) {
    const id = vehicleIdentity(p as Rec);
    if (!id) { keep.push(p); continue; }
    const prev = byId.get(id);
    if (!prev) { byId.set(id, p); continue; }
    const score = (Number(!!(p as Rec).product_code) - Number(!!(prev as Rec).product_code)) || (ts(p as Rec) - ts(prev as Rec));
    if (score > 0) byId.set(id, p); // 더 나은 쪽으로 교체
  }
  return [...byId.values(), ...keep];
}

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
function fileNameFromUrl(url: string): string {
  try {
    const bare = decodeURIComponent(String(url).split('?')[0] || '');
    const o = bare.match(/\/o\/(.+)$/);
    const path = o ? decodeURIComponent(o[1]) : bare;
    const base = path.split('/').filter(Boolean).pop() || '';
    if (base && !/^https?:$/i.test(base)) return base;
  } catch { /* ignore */ }
  return '첨부파일';
}
function looksLikeUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || /firebasestorage\.googleapis/i.test(s);
}
function guessAttType(s: string): string {
  if (/\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(s)) return 'image/jpeg';
  if (/\.pdf(\?|$)/i.test(s)) return 'application/pdf';
  return '';
}
function normalizeAtt(raw: unknown): Rec | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const url = raw.trim();
    if (!url) return null;
    return { url, name: fileNameFromUrl(url), size: 0, type: guessAttType(url), at: 0 };
  }
  if (typeof raw !== 'object') return null;
  const d = raw as Rec;
  if (d._deleted) return null;
  let url = String(d.url || d.downloadURL || d.href || d.src || '').trim();
  let name = String(d.name || d.file_name || d.filename || d.original_name || d.title || '').trim();
  // v3: name 자리에 Storage URL만 넣고 url 필드가 비어 있는 경우
  if (!url && looksLikeUrl(name)) url = name;
  if (!name || looksLikeUrl(name)) name = url ? fileNameFromUrl(url) : '첨부파일';
  const sizeNum = Number(d.size ?? d.bytes ?? d.file_size ?? d.byteSize);
  const size = Number.isFinite(sizeNum) && sizeNum > 0 ? sizeNum : 0;
  const type = String(d.type || d.contentType || d.mime || guessAttType(name) || guessAttType(url) || '');
  const atNum = Number(d.at || d.created_at || d.uploaded_at || d.ts || d.time);
  const at = Number.isFinite(atNum) && atNum > 0 ? atNum : 0;
  return { ...d, url, name, size, type, at };
}
function attachmentsOf(rec: Rec): Rec[] {
  const out: Rec[] = [];
  const push = (raw: unknown) => { const n = normalizeAtt(raw); if (n) out.push(n); };
  if (Array.isArray(rec.attachments)) {
    for (const a of rec.attachments) push(a);
    return out;
  }
  if (Array.isArray(rec.doc_attachments)) for (const a of rec.doc_attachments) push(a);
  if (rec.customer_docs && typeof rec.customer_docs === 'object') {
    for (const d of Object.values<any>(rec.customer_docs)) push(d);
  }
  return out;
}

// v3 레코드 → v4 레코드(엔티티별 재키잉·오분류 복구·조인 임베드). joinMap=policies(product) 또는 contracts(settlement).
function toV4(entity: string, childKey: string, rec: Rec, co: string, joinMap?: Rec): EntityRecord {
  const base: Rec = { ...rec, companyId: co };
  switch (entity) {
    case 'product': {
      const code = rec.product_code || childKey;
      const policy = rec._policy || (rec.policy_code && joinMap ? joinMap[rec.policy_code] : undefined);
      // photo_link(Drive폴더·모던렌트카)는 scrapable — photo에 넣으면 /api/img 415 + 썸네일 영구 공백.
      // photo_link는 ...base 로 유지 → useProductPhotos → /api/extract-photos 경로.
      return {
        ...base, _key: String(code), product_code: code, product_uid: rec.product_uid || childKey,
        _policy: policy,
        photos: rec.photos || rec.image_urls || rec.images || rec.doc_images,
        photo: rec.photo || rec.image_url || (Array.isArray(rec.photos) ? rec.photos[0] : undefined),
      } as EntityRecord;
    }
    case 'policy': { const c = rec.policy_code || childKey; return { ...base, _key: String(c), policy_code: c } as EntityRecord; }
    case 'partner': { const c = rec.partner_code || childKey; return { ...base, _key: String(c), partner_code: c, name: rec.name || rec.partner_name || rec.company_name || c } as EntityRecord; }
    case 'user': { const c = rec.uid || childKey; return { ...base, _key: String(c), uid: c, user_code: rec.user_code || c, agent_channel_code: rec.agent_channel_code || rec.company_code || '', name: rec.name || rec.email || '' } as EntityRecord; }
    case 'contract': { const c = rec.contract_code || childKey; return { ...base, _key: String(c), contract_code: c, attachments: attachmentsOf(rec) } as EntityRecord; }
    case 'room': return { ...base, _key: String(childKey), room_code: rec.room_code || childKey, car_number: rec.car_number || rec.vehicle_number || '', vehicle_name: rec.vehicle_name || [rec.maker, rec.model, rec.sub_model, rec.trim_name].filter(Boolean).join(' ') } as EntityRecord;
    case 'settlement': { const c = rec.settlement_code || childKey; return { ...base, _key: String(c), settlement_code: c, contract_date: rec.contract_date || (joinMap && joinMap[rec.contract_code]?.contract_date) || '' } as EntityRecord; }
    default: return { ...base, _key: String(rec._key || childKey) } as EntityRecord;
  }
}

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
        if (rec && typeof rec === 'object') out.push(toV4('room', childKey, rec, co));
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
      for (const [k, rec] of Object.entries<any>(val)) if (rec && typeof rec === 'object') out.push(toV4('contract', k, rec, co));
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
   * 영업자는 agent_channel_code, 공급사는 provider_company_code 로 스코프(계약과 키가 다름 주의).
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
      for (const [k, rec] of Object.entries<any>(val)) if (rec && typeof rec === 'object') out.push(toV4('settlement', k, rec, co, joinMap));
    };
    try {
      if (role === 'admin') { take(await get(ref(db, node))); }
      else if (auth) {
        if (role === 'provider') {
          const company = sess?.company_code || sess?.code || '';
          if (company) take(await get(query(ref(db, node), orderByChild('provider_company_code'), equalTo(company))));
        } else if (sess?.agent_channel_code) {
          take(await get(query(ref(db, node), orderByChild('agent_channel_code'), equalTo(sess.agent_channel_code))));
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
      for (const [k, rec] of Object.entries<any>(val)) if (rec && typeof rec === 'object') out.push(toV4('customer', k, rec, co));
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
    for (const [childKey, rec] of Object.entries<any>(val)) if (rec && typeof rec === 'object') out.push(toV4(entity, childKey, rec, co, joinMap));
    return out;
  }

  // v3 라이브 ∪ v4 오버레이 필드단위 병합(같은 _key는 오버레이 필드 우선). 필터 전 전량.
  private async merged(entity: string, co: string): Promise<EntityRecord[]> {
    try {
      let joinMap: Rec | undefined;
      if (entity === 'product') joinMap = (await get(ref(this.db(), 'policies'))).val() || {};
      else if (entity === 'settlement') { try { joinMap = (await get(ref(this.db(), `${OVERLAY}/contracts`))).val() || {}; } catch { joinMap = {}; } }   // 정산 조인(계약일자). v4/contracts 스코프거부(비관리자) 시 무시 → 정산은 스코프 리더가 별도로 조회
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
      for (const r of over) { const k = String(r._key); map.set(k, { ...(map.get(k) || {}), ...r }); }
      return [...map.values()];
    } catch (e) {
      console.warn(`RTDB merged(${entity}) 실패(로그인·규칙 확인):`, (e as Error).message);
      return [];
    }
  }

  async list(entity: string, co: string): Promise<EntityRecord[]> {
    const rows = (await this.merged(entity, co)).filter((r) => !r._deleted && !r.deletedAt);
    if (entity !== 'product') return rows;
    const shown = dedupeByVehicleIdentity(rows.filter((r) => !isExcludedProduct(r as Rec))); // 카슝·10년 제외 후 실물 신원 중복 제거
    return seesProductCost() ? shown : shown.map(stripProductCost); // 영업자·손님엔 원가 가림
  }
  async listDeleted(entity: string, co: string): Promise<EntityRecord[]> {
    return (await this.merged(entity, co)).filter((r) => r._deleted || r.deletedAt);
  }
  async get(entity: string, co: string, key: string): Promise<EntityRecord | null> {
    const r = (await this.merged(entity, co)).find((r) => String(r._key) === key && !r._deleted && !r.deletedAt) || null;
    if (!r || entity !== 'product') return r;
    if (isExcludedProduct(r as Rec)) return null; // 카슝·10년이상은 직접링크로도 숨김
    return seesProductCost() ? r : stripProductCost(r); // 영업자·손님엔 원가 가림
  }

  async save(entity: string, co: string, records: EntityRecord[]): Promise<SaveResult> {
    const node = NODE[entity] || entity;
    const seen = new Set((await this.merged(entity, co)).map((r) => String(r._key)));
    let saved = 0, duplicates = 0;
    for (const rec of records) {
      let key = naturalKey(entity, rec as Rec);
      if (key && seen.has(key)) { duplicates++; continue; }
      if (!key) key = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      // 고객 = created_by 소유필드 필수(v4/customers 스코프 read + 소유 write 규칙 기준). 로그인 uid 로 귀속.
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
    // room·contract·settlement = v4 오버레이 규칙이 소유필드 기반(스코프 read·소유 write). 부분 패치엔 소유필드가 없어
    //  레거시(v3전용) 레코드를 처음 오버레이에 쓸 때 생성분기가 소유필드 null → permission_denied(계약진행·정산 실패).
    //  기존(merged) 레코드에서 소유필드를 승계 스탬프해 자기기술형으로 유지 — 방/계약/정산 공통.
    if ((entity === 'room' || entity === 'contract' || entity === 'settlement') && before) {
      for (const f of ['agent_uid', 'agent_code', 'agent_channel_code', 'provider_company_code', 'provider_uid', 'product_code'] as const) {
        if (p[f] === undefined && (before as Rec)[f] != null && (before as Rec)[f] !== '') p[f] = (before as Rec)[f];
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
