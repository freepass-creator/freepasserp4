import type { EntityRecord } from '@/lib/intake/entities';
import { isHiddenFromCatalog, vehicleName } from '@/lib/domain/product';

export type ProductLookup = {
  byId: Map<string, EntityRecord>;
  byCar: Map<string, EntityRecord>;
};

const roomKey = (record: EntityRecord) => `${String(record.product_code)}|${String(record.agent_code)}`;

export function buildContractIndex(contracts: EntityRecord[], cancelled: boolean): Map<string, EntityRecord> {
  const index = new Map<string, EntityRecord>();
  for (const contract of contracts) {
    const isCancelled = contract.contract_status === '계약취소';
    if (isCancelled !== cancelled) continue;
    const key = roomKey(contract);
    if (!index.has(key)) index.set(key, contract);
  }
  return index;
}

export function contractForRoom(index: Map<string, EntityRecord>, room: EntityRecord): EntityRecord | undefined {
  return index.get(roomKey(room));
}

export function buildProductLookup(products: EntityRecord[]): ProductLookup {
  const byId = new Map<string, EntityRecord>();
  const byCar = new Map<string, EntityRecord>();
  for (const product of products) {
    const code = String(product.product_code || '');
    const key = String(product._key || '');
    // erp3 방은 상품의 RTDB 키를 product_uid로 들고 있다(erp3 조인: p._key === room.product_uid).
    // erp4는 상품을 product_code로 리키잉하므로 원본 키(product_uid·_rtdb_key)도 같이 색인해야 예전 문의가 차를 찾는다.
    const uid = String(product.product_uid || '');
    const rtdbKey = String(product._rtdb_key || '');
    const car = String(product.car_number || '');
    if (code) byId.set(code, product);
    if (key && !byId.has(key)) byId.set(key, product);
    if (uid && !byId.has(uid)) byId.set(uid, product);
    if (rtdbKey && !byId.has(rtdbKey)) byId.set(rtdbKey, product);
    if (car) byCar.set(car, product);
  }
  return { byId, byCar };
}

/**
 * erp3 방 키에서 매물 식별자 복원 — 방 필드(product_code·vehicle_number 등)가 비어 있어도 살린다.
 *  · ensureRoom 생성: `CH_{매물코드}_{영업자코드}` → 매물코드
 *  · 표시용 코드    : `CH-{차량번호}-{영업자코드}` → 차량번호
 * 매물코드에 '_'가 들어갈 수 있으므로 마지막 구분자 기준으로 자른다.
 */
function idFromRoomKey(room: EntityRecord): { code?: string; car?: string } {
  const raw = String(room.chat_code || room.room_code || room.room_id || room._key || '');
  const sep = raw.startsWith('CH_') ? '_' : raw.startsWith('CH-') ? '-' : '';
  if (!sep) return {};
  const body = raw.slice(3);
  const cut = body.lastIndexOf(sep);
  const head = cut > 0 ? body.slice(0, cut) : body;
  if (!head) return {};
  return sep === '_' ? { code: head } : { car: head };
}

function productForRoom(lookup: ProductLookup, room: EntityRecord): EntityRecord | undefined {
  const car = String(room.car_number || room.vehicle_number || '');
  const direct = lookup.byId.get(String(room.product_code))
    || lookup.byId.get(String(room.product_uid))
    || lookup.byId.get(String(room.product_id))
    || (car ? lookup.byCar.get(car) : undefined);
  if (direct) return direct;
  const fromKey = idFromRoomKey(room);
  return (fromKey.code ? lookup.byId.get(fromKey.code) : undefined)
    || (fromKey.car ? lookup.byCar.get(fromKey.car) : undefined);
}

/** 방 레코드 차명 — erp3 formatMainLine은 sub_model 우선(maker+model+sub 중복 금지). */
function roomModelName(room: EntityRecord): string {
  const assembled = String(room.vehicle_name || '').trim();
  if (assembled) return assembled;
  const sub = String(room.sub_model || '').trim();
  if (sub) return sub;
  return [room.maker, room.model, room.trim_name].filter(Boolean).join(' ').trim();
}

function resolveRoomCar(
  room: EntityRecord,
  product: EntityRecord | undefined,
  contract: EntityRecord | undefined,
  fromKey: { code?: string; car?: string },
): string {
  return String(room.car_number || room.vehicle_number || '').trim()
    || (fromKey.car || '').trim()
    || String(product?.car_number || '').trim()
    || String(contract?.car_number_snapshot || '').trim();
}

