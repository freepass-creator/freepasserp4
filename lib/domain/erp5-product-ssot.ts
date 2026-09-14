/**
 * 공급사 원천 원자 + Google 상품마스터 대조본을 ERP5 상품 SSOT로 조합하는 공개 경계.
 *
 * ERP3/ERP4 상품 컬렉션은 이 모듈의 입력이 아니다. 가격·상태는 공급사 어댑터 원자를,
 * 차종 식별·표시 메타는 동일 차량번호의 Google 상품마스터 검증값만 사용한다.
 */
import type { AdapterIssue, DepositPolicy, FreepassAtom } from './supplier-adapter';
import {
  calculateDepositFromMonthlyRent,
  resolveAutoplusDepositPolicy,
  SONOGONG_DEPOSIT_POLICY,
} from './deposit-policy';
import { evaluateEligibility } from './product-eligibility';
import { canonSheetVehicleStatus } from './sheet-import';
import { canonMakerDisplay } from './maker-display';
import { isImportBrand } from './vehicle-origin';
import { erp5VehicleMasterEntryId } from './erp5-vehicle-master-ssot';

export type ExportedProduct = Record<string, unknown>;

export type ProductExportResult = {
  data: ExportedProduct;
  ignoredFields: string[];
};

export type Erp5ProductVerificationState = 'verified' | 'needs-review' | 'conflict';

export type ProductSourceSpec = {
  code: string;
  partnerCode: string;
  name: string;
  spreadsheetId: string;
  tab: string;
};

export type Erp5ProductComposition = ProductExportResult & {
  id: string;
  verificationState: Erp5ProductVerificationState;
  blockingReasons: string[];
};

const AUTOPLUS_CODES = new Set(['RP023', 'AUTOPLUS']);
const SONOGONG_CODES = new Set(['RP012', 'SONOGONG']);

const PUBLIC_PRODUCT_FIELDS = new Set([
  'car_number',
  'origin',
  'maker',
  'model',
  'sub_model',
  'trim_name',
  '확정',
  '검수상태',
  'ext_color',
  'int_color',
  'year',
  'fuel_type',
  'engine_cc',
  'vehicle_class',
  'drive_type',
  'seats',
  'battery_capacity',
  'first_registration_date',
  'vehicle_status',
  'status_label_raw',
  'status',
  'status_kind',
  'status_reason',
  'listable',
  'mileage',
  'policy_code',
  'product_code',
  'product_type',
  'provider_company_code',
  'partner_code',
  'provider_name',
  'photo_link',
  'location',
  'options',
  'usage',
  'supplier_vehicle_name',
  'supplier_options',
  '_mirror_at',
  'source_updated_at',
  'rent_variants',
  'rentVariants',
  'source_status_raw',
  'source_status_canonical',
  'google_status_raw',
  'google_status_canonical',
  'verification_state',
  'verification_reasons',
  'listing_reasons',
  'source_evidence',
  'google_reference',
  'adapter_issues',
  'vehicle_master_entry_id',
]);

const PRIVATE_PRICE_KEY = /(?:fee|commission|margin|cost|수수료|커미션|마진|원가|공급가)/i;

const PRIVATE_KEY = /^(?:customer(?:_.*)?|client(?:_.*)?|consult(?:ation)?(?:_.*)?|contract(?:_.*)?|renter(?:_.*)?|driver(?:_.*)?|representative(?:_.*)?|employee(?:_.*)?|user(?:_.*)?|owner(?:_.*)?|manager(?:_.*)?|phone|phone_number|mobile|tel|telephone|email|birth|birthday|resident(?:_.*)?|rrn|address|account_number|bank_account|bank_name|vin|vehicle_identification_number|chassis(?:_.*)?|attachment(?:_.*)?|consent(?:_.*)?|signature(?:_.*)?|created_by|updated_by|locked_by_contract|고객(?:명|_.*)?|계약자(?:명|_.*)?|담당자(?:명|_.*)?|소유자(?:명|_.*)?|예금주(?:명|_.*)?|성명|이름|전화(?:번호)?|휴대폰|연락처|이메일|생년월일|주민(?:등록번호)?|주소|계좌(?:번호)?|은행(?:명)?|차대번호|첨부(?:파일)?|동의|서명)$/i;

