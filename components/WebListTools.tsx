'use client';

import type { ListToolsConfig } from '@/components/MobilePageShell';
import { Btn, C, FS, FW, SearchInput, Select } from '@/components/ui';

/**
 * 데스크톱 목록 도구 SSOT.
 * WorkPage와 일반 Page가 같은 검색 → 정렬 → 필터 → 적용조건 순서를 공유한다.
 */
export function WebListTools({ tools }: { tools?: ListToolsConfig }) {
  if (!tools) return null;

  const search = tools.search;
  const sort = tools.sort;
  const filter = tools.filter;
  const hasPrimary = !!(search || sort || filter);
  if (!hasPrimary && !tools.hints?.length) return null;

  return (
    <div style={{ flex: '0 0 auto', borderBottom: `1px solid ${C.line2}` }}>
      {hasPrimary ? (
        <>
          <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {search ? (
              <SearchInput
                value={search.value}
                onChange={search.onChange}
                placeholder={search.placeholder || '검색'}
                full
                style={{ flex: '1 1 160px', minWidth: 0 }}
              />
            ) : <span style={{ flex: 1, minWidth: 0 }} />}
            {sort ? (
              <Select
                size="md"
                value={sort.value}
                onChange={sort.onChange}
                ariaLabel={sort.placeholder || '정렬'}
                placeholder={sort.placeholder || '정렬'}
                options={[
                  { value: '', label: '기본' },
                  ...sort.options.map((option) => ({ value: option.value, label: option.label })),
                ]}
                width={118}
              />
            ) : null}
          </div>
          {filter ? (
            <div style={{ padding: '0 12px 10px' }}>
              {filter.body}
              {filter.count > 0 && filter.onClear ? (
                <div style={{ marginTop: 8 }}>
                  <Btn size="sm" variant="ghost" haptic="select" onClick={() => filter.onClear?.()}>필터 해제</Btn>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      {tools.hints && tools.hints.length > 0 ? (
        <div style={{
          padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
          fontSize: FS.sub, color: C.mute, minWidth: 0,
        }}>
          <span style={{ flex: '0 0 auto', fontWeight: FW.head, color: C.faint }}>적용</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tools.hints.join(' · ')}
          </span>
          {tools.onClearHints ? (
            <Btn size="sm" variant="ghost" haptic="select" onClick={() => tools.onClearHints?.()}>해제</Btn>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

