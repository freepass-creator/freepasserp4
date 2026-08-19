import type { EntityRecord } from '@/lib/intake/entities';
import { matchMemberQuery } from '@/lib/domain/search';
import { partnerTypeLabel, UNCLASSIFIED_PARTNER_TYPE } from '@/lib/domain/partner';

export type MemberTab = 'user' | 'partner';
export type MemberSort = 'name' | 'role' | 'code';
export type MemberActiveFilter = 'all' | 'active' | 'inactive' | 'pending';
export type MemberRoleGroup = 'all' | 'sales' | 'provider';

export const MEMBER_SORT_OPTIONS: { value: MemberSort; label: string }[] = [
  { value: 'name', label: '이름순' },
  { value: 'role', label: '역할순' },
  { value: 'code', label: '코드순' },
];

export const MEMBER_ACTIVE_OPTIONS: { key: MemberActiveFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'active', label: '활성' },
  { key: 'inactive', label: '비활성' },
  { key: 'pending', label: '승인대기' },
];

export const MEMBER_ROLE_OPTIONS = [
  { key: 'all', label: '전체' },
  { key: 'sales', label: '영업자' },
  { key: 'provider', label: '공급사 직원' },
];

export const MEMBER_PARTNER_TYPE_OPTIONS = [
  { key: 'all', label: '전체' },
  { key: '공급사', label: '공급사' },
  { key: '영업채널', label: '영업채널' },
  { key: UNCLASSIFIED_PARTNER_TYPE, label: UNCLASSIFIED_PARTNER_TYPE },
];

/**
 * 목록 축 — 역할이 아님.
 * 회원 = 사람(users: 영업자·공급사 직원) / 파트너사 = 회사(partners: 영업채널·공급사).
 * 필드·저장 노드가 달라 한 목록에 섞지 않는다.
 */
export const MEMBER_TAB_OPTIONS: { key: MemberTab; label: string }[] = [
  { key: 'user', label: '회원' },
  { key: 'partner', label: '파트너사' },
];

export function memberRoleGroup(role: unknown): Exclude<MemberRoleGroup, 'all'> | 'operator' | 'unknown' {
  const value = String(role || '').trim();
  if (value.startsWith('agent')) return 'sales';
  if (value.startsWith('provider')) return 'provider';
  if (value === 'admin') return 'operator';
  return 'unknown';
}

export const PERSONAL_AGENT_COMPANY = 'SP999';
export const PERSONAL_AGENT_NAME = '개인 영업자';
export const PERSONAL_AGENT_LABEL = '개인영업자';

export function isPersonalAgent(role: unknown, companyCode?: unknown): boolean {
  if (memberRoleGroup(role) !== 'sales') return false;
  const company = String(companyCode || '').trim();
  return !company || company === PERSONAL_AGENT_COMPANY;
}

export function memberTypeLabel(role: unknown, companyCode?: unknown): string {
  if (isPersonalAgent(role, companyCode)) return PERSONAL_AGENT_LABEL;
  const group = memberRoleGroup(role);
  if (group === 'sales') return '영업자';
  if (group === 'provider') return '공급사 직원';
  if (group === 'operator') return '운영자';
  return '분류 필요';
}

/** 인증 게이트와 같은 계정 상태 판정 — boolean false·삭제·반려도 활성으로 보이면 안 된다. */
export function memberAccountState(row: EntityRecord): Exclude<MemberActiveFilter, 'all'> {
  const status = String(row.status || '').trim();
  if (status === 'pending') return 'pending';
  const active = String(row.is_active ?? '').trim().toLowerCase();
  return active === '아니오' || active === 'false' || status === 'deleted' || status === 'rejected'
    ? 'inactive'
    : 'active';
}

type Params = {
  rows: EntityRecord[];
  tab: MemberTab;
  query: string;
  sort: MemberSort | '';
  role: MemberRoleGroup;
  active: MemberActiveFilter;
  partnerType: string;
};

export function filterMembers(params: Params): EntityRecord[] {
  return params.rows
    .filter((row) => matchMemberQuery(row, params.query))
    .filter((row) => {
      if (params.tab === 'user') {
        if (params.role !== 'all' && memberRoleGroup(row.role) !== params.role) return false;
        const displayState = memberAccountState(row);
        if (params.active !== 'all' && displayState !== params.active) return false;
      } else if (
        params.partnerType !== 'all'
        && partnerTypeLabel(row.partner_type, row.partner_code || row._key) !== params.partnerType
      ) {
        return false;
      }
      return true;
    })
    .slice()
    .sort((a, b) => {
      const aPending = params.tab === 'user' && String(a.status || '') === 'pending' ? 0 : 1;
      const bPending = params.tab === 'user' && String(b.status || '') === 'pending' ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      if (!params.sort) return 0;
      if (params.sort === 'code') {
        const aCode = params.tab === 'user' ? String(a.user_code || a.uid || '') : String(a.partner_code || '');
        const bCode = params.tab === 'user' ? String(b.user_code || b.uid || '') : String(b.partner_code || '');
        return aCode.localeCompare(bCode, 'ko');
      }
      if (params.sort === 'role') {
        const aRole = params.tab === 'user'
          ? memberTypeLabel(a.role, a.company_code)
          : partnerTypeLabel(a.partner_type, a.partner_code || a._key);
        const bRole = params.tab === 'user'
          ? memberTypeLabel(b.role, b.company_code)
          : partnerTypeLabel(b.partner_type, b.partner_code || b._key);
        return aRole.localeCompare(bRole, 'ko') || String(a.name || '').localeCompare(String(b.name || ''), 'ko');
      }
      return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
    });
}

export function pendingMemberCount(rows: EntityRecord[], tab: MemberTab): number {
  return tab === 'user' ? rows.filter((row) => String(row.status || '') === 'pending').length : 0;
}
