import type { EntityRecord } from '@/lib/intake/entities';
import { ID_PREFIX, type IdKind, isId } from '@/lib/domain/ids';

/** Store 엔티티와 ERP5 내부코드 종류의 단일 매핑. 인증 UID와 공개 토큰은 포함하지 않는다. */
export const ENTITY_ID_KIND = {
  product: 'product',
  policy: 'policy',
  partner: 'partner',
  user: 'user',
  customer: 'customer',
  room: 'room',
  message: 'message',
  quote: 'quote',
  contract: 'contract',
  settlement: 'settlement',
  report: 'report',
  audit_log: 'audit',
} as const satisfies Record<string, IdKind>;

export type CodedEntity = keyof typeof ENTITY_ID_KIND;

export const ENTITY_CODE_FIELD: Record<CodedEntity, string> = {
  product: 'product_code',
  policy: 'policy_code',
  partner: 'partner_code',
  user: 'user_code',
  customer: 'customer_code',
  room: 'room_code',
  message: 'message_code',
  quote: 'quote_code',
  contract: 'contract_code',
  settlement: 'settlement_code',
  report: 'report_code',
  audit_log: 'audit_code',
};

const text = (value: unknown) => String(value ?? '').trim();

function aliasesFrom(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === 'string') return [text(item)];
      if (item && typeof item === 'object') return [text((item as Record<string, unknown>).code)];
      return [];
    }).filter(Boolean);
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, item]) => [text(key), text(item)])
      .filter(Boolean);
  }
  return text(value) ? [text(value)] : [];
}

/**
 * 현재 표준코드와 기존코드 별칭을 모두 모은다.
 * `_key`는 RTDB 저장키·Firebase UID로 직접 조회하는 기존 경로를 보존하기 위해 포함할 뿐,
 * `canonicalEntityCode`가 표준코드로 판정하지 않으면 신규 업무코드로 간주하지 않는다.
 */
export function entityCodeAliases(entity: string, record: EntityRecord): string[] {
  const kind = ENTITY_ID_KIND[entity as CodedEntity];
  const field = ENTITY_CODE_FIELD[entity as CodedEntity];
  if (!kind || !field) return [text(record._key)].filter(Boolean);
  const values = [
    text(record[field]),
    text(record.canonical_code),
    text(record.erp_code),
    text(record._key),
    text(record.legacy_code),
    text(record[`legacy_${field}`]),
    ...aliasesFrom(record.legacy_codes),
    ...aliasesFrom(record.code_aliases),
  ];
  return [...new Set(values.filter(Boolean))];
}

export function matchesEntityCode(entity: string, record: EntityRecord, input: unknown): boolean {
  const wanted = text(input);
  return !!wanted && entityCodeAliases(entity, record).includes(wanted);
}

export function canonicalEntityCode(entity: string, record: EntityRecord): string {
  const kind = ENTITY_ID_KIND[entity as CodedEntity];
  if (!kind) return '';
  return entityCodeAliases(entity, record).find((code) => isId(kind, code)) || '';
}

export function codePrefixForEntity(entity: string): string {
  const kind = ENTITY_ID_KIND[entity as CodedEntity];
  return kind ? ID_PREFIX[kind] : '';
}