const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const KOREAN_PHONE_VALUE = /(?:^|\D)(?:\+?82[- .]?)?(?:0?1[016789]|0[2-6][1-5]?)[- .]?\d{3,4}[- .]?\d{4}(?:\D|$)/;
const RESIDENT_ID_VALUE = /(?:^|\D)\d{6}[- ]?[1-4]\d{6}(?:\D|$)/;
const SENSITIVE_URL_PARAM = /^(?:(?:(?:customer|client|renter|driver|representative|employee|user)_)?(?:phone(?:_(?:number|no))?|mobile(?:_(?:number|no))?|tel|telephone|contact(?:_(?:number|no))?|email(?:_address)?|birth(?:day|_date)?|resident(?:_(?:id|number|no))?|rrn|address)|(?:customer|client|renter|driver|representative|employee|user)_name|bank_account(?:_(?:number|no))?|account_(?:number|no)|고객(?:명|_이름|_전화|_연락처|_이메일)?|성명|전화(?:번호)?|휴대폰|연락처|이메일|생년월일|주민(?:등록번호)?|주소|계좌(?:번호)?)$/i;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

function withoutUndefined(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map(withoutUndefined).filter((item) => item !== undefined);
  }
  if (!isPlainObject(value)) return value;
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    const copied = withoutUndefined(nested);
    if (copied !== undefined) result[key] = copied;
  }
  return result;
}

const normalizePrivateKey = (key: string) => key.trim()
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .replace(/[^A-Za-z0-9가-힣]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .toLowerCase();
const hasPrivateKey = (key: string) => PRIVATE_KEY.test(normalizePrivateKey(key));
const normalizeUrlParamKey = (key: string) => key
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .replace(/[^A-Za-z0-9가-힣]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .toLowerCase();

function assertPublicPhotoLink(value: string, path: string): void {
  const links = value.split(/\s*[\n,]\s*/).map((link) => link.trim()).filter(Boolean);
  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      if (EMAIL_VALUE.test(link) || KOREAN_PHONE_VALUE.test(link) || RESIDENT_ID_VALUE.test(link)) {
        throw new Error(`개인정보로 보이는 값이 공개 상품 필드에 있습니다: ${path}`);
      }
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`공개 상품 사진 링크 프로토콜이 올바르지 않습니다: ${path}`);
    }
    let decodedPath = url.pathname;
    let decodedHash = url.hash;
    try { decodedPath = decodeURIComponent(decodedPath); } catch { /* 원문으로 검사 */ }
    try { decodedHash = decodeURIComponent(decodedHash); } catch { /* 원문으로 검사 */ }
    if (url.username || url.password || EMAIL_VALUE.test(decodedPath) || EMAIL_VALUE.test(decodedHash)) {
      throw new Error(`개인정보로 보이는 값이 공개 상품 필드에 있습니다: ${path}`);
    }
    for (const [key, parameter] of url.searchParams) {
      if ((SENSITIVE_URL_PARAM.test(normalizeUrlParamKey(key)) && parameter) || EMAIL_VALUE.test(parameter)) {
        throw new Error(`개인정보로 보이는 값이 공개 상품 필드에 있습니다: ${path}`);
      }
    }
  }
}

function offerTerms(source: Record<string, unknown>, atom?: FreepassAtom): Record<string, unknown> | null {
  const code = String(source.provider_company_code || source.partner_code || '').trim().toUpperCase();
  if (AUTOPLUS_CODES.has(code)) {
    // 제조사가 없으면 국산으로 추정하지 않는다. 어댑터와 같은 SSOT resolver만 쓴다.
    const depositPolicy = atom?.depositPolicy ?? resolveAutoplusDepositPolicy(String(source.maker ?? ''));
    return {
      priceAxes: ['termMonths', 'annualKm'],
      ...(depositPolicy ? { depositPolicy } : {}),
    };
  }
  if (SONOGONG_CODES.has(code)) {
    return {
      priceAxes: ['termMonths'],
      depositPolicy: atom?.depositPolicy ?? SONOGONG_DEPOSIT_POLICY,
    };
  }
  return null;
}

