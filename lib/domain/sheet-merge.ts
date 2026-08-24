/**
 * 시트 재동기화 soft-merge — 빈값으로 수기보정 덮어쓰기 금지.
 * 신규 = create, 기존 = blank-skip merge 후 변경분만 patch.
 */
import { type EntityRecord } from '@/lib/intake/entities';
import { getStore, type SaveResult } from '@/lib/store';
import type { GuardedProductPatch } from '@/lib/domain/product-write-guard';

/** 시트 유입이 건드리면 안 되는 시스템/식별 필드 */
const PROTECTED = new Set([
  '_key', 'product_code', 'companyId', 'createdAt', 'createdBy', 'deletedAt', 'deletedReason', '_deleted',
  'updatedAt', '_sheet_manual_fields', '_sheet_contract_status', '_sheet_price_scope', '_sales_sheet_authoritative',
  // importSheetTable은 fresh row를 매번 master snap 하므로 이 둘에는 실행시각이 들어간다.
  // 기존 매물 soft-merge에서 받아들이면 동일 시트 재검증도 전 건 "내용수정"이 되고,
  // 저장할 때마다 이력·감사로그가 불어난다. 신규 create에는 원본 record 그대로 보존된다.
  '_snap_at', '_snap_history',
]);

/** 공급사가 시트에서 책임지고 갱신하는 재고 원자. 원본에 값이 오면 ERP 수기값보다 우선한다. */
export const SUPPLIER_OWNED_PRODUCT_FIELDS = new Set([
  'vehicle_status', 'status_label_raw', 'product_type',
  'maker', 'model', 'sub_model', 'variant', 'trim_name', 'trim_extra', 'supplier_vehicle_name', 'supplier_options',
  'year', 'first_registration_date', 'fuel_type', 'engine_cc', 'mileage',
  'ext_color', 'int_color', 'seats', 'drive_type', 'battery_capacity', 'vehicle_class', 'usage',
  'options', 'photo_link', 'location', 'price',
  'policy_code',
  'sheet_source_gid', 'sheet_source_tab', 'sheet_source_row',
]);

/**
 * 차종마스터 코드로부터 파생되는 정제 식별자.
 * 상품마스터의 검증된 코드만 이 묶음을 갱신할 수 있고, 이후 공급사 원문 동기화는
 * 이미 확정된 식별자를 되돌리지 못한다. 차량별 상태/가격/정책은 계속 별도로 갱신된다.
 */
const PRODUCT_MASTER_IDENTITY_FIELDS = new Set([
  'maker', 'model', 'sub_model', 'catalog_id', 'trim_row_key',
  'variant', 'trim_name', 'fuel_type', 'engine_cc', 'seats', 'drive_type', 'battery_capacity',
  'vehicle_class', 'gen_year_start', 'gen_year_end',
]);

/** 판매시트 3탭이 현재값(빈칸 포함)을 소유하는 공개 필드. */
export const SALES_EXACT_PRODUCT_FIELDS = new Set([
  'vehicle_status', 'status_label_raw', 'product_type',
  'maker', 'model', 'sub_model', 'variant', 'trim_name', 'trim_extra', 'supplier_vehicle_name', 'supplier_options',
  'year', 'first_registration_date', 'fuel_type', 'engine_cc', 'mileage',
  'ext_color', 'int_color', 'seats', 'drive_type', 'battery_capacity', 'vehicle_class', 'origin', 'usage',
  /**
   * ⚠ `photo_link` 는 여기 **없다.** 유입이 판매시트 경로에서 사진을 일부러 버리기 때문이다
   *   (`sheet-import`: 「사진은 번호판·폴더 증거를 검증하기 전까지 판매 정본에서 ERP 로 자동 반영하지 않는다」).
   *   그런데 이 목록에 넣어 두면 «키가 없다»고 **공급사 19곳을 통째로 보류**시킨다 —
   *   실측 2026-08-23: 재고를 리셋해 ERP 사진이 사라지자 그날로 동기가 멈췄다.
   *   두 규칙이 서로를 막고 있었다. 사진을 판매시트로 나르기로 정하면 그때 다시 넣는다.
   */
  'options', 'location', 'price', 'policy_code', 'partner_memo',
  'sheet_source_gid', 'sheet_source_tab', 'sheet_source_row',
]);

function isBlank(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => same(value, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => key === rightKeys[index] && same(left[key], right[key]));
}

const MANUAL_FIELD_EXCLUDED = new Set([
  '_key', 'product_code', 'companyId', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy',
  'deletedAt', 'deletedReason', '_deleted', 'provider_company_code', 'partner_code',
  'source', 'source_schema', 'locked_by_contract', 'sheet_status_owner', 'sheet_block_reason',
  'sheet_blocked_at', 'allow_sheet_reactivate', 'sheet_sync_run_id', 'status_label',
  'sheet_source_gid', 'sheet_source_tab', 'sheet_source_row',
]);

