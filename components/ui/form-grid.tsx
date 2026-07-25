'use client';

import React from 'react';
import type { EntityRecord, Field } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';
import { ToggleChips } from './filters';
import { fmtNumber, fmtPhone } from './formatters';
import { C, FS, R, ctrlH, ctrlInputFs } from './tokens';

export function FormGrid({
  fields,
  form,
  onChange,
  cols = 2,
  disabled,
}: {
  fields: Field[];
  form: EntityRecord;
  onChange: (key: string, value: string) => void;
  cols?: number;
  disabled?: boolean;
}) {
  const mobile = useIsMobile();
  const columns = mobile ? 1 : cols;
  const inputStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    marginTop: 3,
    boxSizing: 'border-box',
    height: ctrlH(mobile),
    padding: mobile ? '0 11px' : '0 9px',
    border: `1px solid ${C.line}`,
    borderRadius: R,
    fontSize: ctrlInputFs(mobile),
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns},1fr)`, gap: 9 }}>
      {fields.map((field) => {
        const value = (form[field.key] as string) ?? '';
        const empty = value === '' || value == null;
        const background = disabled ? C.head : empty ? (field.manual || field.required ? C.warnBg : C.head) : C.taupeBg;
        const numeric = field.type === 'number';
        const phone = /phone|연락처|전화/.test(field.key);
        const span = field.type === 'chips' ? { gridColumn: '1 / -1' as const } : undefined;
        return (
          <label key={field.key} style={{ fontSize: FS.cap, color: C.mute, ...span }}>
            {field.label}
            {field.required && <span style={{ color: C.danger }}> *</span>}
            {field.manual && !disabled && <span style={{ color: C.warn }}> ·직접</span>}
            {field.max ? <span style={{ color: C.faint }}> ·최대 {field.max}</span> : null}
            {field.type === 'select' ? (
              <select
                value={value}
                disabled={disabled}
                onChange={(event) => onChange(field.key, event.target.value)}
                style={{ ...inputStyle, background, cursor: disabled ? 'default' : undefined, opacity: disabled ? 0.85 : 1 }}
              >
                <option value="">—</option>
                {[...(value && !(field.options || []).includes(value) ? [value] : []), ...(field.options || [])].map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : field.type === 'chips' ? (
              <div style={{ marginTop: 5, pointerEvents: disabled ? 'none' : undefined, opacity: disabled ? 0.85 : 1 }}>
                {(() => {
                  const selected = new Set(value.split(/[,/#|]/).map((item) => item.trim()).filter(Boolean));
                  const locked = new Set(field.disabledOptions || []);
                  const options = [...(field.options || [])];
                  for (const item of selected) if (!options.includes(item)) options.push(item);
                  return (
                    <ToggleChips
                      size="sm"
                      selected={selected}
                      options={options.map((option) => ({
                        key: option,
                        label: locked.has(option) ? `${option} ·운영예정` : option,
                        disabled: locked.has(option),
                      }))}
                      onToggle={(key) => {
                        if (disabled || locked.has(key)) return;
                        const next = new Set(selected);
                        if (next.has(key)) next.delete(key);
                        else {
                          if (field.max != null && next.size >= field.max) return;
                          next.add(key);
                        }
                        onChange(field.key, [...next].filter((item) => !locked.has(item)).join(','));
                      }}
                    />
                  );
                })()}
              </div>
            ) : (
              <input
                type={field.type === 'date' ? 'date' : 'text'}
                inputMode={numeric ? 'numeric' : phone ? 'tel' : undefined}
                value={numeric ? fmtNumber(value) : phone ? fmtPhone(value) : value}
                disabled={disabled}
                onChange={(event) => onChange(
                  field.key,
                  numeric ? event.target.value.replace(/[^\d.]/g, '') : phone ? fmtPhone(event.target.value) : event.target.value,
                )}
                style={{ ...inputStyle, background, cursor: disabled ? 'default' : undefined, opacity: disabled ? 0.85 : 1 }}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