export function roomTitle(
  room: EntityRecord,
  products: ProductLookup,
  deletedProducts: ProductLookup,
  contracts: EntityRecord[],
  activeContract?: EntityRecord,
): string {
  // 관리자 1:1 상담방(ADMIN_*, is_admin_chat) = 매물이 없는 방 → 차량으로 오인 표기 금지.
  if (room.is_admin_chat || String(room._key || '').startsWith('ADMIN_')) {
    const subject = String(room.subject || '').trim();
    const who = String(room.agent_name || room.agent_code || '').trim();
    return subject || (who ? `${who} · 관리자 상담` : '관리자 상담');
  }
  // erp3 formatMainLine = [차번, 세부모델, …] 있는 것만. 방 필드 → 키복원 → 매물 → 계약스냅샷.
  const fromKey = idFromRoomKey(room);
  const product = productForRoom(products, room) || productForRoom(deletedProducts, room);
  const productCode = String(room.product_code || '') || (fromKey.code || '');
  const contract = productCode
    ? activeContract
      || contracts.find((candidate) => String(candidate.product_code) === productCode && String(candidate.contract_status || '') !== '계약취소')
      || contracts.find((candidate) => String(candidate.product_code) === productCode)
    : undefined;

  const car = resolveRoomCar(room, product, contract, fromKey);

  const name = roomModelName(room)
    || (product ? (String(product.sub_model || '').trim() || vehicleName(product)) : '')
    || [contract?.maker_snapshot, contract?.sub_model_snapshot].filter(Boolean).join(' ').trim();

  // erp3 = 조각 없으면 '-'. "차량 조회불가"는 erp3에 없는 표기라 목록 톤이 갈린다.
  const title = [car, name].filter(Boolean).join(' ');
  if (!title) return '-';
  // 상태 꼬리표 — 출고불가는 살아있는 차(삭제 아님), 삭제는 확인된 경우만.
  if (product && isHiddenFromCatalog(product)) return `${title} (출고불가)`;
  if (product && (product._deleted || product.deletedAt)) return `${title} (삭제)`;
  return title;
}

/** 목록·헤더용 차번만 — roomTitle과 동일 해석(매물·계약 폴백). */
export function roomPlate(
  room: EntityRecord,
  products: ProductLookup,
  deletedProducts: ProductLookup,
  contracts: EntityRecord[],
  activeContract?: EntityRecord,
): string {
  if (room.is_admin_chat || String(room._key || '').startsWith('ADMIN_')) return '';
  const fromKey = idFromRoomKey(room);
  const product = productForRoom(products, room) || productForRoom(deletedProducts, room);
  const productCode = String(room.product_code || '') || (fromKey.code || '');
  const contract = productCode
    ? activeContract
      || contracts.find((candidate) => String(candidate.product_code) === productCode && String(candidate.contract_status || '') !== '계약취소')
      || contracts.find((candidate) => String(candidate.product_code) === productCode)
    : undefined;
  return resolveRoomCar(room, product, contract, fromKey);
}

/**
 * 목록 1줄용 차명만 — roomPlate(차번)의 짝. 목록 규격이 ①차량명 ②차번·상대방이라
 * roomTitle(차번+차명 합본)을 쪼개 쓸 수 있어야 한다.
 * 관리자 상담방은 차량이 없으므로 상담 제목을 그대로 돌려준다(목록에서 빈 줄 방지).
 */
export function roomModel(
  room: EntityRecord,
  products: ProductLookup,
  deletedProducts: ProductLookup,
  contracts: EntityRecord[],
  activeContract?: EntityRecord,
): string {
  if (room.is_admin_chat || String(room._key || '').startsWith('ADMIN_')) {
    const subject = String(room.subject || '').trim();
    const who = String(room.agent_name || room.agent_code || '').trim();
    return subject || (who ? `${who} · 관리자 상담` : '관리자 상담');
  }
  const fromKey = idFromRoomKey(room);
  const product = productForRoom(products, room) || productForRoom(deletedProducts, room);
  const productCode = String(room.product_code || '') || (fromKey.code || '');
  const contract = productCode
    ? activeContract
      || contracts.find((candidate) => String(candidate.product_code) === productCode && String(candidate.contract_status || '') !== '계약취소')
      || contracts.find((candidate) => String(candidate.product_code) === productCode)
    : undefined;

  const name = roomModelName(room)
    || (product ? (String(product.sub_model || '').trim() || vehicleName(product)) : '')
    || [contract?.maker_snapshot, contract?.sub_model_snapshot].filter(Boolean).join(' ').trim();
  if (!name) return resolveRoomCar(room, product, contract, fromKey) || '-';
  // 상태 꼬리표는 차명 옆에 — 출고불가는 살아있는 차(삭제 아님)
  if (product && isHiddenFromCatalog(product)) return `${name} (출고불가)`;
  if (product && (product._deleted || product.deletedAt)) return `${name} (삭제)`;
  return name;
}

export function providerForRoom(room: EntityRecord, products: ProductLookup): { code: string; name: string } {
  const code = String(room.provider_company_code || '').trim();
  const product = productForRoom(products, room);
  const name = String(product?.provider_name || product?.provider_name_full || room.provider_name || '').trim();
  return { code, name: name || code };
}

/**
 * 대화코드 — erp3 `chatCodeOf`와 동일 축.
 *  · 차번+영업자 있으면 `CH-{차번}-{영업자}` (차번은 매물 조인 복원값 허용)
 *  · ensureRoom `CH_…_…` 는 dash로 보기 좋게
 *  · Firebase push id(`-O…`)는 대화코드로 쓰지 않음 → `CH-{_key 8자}`
 */
export function chatCodeOf(room: EntityRecord | null | undefined, carOverride?: string): string {
  if (!room) return '';
  const car = String(carOverride || room.vehicle_number || room.car_number || '').trim();
  const agent = String(room.agent_code || '').trim();
  if (car && agent) return `CH-${car}-${agent}`;
  const explicit = String(room.chat_code || room.room_code || room.room_id || '').trim();
  // push id / 방 키를 chat_code에 넣어 둔 레거시는 표시용 코드로 쓰지 않는다.
  if (explicit && !explicit.startsWith('-')) {
    if (/^CH_/.test(explicit)) return explicit.replace(/_/g, '-');
    return explicit;
  }
  const key = String(room._key || '');
  return key ? `CH-${key.replace(/^-/, '').slice(0, 8)}` : '';
}