function copyPublicValue(value: unknown, path: string): unknown {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    if (path === 'photo_link') {
      assertPublicPhotoLink(value, path);
      return value;
    }
    if (EMAIL_VALUE.test(value) || KOREAN_PHONE_VALUE.test(value) || RESIDENT_ID_VALUE.test(value)) {
      throw new Error(`개인정보로 보이는 값이 공개 상품 필드에 있습니다: ${path}`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item, index) => copyPublicValue(item, `${path}[${index}]`))
      .filter((item) => item !== undefined);
  }
  // Firestore Timestamp/GeoPoint 같은 SDK 값은 내부 필드를 펼치지 않고 그대로 운반한다.
  if (!isPlainObject(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (PRIVATE_PRICE_KEY.test(key) || hasPrivateKey(key)) continue;
    const copied = copyPublicValue(nested, `${path}.${key}`);
    if (copied !== undefined) result[key] = copied;
  }
  return result;
}

function adapterPricing(atom: FreepassAtom): Record<string, unknown> {
  return withoutUndefined({
    sourceCode: atom.source.supplierCode,
    sourceName: atom.source.supplierName || '',
    adapter: atom.source.adapter,
    adapterVersion: atom.source.adapterVersion,
    shortDeposit: atom.shortDeposit ?? null,
    longDeposit: atom.longDeposit ?? null,
    depositPolicy: atom.depositPolicy ?? null,
    rent: atom.rent,
    rentVariants: atom.rentVariants || [],
  }) as Record<string, unknown>;
}

export function exportProductForErp5(source: Record<string, unknown>, atom?: FreepassAtom): ProductExportResult {
  const data: ExportedProduct = {};
  const ignoredFields: string[] = [];

  for (const [key, value] of Object.entries(source)) {
    if (!PUBLIC_PRODUCT_FIELDS.has(key) || hasPrivateKey(key)) {
      ignoredFields.push(key);
      continue;
    }
    const copied = copyPublicValue(value, key);
    if (copied !== undefined) data[key] = copied;
  }

  if (typeof data.car_number !== 'string' || !data.car_number.trim()) {
    throw new Error('car_number 없는 상품은 ERP5 SSOT에 게시할 수 없습니다.');
  }

  const terms = offerTerms(source, atom);
  if (terms) data.offer_terms = terms;
  if (atom) data.adapter_pricing = adapterPricing(atom);

  return { data, ignoredFields: ignoredFields.sort() };
}

const DISPLAY_FIELDS = [
  'origin', 'maker', 'model', 'sub_model', 'trim_name', 'ext_color', 'int_color', 'year',
  'fuel_type', 'engine_cc', 'vehicle_class', 'drive_type', 'seats', 'battery_capacity',
  'first_registration_date', 'mileage', 'policy_code', 'product_type', 'photo_link', 'location',
  'options', 'usage', 'supplier_vehicle_name', 'supplier_options',
] as const;

const cleanText = (value: unknown): string => String(value ?? '').trim();
const cleanPlate = (value: unknown): string => cleanText(value).replace(/\s+/g, '');

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function hasProjectablePrice(atom: FreepassAtom): boolean {
  const fixedDeposit = atom.shortDeposit ?? atom.longDeposit;
  const canPrice = (months: number, rent: unknown) => {
    const monthlyRent = Number(rent);
    if (!Number.isFinite(monthlyRent) || monthlyRent <= 0) return false;
    if (atom.depositPolicy) {
      return calculateDepositFromMonthlyRent(atom.depositPolicy, months, monthlyRent) !== undefined;
    }
    return fixedDeposit !== undefined;
  };
  if (Object.entries(atom.rent).some(([months, rent]) => canPrice(Number(months), rent))) return true;
  return Boolean(atom.rentVariants?.some((item) => canPrice(item.termMonths, item.amount)));
}

