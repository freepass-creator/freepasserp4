'use client';

import type { EntityRecord } from '@/lib/intake/entities';
import { ROLE_LABEL_RAW } from '@/lib/intake/entities';
import { ACTOR_TONE, Badge, C, CenterNote, ListRow, PillTabs } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import type { MemberTab } from './member-filter';

const ROLE_LABEL: Record<string, string> = ROLE_LABEL_RAW;

export function MembersList({ tab, rows, selected, filtered, onTab, onSelect }: {
  tab: MemberTab;
  rows: EntityRecord[];
  selected: string | null;
  filtered: boolean;
  onTab: (tab: MemberTab) => void;
  onSelect: (row: EntityRecord) => void;
}) {
  return (
    <>
      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${C.line}`, background: C.head, flex: '0 0 auto' }}>
        <PillTabs tabs={[{ key: 'user', label: '사용자' }, { key: 'partner', label: '파트너' }]} value={tab} onChange={onTab} size="sm" />
      </div>
      {!rows.length ? <CenterNote>{filtered ? '검색 결과 없음' : '없음 — 신규로 추가'}</CenterNote> : (
        <div>{rows.map((row) => {
          const pending = tab === 'user' && String(row.status || '') === 'pending';
          const role = String(row.role || '');
          const sub = tab === 'user'
            ? `${ROLE_LABEL[role] || role} · ${row.is_active === '아니오' ? '비활성' : '활성'}`
            : `${String(row.partner_type || '')} · 수수료 ${row.fee_rate != null ? `${Math.round(Number(row.fee_rate) * 100)}%` : '기본'}`;
          return (
            <ListRow
              key={String(row._key)}
              selected={String(row._key) === selected}
              onClick={() => { haptic.tap(); onSelect(row); }}
              main={String(row.name || row.user_code || row.partner_code || '—')}
              sub={sub}
              right={tab === 'user' ? (
                pending
                  ? <Badge tone="amber" variant="solid">승인대기</Badge>
                  : <Badge tone={ACTOR_TONE[role] || (role.startsWith('agent') ? 'blue' : 'gray')}>{ROLE_LABEL[role] || ''}</Badge>
              ) : undefined}
            />
          );
        })}</div>
      )}
    </>
  );
}