export function sheetManualFieldSet(row: EntityRecord): Set<string> {
  const raw = row._sheet_manual_fields;
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [];
  return new Set(values.map(String).map((value) => value.trim()).filter(Boolean));
}

/** 시트 유입 재고를 사람이 편집하면 그 필드는 이후 동기화보다 내부 값을 우선한다. */
export function buildSheetManualFieldList(before: EntityRecord, after: EntityRecord): string[] {
  const source = String(before.source || '').trim();
  const fields = sheetManualFieldSet(before);
  if (source !== 'sheet' && source !== 'external_sheet') return [...fields].sort();
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key.startsWith('_') || MANUAL_FIELD_EXCLUDED.has(key)) continue;
    if (!same(before[key], after[key])) fields.add(key);
  }
  return [...fields].sort();
}

const productStatus = (row: EntityRecord): string => String(row.vehicle_status || '').trim();

/**
 * sheet_status_owner 도입 전 부재 처리로 만들어진 레거시 자동차단.
 * 정확한 과거 라벨과 시트 출처가 함께 있을 때만 인정해 수기 출고불가를 풀지 않는다.
 */
export function isLegacySheetOwnedBlock(row: EntityRecord): boolean {
  const source = String(row.source || '').trim();
  return productStatus(row) === '출고불가'
    && String(row.status_label || '').trim() === '시트에서 제거됨'
    && (source === 'external_sheet' || source === 'sheet');
}

/** 현재 provenance 또는 검증된 레거시 표식으로 시트가 소유한 출고불가인지 판정. */
export function isSheetOwnedBlock(row: EntityRecord): boolean {
  if (productStatus(row) !== '출고불가') return false;
  const currentMarker = row.sheet_status_owner === 'sheet'
    && ['missing_or_excluded', 'source_contract_status'].includes(String(row.sheet_block_reason || ''));
  return currentMarker || isLegacySheetOwnedBlock(row);
}

/**
 * 계약 엔진이 소유한 상태인지 판정한다.
 * 계약 엔진이 기록한 `locked_by_contract`의 실제 참값만 잠근다.
 * 판매시트의 `계약중` 상태 자체나 빈/거짓 락 표시는 엔진 락으로 추정하지 않는다.
 */
export function isContractEngineLocked(row: EntityRecord): boolean {
  const raw = row.locked_by_contract;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  const lock = String(raw ?? '').trim();
  return !!lock && !/^(?:0|false|null|undefined|none|-)$/i.test(lock);
}

/** 시트가 자동 해제하면 안 되는 운영자/공급사 수기 출고불가. */
export function isManualSheetHold(row: EntityRecord): boolean {
  const engineLocked = isContractEngineLocked(row);
  return productStatus(row) === '출고불가'
    && !engineLocked
    && !isSheetOwnedBlock(row)
    && row.allow_sheet_reactivate !== true;
}

/** existing ← incoming. 빈 incoming 필드는 existing 유지. price는 기간키 병합.
 *  _raw_vehicle = 최초 원본 유지. 기존 매물의 volatile snap 시각/이력은 유지. */