/**
 * ERP5 상품 한 대를 만든다. source atom이 행을 주도하며 Google-only 행은 여기로 들어오지 않는다.
 * 상태가 누락되거나 두 원천이 충돌하면 원자는 보존하되 listable=false로 닫는다.
 */
export function composeProductForErp5(input: {
  spec: ProductSourceSpec;
  atom: FreepassAtom;
  adapterIssues?: AdapterIssue[];
  googleProduct?: Record<string, unknown>;
  googleSheetId: string;
  googleSheetTab: string;
  googleSheetGid?: string;
  manualBlockReason?: string;
}): Erp5ProductComposition {
  const plate = cleanPlate(input.atom.plateNumber);
  if (!plate) throw new Error(`${input.spec.name} 원천에 차량번호가 없는 상품은 ERP5에 게시할 수 없습니다.`);
  const id = `${input.spec.partnerCode}_${plate}`;
  const master = input.googleProduct;
  const sourceStatusRaw = cleanText(input.atom.status);
  const sourceStatusCanonical = sourceStatusRaw ? canonSheetVehicleStatus(sourceStatusRaw) : '';
  const googleStatusRaw = cleanText(master?.status_label_raw);
  const googleStatusCanonical = cleanText(master?.vehicle_status)
    || (googleStatusRaw ? canonSheetVehicleStatus(googleStatusRaw) : '');
  const verification = cleanText(master?._product_master_verification);
  const management = cleanText(master?._product_master_management);
  const blockingReasons: string[] = [];
  let statusConflict = false;
  const sourceMaker = canonMakerDisplay(input.atom.maker);
  const googleMaker = canonMakerDisplay(master?.maker);
  const makerConflict = Boolean(sourceMaker && googleMaker && sourceMaker !== googleMaker);
  const isAutoplus = AUTOPLUS_CODES.has(input.spec.code.toUpperCase())
    || AUTOPLUS_CODES.has(input.spec.partnerCode.toUpperCase());

  if (!sourceStatusRaw) blockingReasons.push('SOURCE_STATUS_MISSING');
  if (!master) {
    blockingReasons.push('GOOGLE_MASTER_MISSING');
  } else {
    if (cleanPlate(master.car_number) !== plate
      || cleanText(master.provider_company_code).toUpperCase() !== input.spec.partnerCode.toUpperCase()) {
      blockingReasons.push('GOOGLE_MASTER_IDENTITY_MISMATCH');
    }
    if (makerConflict) blockingReasons.push(`MAKER_CONFLICT:${sourceMaker}:${googleMaker}`);
    if (isAutoplus && makerConflict && isImportBrand(sourceMaker) !== isImportBrand(googleMaker)) {
      blockingReasons.push('AUTOPLUS_DEPOSIT_CLASS_CONFLICT');
    }
    if (verification !== '확정' || master._product_master_identity_authoritative !== true) {
      blockingReasons.push(`GOOGLE_MASTER_NOT_CONFIRMED:${verification || 'blank'}`);
    }
    if (!googleStatusCanonical) blockingReasons.push('GOOGLE_STATUS_MISSING');
    if (sourceStatusCanonical && googleStatusCanonical && sourceStatusCanonical !== googleStatusCanonical) {
      blockingReasons.push(`STATUS_CONFLICT:${sourceStatusCanonical}:${googleStatusCanonical}`);
      statusConflict = true;
    }
    if (management === '검수필요') blockingReasons.push('GOOGLE_MASTER_REVIEW_REQUIRED');
    if (!['운영', '중지'].includes(management)) {
      blockingReasons.push(`GOOGLE_MANAGEMENT_INVALID:${management || 'blank'}`);
    }
  }
  if (input.manualBlockReason) blockingReasons.push(`GOOGLE_MANUAL_BLOCK:${input.manualBlockReason}`);
  for (const issue of input.adapterIssues || []) {
    if (issue.level === 'error') blockingReasons.push(`ADAPTER_ERROR:${issue.code}`);
  }

  // 오토플러스 보증금의 국산/수입 구분은 Google 확정 제조사와 공급사 제조사가
  // 일치할 때만 확정값으로 재계산한다. 충돌한 경우 원자는 보존하되 활성화를 막는다.
  const effectiveAtom = isAutoplus && googleMaker && !makerConflict
    ? { ...input.atom, depositPolicy: resolveAutoplusDepositPolicy(googleMaker) }
    : input.atom;
  const authoritativeVehicleIdentity = master?._vehicle_master_identity
    && typeof master._vehicle_master_identity === 'object'
    ? master._vehicle_master_identity as Record<string, unknown>
    : null;
  const vehicleMasterIdentity = {
    origin: cleanText(authoritativeVehicleIdentity?.origin),
    maker: cleanText(authoritativeVehicleIdentity?.maker),
    model: cleanText(authoritativeVehicleIdentity?.model),
    subModel: cleanText(authoritativeVehicleIdentity?.subModel),
    trim: cleanText(authoritativeVehicleIdentity?.trim) || '기본형',
  };
  const vehicleMasterEntryId = vehicleMasterIdentity.origin && vehicleMasterIdentity.maker
    && vehicleMasterIdentity.model && vehicleMasterIdentity.subModel
    ? erp5VehicleMasterEntryId(vehicleMasterIdentity)
    : '';
  if (!vehicleMasterEntryId) blockingReasons.push('VEHICLE_MASTER_IDENTITY_INCOMPLETE');

  const verificationState: Erp5ProductVerificationState = statusConflict
    ? 'conflict'
    : blockingReasons.length ? 'needs-review' : 'verified';
  const eligibility = evaluateEligibility(
    {
      ...effectiveAtom,
      status: sourceStatusCanonical || undefined,
      maker: cleanText(master?.maker) || input.atom.maker,
      model: cleanText(master?.model) || input.atom.model,
      subModel: cleanText(master?.sub_model) || input.atom.subModel,
      trim: cleanText(master?.trim_name) || input.atom.trim,
    },
    'ERP',
    { supplierEnabled: true, channelEnabled: true },
  );
  const listingReasons = [...eligibility.reasons];
  if (verificationState !== 'verified') listingReasons.push('VERIFICATION_NOT_VERIFIED');
  if (!hasProjectablePrice(effectiveAtom)) listingReasons.push('DEPOSIT_OR_PRICE_MISSING');
  const listable = verificationState === 'verified' && unique(listingReasons).length === 0;

  const candidate: Record<string, unknown> = {
    car_number: plate,
    product_code: id,
    provider_company_code: input.spec.partnerCode,
    partner_code: input.spec.partnerCode,
    provider_name: input.spec.name,
    maker: input.atom.maker,
    model: input.atom.model,
    sub_model: input.atom.subModel,
    trim_name: input.atom.trim,
    supplier_vehicle_name: input.atom.rawName,
    year: input.atom.year,
    mileage: input.atom.km,
    fuel_type: input.atom.fuel,
    engine_cc: input.atom.displacement,
    product_type: input.atom.productType,
  };
  if (master) {
    for (const field of DISPLAY_FIELDS) {
      if (master[field] !== undefined) candidate[field] = master[field];
    }
  }
  if (vehicleMasterEntryId) candidate.vehicle_master_entry_id = vehicleMasterEntryId;
  Object.assign(candidate, {
    // 상태는 Google 값으로 덮지 않는다. 공급사 원천이 실행 상태의 주인이다.
    status_label_raw: sourceStatusRaw,
    vehicle_status: sourceStatusCanonical,
    status: sourceStatusCanonical,
    listable,
    source_status_raw: sourceStatusRaw,
    source_status_canonical: sourceStatusCanonical,
    google_status_raw: googleStatusRaw,
    google_status_canonical: googleStatusCanonical,
    verification_state: verificationState,
    verification_reasons: unique(blockingReasons),
    listing_reasons: unique(listingReasons),
    adapter_issues: (input.adapterIssues || []).map((issue) => ({
      level: issue.level,
      code: issue.code,
      message: issue.message,
      ...(issue.field ? { field: issue.field } : {}),
    })),
    source_evidence: {
      supplierCode: input.spec.code,
      partnerCode: input.spec.partnerCode,
      supplierName: input.spec.name,
      spreadsheetId: input.spec.spreadsheetId,
      tab: input.spec.tab,
      row: input.atom.source.row ?? null,
      adapter: input.atom.source.adapter,
      adapterVersion: input.atom.source.adapterVersion,
      provenance: input.atom.provenance,
    },
    google_reference: {
      spreadsheetId: input.googleSheetId,
      tab: input.googleSheetTab,
      gid: input.googleSheetGid || '',
      row: master?.sheet_source_row ?? null,
      productCode: master?.product_code ?? '',
      verification,
      management,
      trimRowKey: master?.trim_row_key ?? '',
      catalogId: master?.catalog_id ?? '',
      updatedAt: master?._product_master_updated ?? '',
      origin: master?._product_master_origin ?? '',
    },
  });

  const exported = exportProductForErp5(candidate, effectiveAtom);
  return {
    id,
    data: exported.data,
    ignoredFields: exported.ignoredFields,
    verificationState,
    blockingReasons: unique(blockingReasons),
  };
}

