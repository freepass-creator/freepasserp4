/**
 * ERP4 Firestore 상품 원자를 ERP5 상품 SSOT로 내보낼 때의 공개 필드 계약.
 *
 * 이 모듈은 값을 정규화하지 않는다. 기존 상품 원장의 값을 그대로 복사하되,
 * 개인정보·계약·정산·공급사 수수료 필드는 경계에서 제거한다.
 */
import type { FreepassAtom } from './supplier-adapter';
import { resolveAutoplusDepositPolicy, SONOGONG_DEPOSIT_POLICY } from './deposit-policy';

export type ExportedProduct = Record<string, unknown>;

export type ProductExportResult = {
  data: ExportedProduct;
  ignoredFields: string[];
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
  'price',
  'mileage',
  'policy_code',
  'product_code',
  'product_type',
  'provider_company_code',
  'partner_code',
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
]);

const PRIVATE_PRICE_KEY = /(?:fee|commission|margin|cost|수수료|커미션|마진|원가|공급가)/i;

const PRIVATE_KEY = /^(?:customer(?:_.*)?|client(?:_.*)?|consult(?:ation)?(?:_.*)?|contract(?:_.*)?|renter(?:_.*)?|driver(?:_.*)?|representative(?:_.*)?|employee(?:_.*)?|user(?:_.*)?|phone|phone_number|mobile|tel|telephone|email|birth|birthday|resident(?:_.*)?|rrn|address|account_number|bank_account|bank_name|vin|chassis(?:_.*)?|attachment(?:_.*)?|consent(?:_.*)?|signature(?:_.*)?|created_by|updated_by|locked_by_contract|고객(?:_.*)?|계약자(?:_.*)?|성명|이름|전화(?:번호)?|휴대폰|연락처|이메일|생년월일|주민(?:등록번호)?|주소|계좌(?:번호)?|은행(?:명)?|차대번호|첨부(?:파일)?|동의|서명)$/i;

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

const hasPrivateKey = (key: string) => PRIVATE_KEY.test(key.trim());
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

export function productPublicFieldNames(): string[] {
  return [...PUBLIC_PRODUCT_FIELDS].sort();
}