export function softMergeProduct(existing: EntityRecord, incoming: EntityRecord): EntityRecord {
  const out: EntityRecord = { ...existing };
  // 계약 상태 문자열만으로 엔진 락을 추정하지 않는다. 실제 락 표지가 있을 때만
  // 판매시트 상태보다 우선하여 보존한다.
  const engineLocked = isContractEngineLocked(existing);
  const legacySheetOwnedBlock = isLegacySheetOwnedBlock(existing);
  const sheetOwnedBlock = isSheetOwnedBlock(existing);
  const manualBlocked = isManualSheetHold(existing);
  const manualFields = sheetManualFieldSet(existing);
  const incomingIsProductMaster = Object.prototype.hasOwnProperty.call(
    incoming,
    '_product_master_identity_authoritative',
  );
  const incomingMasterIdentity = incoming._product_master_identity_authoritative === true;
  const existingMasterIdentity = existing._product_master_identity_authoritative === true;
  const incomingSalesAuthoritative = incoming._sales_sheet_authoritative === true;
  let reactivatedLegacySheetBlock = false;
  for (const [k, v] of Object.entries(incoming)) {
    if (PROTECTED.has(k)) continue;
    if (incomingSalesAuthoritative && SALES_EXACT_PRODUCT_FIELDS.has(k)) {
      // 계약 엔진 락만 판매시트 상태보다 우선한다. 나머지 필드는 판매시트의 현재
      // 빈칸까지 그대로 반영해 옛 차명·금액·사진이 ERP에 남지 않게 한다.
      if (k === 'vehicle_status' && engineLocked) continue;
      if (k === 'price') {
        out.price = v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
      } else {
        out[k] = v == null ? '' : v;
        if (k === 'vehicle_status'
          && String(v || '') !== '계약중'
          && existing.sheet_status_owner === 'sheet'
          && String(existing.sheet_block_reason || '') === 'source_contract_status') {
          out.sheet_status_owner = null;
          out.sheet_block_reason = null;
          out.sheet_blocked_at = null;
        }
      }
      continue;
    }
    if (isBlank(v)) continue;
    if (PRODUCT_MASTER_IDENTITY_FIELDS.has(k)) {
      // 미매칭 상품마스터 행은 공급사 원문일 뿐 정제 식별자가 아니다.
      if (incomingIsProductMaster && !incomingMasterIdentity) continue;
      /**
       * ★**옛 차종마스터 확정값이 판매시트 정제값을 막지 못한다**(사장님 2026-08-22
       *   「ERP 에는 정제를 쓰는 게 맞고 정제만 잘해 두면 되니까」·「차종마스터 이제 참조 안 한다」).
       *
       * 예전 규칙은 `existingMasterIdentity` 면 시트가 못 덮게 했다 — 시트 값이 «공급사 원문 추정»이던 시절의 방어다.
       * 지금 유입은 **판매시트**이고 그 값은 공급사 정제칸(세부모델 100%·세부트림 88%, 실측 2026-08-22)이라 추정이 아니다.
       * 상품마스터 경로도 기본으로 건너뛴다(hourly-sync ⑥′ `--with-product-master` 로만) — 남은 플래그는 옛 경로의 잔재다.
       * 이 방어를 그대로 두면 판매시트엔 있는데 ERP 만 빈 차 219대가 영원히 안 채워진다(실측).
       */
    }
    const authoritativeIdentityField = incomingMasterIdentity && PRODUCT_MASTER_IDENTITY_FIELDS.has(k);
    if (manualFields.has(k)
      && !SUPPLIER_OWNED_PRODUCT_FIELDS.has(k)
      && !authoritativeIdentityField) continue;
    // 엔진 락(계약중·출고불가)의 상태는 settlement-engine 소관 — 시트 재동기화가 덮으면 재고가 통째로 풀린다.
    // 락 주인이 없는 매물(공급사 수기 출고불가 등)은 그대로 시트가 갱신하도록 둔다.
    if (k === 'vehicle_status') {
      if (engineLocked) continue;
      // ★상품마스터(ERP 입력 정본)에서 온 상태는 표식 없는 출고불가(=수기 보류로 간주하던 것)도 덮는다.
      //   사장님 2026-08-19 「시트는 512대고 ERP 는 482대인데 왜 안 맞지 — 시트랑 맞아야 하는데」: 실측 30대가
      //   ERP 만 출고불가(표식 없음)인 채로 남아 시트가 출고가능이라 해도 영원히 안 살아났다. 보류는 상품마스터
      //   「관리상태 중지」로 표현한다(import 가 출고불가로 투영). 직접 시트 유입(legacy 경로)은 종전대로 보호한다.
      if (manualBlocked && !incomingIsProductMaster) continue;
      if (String(v) !== '출고불가' && (sheetOwnedBlock || existing.allow_sheet_reactivate === true || (manualBlocked && incomingIsProductMaster))) {
        // 시트가 부재 때문에 만든 차단만 시트 재등장으로 되돌린다. 명시적 1회 허용도
        // 반영 후 지워 다음 수기 보류를 무기한 자동해제하지 않는다.
        out.sheet_status_owner = null;
        out.sheet_block_reason = null;
        out.sheet_blocked_at = null;
        out.allow_sheet_reactivate = null;
        reactivatedLegacySheetBlock = legacySheetOwnedBlock;
      }
    }
    if (k === '_raw_vehicle') {
      if (existing._raw_vehicle && typeof existing._raw_vehicle === 'object') continue;
      out._raw_vehicle = v;
      continue;
    }
    if (k === '_pending_signature' && !isBlank(existing._pending_signature)) {
      // 임시번호를 처음 부여할 때의 신원 서명은 식별 증거다. 이후 시트 수정으로
      // 덮지 않고, 불일치는 커밋 전 conflict gate에서 수동 연결 대상으로 막는다.
      continue;
    }
    if (k === 'price' && v && typeof v === 'object') {
      // PLAN §9의 승인 범위는 가격 파서 추가이며 기존 diff/commit 의미 변경은 아니다.
      // 일부 기간 셀이 일시 공란·파서 오류라고 다른 유효 기간까지 삭제하지 않도록
      // 이번 시트에서 명시적으로 읽힌 기간만 갱신한다. 기간 삭제는 별도 정책 승인 전 금지.
      const prevPrice = existing.price && typeof existing.price === 'object'
        ? existing.price as Record<string, unknown>
        : {};
      out.price = { ...prevPrice, ...(v as Record<string, unknown>) };
      continue;
    }
    out[k] = v;
  }
  // 레거시 자동차단 라벨을 남기면 사람이 이후 다시 출고불가로 바꿨을 때도 자동 차단으로
  // 오인할 수 있다. 유입이 새 status_label을 명시하지 않은 경우에만 낡은 표식을 제거한다.
  if (reactivatedLegacySheetBlock && isBlank(incoming.status_label)) out.status_label = null;
  return out;
}

