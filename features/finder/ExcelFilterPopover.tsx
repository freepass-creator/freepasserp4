'use client';

import { useMemo, useState } from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import { excelPopEntries, type PopEntry } from '@/lib/domain/excel-col-filter';
import { excelColumnValues, isNumericExcelColumn, type ColSort } from './excel-columns';
import { Btn, C, FS, FW, ICON, NUM, R, SearchInput, SH } from '@/components/ui';
import { Check } from 'lucide-react';

type Props = {
  field: string;
  x: number;
  y: number;
  rows: EntityRecord[];
  colFilter: Record<string, Set<string>>;
  setColFilter: (filter: Record<string, Set<string>>) => void;
  colSort: ColSort;
  setColSort: (sort: ColSort) => void;
  onClose: () => void;
};

export function ExcelFilterPopover({
  field, x, y, rows, colFilter, setColFilter, colSort, setColSort, onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const entries = useMemo((): PopEntry[] => {
    const preset = excelPopEntries(field, rows);
    if (preset) return preset;
    const counts = new Map<string, number>();
    rows.forEach((product) => {
      for (const value of excelColumnValues(product, field)) {
        counts.set(value, (counts.get(value) || 0) + 1);
      }
    });
    return [...counts.entries()]
      .map(([key, count]) => ({ key, label: key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'ko'));
  }, [rows, field]);

  const selected = colFilter[field] || new Set<string>();
  const toggleValue = (value: string) => {
    const nextSelected = new Set(selected);
    nextSelected.has(value) ? nextSelected.delete(value) : nextSelected.add(value);
    const nextFilter = { ...colFilter };
    if (nextSelected.size) nextFilter[field] = nextSelected;
    else delete nextFilter[field];
    setColFilter(nextFilter);
  };
  const clear = () => {
    const nextFilter = { ...colFilter };
    delete nextFilter[field];
    setColFilter(nextFilter);
  };
  const toggleSort = (dir: 'asc' | 'desc') => {
    setColSort(colSort?.field === field && colSort.dir === dir ? null : { field, dir });
  };
  const isSort = (dir: string) => colSort?.field === field && colSort.dir === dir;
  const normalizedQuery = query.toLowerCase();
  const shown = entries.filter((entry) => !query
    || entry.label.toLowerCase().includes(normalizedQuery)
    || entry.key.toLowerCase().includes(normalizedQuery));
  const canSort = isNumericExcelColumn(field);
  const rowStyle = {
    padding: '6px 10px', fontSize: FS.sub, cursor: 'pointer' as const,
    display: 'flex', alignItems: 'center', gap: 8, border: 'none',
    background: 'transparent', width: '100%', boxSizing: 'border-box' as const,
    textAlign: 'left' as const, fontFamily: 'inherit',
  };
  const checkbox = (on: boolean) => (
    <span
      aria-hidden
      style={{
        flex: '0 0 auto', width: 14, height: 14, boxSizing: 'border-box',
        borderRadius: R, border: `1.5px solid ${on ? C.brand : C.line}`,
        background: on ? C.brand : C.taupeBg, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', color: C.taupeBg,
        fontSize: 10, fontWeight: FW.head, lineHeight: 1,
      }}
    >{on ? <Check size={ICON.sm} aria-hidden /> : null}</span>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90 }} />
      <div style={{
        position: 'fixed', top: y + 2,
        left: Math.max(6, Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 226)),
        width: 220, background: C.taupeBg, border: `1px solid ${C.line}`, borderRadius: R,
        boxShadow: SH.menu, zIndex: 91,
        textAlign: 'left', fontWeight: FW.body,
      }}>
        {canSort && (
          <div style={{ display: 'flex', borderBottom: `1px solid ${C.line2}` }}>
            {(['asc', 'desc'] as const).map((dir) => (
              <Btn
                key={dir}
                variant="bare"
                onClick={() => toggleSort(dir)}
                style={{
                  ...rowStyle, flex: 1, justifyContent: 'center', fontWeight: FW.strong,
                  color: isSort(dir) ? C.brand : C.mute,
                  background: isSort(dir) ? C.selected : 'transparent',
                }}
              >{dir === 'asc' ? '↑ 오름' : '↓ 내림'}</Btn>
            ))}
          </div>
        )}
        <div style={{ padding: '6px 8px', borderBottom: `1px solid ${C.line2}` }}>
          <SearchInput value={query} onChange={setQuery} placeholder="검색…" full />
        </div>
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {shown.length === 0 ? (
            <div style={{ ...rowStyle, color: C.faint, cursor: 'default' }}>값 없음</div>
          ) : shown.map((entry) => {
            const on = selected.has(entry.key);
            return (
              <Btn
                key={entry.key}
                variant="bare"
                onClick={() => toggleValue(entry.key)}
                aria-pressed={on}
                style={{
                  ...rowStyle, background: on ? C.selected : 'transparent',
                  color: C.ink, fontWeight: FW.body,
                }}
              >
                {checkbox(on)}
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.label}</span>
                <span style={{ flex: '0 0 auto', fontFamily: NUM, fontVariantNumeric: 'tabular-nums', color: C.faint, fontSize: FS.cap }}>{entry.count}</span>
              </Btn>
            );
          })}
        </div>
        <div style={{ display: 'flex', borderTop: `1px solid ${C.line2}` }}>
          <Btn variant="bare" onClick={clear} style={{ ...rowStyle, flex: 1, justifyContent: 'center', color: C.mute }}>
            초기화
          </Btn>
          <Btn
            variant="bare"
            onClick={onClose}
            style={{
              ...rowStyle, flex: 1, justifyContent: 'center', color: C.brand,
              fontWeight: FW.strong, borderLeft: `1px solid ${C.line2}`,
            }}
          >
            닫기
          </Btn>
        </div>
      </div>
    </>
  );
}
