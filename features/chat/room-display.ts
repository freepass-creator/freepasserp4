import type { EntityRecord } from '@/lib/intake/entities';
import { isHiddenFromCatalog } from '@/lib/domain/product';
import { isContractCancelled, isContractInProgress } from '@/lib/domain/contract';
import { roomVehicleLabel, roomVehicleSnapshot } from '@/lib/domain/vehicle-label';
import { isOpaqueIdentity, safeBusinessCode } from '@/lib/domain/work-identity';

export type ProductLookup = {
  byId: Map<string, EntityRecord>;
  byCar: Map<string, EntityRecord>;
};

function values(items: unknown[]): string[] {
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))];
}

function pairKeys(products: string[], cars: string[], agents: string[]): string[] {
  if (!agents.length) return [];
  return [
    ...products.flatMap((product) => agents.map((agent) => `product:${product}|agent:${agent}`)),
    ...cars.flatMap((car) => agents.map((agent) => `car:${car}|agent:${agent}`)),
  ];
}

function contractJoinKeys(contract: EntityRecord): string[] {
  const code = String(contract.contract_code || '').trim();
  return [
    ...(code ? [`contract:${code}`] : []),
    ...pairKeys(
      values([contract.product_code, contract.product_uid, contract.product_id]),
      values([contract.car_number_snapshot, contract.car_number, contract.vehicle_number]),
      values([contract.agent_code, contract.agent_uid, contract.user_code]),
    ),
  ];
}