/** soft-merge 결과에서 실제 바뀐 키만 patch로. */
export function changedPatch(before: EntityRecord, after: EntityRecord): EntityRecord | null {
  const patch: EntityRecord = {};
  for (const k of Object.keys(after)) {
    if (PROTECTED.has(k)) continue;
    if (!same(before[k], after[k])) patch[k] = after[k];
  }
  return Object.keys(patch).length ? patch : null;
}

export type UpsertPlan = {
  creates: EntityRecord[];
  patches: GuardedProductPatch[];
  unchanged: number;
};

const plateOf = (r: EntityRecord): string =>
  String(r.car_number || r.car_number_snapshot || '').replace(/\s/g, '');

/** 시트 재조정용 공급사 코드 SSOT. 레거시 빈 필드는 양쪽 key 규약에서만 안전 추론한다. */
export function sheetProviderOf(
  row: EntityRecord,
  candidates: Iterable<string> = [],
): string {
  const candidateList = [...new Set([...candidates].map(String).filter(Boolean))];
  const explicit = String(row.provider_company_code || row.partner_code || '').trim();
  if (explicit) return explicit;
  const sourceSchema = String(row.source_schema || '').trim();
  // 레거시 source_schema는 `autoplus|general` 같은 공용 포맷명일 수 있다.
  // 현재 roster의 실제 공급사 코드와 정확히 일치할 때만 약한 소유 힌트로 쓴다.
  if (sourceSchema && candidateList.includes(sourceSchema)) return sourceSchema;
  const key = String(row._key || row.product_code || '').trim();
  if (!key) return '';
  const matches = candidateList
    .filter((code) => key.startsWith(`${code}_`) || key.endsWith(`_${code}`));
  return matches.length === 1 ? matches[0] : '';
}

/**
 * 시트 create → 되살릴 삭제 톰스톤.
 * 1차 product_code/_key, 2차 공급사+차번(EXT_ 우선). 임시번호는 2차 금지.
 */
export function resolveSheetReviveTarget(
  create: EntityRecord,
  deleted: EntityRecord[],
): { key: string; expected: EntityRecord } | null {
  const createKey = String(create.product_code || create._key || '');
  if (createKey) {
    const byKey = deleted.find((row) => String(row._key || row.product_code || '') === createKey);
    if (byKey) {
      // toV4Record의 _key는 논리 product_code이고, 실제 Firebase child는 _rtdb_key다.
      // 삭제 이력을 되살릴 때 논리키로 transaction하면 없는 다른 child를 보게 되어 CAS가
      // 실패하거나 옛 톰스톤을 남긴 채 새 twin을 만든다.
      return { key: String(byKey._rtdb_key || createKey), expected: byKey };
    }
  }
  const plate = plateOf(create);
  if (!plate || create.is_pending_plate) return null;
  const provider = sheetProviderOf(create);
  if (!provider) return null;
  const same = deleted.filter((row) => {
    if (plateOf(row) !== plate) return false;
    if (row.is_pending_plate) return false;
    return sheetProviderOf(row) === provider;
  });
  if (!same.length) return null;
  const preferred = same.find((row) => String(row._key || row.product_code || '').startsWith('EXT_')) || same[0];
  const key = String(preferred._rtdb_key || preferred._key || preferred.product_code || '');
  return key ? { key, expected: preferred } : null;
}

const SHEET_PRIVATE_PRODUCT_FIELDS = new Set([
  'vehicle_price', 'vin', 'account_number',
  // 파서/병합 사이에서만 쓰는 표식. 신규 create에도 저장되면 안 된다.
  '_sales_sheet_authoritative', '_sheet_price_scope', '_sheet_contract_status',
]);
const SHEET_PRIVATE_PRICE_FIELDS = new Set(['fee', 'commission', 'fee_memo']);

/**
 * Sheet는 공개 재고·대여조건의 writer일 뿐 원가/VIN/계좌/수수료의 writer가 아니다.
 * 기존 price를 기간 병합하면 private 수수료도 객체 안에 따라오므로, CAS 패치 직전에
 * 제거하지 않으면 RTDB 공개/비공개 2단 transaction에서 공개만 먼저 반영되는 부분 성공이 생긴다.
 */
export function stripSheetPrivatePatchFields(patch: EntityRecord): EntityRecord {
  const output = { ...patch };
  for (const field of SHEET_PRIVATE_PRODUCT_FIELDS) delete output[field];
  if (output.price && typeof output.price === 'object' && !Array.isArray(output.price)) {
    const publicPrice: Record<string, unknown> = {};
    for (const [period, rawTerms] of Object.entries(output.price as Record<string, unknown>)) {
      if (!rawTerms || typeof rawTerms !== 'object' || Array.isArray(rawTerms)) {
        publicPrice[period] = rawTerms;
        continue;
      }
      const publicTerms = Object.fromEntries(Object.entries(rawTerms as Record<string, unknown>)
        .filter(([field]) => !SHEET_PRIVATE_PRICE_FIELDS.has(field)));
      // 수수료만 있던 기간을 빈 객체로 남기면 기존 공개 price 기간을 빈값으로 덮을 수 있다.
      if (Object.keys(publicTerms).length) publicPrice[period] = publicTerms;
    }
    output.price = publicPrice;
  }
  return output;
}

