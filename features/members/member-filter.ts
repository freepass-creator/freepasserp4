import type { EntityRecord } from '@/lib/intake/entities';
import { ROLES, ROLE_LABEL_RAW } from '@/lib/intake/entities';
import { matchMemberQuery } from '@/lib/domain/search';

export type MemberTab = 'user' | 'partner';
export type MemberSort = 'name' | 'role' | 'code';
export type MemberActiveFilter = 'all' | 'active' | 'inactive' | 'pending';

export const MEMBER_SORT_OPTIONS: { value: MemberSort; label: string }[] = [
  { value: 'name', label: '이름순' },
  { value: 'role', label: '역할순' },
  { value: 'code', label: '코드순' },
];

export const MEMBER_ACTIVE_OPTIONS: { key: MemberActiveFilter; label: string }[] = [
  { key: 'all', label: '전체' },
  { key: 'active', label: '활성' },
  { key: 'inactive', label: '비활성' },
];

export const MEMBER_ROLE_OPTIONS = [
  { key: 'all', label: '전체' },
  ...ROLES.map((role) => ({ key: role, label: ROLE_LABEL_RAW[role] })),
];

export const MEMBER_PARTNER_TYPE_OPTIONS = [
  { key: 'all', label: '전체' },
  { key: '공급사', label: '공급사' },
  { key: '채널', label: '채널' },
];

type Params = {
  rows: EntityRecord[];
  tab: MemberTab;
  query: string;
  sort: MemberSort | '';
  role: string;
  active: MemberActiveFilter;
  partnerType: string;
};

export function filterMembers(params: Params): EntityRecord[] {
  return params.rows
    .filter((row) => matchMemberQuery(row, params.query))
    .filter((row) => {
      if (params.tab === 'user') {
        if (params.role !== 'all' && String(row.role || '') !== params.role) return false;
        if (params.active === 'active' && row.is_active === '아니오') return false;
        if (params.active === 'inactive' && row.is_active !== '아니오') return false;
        if (params.active === 'pending' && String(row.status || '') !== 'pending') return false;
      } else if (params.partnerType !== 'all' && String(row.partner_type || '') !== params.partnerType) {
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
        const aRole = params.tab === 'user' ? String(a.role || '') : String(a.partner_type || '');
        const bRole = params.tab === 'user' ? String(b.role || '') : String(b.partner_type || '');
        return aRole.localeCompare(bRole, 'ko') || String(a.name || '').localeCompare(String(b.name || ''), 'ko');
      }
      return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
    });
}

export function pendingMemberCount(rows: EntityRecord[], tab: MemberTab): number {
  return tab === 'user' ? rows.filter((row) => String(row.status || '') === 'pending').length : 0;
}
