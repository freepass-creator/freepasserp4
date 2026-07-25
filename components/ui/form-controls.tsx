'use client';

import React from 'react';
import { Search, X } from 'lucide-react';
import { useIsMobile } from '@/lib/use-mobile';
import { C, R, ctrlH, ctrlInputFs } from './tokens';

type Option = string | { value: string; label: string };

/* 낱개 입력 원자(SSOT). FormGrid=스키마폼용 / 이 파일은 툴바·필터의 단일 입력용. */
export function Select({ value, onChange, options, groups, placeholder, size = 'md', width, full, disabled, style }: {
  value: string;
  onChange: (v: string) => void;
  options?: Option[];
  groups?: { label: string; options: Option[] }[];
  placeholder?: string;
  size?: 'sm' | 'md';
  width?: number;
  full?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const mobile = useIsMobile();
  const optNode = (o: Option) => {
    const v = typeof o === 'string' ? o : o.value;
    const l = typeof o === 'string' ? o : o.label;
    return <option key={v} value={v}>{l}</option>;
  };
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
      style={{
        height: ctrlH(mobile, size), boxSizing: 'border-box',
        padding: mobile ? '0 14px' : '0 8px',
        border: `1px solid ${C.line}`, borderRadius: R,
        fontSize: ctrlInputFs(mobile, size), background: C.taupeBg, color: C.ink,
        cursor: disabled ? 'default' : 'pointer',
        ...(full ? { width: '100%' } : width ? { width } : { width: 'max-content', maxWidth: '100%', fieldSizing: 'content' as const }),
        ...style,
      }}>
      {placeholder != null && <option value="">{placeholder}</option>}
      {groups
        ? groups.map((g) => <optgroup key={g.label} label={g.label}>{g.options.map(optNode)}</optgroup>)
        : (options || []).map(optNode)}
    </select>
  );
}

export function Input({ value, onChange, placeholder, size = 'md', type = 'text', inputMode, width, full, style, onEnter, onKeyDown, autoFocus, disabled }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  size?: 'sm' | 'md';
  type?: string;
  inputMode?: 'text' | 'search' | 'numeric' | 'tel' | 'email' | 'url' | 'decimal';
  width?: number;
  full?: boolean;
  style?: React.CSSProperties;
  onEnter?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const mobile = useIsMobile();
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type={type} inputMode={inputMode} autoFocus={autoFocus} disabled={disabled}
    onKeyDown={(e) => { onKeyDown?.(e); if (onEnter && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onEnter(); } }}
    style={{ height: ctrlH(mobile, size), boxSizing: 'border-box', padding: mobile ? '0 12px' : '0 10px', border: `1px solid ${C.line}`, borderRadius: R, fontSize: ctrlInputFs(mobile, size), background: disabled ? C.head : C.taupeBg, color: C.ink, opacity: disabled ? 0.7 : 1, cursor: disabled ? 'default' : undefined, ...(full ? { width: '100%' } : width ? { width } : {}), ...style }} />;
}

export function Textarea({ value, onChange, onBlur, placeholder, size = 'md', rows = 3, full, style, disabled, autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  size?: 'sm' | 'md';
  rows?: number;
  full?: boolean;
  style?: React.CSSProperties;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const mobile = useIsMobile();
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder} rows={rows} disabled={disabled} autoFocus={autoFocus}
    style={{ boxSizing: 'border-box', padding: mobile ? '10px 12px' : '8px 10px', border: `1px solid ${C.line}`, borderRadius: R, fontSize: ctrlInputFs(mobile, size), lineHeight: 1.5, fontFamily: 'inherit', background: disabled ? C.head : C.taupeBg, color: C.ink, opacity: disabled ? 0.7 : 1, resize: 'vertical', ...(full ? { width: '100%' } : {}), ...style }} />;
}

export function SearchInput({ value, onChange, placeholder = '검색', width, full, style, autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: number;
  full?: boolean;
  style?: React.CSSProperties;
  autoFocus?: boolean;
}) {
  const mobile = useIsMobile();
  const [focus, setFocus] = React.useState(false);
  const h = ctrlH(mobile);
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (!autoFocus) return;
    const t = window.setTimeout(() => ref.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [autoFocus]);
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', ...(full ? { flex: '1 1 auto', width: '100%' } : width ? { width } : {}), ...style }}>
      <Search size={mobile ? 16 : 14} style={{ position: 'absolute', left: mobile ? 12 : 9, color: focus ? C.accent : C.faint, pointerEvents: 'none' }} />
      <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode="search" autoFocus={autoFocus}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{ width: '100%', height: h, boxSizing: 'border-box', padding: mobile ? '0 40px 0 36px' : '0 28px 0 28px', border: `1px solid ${focus ? C.accent : C.line}`, borderRadius: R, fontSize: ctrlInputFs(mobile), background: C.taupeBg, color: C.ink, outline: 'none', boxShadow: focus ? '0 0 0 3px rgba(37,99,235,0.15)' : 'none', transition: 'border-color .12s, box-shadow .12s' }} />
      {value && (
        <button type="button" aria-label="지우기" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange('')}
          style={{ position: 'absolute', right: mobile ? 4 : 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: mobile ? 36 : 17, height: mobile ? 36 : 17, padding: 0, borderRadius: '50%', border: 'none', background: mobile ? 'transparent' : C.line2, color: C.mute, cursor: 'pointer' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: mobile ? 22 : 17, height: mobile ? 22 : 17, borderRadius: '50%', background: C.line2 }}>
            <X size={mobile ? 14 : 11} />
          </span>
        </button>
      )}
    </div>
  );
}