/**
 * 유입 매물 vs 기존 → create / soft-merge patch / unchanged.
 *
 * 1차 키 = product_code(_key). **2차 키 = 공급사+차량번호.**
 * 키 규약이 한 가지가 아니다 — v3 이관분은 `02하9002_RP006`(차번_공급사), 시트 유입은
 * `RP006_02하9002`(공급사_차번)로 만든다. 키만 보면 같은 실물 차가 신규로 하나 더 생기고,
 * 뒤이어 부재처리가 옛 레코드를 출고불가로 내린다. 계약이 걸려 있으면 그것도 못 해서
 * **같은 차가 계약중 하나 · 출고가능 하나로 동시에 남는다**(트윈 중복판매).
 * 실측(2026-07-31): 403대 중 23대가 이 경우 — 오플 6 · 아이언 5 · 우리캐피탈 4 · 손오공 3 · 웰릭스 2 · 스타 2 · 리더스 1.
 * 차번이 같으면 같은 차다. 기존 키를 그대로 쓰고 patch 로 간다.
 */
export function planProductUpsert(incoming: EntityRecord[], existing: EntityRecord[]): UpsertPlan {
  const byKey = new Map<string, EntityRecord>();
  const byPlate = new Map<string, EntityRecord>();
  const providerCodes = new Set(incoming.map((row) => sheetProviderOf(row)).filter(Boolean));
  for (const r of existing) {
    const k = String(r._key || r.product_code || '');
    if (k) byKey.set(k, r);
    const plate = plateOf(r);
    if (!plate || r._deleted) continue;
    const provider = sheetProviderOf(r, providerCodes);
    if (!provider) continue;
    const pk = `${provider}|${plate}`;
    // 같은 차가 여러 레코드면 먼저 만난 쪽(=운영에서 쓰던 것)을 남긴다.
    if (!byPlate.has(pk)) byPlate.set(pk, r);
  }
  const creates: EntityRecord[] = [];
  const patches: GuardedProductPatch[] = [];
  let unchanged = 0;
  for (const rec of incoming) {
    let key = String(rec.product_code || rec._key || '');
    if (!key) continue;
    let prev = byKey.get(key);
    if (!prev) {
      // 키가 안 맞으면 공급사+차번으로 한 번 더 본다.
      //  임시번호(100신…)는 실물 차번이 아니므로 이 경로를 태우면 안 된다 — 서로 다른 신차가 물린다.
      const plate = plateOf(rec);
      if (plate && !rec.is_pending_plate) {
        const alt = byPlate.get(`${sheetProviderOf(rec)}|${plate}`);
        if (alt) { prev = alt; key = String(alt._key || alt.product_code || key); }
      }
    }
    if (!prev) {
      creates.push(rec);
      continue;
    }
    const merged = softMergeProduct(prev, rec);
    // readProducts는 공개 rent/deposit와 private fee를 합쳐 반환한다. 판매시트는 공개 가격만
    // 소유하므로 비교 때 fee를 제거하지 않으면 실제 공개값이 같아도 매 실행 price patch가 난다.
    const beforeForDiff = rec._sales_sheet_authoritative === true
      ? {
          ...prev,
          price: stripSheetPrivatePatchFields({ price: prev.price }).price || {},
        }
      : prev;
    const changed = changedPatch(beforeForDiff, merged);
    const publicChanged = changed ? stripSheetPrivatePatchFields(changed) : null;
    const patch = publicChanged && Object.keys(publicChanged).length ? publicChanged : null;
    if (patch) {
      // v4 매물 write 규칙 = newData.provider_company_code === 내 회사. 변경필드만 담는 patch가 v3전용 매물의
      //  첫 오버레이면 회사코드 누락 → provider permission_denied. 기존 소유코드 승계 스탬프(자기기술형·admin 무해).
      if (patch.provider_company_code === undefined && prev.provider_company_code != null && prev.provider_company_code !== '') {
        patch.provider_company_code = prev.provider_company_code;
      }
      // ★patch 는 **실제 Firebase child**(_rtdb_key)에 쓴다. toV4Record 의 _key 는 논리 product_code 라
      //  라이브 레코드가 EXT_… child 에 있고 같은 product_code 의 soft-delete 톰스톤이 논리키 child 에 남아 있으면
      //  논리키로 transaction 하는 순간 CAS 가 톰스톤을 보고 «동기화 중 재고가 변경됐습니다»로 그 공급사 전체가 멈춘다
      //  (2026-08-19 개통일 이안카 RP031_133호5531 — 톰스톤 08-11 · 라이브 EXT_4dca6a1ace4b, 이안카 twin 30건).
      //  revive(resolveSheetReviveTarget)가 이미 _rtdb_key 를 쓰는 것과 같은 규칙이다.
      patches.push({ key: String(prev._rtdb_key || key), patch, expected: prev });
    } else unchanged++;
  }
  return { creates, patches, unchanged };
}