function dateRank(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 같은 레거시 조인키의 후보는 입력 배열 순서가 아니라 업무 의미와 최신성으로 고른다. */
function compareContractPriority(a: EntityRecord, b: EntityRecord): number {
  const progress = Number(isContractInProgress(a)) - Number(isContractInProgress(b));
  if (progress) return progress;

  const ranks: [unknown, unknown][] = [
    [a.contract_date, b.contract_date],
    [a.createdAt ?? a.created_at, b.createdAt ?? b.created_at],
    [a.cancelled_at, b.cancelled_at],
    [a.updatedAt ?? a.updated_at, b.updatedAt ?? b.updated_at],
  ];
  for (const [aValue, bValue] of ranks) {
    const diff = dateRank(aValue) - dateRank(bValue);
    if (diff) return diff;
  }

  const aCode = String(a.contract_code || a._key || '').trim();
  const bCode = String(b.contract_code || b._key || '').trim();
  return aCode === bCode ? 0 : aCode > bCode ? 1 : -1;
}

function roomJoinKeys(room: EntityRecord): string[] {
  const parsed = idFromRoomKey(room);
  return pairKeys(
    values([room.product_code, room.product_uid, room.product_id, parsed.code]),
    values([room.car_number, room.vehicle_number, parsed.car]),
    values([room.agent_code, room.agent_uid, room.user_code, parsed.agent]),
  );
}

export function buildContractIndex(contracts: EntityRecord[], cancelled: boolean): Map<string, EntityRecord> {
  const index = new Map<string, EntityRecord>();
  for (const contract of contracts) {
    const isCancelled = isContractCancelled(contract);
    if (isCancelled !== cancelled) continue;
    for (const key of contractJoinKeys(contract)) {
      const previous = index.get(key);
      if (!previous || compareContractPriority(contract, previous) > 0) index.set(key, contract);
    }
  }
  return index;
}

export function contractForRoom(index: Map<string, EntityRecord>, room: EntityRecord): EntityRecord | undefined {
  const linked = String(room.linked_contract || '').trim();
  // 명시 연결은 차량·담당자 추정보다 강하다. 이 인덱스(활성/취소)에 없다고
  // 같은 차량의 다른 계약으로 갈아타면 목록 상태와 상세 계약이 서로 달라진다.
  if (linked) return index.get(`contract:${linked}`);
  for (const key of roomJoinKeys(room)) {
    const match = index.get(key);
    if (match) return match;
  }
  return undefined;
}

/** 계약 선택은 읽기 동작이다. 기존 방만 찾고 새 방을 만들지 않는다. */
export function findRoomForContract(rooms: EntityRecord[], contract: EntityRecord): EntityRecord | undefined {
  const code = String(contract.contract_code || '').trim();
  if (code) {
    const linked = rooms.find((room) => String(room.linked_contract || '').trim() === code);
    if (linked) return linked;
  }
  const contractKeys = new Set(contractJoinKeys(contract));
  return rooms.find((room) => {
    const linked = String(room.linked_contract || '').trim();
    if (linked && linked !== code) return false;
    return roomJoinKeys(room).some((key) => contractKeys.has(key));
  });
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
function idFromRoomKey(room: EntityRecord): { code?: string; car?: string; agent?: string } {
  const raw = String(room.chat_code || room.room_code || room.room_id || room._key || '');
  const sep = raw.startsWith('CH_') ? '_' : raw.startsWith('CH-') ? '-' : '';
  if (!sep) return {};
  const body = raw.slice(3);
  const knownAgent = values([room.agent_code, room.agent_uid, room.user_code])
    .sort((a, b) => b.length - a.length)
    .find((agent) => body.endsWith(`${sep}${agent}`));
  const cut = knownAgent ? body.length - knownAgent.length - 1 : body.lastIndexOf(sep);
  const head = cut > 0 ? body.slice(0, cut) : body;
  const agent = knownAgent || (cut > 0 ? body.slice(cut + 1) : '');
  if (!head) return {};
  return sep === '_' ? { code: head, agent } : { car: head, agent };
}

/** 목록·상세가 같은 레거시 product_uid/차번 복원 규칙을 쓰게 하는 상품 조인 SSOT. */
export function productForRoom(lookup: ProductLookup, room: EntityRecord): EntityRecord | undefined {
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

function resolveRoomCar(
  room: EntityRecord,
  product: EntityRecord | undefined,
  contract: EntityRecord | undefined,
  fromKey: { code?: string; car?: string },
): string {
  return String(room.car_number || room.vehicle_number || '').trim()
    || (fromKey.car || '').trim()
    || String(contract?.car_number_snapshot || '').trim()
    || String(product?.car_number || '').trim();
}

/**
 * 문의 상세용 상품 레코드. 가격·사진·정책은 현재/삭제 상품에서 유지하고 차량 식별값만
 * 방 snapshot → 계약 snapshot → 상품 순으로 덮어 목록과 상세가 서로 다른 트림을 보이지 않게 한다.
 */
export function roomProductDetail(
  room: EntityRecord,
  product?: EntityRecord | null,
  contract?: EntityRecord | null,
): EntityRecord | null {
  const roomSnapshot = roomVehicleSnapshot(room, product, contract);
  const contractName = String(contract?.vehicle_name_snapshot || contract?.vehicle_name || '').trim();
  const contractPlate = String(contract?.car_number_snapshot || '').trim();
  const usableContractName = contractName && contractName.replace(/[\s-]+/g, '') !== contractPlate.replace(/[\s-]+/g, '')
    ? contractName
    : '';
  const hasContractIdentity = !!contract && [
    usableContractName,
    contract.model_snapshot || contract.model,
    contract.sub_model_snapshot || contract.sub_model,
    contract.variant_snapshot || contract.variant,
    contract.trim_name_snapshot || contract.trim_name,
    contract.trim_extra_snapshot || contract.trim_extra,
  ].some((value) => String(value || '').trim());
  const contractSnapshot: EntityRecord | null = hasContractIdentity ? {
    maker: String(contract?.maker_snapshot || contract?.maker || product?.maker || ''),
    model: String(contract?.model_snapshot || contract?.model || ''),
    sub_model: String(contract?.sub_model_snapshot || contract?.sub_model || ''),
    variant: String(contract?.variant_snapshot || contract?.variant || ''),
    trim_name: String(contract?.trim_name_snapshot || contract?.trim_name || ''),
    trim_extra: String(contract?.trim_extra_snapshot || contract?.trim_extra || ''),
    vehicle_name: usableContractName,
  } : null;
  const identity = roomSnapshot || contractSnapshot;
  if (!product && !identity) return null;

  const month = Number(contract?.rent_month_snapshot) || 0;
  const historicalPrice = month > 0 ? {
    price: {
      [String(month)]: {
        rent: Number(contract?.rent_amount_snapshot) || 0,
        deposit: Number(contract?.deposit_amount_snapshot) || 0,
      },
    },
  } : {};
  const base: EntityRecord = product ? { ...product } : {
    product_code: String(contract?.product_code || room.product_code || room.product_uid || ''),
    ...historicalPrice,
    _fromHistory: true,
  };
  const carNumber = String(room.car_number || room.vehicle_number || '').trim()
    || String(idFromRoomKey(room).car || '').trim()
    || contractPlate
    || String(product?.car_number || '').trim();

  if (!identity) return { ...base, car_number: carNumber || base.car_number };
  return {
    ...base,
    maker: String(identity.maker || ''),
    model: String(identity.model || ''),
    sub_model: String(identity.sub_model || ''),
    variant: String(identity.variant || ''),
    trim_name: String(identity.trim_name || ''),
    trim_extra: String(identity.trim_extra || ''),
    vehicle_name: String(identity.vehicle_name || ''),
    car_number: carNumber,
  };
}

/** 차량 없는 방 — 관리자 상담(ADMIN_) · 견적기 상담(CS_/consult). 차번·차량명·대화코드 경로 우회. */
export function isVehicleLessRoom(room: EntityRecord | null | undefined): boolean {
  if (!room) return false;
  return !!(
    room.is_admin_chat
    || String(room._key || '').startsWith('ADMIN_')
    || room.room_kind === 'consult'
    || String(room._key || '').startsWith('CS_')
  );
}

/**
 * 견적기 상담방 목록 표기 — 공급사 코드로 만든다.
 *   담당자가 목록에서 "어느 견적기에서 온 문의인지" 바로 알아야 한다(차번이 없는 방이라 더 그렇다).
 *   ⚠ 방에 저장된 subject 를 쓰지 않는다. subject 는 생성 시점 문구가 박제되므로,
 *     문구를 바꾸면 옛 방만 옛 이름으로 남아 목록에 두 이름이 섞인다.
 *     여기서 만들면 옛 방·새 방이 같이 바뀐다. deal.ts 가 저장할 subject 도 이걸 쓴다.
 */
export const CONSULT_LABEL: Record<string, string> = {
  RP012: '중고 구독견적기',   // 손오공
  RP013: '신차 구독견적기',   // 웰릭스
};
const CONSULT_LABEL_FALLBACK = '구독견적기';

function isConsultRoom(room: EntityRecord): boolean {
  return room.room_kind === 'consult' || String(room._key || '').startsWith('CS_');
}

function vehicleLessSubject(room: EntityRecord): string {
  if (isConsultRoom(room)) {
    return CONSULT_LABEL[String(room.provider_company_code || '').trim()]
      || String(room.subject || '').trim()
      || CONSULT_LABEL_FALLBACK;
  }
  const subject = String(room.subject || '').trim();
  if (subject) return subject;
  // ADMIN_ 레거시(제목 없음)만 폴백.
  if (room.is_admin_chat || String(room._key || '').startsWith('ADMIN_')) {
    const who = String(room.agent_name || room.agent_code || '').trim();
    return who ? `${who} · 관리자 상담` : '관리자 상담';
  }
  return '상담';
}

export function roomTitle(
  room: EntityRecord,
  products: ProductLookup,
  deletedProducts: ProductLookup,
  contracts: EntityRecord[],
  activeContract?: EntityRecord,
): string {
  // 매물 없는 방 = 차량으로 오인 표기 금지 → subject.
  if (isVehicleLessRoom(room)) return vehicleLessSubject(room);
  // erp3 formatMainLine = [차번, 세부모델, …] 있는 것만. 방 필드 → 키복원 → 매물 → 계약스냅샷.
  const fromKey = idFromRoomKey(room);
  const product = productForRoom(products, room) || productForRoom(deletedProducts, room);
  const productCode = String(room.product_code || '') || (fromKey.code || '');
  const contract = activeContract
    || (productCode
      ? contracts.find((candidate) => String(candidate.product_code) === productCode && !isContractCancelled(candidate))
      || contracts.find((candidate) => String(candidate.product_code) === productCode)
      : undefined);

  const car = resolveRoomCar(room, product, contract, fromKey);

  const name = roomVehicleLabel(room, product, contract);

  // erp3 = 조각 없으면 '-'. "차량 조회불가"는 erp3에 없는 표기라 목록 톤이 갈린다.
  const title = [car, name].filter(Boolean).join(' ');
  if (!title) return '-';
  // 상태 꼬리표 — 출고불가는 살아있는 차(삭제 아님), 삭제는 확인된 경우만.
  if (product && (product._deleted || product.deletedAt)) return `${title} (삭제)`;
  if (product && isHiddenFromCatalog(product)) return `${title} (출고불가)`;
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
  if (isVehicleLessRoom(room)) return '';
  const fromKey = idFromRoomKey(room);
  const product = productForRoom(products, room) || productForRoom(deletedProducts, room);
  const productCode = String(room.product_code || '') || (fromKey.code || '');
  const contract = activeContract
    || (productCode
      ? contracts.find((candidate) => String(candidate.product_code) === productCode && !isContractCancelled(candidate))
      || contracts.find((candidate) => String(candidate.product_code) === productCode)
      : undefined);
  return resolveRoomCar(room, product, contract, fromKey);
}

/**
 * 목록 1줄용 차명만 — roomPlate(차번)의 짝. 목록 2줄 규격에서 차명·차번·상대방은 ①에 붙인다.
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
  if (isVehicleLessRoom(room)) return vehicleLessSubject(room);
  const fromKey = idFromRoomKey(room);
  const product = productForRoom(products, room) || productForRoom(deletedProducts, room);
  const productCode = String(room.product_code || '') || (fromKey.code || '');
  const contract = activeContract
    || (productCode
      ? contracts.find((candidate) => String(candidate.product_code) === productCode && !isContractCancelled(candidate))
      || contracts.find((candidate) => String(candidate.product_code) === productCode)
      : undefined);

  const name = roomVehicleLabel(room, product, contract);
  if (!name) return '차량명 미확인';
  // 상태 꼬리표는 차명 옆에 — 출고불가는 살아있는 차(삭제 아님)
  if (product && (product._deleted || product.deletedAt)) return `${name} (삭제)`;
  if (product && isHiddenFromCatalog(product)) return `${name} (출고불가)`;
  return name;
}

export function providerForRoom(
  room: EntityRecord,
  products: ProductLookup,
  deletedProducts?: ProductLookup,
  aliases: Record<string, string> = {},
): { code: string; name: string } {
  const product = productForRoom(products, room)
    || (deletedProducts ? productForRoom(deletedProducts, room) : undefined);
  const code = String(room.provider_company_code || product?.provider_company_code || '').trim();
  const name = values([
    aliases[code],
    product?.provider_name,
    room.provider_name,
    product?.provider_name_full,
  ]).find((candidate) => candidate !== code && !isOpaqueIdentity(candidate)) || '';
  return { code, name };
}

/**
 * 대화코드 — erp3 `chatCodeOf`와 동일 축.
 *  · 차번+영업자 있으면 `CH-{차번}-{영업자}` (차번은 매물 조인 복원값 허용)
 *  · ensureRoom `CH_…_…` 는 dash로 보기 좋게
 *  · Firebase push id(`-O…`)는 대화코드로 쓰지 않음 → `CH-{_key 8자}`
 */
export function chatCodeOf(room: EntityRecord | null | undefined, carOverride?: string): string {
  if (!room) return '';
  // 상담방 내부키(CS_/ADMIN_)를 헤더 대화코드로 노출하지 않는다.
  if (isVehicleLessRoom(room)) return '';
  const car = String(carOverride || room.vehicle_number || room.car_number || '').trim();
  const agent = safeBusinessCode(room.agent_code, room.agent_uid);
  if (car && agent) return `CH-${car}-${agent}`;
  if (car) return `CH-${car}`;
  const explicit = String(room.chat_code || room.room_code || room.room_id || '').trim();
  // push id / 방 키를 chat_code에 넣어 둔 레거시는 표시용 코드로 쓰지 않는다.
  if (explicit && !explicit.startsWith('-')) {
    if (/^CH[_-]/.test(explicit)) {
      const parsed = idFromRoomKey(room);
      if (!safeBusinessCode(parsed.agent)) return '';
      return explicit.replace(/_/g, '-');
    }
    return isOpaqueIdentity(explicit) ? '' : explicit;
  }
  return '';
}