function priceDeposit(
  pricing: Record<string, unknown>,
  policy: DepositPolicy | null,
  termMonths: number,
  monthlyRent: number,
): number | undefined {
  if (policy) return calculateDepositFromMonthlyRent(policy, termMonths, monthlyRent);
  const amount = (value: unknown) => {
    if (value === null || value === undefined || value === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  const shortDeposit = amount(pricing.shortDeposit);
  const longDeposit = amount(pricing.longDeposit);
  return termMonths <= 12
    ? (shortDeposit ?? longDeposit)
    : (longDeposit ?? shortDeposit);
}

/** ERP5의 정책 원자를 기존 ERP4 화면용 숫자 price 맵으로 읽기 순간에만 투영한다. */
export function projectErp5ProductForErp4(
  product: Record<string, unknown>,
  documentId = '',
  options: { includeDiagnostics?: boolean } = {},
): Record<string, unknown> {
  const pricing = (product.adapter_pricing && typeof product.adapter_pricing === 'object')
    ? product.adapter_pricing as Record<string, unknown>
    : {};
  const policy = (pricing.depositPolicy && typeof pricing.depositPolicy === 'object')
    ? pricing.depositPolicy as DepositPolicy
    : null;
  const price: Record<string, { rent: number; deposit: number }> = {};
  const put = (key: string, months: number, rawRent: unknown) => {
    const rent = Number(rawRent);
    if (!Number.isFinite(rent) || rent <= 0) return;
    const deposit = priceDeposit(pricing, policy, months, rent);
    if (deposit === undefined) return;
    price[key] = { rent: Math.round(rent), deposit: Math.round(deposit) };
  };
  const rent = (pricing.rent && typeof pricing.rent === 'object')
    ? pricing.rent as Record<string, unknown>
    : {};
  for (const [months, amount] of Object.entries(rent)) put(String(Number(months)), Number(months), amount);
  const variants = Array.isArray(pricing.rentVariants) ? pricing.rentVariants : [];
  for (const raw of variants) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const months = Number(item.termMonths);
    const annualKm = Number(item.annualKm);
    const key = Number.isFinite(annualKm) && annualKm > 0
      ? `${months}_${annualKm / 10_000}만`
      : String(months);
    put(key, months, item.amount);
  }
  const productCode = cleanText(product.product_code) || documentId;
  const projected: Record<string, unknown> = { ...product };
  if (!options.includeDiagnostics) {
    for (const field of [
      'source_evidence',
      'google_reference',
      'adapter_issues',
      'verification_reasons',
      'listing_reasons',
      'source_status_raw',
      'source_status_canonical',
      'google_status_raw',
      'google_status_canonical',
    ]) delete projected[field];
  }
  return {
    ...projected,
    _key: productCode,
    product_code: productCode,
    vehicle_status: cleanText(product.source_status_canonical) || cleanText(product.vehicle_status),
    status_label_raw: cleanText(product.source_status_raw) || cleanText(product.status_label_raw),
    price,
  };
}

export function productPublicFieldNames(): string[] {
  return [...PUBLIC_PRODUCT_FIELDS].sort();
}