export type CommitSheetResult = {
  created: number;
  updated: number;
  unchanged: number;
  duplicates: number;
  backend: string;
  /** 톰스톤을 걷어내고 되살린 대수 — 시트에 있는데 삭제 상태로 묻혀 있던 것. */
  revived?: number;
};

/**
 * 시트 병합/부재판정용 기존 매물 원본.
 * 판매 목록 list()는 제외 공급사·상태를 숨기고 같은 차량번호 twin을 하나로 접으므로,
 * 그 가공 결과로 동기화하면 숨은 기존 레코드는 영구히 갱신되지 않는다.
 */
async function rawProductsForSheetReconcile(companyId: string, fresh = false): Promise<EntityRecord[]> {
  const store = getStore();
  if (fresh && typeof store.listRawFreshWithHealth === 'function') {
    const health = await store.listRawFreshWithHealth('product', companyId);
    if (!health.complete) {
      throw new Error(`ERP 재고 원본 조회 불완전 — ${(health.failures || ['source read 실패']).join(' · ')}`);
    }
    return health.rows;
  }
  if (fresh && typeof store.listRawFresh === 'function') {
    return store.listRawFresh('product', companyId);
  }
  return typeof store.listRaw === 'function'
    ? await store.listRaw('product', companyId)
    : await store.list('product', companyId);
}

export async function listProductsForSheetReconcile(companyId: string, fresh = false): Promise<EntityRecord[]> {
  const rows = await rawProductsForSheetReconcile(companyId, fresh);
  return rows.filter((r) => !r._deleted && !r.deletedAt && String(r.status || '') !== 'deleted');
}

/** save() dedup과 충돌하는 모든 삭제 상태(_deleted/deletedAt + legacy status=deleted). */
export async function listDeletedProductsForSheetReconcile(companyId: string, fresh = false): Promise<EntityRecord[]> {
  if (fresh) return (await listSheetReconcileState(companyId, true)).deleted;
  const store = getStore();
  const [raw, deleted] = await Promise.all([
    rawProductsForSheetReconcile(companyId, fresh),
    typeof store.listDeleted === 'function' ? store.listDeleted('product', companyId) : Promise.resolve([]),
  ]);
  const map = new Map<string, EntityRecord>();
  for (const row of [...raw.filter((r) => String(r.status || '') === 'deleted'), ...deleted]) {
    const key = String(row._key || row.product_code || '');
    if (key) map.set(key, row);
  }
  return [...map.values()];
}

/** 활성·삭제를 동일한 fresh 원본 스냅샷에서 나눠 시트 preflight 경합 판정에 쓴다. */
export async function listSheetReconcileState(
  companyId: string,
  fresh = false,
): Promise<{ active: EntityRecord[]; deleted: EntityRecord[] }> {
  const store = getStore();
  if (fresh && typeof store.listAllFreshWithHealth === 'function') {
    const health = await store.listAllFreshWithHealth('product', companyId);
    if (!health.complete) {
      throw new Error(`ERP 재고·삭제 이력 조회 불완전 — ${(health.failures || ['source read 실패']).join(' · ')}`);
    }
    const active = health.rows.filter((row) =>
      !row._deleted && !row.deletedAt && String(row.status || '') !== 'deleted');
    const deletedByKey = new Map<string, EntityRecord>();
    for (const row of health.rows.filter((item) =>
      item._deleted || item.deletedAt || String(item.status || '') === 'deleted')) {
      const key = String(row._key || row.product_code || '');
      if (key) deletedByKey.set(key, row);
    }
    return { active, deleted: [...deletedByKey.values()] };
  }
  const [raw, tombstones] = await Promise.all([
    rawProductsForSheetReconcile(companyId, fresh),
    typeof store.listDeleted === 'function' ? store.listDeleted('product', companyId) : Promise.resolve([]),
  ]);
  const active = raw.filter((r) => !r._deleted && !r.deletedAt && String(r.status || '') !== 'deleted');
  const deletedByKey = new Map<string, EntityRecord>();
  for (const row of [...raw.filter((r) => r._deleted || r.deletedAt || String(r.status || '') === 'deleted'), ...tombstones]) {
    const key = String(row._key || row.product_code || '');
    if (key) deletedByKey.set(key, row);
  }
  return { active, deleted: [...deletedByKey.values()] };
}

/** 활성뿐 아니라 삭제 tombstone 변화도 커밋 전 경합으로 감지한다. */
export function sheetReconcileStateRevision(state: {
  active: EntityRecord[];
  deleted: EntityRecord[];
}): string {
  return sheetReconcileRevision([
    ...state.active.map((row) => ({ ...row, _sheet_reconcile_bucket: 'active' })),
    ...state.deleted.map((row) => ({ ...row, _sheet_reconcile_bucket: 'deleted' })),
  ]);
}

function stableValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stableValue);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, stableValue(value)]));
  }
  return v;
}

