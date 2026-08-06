'use client';

import React, { useMemo, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { BottomSheet } from '../BottomSheet';
import { Select, SearchInput } from './form-controls';
import { C, FS, FW, R, SH, ctrlH, ctrlInputFs, ICON } from './tokens';

type Option = string | { value: string; label: string };

function optValue(o: Option): string {
  return typeof o === 'string' ? o : o.value;
}
function optLabel(o: Option): string {
  return typeof o === 'string' ? o : o.label;
}

/** 불리언 토글 — 트랙+노브. haptic.select 내장. */
export function Switch({
  checked,
  onChange,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={title}
      title={title}
      disabled={disabled}
      className="fp-press"
      onClick={() => {
        if (disabled) return;
        haptic.select();
        onChange(!checked);
      }}
      style={{
        position: 'relative',
        width: 51,
        height: 31,
        flex: '0 0 auto',
        padding: 0,
        border: 'none',
        borderRadius: 16,
        background: disabled ? C.line2 : checked ? C.brand : C.line2,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background .15s ease',
        boxSizing: 'border-box',
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 22 : 2,
          width: 27,
          height: 27,
          borderRadius: '50%',
          background: C.taupeBg,
          boxShadow: SH.cardRest,
          transition: 'left .15s ease',
          boxSizing: 'border-box',
        }}
      />
    </button>
  );
}

/** SheetSelect 옵션 행 — 44px급(minHeight ctrlH)·선택 시 체크. */
export function RadioRow({
  label,
  selected,
  onSelect,
  disabled,
}: {
  label: React.ReactNode;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  const mobile = useIsMobile();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      className="fp-press"
      onClick={() => {
        if (disabled) return;
        haptic.select();
        onSelect();
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        minHeight: ctrlH(true),
        padding: mobile ? '0 16px' : '0 12px',
        boxSizing: 'border-box',
        border: 'none',
        borderBottom: `1px solid ${C.line2}`,
        background: selected ? C.selected : 'transparent',
        color: C.ink,
        cursor: disabled ? 'default' : 'pointer',
        textAlign: 'left',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span style={{
        flex: 1,
        minWidth: 0,
        fontSize: FS.body,
        fontWeight: selected ? FW.strong : FW.body,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      {selected ? <Check size={ICON.lg} strokeWidth={2.4} color={C.brand} aria-hidden style={{ flex: '0 0 auto' }} /> : null}
    </button>
  );
}

/**
 * 선택 컨트롤 — 웹=기존 Select, 모바일=BottomSheet + RadioRow.
 * searchable면 시트 상단 검색.
 */
export function SheetSelect({
  value,
  onChange,
  options,
  groups,
  placeholder = '선택',
  searchable,
  size = 'md',
  width,
  full,
  disabled,
  style,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  options?: Option[];
  groups?: { label: string; options: Option[] }[];
  placeholder?: string;
  searchable?: boolean;
  size?: 'sm' | 'md';
  width?: number;
  full?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
  /** 시트 제목(미지정 시 placeholder) */
  title?: string;
}) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const flat = useMemo(() => {
    if (groups?.length) return groups.flatMap((g) => g.options);
    return options || [];
  }, [groups, options]);

  const selectedLabel = useMemo(() => {
    const hit = flat.find((o) => optValue(o) === value);
    return hit ? optLabel(hit) : '';
  }, [flat, value]);

  if (!mobile) {
    return (
      <Select
        value={value}
        onChange={onChange}
        options={options}
        groups={groups}
        placeholder={placeholder}
        size={size}
        width={width}
        full={full}
        disabled={disabled}
        style={style}
      />
    );
  }

  const needle = q.trim().toLowerCase();
  const filtered = !searchable || !needle
    ? flat
    : flat.filter((o) => optLabel(o).toLowerCase().includes(needle) || optValue(o).toLowerCase().includes(needle));

  const showSearch = searchable ?? flat.length > 8;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        className="fp-press"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          haptic.tap();
          setQ('');
          setOpen(true);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: ctrlH(mobile, size),
          boxSizing: 'border-box',
          padding: '0 12px',
          border: `1px solid ${C.line}`,
          borderRadius: R,
          fontSize: ctrlInputFs(mobile, size),
          background: disabled ? C.head : C.taupeBg,
          color: selectedLabel ? C.ink : C.faint,
          cursor: disabled ? 'default' : 'pointer',
          textAlign: 'left',
          opacity: disabled ? 0.85 : 1,
          ...(full ? { width: '100%' } : width ? { width } : { width: 'max-content', maxWidth: '100%' }),
          ...style,
        }}
      >
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDown size={ICON.md} strokeWidth={2.2} color={C.faint} aria-hidden style={{ flex: '0 0 auto' }} />
      </button>
      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title={title || placeholder}
        footer="std"
        pad={false}
        maxHeight="min(62vh, 560px)"
      >
        {showSearch ? (
          <div style={{ padding: '10px 14px 8px', borderBottom: `1px solid ${C.line2}` }}>
            <SearchInput value={q} onChange={setQ} placeholder="검색" full autoFocus />
          </div>
        ) : null}
        <div role="listbox" style={{ overflowY: 'auto', maxHeight: showSearch ? 'min(46vh, 420px)' : 'min(52vh, 480px)' }}>
          {placeholder != null ? (
            <RadioRow
              label={<span style={{ color: C.faint }}>{placeholder}</span>}
              selected={value === ''}
              onSelect={() => { onChange(''); setOpen(false); }}
            />
          ) : null}
          {filtered.length ? filtered.map((o) => {
            const v = optValue(o);
            return (
              <RadioRow
                key={v}
                label={optLabel(o)}
                selected={value === v}
                onSelect={() => { onChange(v); setOpen(false); }}
              />
            );
          }) : (
            <div style={{ padding: '16px 14px', fontSize: FS.sub, color: C.faint }}>검색 결과 없음</div>
          )}
        </div>
      </BottomSheet>
    </>
  );
}
