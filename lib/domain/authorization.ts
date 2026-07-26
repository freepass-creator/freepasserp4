/**
 * 조직 기반 권한 SSOT.
 *
 * 화면용 3역할(agent/provider/admin)은 기존 UI 호환을 위해 유지하고,
 * 실제 데이터 범위·관리 권한은 Session.rawRole과 조직 코드로 판정한다.
 * 역할 부여 UI는 별도 후속 작업이며 이 모듈은 판정만 담당한다.
 */
import type { Session } from '@/lib/auth-session';

export type OrganizationRole =
  | 'admin'
  | 'agent_admin'
  | 'agent'
  | 'provider_admin'
  | 'provider';

export type AccessScope =
  | { kind: 'platform' }
  | { kind: 'agent_channel'; code: string }
  | { kind: 'agent_self'; uid: string; code: string }
  | { kind: 'provider_company'; code: string }
  | { kind: 'none' };

/** 레거시 agent_manager는 영업채널 관리자로 취급한다. 알 수 없는 영업 역할은 최소권한 agent. */
export function organizationRole(session: Session | null): OrganizationRole | null {
  if (!session) return null;
  const raw = String(session.rawRole || session.role || '');
  if (raw === 'admin') return 'admin';
  if (raw === 'agent_admin' || raw === 'agent_manager') return 'agent_admin';
  if (raw === 'provider_admin') return 'provider_admin';
  if (raw === 'provider') return 'provider';
  return 'agent';
}

export function isPlatformAdmin(session: Session | null): boolean {
  return organizationRole(session) === 'admin';
}

export function isAgentOrgAdmin(session: Session | null): boolean {
  return organizationRole(session) === 'agent_admin';
}

export function isProviderOrgAdmin(session: Session | null): boolean {
  return organizationRole(session) === 'provider_admin';
}

export function isProviderMember(session: Session | null): boolean {
  const role = organizationRole(session);
  return role === 'provider' || role === 'provider_admin';
}

export function accessScope(session: Session | null): AccessScope {
  const role = organizationRole(session);
  if (!session || !role) return { kind: 'none' };
  if (role === 'admin') return { kind: 'platform' };
  if (role === 'agent_admin') {
    const code = String(session.agent_channel_code || '').trim();
    return code ? { kind: 'agent_channel', code } : { kind: 'none' };
  }
  if (role === 'agent') {
    const uid = String(session.uid || '').trim();
    const code = String(session.user_code || session.code || '').trim();
    return uid ? { kind: 'agent_self', uid, code } : { kind: 'none' };
  }
  const code = String(session.company_code || '').trim();
  return code ? { kind: 'provider_company', code } : { kind: 'none' };
}

export function canAccessOwnedRecord(
  session: Session | null,
  record: Record<string, unknown>,
): boolean {
  const scope = accessScope(session);
  if (scope.kind === 'platform') return true;
  if (scope.kind === 'agent_channel') {
    return String(record.agent_channel_code || '') === scope.code;
  }
  if (scope.kind === 'agent_self') {
    const ownerUid = String(record.agent_uid || '');
    if (ownerUid) return ownerUid === scope.uid;
    return !!scope.code && String(record.agent_code || '') === scope.code;
  }
  if (scope.kind === 'provider_company') {
    return String(record.provider_company_code || '') === scope.code;
  }
  return false;
}

/** 조직 관리자에게만 추가되는 고위험 조직 작업. 공급사 일상 재고·계약 처리는 일반 직원도 가능하다. */
export function canManageOrganization(session: Session | null): boolean {
  const role = organizationRole(session);
  return role === 'admin' || role === 'agent_admin' || role === 'provider_admin';
}

export function canFinalizeSettlement(session: Session | null): boolean {
  return isPlatformAdmin(session);
}
