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
import { ref, get, update as dbUpdate } from 'firebase/database';
import { getRtdb } from './client';
import { ENTITIES, type EntityRecord } from '../intake/entities';
import { currentActor } from '../session';
import type { StoreAdapter, SaveResult } from '../store';

type Rec = Record<string, any>;

// RTDB update()/set()는 값에 undefined 있으면 throw. 저장 직전 undefined 키 제거(applySnap의 미매칭 variant/trim 등 방어).
const stripUndef = (o: Rec): Rec => { const r: Rec = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v; return r; };

// v4 엔티티키 → v3 RTDB 노드명
const NODE: Record<string, string> = {
  product: 'products', policy: 'policies', partner: 'partners', user: 'users',
  contract: 'contracts', room: 'rooms', message: 'messages', settlement: 'settlements', audit_log: 'audit_logs',
};
const OVERLAY = 'v4'; // 쓰기 격리 루트
// v3 라이브에서 당겨오는 엔티티 = 매물·회원·채팅(+매물 표시에 필요한 정책·공급사).
//  계약·정산·감사는 v4 네이티브(오버레이만) — 새 생태계는 v3 레거시 계약/정산을 끌어오지 않는다(사용자 결정).
const BRIDGE_FROM_V3 = new Set(['product', 'policy', 'partner', 'user', 'room', 'message']);

// 카슝(=빌린카) 불러온 매물은 v4에서 제외 — 사용자 결정. 빌린카 = 공급사 RP021 / PT-0024(35대).
//  브리지 read 단에서 걸러 v4 목록·상세서 안 보이게(v3 원본은 무변경).
const KASHUNG_PROVIDERS = new Set(['RP021', 'PT-0024']);
const isKashungProduct = (r: Rec): boolean =>
  KASHUNG_PROVIDERS.has(String(r.provider_company_code)) || KASHUNG_PROVIDERS.has(String(r.partner_code));

function naturalKey(entity: string, rec: Rec): string {
  const e = ENTITIES[entity];
  if (!e) return String(rec._key ?? '');
  const v = e.idFrom ? rec[e.idFrom] : undefined;
  if (v != null && v !== '') return String(v);
  if (e.keyFields) { const parts = e.keyFields.map((k) => String(rec[k] ?? '')).filter(Boolean); if (parts.length) return parts.join('|'); }
  return String(rec._key ?? '');
}

// v3 계약 첨부(customer_docs 중첩맵 + doc_attachments 배열) → v4 attachments 배열
function attachmentsOf(rec: Rec): Rec[] {
  if (Array.isArray(rec.attachments)) return rec.attachments;
  const out: Rec[] = [];
  if (Array.isArray(rec.doc_attachments)) for (const a of rec.doc_attachments) out.push(typeof a === 'string' ? { url: a, name: a } : a);
  if (rec.customer_docs && typeof rec.customer_docs === 'object') for (const d of Object.values<any>(rec.customer_docs)) if (d && !d._deleted) out.push(d);
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
    case 'user': { const c = rec.uid || childKey; return { ...base, _key: String(c), uid: c, agent_channel_code: rec.agent_channel_code || rec.company_code || '', name: rec.name || rec.email || '' } as EntityRecord; }
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
  private async readMessages(co: string, overlay: boolean): Promise<EntityRecord[]> {
    const val: Rec = (await get(ref(this.db(), overlay ? `${OVERLAY}/messages` : 'messages'))).val() || {};
    const out: EntityRecord[] = [];
    if (overlay) {
      for (const [k, m] of Object.entries<any>(val)) if (m && typeof m === 'object') out.push({ ...m, _key: String(k), room_id: m.room_id, companyId: co } as EntityRecord);
    } else {
      for (const [roomId, msgs] of Object.entries<any>(val)) {
        if (!msgs || typeof msgs !== 'object') continue;
        for (const [pushId, m] of Object.entries<any>(msgs)) if (m && typeof m === 'object') out.push({ ...m, _key: String(pushId), room_id: m.room_id || roomId, companyId: co } as EntityRecord);
      }
    }
    return out;
  }

  private async readNode(entity: string, co: string, overlay: boolean, joinMap?: Rec): Promise<EntityRecord[]> {
    if (entity === 'message') return this.readMessages(co, overlay);
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
      else if (entity === 'settlement') joinMap = (await get(ref(this.db(), `${OVERLAY}/contracts`))).val() || {};   // 정산은 v4 네이티브 → 계약도 v4 오버레이 참조
      // 매물·회원·채팅(+정책·공급사)만 v3 라이브에서 당겨옴. 계약·정산·감사는 v4 오버레이만(v3 라이브 read 생략).
      const bridge = BRIDGE_FROM_V3.has(entity);
      const [live, over] = await Promise.all([
        bridge ? this.readNode(entity, co, false, joinMap).catch(() => [] as EntityRecord[]) : Promise.resolve([] as EntityRecord[]),
        this.readNode(entity, co, true, joinMap).catch(() => [] as EntityRecord[]),
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
    return entity === 'product' ? rows.filter((r) => !isKashungProduct(r as Rec)) : rows; // 카슝(빌린카) 제외
  }
  async listDeleted(entity: string, co: string): Promise<EntityRecord[]> {
    return (await this.merged(entity, co)).filter((r) => r._deleted || r.deletedAt);
  }
  async get(entity: string, co: string, key: string): Promise<EntityRecord | null> {
    const r = (await this.merged(entity, co)).find((r) => String(r._key) === key && !r._deleted && !r.deletedAt) || null;
    return (r && entity === 'product' && isKashungProduct(r as Rec)) ? null : r; // 카슝(빌린카)은 직접링크로도 숨김
  }

  async save(entity: string, co: string, records: EntityRecord[]): Promise<SaveResult> {
    const node = NODE[entity] || entity;
    const seen = new Set((await this.merged(entity, co)).map((r) => String(r._key)));
    let saved = 0, duplicates = 0;
    for (const rec of records) {
      let key = naturalKey(entity, rec as Rec);
      if (key && seen.has(key)) { duplicates++; continue; }
      if (!key) key = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const stored: Rec = stripUndef({ ...rec, companyId: co, _key: key, createdAt: new Date().toISOString(), createdBy: 'rtdb' });
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
    this.writeAudit(entity, co, `bulk:${done}`, 'update', null, { count: done } as EntityRecord);
    return done;
  }
  async remove(entity: string, co: string, key: string, reason = ''): Promise<void> {
    await this.update(entity, co, key, { _deleted: true, deletedAt: new Date().toISOString(), deletedReason: reason });
  }
  async restore(entity: string, co: string, key: string): Promise<void> {
    await this.update(entity, co, key, { _deleted: false, deletedAt: null });
  }

  // 전 write 감사 — v4/audit_logs 오버레이(ERP 30원칙). message·audit_log 자기제외. best-effort.
  private writeAudit(entity: string, co: string, key: string, action: string, before: EntityRecord | null, after: EntityRecord | null): void {
    if (entity === 'audit_log' || entity === 'message') return;
    try {
      const a = currentActor();
      const id = `AL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      void dbUpdate(ref(this.db(), `${OVERLAY}/audit_logs/${id}`), {
        _key: id, entity, target_key: key, action, actor_uid: a.uid, actor_role: a.role, actor_name: a.name,
        at: Date.now(), companyId: co, before: before ? JSON.stringify(before).slice(0, 600) : '', after: after ? JSON.stringify(after).slice(0, 600) : '',
      }).catch(() => {});
    } catch { /* 감사는 best-effort */ }
  }
}
