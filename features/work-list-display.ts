import type { EntityRecord } from '@/lib/intake/entities';
import type { OrganizationRole } from '@/lib/domain/authorization';
import { isOpaqueIdentity, safeBusinessCode } from '@/lib/domain/work-identity';

export { isOpaqueIdentity, isSafeBusinessCode, safeBusinessCode } from '@/lib/domain/work-identity';

export function compactTextParts(values: unknown[]): string[] {
  return values
    .filter((value) => value !== null && value !== undefined && value !== false)
    .map((value) => String(value ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function joinMetaText(values: unknown[]): string {
  return compactTextParts(values).join(' · ');
}

function visibleName(values: unknown[], identityValues: unknown[]): string {
  const identities = new Set(compactTextParts(identityValues));
  return compactTextParts(values).find((candidate) => (
    !isOpaqueIdentity(candidate) && !identities.has(candidate)
  )) || '';
}

function agentLabel(record: EntityRecord, fallback?: EntityRecord, preferCode = false): string {
  const identities = [record.agent_uid, fallback?.agent_uid, record.agent_code, fallback?.agent_code];
  // 마지막 발신자는 공유 채널의 응대자일 수 있어 계약 담당자 fallback으로 쓰지 않는다.
  const name = visibleName([record.agent_name, fallback?.agent_name], identities);
  const code = [
    safeBusinessCode(record.agent_code, record.agent_uid),
    safeBusinessCode(fallback?.agent_code, fallback?.agent_uid),
  ]
    .find(Boolean);
  // preferCode = 목록에 사람 이름 대신 업무코드를 노출한다(개인정보 축소).
  // 코드가 없으면 이름으로 떨어진다 — 상대가 누구인지 아예 모르는 상태보다 낫다.
  if (preferCode) return code || name || '담당자 미확인';
  return name || code || '담당자 미확인';
}

function providerLabel(record: EntityRecord, resolved?: string): string {
  const identities = [record.provider_uid, record.provider_company_code, record.partner_code];
  const name = visibleName([
    resolved,
    record.provider_name,
    record.provider_company_name,
    record.partner_name,
  ], identities);
  if (name) return name;
  const code = [
    safeBusinessCode(record.provider_company_code, record.provider_uid),
    safeBusinessCode(record.partner_code, record.provider_uid),
  ]
    .find(Boolean);
  return code || '공급사 미확인';
}

/**
 * 목록의 상대방 슬롯 SSOT. 권한 판정에는 쓰지 않고 이미 허용된 행의 표시만 바꾼다.
 * 일반 구성원에게 자기 조직/자기 이름은 반복하지 않고, 조직 관리자는 담당자를 함께 본다.
 */
export function workPartyParts(
  role: OrganizationRole | null,
  record: EntityRecord,
  options: { agentFallback?: EntityRecord; providerName?: string; preferCode?: boolean } = {},
): string[] {
  const agent = agentLabel(record, options.agentFallback, options.preferCode);
  const provider = providerLabel(record, options.providerName);
  if (role === 'agent') return [provider];
  if (role === 'provider' || role === 'provider_admin') return [agent];
  if (role === 'agent_admin' || role === 'admin') return [provider, agent];
  return [provider];
}

/** 필터·검색 뒤에도 실제 목록에 남아 있는 선택만 유지한다. */
export function retainVisibleSelection(
  selected: string | null,
  visibleKeys: readonly string[],
): string | null {
  if (!selected) return null;
  return visibleKeys.includes(selected) ? selected : null;
}
