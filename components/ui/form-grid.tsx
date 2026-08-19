'use client';

import React from 'react';
import type { EntityRecord, Field } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';
import { ToggleChips } from './filters';
import { fmtNumber, fmtPhone } from './formatters';
import { SheetSelect, Switch } from './native-form';
import { DetailRow, ListGroup } from './detail-group';
import { C, FS, R, ctrlH, ctrlInputFs, ctrlPadX } from './tokens';

type SelectOption = string | { value: string; label: string };

function readValue(field: Field, raw: unknown, selectOptions?: Record<string, SelectOption[]>): string {
  if (raw == null || raw === '') return '';
  const value = Array.isArray(raw) ? raw.join(',') : String(raw);
  const options = selectOptions?.[field.key] || field.options || [];
  const matched = options.find((option) => (typeof option === 'string' ? option : option.value) === value);
  if (matched && typeof matched !== 'string') return matched.label;
  if (isYesNoActive(field)) return value === '아니오' ? '비활성' : '활성';
  if (field.type === 'number') return fmtNumber(value);
  if (/phone|연락처|전화/.test(`${field.key} ${field.label}`)) return fmtPhone(value);
  if (field.type === 'chips') return value.split(/[,/#|]/).map((item) => item.trim()).filter(Boolean).join(' · ');
  return value;
}

/** 조회 모드 스키마 필드 — 비활성 입력폼 대신 모바일 정보행으로 표시한다. */
export function FormReadList({ fields, form, selectOptions, header, footer }: {
  fields: Field[];
  form: EntityRecord;
  selectOptions?: Record<string, SelectOption[]>;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <ListGroup header={header} footer={footer}>
      {fields.map((field) => {
        const value = readValue(field, form[field.key], selectOptions);
        const stacked = value.length > 36 || /options|memo|condition|criteria|scope|service/.test(field.key);
        return <DetailRow key={field.key} label={field.label} value={value} stacked={stacked} />;
      })}
    </ListGroup>
  );
}

function isYesNoActive(field: Field): boolean {
  if (field.key !== 'is_active') return false;
  const opts = field.options || [];
  return opts.includes('예') && opts.includes('아니오');
}

export function FormGrid({
  fields,
  form,
  onChange,
  cols = 2,
  disabled,
  selectOptions,
  showNotes,
}: {
  fields: Field[];
  form: EntityRecord;
  onChange: (key: string, value: string) => void;
  cols?: number;
  disabled?: boolean;
  /** 필드별 Select 옵션 오버라이드(정책코드 등 value≠label). */
  selectOptions?: Record<string, SelectOption[]>;
  /**
   * 필드의 `note` 를 칸 밑에 설명으로 그린다.
   *
   * 기본은 끔 — 재고·계약처럼 매일 만지는 화면은 조밀해야 하고, 거기선 설명이 소음이다.
   * **정책처럼 «한 번 정해 두고 계속 쓰는» 화면에서만 켠다.** 그런 화면은 자주 안 오기 때문에
   * 「이 칸이 무슨 뜻이고 어느 약관 조항에 걸리는지」를 그 자리에서 읽을 수 있어야 한다.
   */
  showNotes?: boolean;
}) {
  const mobile = useIsMobile();
  const columns = mobile ? 1 : cols;
  const inputStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    marginTop: 3,
    boxSizing: 'border-box',
    height: ctrlH(mobile),
    padding: `0 ${ctrlPadX(mobile)}px`, // Input과 동일 — 스키마 폼이 툴바 입력과 1px 어긋나던 것 제거
    border: `1px solid ${C.line}`,
    borderRadius: R,
    fontSize: ctrlInputFs(mobile),
    // 조회(disabled) 모드에서 브라우저 기본 회색이 얹히면 입력된 값이 placeholder처럼 읽힌다.
    //  흐림은 아래 opacity 하나로만 표현한다(Input 원자와 같은 규칙).
    color: C.ink,
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns},1fr)`, gap: 9 }}>
      {fields.map((field) => {
        const value = (form[field.key] as string) ?? '';
        const empty = value === '' || value == null;
        const background = disabled ? C.head : empty ? (field.manual || field.required ? C.warnBg : C.head) : C.taupeBg;
        const numeric = field.type === 'number';
        // range 지정 = 소수 입력 필드(율). 여기서 fmtNumber(toLocaleString)를 태우면
        // "0." 이 "0" 으로 되접혀 소수점을 아예 못 찍는다 → 0.1 을 치면 1 이 저장된다(QA RATE-1의 입력측 원인).
        const decimal = numeric && !!field.range;
        const num = value === '' ? NaN : Number(value);
        const outOfRange = !!field.range && value !== ''
          && (!Number.isFinite(num) || num < field.range[0] || num > field.range[1]);
        const phone = /phone|연락처|전화/.test(field.key);
        const span = field.type === 'chips' || isYesNoActive(field) ? { gridColumn: '1 / -1' as const } : undefined;
        const overrideOpts = selectOptions?.[field.key];
        const baseOpts: SelectOption[] = overrideOpts || (field.options || []);
        // select 값은 글자로 비교한다 — 옛 숫자값(7·0.3)이 select 원자에 남아 있으면 옵션이 두 번 끼어 key 경고가 났다(2026-08-19).
        const selValue = value === null || value === undefined ? '' : String(value);
        const hasValue = !!selValue && baseOpts.some((o) => (typeof o === 'string' ? o : o.value) === selValue);
        const selectOpts: SelectOption[] = selValue && field.type === 'select' && !hasValue
          ? [selValue, ...baseOpts]
          : [...baseOpts];
        return (
          <label key={field.key} data-field={field.key} style={{ fontSize: FS.cap, color: C.mute, ...span }}>
            {field.label}
            {field.required && <span style={{ color: C.danger }}> *</span>}
            {field.manual && !disabled && <span style={{ color: C.warn }}> ·직접</span>}
            {field.max ? <span style={{ color: C.faint }}> ·최대 {field.max}</span> : null}
            {isYesNoActive(field) ? (
              <div style={{
                marginTop: 3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                minHeight: ctrlH(mobile),
                padding: mobile ? '0 4px 0 0' : '0 2px 0 0',
                boxSizing: 'border-box',
              }}>
                <span style={{ fontSize: FS.body, color: C.ink }}>{value === '아니오' ? '비활성' : '활성'}</span>
                <Switch
                  title={field.label}
                  checked={value !== '아니오'}
                  disabled={disabled}
                  onChange={(on) => onChange(field.key, on ? '예' : '아니오')}
                />
              </div>
            ) : field.type === 'select' ? (
              <SheetSelect
                value={selValue}
                disabled={disabled}
                full
                placeholder="—"
                title={field.label}
                onChange={(v) => onChange(field.key, v)}
                options={selectOpts}
                searchable={selectOpts.length > 8}
                style={{ marginTop: 3, background, opacity: disabled ? 0.85 : 1 }}
              />
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
              <>
                <input
                  type={field.type === 'date' ? 'date' : 'text'}
                  inputMode={decimal ? 'decimal' : numeric ? 'numeric' : phone ? 'tel' : undefined}
                  value={decimal ? value : numeric ? fmtNumber(value) : phone ? fmtPhone(value) : value}
                  disabled={disabled}
                  onChange={(event) => onChange(
                    field.key,
                    numeric ? event.target.value.replace(/[^\d.]/g, '') : phone ? fmtPhone(event.target.value) : event.target.value,
                  )}
                  style={{
                    ...inputStyle,
                    background: outOfRange ? C.warnBg : background,
                    borderColor: outOfRange ? C.danger : C.line,
                    cursor: disabled ? 'default' : undefined,
                    opacity: disabled ? 0.85 : 1,
                  }}
                />
                {outOfRange && field.range && (
                  <span style={{ display: 'block', marginTop: 3, fontSize: FS.cap, color: C.danger }}>
                    {field.range[0]}~{field.range[1]} 범위로 입력하세요 (예: 10% → 0.1)
                  </span>
                )}
              </>
            )}
            {/*
              설명은 «칸 밑»에 둔다. 라벨 옆에 붙이면 라벨이 길어져 그리드가 흔들리고,
              범위 오류 문구와 자리를 다투게 된다. 오류가 떠 있을 때는 그쪽이 먼저다.
            */}
            {showNotes && field.note && !outOfRange && (
              <span style={{ display: 'block', marginTop: 3, fontSize: FS.cap, color: C.faint, lineHeight: 1.45 }}>
                {field.note}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}