/** 검증 후 ERP 재고가 바뀌었는지 감지하는 결정적 revision. */
export function sheetReconcileRevision(rows: EntityRecord[]): string {
  const canonical = rows
    .map((row) => stableValue(row))
    .sort((a, b) => String((a as EntityRecord)._key || (a as EntityRecord).product_code || '')
      .localeCompare(String((b as EntityRecord)._key || (b as EntityRecord).product_code || '')));
  const text = JSON.stringify(canonical);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${rows.length}:${(hash >>> 0).toString(36)}`;
}

/**
 * soft-merge 저장 엔진(빈칸→수기 덮지 않음).
 * ★ 외부 시트/엑셀 입고는 직접 호출하지 말 것 — master-ingress.commitSupplierProducts.
 */
export async function commitSheetProducts(companyId: string, products: EntityRecord[]): Promise<CommitSheetResult> {
  const store = getStore();
  // 저장 경계에서는 DispatchStore 세션 캐시를 쓰지 않는다. 다른 관리자 변경을 놓치면
  // stale soft-merge가 수기 상태·가격을 덮을 수 있다.
  const existing = await listProductsForSheetReconcile(companyId, true);
  const plan = planProductUpsert(products, existing);
  let created = 0;
  let duplicates = 0;
  let updated = 0;
  // 기존 레코드 CAS를 먼저 통과시켜야 충돌 시 신규행만 앞서 저장되는 부분 커밋을 줄인다.
  if (plan.patches.length) {
    const guarded = await store.bulkPatchGuardedProduct(companyId, plan.patches);
    updated = guarded.updated;
    if (guarded.conflicts.length) {
      throw new Error(`ERP 재고가 저장 중 변경됐습니다(${guarded.conflicts.slice(0, 5).join(', ')}). 데이터 검증을 다시 실행하세요.`);
    }
  }
  // ── 톰스톤 해제 — 시트에 살아 있는 차는 되살린다.
  //
  //  `store.save` 는 dedup 집합에 **소프트삭제 키까지** 넣는다(rtdb-adapter:622).
  //  자연키 재저장으로 아무 삭제 매물이나 부활하는 걸 막으려는 의도이고 그건 맞다.
  //  그런데 그 때문에 «시트에 멀쩡히 있는 차»가 예전 일괄정리의 톰스톤에 걸려
  //  영영 안 올라온다 — 실측(2026-08-05): 아이카 6대 · (2026-08-07): 아이카 21대.
  //
  //  매칭 키만 `product_code` 로 보면 실패한다. 시트 유입은 `RP004_109호4042` 인데
  //  톰스톤은 `EXT_…` 인 경우가 대부분이다. **1차=키 · 2차=공급사+차번**(활성 upsert와 동일).
  //  조건: ① 시트가 올린다(=creates) ② 같은 공급사 삭제 톰스톤이 있다.
  //  시트가 원본. 흔적=`revived_at`.
  const revivedKeys = new Set<string>();
  const revivedPlates = new Set<string>();
  if (plan.creates.length) {
    const deleted = await listDeletedProductsForSheetReconcile(companyId, true);
    if (deleted.length) {
      const now = new Date().toISOString();
      const revivePatches: GuardedProductPatch[] = [];
      const claimedPlates = new Set<string>();
      for (const row of plan.creates) {
        const target = resolveSheetReviveTarget(row, deleted);
        if (!target) continue;
        const plate = plateOf(row);
        const plateKey = plate ? `${sheetProviderOf(row)}|${plate}` : '';
        if (plateKey && claimedPlates.has(plateKey)) continue;
        if (plateKey) claimedPlates.add(plateKey);
        revivePatches.push({
          key: target.key,
          expected: target.expected,
          patch: {
            // Sheet는 공개 재고 writer다. 되살림도 수수료·원가·VIN·계좌 private 원자를
            // 건드리지 않아 공개/비공개 2단 트랜잭션의 부분 성공을 만들지 않는다.
            ...stripSheetPrivatePatchFields(row),
            _deleted: null, deletedAt: null, status: null,
            revived_at: now,
          } as EntityRecord,
        });
        if (plateKey) revivedPlates.add(plateKey);
      }
      if (revivePatches.length) {
        const guarded = await store.bulkPatchGuardedProduct(companyId, revivePatches);
        for (const item of revivePatches.slice(0, guarded.updated)) revivedKeys.add(item.key);
        if (guarded.conflicts.length) {
          throw new Error(`삭제 재고가 저장 중 변경됐습니다(${guarded.conflicts.slice(0, 5).join(', ')}). 데이터 검증을 다시 실행하세요.`);
        }
      }
    }
  }
  const freshCreates = (revivedKeys.size || revivedPlates.size)
    ? plan.creates.filter((row) => {
      const key = String(row.product_code || row._key || '');
      if (revivedKeys.has(key)) return false;
      const plate = plateOf(row);
      if (plate && revivedPlates.has(`${sheetProviderOf(row)}|${plate}`)) return false;
      return true;
    })
    : plan.creates;

  if (freshCreates.length) {
    const r: SaveResult = await store.save('product', companyId, freshCreates);
    created = r.saved;
    duplicates = r.duplicates;
  }
  return { created, updated, unchanged: plan.unchanged, duplicates, backend: store.backend, revived: revivedKeys.size };
}

export type AbsentPlan = {
  patches: GuardedProductPatch[];
  skipped_locked: number;
  already_blocked: number;
};

/**
 * 시트에 이번 유입에 없는 같은 공급사 매물 → 출고불가 patch (삭제 금지).
 * 실제 locked_by_contract가 있으면 스킵. 이미 출고불가면 집계만.
 */
export function planAbsentBlocked(opts: {
  existing: EntityRecord[];
  providerCode: string;
  presentKeys: Set<string>;
  /** 이번 유입에 있던 차량번호. 키 규약이 달라도 **차번이 같으면 시트에 있는 차다.** */
  presentPlates?: Set<string>;
}): AbsentPlan {
  const provider = opts.providerCode;
  let skipped_locked = 0;
  let already_blocked = 0;
  const patches: GuardedProductPatch[] = [];
  for (const r of opts.existing) {
    if (r._deleted) continue;
    const key = String(r._key || r.product_code || '');
    if (!key) continue;
    const pc = sheetProviderOf(r, [provider]);
    // 명시적 소유 코드가 예전 key prefix보다 우선한다.
    // RP1_로 시작해도 provider_company_code=RP2면 RP1 부재처리가 건드리지 않는다.
    if (pc ? pc !== provider : !key.startsWith(`${provider}_`)) continue;
    const pcode = String(r.product_code || '');
    if (opts.presentKeys.has(key) || (pcode && opts.presentKeys.has(pcode))) continue;
    // 키가 옛 규약(`차번_공급사`)이라 못 맞은 것뿐인데 출고불가로 내리면
    //  멀쩡한 매물이 죽고, 새 키 레코드와 함께 같은 차가 둘이 된다.
    const plate = plateOf(r);
    if (plate && opts.presentPlates?.has(plate)) continue;
    if (String(r.vehicle_status || '') === '출고불가') {
      already_blocked++;
      continue;
    }
    // 계약 상태 문자열이 아니라 계약 엔진이 기록한 실제 락만 보호한다.
    if (isContractEngineLocked(r)) {
      skipped_locked++;
      continue;
    }
    patches.push({
      key,
      expected: r,
      patch: {
        vehicle_status: '출고불가',
        // 시트가 만든 차단임을 남겨야 이후 같은 차가 돌아왔을 때만 자동 재활성화할 수 있다.
        sheet_status_owner: 'sheet',
        sheet_block_reason: 'missing_or_excluded',
        sheet_blocked_at: Date.now(),
        // v3-only 첫 오버레이 permission — 소유 공급사 코드 승계
        provider_company_code: pc || provider,
      },
    });
  }
  return { patches, skipped_locked, already_blocked };
}

/** fetch 성공·건수 가드. 빈 유입·급감(사고)이면 부재→출고불가 금지. */
export function shouldReconcileAbsent(
  imported: number,
  previousCount: number,
): { ok: boolean; reason?: 'imported_empty' | 'collapse' } {
  if (imported <= 0) return { ok: false, reason: 'imported_empty' };
  // 소규모 공급사도 헤더+1행만 남는 탭 붕괴가 난다. 10대 이상만 보던 예전 가드는
  // 9→1을 정상으로 통과시켜 8대를 출고불가로 내렸다. 절대 2행 이상이면서 50% 이상
  // 줄면 규모와 무관하게 운영 확인 전 부재처리를 멈춘다(2→1만 예외).
  const lost = previousCount - imported;
  if (previousCount >= 3 && lost >= 2 && imported <= previousCount * 0.5) {
    return { ok: false, reason: 'collapse' };
  }
  return { ok: true };
}

/** 부재 매물 출고불가 적용. 일괄 연동(sync-all) 전용 — 부분 붙여넣기 경로에서 호출 금지. */
export async function applyAbsentBlocked(
  companyId: string,
  providerCode: string,
  presentKeys: Set<string>,
  presentPlates?: Set<string>,
): Promise<{ absent_blocked: number; skipped_locked: number; already_blocked: number }> {
  const store = getStore();
  const existing = await listProductsForSheetReconcile(companyId, true);
  const plan = planAbsentBlocked({ existing, providerCode, presentKeys, presentPlates });
  let absent_blocked = 0;
  if (plan.patches.length) {
    const guarded = await store.bulkPatchGuardedProduct(companyId, plan.patches);
    absent_blocked = guarded.updated;
    if (guarded.conflicts.length) {
      throw new Error(`부재 재고가 저장 중 변경됐습니다(${guarded.conflicts.slice(0, 5).join(', ')}). 데이터 검증을 다시 실행하세요.`);
    }
  }
  return {
    absent_blocked,
    skipped_locked: plan.skipped_locked,
    already_blocked: plan.already_blocked,
  };
}
