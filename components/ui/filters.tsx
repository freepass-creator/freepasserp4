'use client';

import React from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { haptic } from '@/lib/haptics';
import { useIsMobile } from '@/lib/use-mobile';
import { CountPill } from './badges';
import { Btn } from './buttons';
import { C, FS, FW, R, ctrlChipH, ctrlFs, ctrlH } from './tokens';

export function PillTabs<T extends string>({
  tabs,
  value,
  onChange,
  size = 'md',
}: {
  tabs: { key: T; label: React.ReactNode; title?: string }[];
  value: T;
  onChange: (key: T) => void;
  size?: 'sm' | 'md';
}) {
  const mobile = useIsMobile();
  const height = ctrlH(mobile, size);
  const padding = mobile ? '0 18px' : size === 'sm' ? '0 12px' : '0 14px';
  const fontSize = ctrlFs(mobile, size);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {tabs.map((tab) => {
        const active = value === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            title={tab.title}
            className="fp-chip"
            style={{
              height,
              boxSizing: 'border-box',
              padding,
              fontSize,
              fontWeight: FW.label,
              cursor: 'pointer',
              borderRadius: R,
              border: `1px solid ${active ? C.brand : C.line}`,
              background: active ? C.brand : C.taupeBg,
              color: active ? C.taupeBg : C.mute,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              transition: 'background .1s, border-color .1s, color .1s',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function ToggleChips<T extends string>({
  selected,
  onToggle,
  options,
  size = 'md',
}: {
  selected: Set<T>;
  onToggle: (value: T) => void;
  options: { key: T; label: string; count?: number; disabled?: boolean }[];
  size?: 'sm' | 'md';
}) {
  const mobile = useIsMobile();
  const height = ctrlChipH(mobile);
  const fontSize = ctrlFs(mobile, size);
  const padding = mobile ? '0 18px' : size === 'sm' ? '0 11px' : '0 12px';
  const chipStyle = (active: boolean, locked: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    height,
    boxSizing: 'border-box',
    padding,
    fontSize,
    fontWeight: FW.label,
    cursor: locked ? 'default' : 'pointer',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    borderRadius: R,
    border: `1px solid ${active ? C.brand : C.line}`,
    background: active ? C.brand : C.taupeBg,
    color: active ? C.taupeBg : C.mute,
    lineHeight: 1,
    opacity: locked ? 0.55 : 1,
    transition: 'background .1s, border-color .1s, color .1s',
  });
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: mobile ? 8 : 6 }}>
      {options.map((option) => {
        const active = selected.has(option.key);
        const locked = !!option.disabled;
        return (
          <button
            key={option.key}
            type="button"
            disabled={locked}
            onClick={() => {
              if (locked) return;
              haptic.select();
              onToggle(option.key);
            }}
            aria-pressed={active}
            aria-disabled={locked || undefined}
            className="fp-chip"
            style={chipStyle(active, locked)}
            title={locked ? '운영예정' : undefined}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function FilterGroup({
  title,
  count = 0,
  onClear,
  actions,
  defaultOpen = true,
  first = false,
  children,
}: {
  title: React.ReactNode;
  count?: number;
  onClear?: () => void;
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  first?: boolean;
  children: React.ReactNode;
}) {
  const mobile = useIsMobile();
  const [open, setOpen] = React.useState(defaultOpen);
  const height = ctrlH(mobile);
  const clearStyle: React.CSSProperties = {
    marginLeft: 6,
    flex: '0 0 auto',
    color: C.accent,
    fontSize: mobile ? FS.sub : FS.cap,
    fontWeight: FW.strong,
    minHeight: height,
    minWidth: 40,
    padding: mobile ? '0 10px' : '0 6px',
    visibility: count > 0 ? 'visible' : 'hidden',
    pointerEvents: count > 0 ? 'auto' : 'none',
  };
  return (
    <div style={{ borderTop: first ? 'none' : `1px solid ${C.line2}` }}>
      <div style={{ display: 'flex', alignItems: 'center', minHeight: height }}>
        <button
          onClick={() => {
            haptic.tap();
            setOpen((current) => !current);
          }}
          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: mobile ? '10px 0' : '8px 0', background: 'none', border: 'none', cursor: 'pointer', minHeight: height, minWidth: 0 }}
        >
          <ChevronDown size={mobile ? 18 : 15} color={C.faint} style={{ flex: '0 0 auto', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .12s' }} />
          <span style={{ fontSize: mobile ? FS.title : FS.body, fontWeight: FW.title, color: C.ink, letterSpacing: '-0.01em', lineHeight: 1.2 }}>{title}</span>
          <span style={{ display: 'inline-flex', visibility: count > 0 ? 'visible' : 'hidden', pointerEvents: 'none', minWidth: 22 }}>
            <CountPill n={count > 0 ? count : 1} tone="accent" />
          </span>
          <span style={{ flex: 1 }} />
        </button>
        {actions != null ? (
          <div style={{ display: 'flex', alignItems: 'center', flex: '0 0 auto', marginLeft: 2 }}>{actions}</div>
        ) : onClear ? (
          <Btn
            variant="bare"
            mobileIcon={<RotateCcw size={18} />}
            title="해제"
            disabled={count <= 0}
            onClick={() => {
              if (count <= 0) return;
              haptic.select();
              onClear();
            }}
            style={clearStyle}
          >
            해제
          </Btn>
        ) : null}
      </div>
      {open && <div style={{ display: 'flex', flexWrap: 'wrap', gap: mobile ? 8 : 6, paddingBottom: mobile ? 14 : 12, width: '100%' }}>{children}</div>}
    </div>
  );
}

export type ChipOpt<T extends string> = {
  key: T;
  label: string;
  count?: number;
};

export function FilterChips<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ChipOpt<T>[];
}) {
  const mobile = useIsMobile();
  const height = ctrlChipH(mobile);
  const fontSize = ctrlFs(mobile);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: mobile ? 8 : 6, marginTop: 0 }}>
      {options.map((option) => {
        const active = value === option.key;
        return (
          <button
            key={option.key}
            onClick={() => {
              haptic.select();
              onChange(option.key);
            }}
            aria-pressed={active}
            className="fp-chip"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height,
              boxSizing: 'border-box',
              padding: mobile ? '0 18px' : '0 12px',
              fontSize,
              fontWeight: FW.label,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              lineHeight: 1,
              borderRadius: R,
              border: `1px solid ${active ? C.brand : C.taupeLine}`,
              background: active ? C.brand : C.taupeBg,
              color: active ? C.taupeBg : C.mute,
              transition: 'background .1s, border-color .1s, color .1s',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
