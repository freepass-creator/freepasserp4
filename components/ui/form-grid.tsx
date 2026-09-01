'use client';

import React from 'react';
import type { EntityRecord, Field } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';
import { ToggleChips } from './filters';
import { fmtNumber, fmtPhone } from './formatters';
import { SheetSelect, Switch } from './native-form';
import { Input } from './form-controls';
import { DetailTable, DT, type SectionAccent } from './detail';
import { C, FS, R_CARD, KV_LABEL_W, ctrlH } from './tokens';
import { parseProductOptions } from '@/lib/domain/product';
import { ColorDot } from '@/components/color-swatch';
import { OptionChips } from '@/components/product-card-options';

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

function isColorField(field: Field): boolean {
  return field.key === 'ext_color' || field.key === 'int_color';
}

function isYesNoActive(field: Field): boolean {
  if (field.key !== 'is_active') return false;
  const opts = field.options || [];
  return opts.includes('예') && opts.includes('아니오');
}

function isFullRow(field: Field): boolean {
  return field.type === 'chips' || isYesNoActive(field) || field.key === 'options';
}

function chunkFields(fields: Field[], pair: boolean): Field[][] {
  const rows: Field[][] = [];
  let i = 0;
  while (i < fields.length) {
    const field = fields[i];
    if (!pair || isFullRow(field)) {
      rows.push([field]);
      i += 1;
      continue;
    }
    const next = fields[i + 1];
    if (next && !isFullRow(next)) {
      rows.push([field, next]);
      i += 2;
    } else {
      rows.push([field]);
      i += 1;
    }
  }
  return rows;
}

type FieldCellsProps = {
  field: Field;
  value: string;
  mobile: boolean;
  disabled: boolean;
  creating?: boolean;
  options?: SelectOption[];
  showNotes?: boolean;
  span: number;
  full: boolean;
  onChange: (key: string, value: string) => void;
};

const FormFieldCells = React.memo(function FormFieldCells({
  field,
  value,
  mobile,
  disabled: lockedByCaller,
  creating,
  options: overrideOpts,
  showNotes,
  span,
  full,
  onChange,
}: FieldCellsProps) {
  const disabled = lockedByCaller || !!field.readOnly;
  const empty = value === '' || value == null;
  const numeric = field.type === 'number';
  const decimal = numeric && !!field.range;
  const num = value === '' ? NaN : Number(value);
  const outOfRange = !!field.range && value !== ''
    && (!Number.isFinite(num) || num < field.range[0] || num > field.range[1]);
  const phone = /phone|연락처|전화/.test(field.key);
  const warnEmpty = !disabled && empty && !!(field.manual || field.required);
  const baseOpts: SelectOption[] = overrideOpts || (field.options || []);
  const selValue = value == null ? '' : String(value);
  const hasValue = !!selValue && baseOpts.some((option) => (typeof option === 'string' ? option : option.value) === selValue);
  const selectOpts: SelectOption[] = selValue && field.type === 'select' && !hasValue
    ? [selValue, ...baseOpts]
    : baseOpts;
  const display = readValue(field, value, overrideOpts ? { [field.key]: overrideOpts } : undefined);
  const size = mobile ? 'md' as const : 'sm' as const;
  const fillStyle: React.CSSProperties | undefined = !disabled && (empty || outOfRange)
    ? {
        background: warnEmpty ? C.warnBg : C.head,
        boxShadow: outOfRange ? `inset 0 0 0 1px ${C.danger}` : undefined,
      }
    : undefined;
  const textPlaceholder = creating || empty ? '입력' : undefined;

  const label = (
    <>
      {field.label}
      {!disabled && field.required ? <span style={{ color: C.danger }}> *</span> : null}
      {field.manual && !disabled ? <span style={{ color: C.warn }}> ·직접</span> : null}
      {!disabled && field.max ? <span style={{ color: C.faint }}> ·최대 {field.max}</span> : null}
    </>
  );

  let control: React.ReactNode;
  if (disabled && field.key === 'options') {
    control = parseProductOptions(value).length
      ? <OptionChips p={{ options: value }} expand />
      : <span style={{ color: C.faint }}>—</span>;
  } else if (isColorField(field) && disabled) {
    control = display
      ? <span style={{ display: 'inline-flex', alignItems: 'center' }}><ColorDot name={display} />{display}</span>
      : <span style={{ color: C.faint }}>—</span>;
  } else if (disabled) {
    control = display
      ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{display}</span>
      : <span style={{ color: C.faint }}>—</span>;
  } else if (isColorField(field)) {
    control = (
      <SheetSelect
        value={selValue}
        full
        size={size}
        placeholder="선택"
        title={field.label}
        onChange={(v) => onChange(field.key, v)}
        options={selectOpts}
        searchable={selectOpts.length > 8}
        style={fillStyle}
      />
    );
  } else if (isYesNoActive(field)) {
    control = (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: ctrlH(mobile, size) }}>
        <span>{value === '아니오' ? '비활성' : '활성'}</span>
        <Switch title={field.label} checked={value !== '아니오'} disabled={disabled} onChange={(on) => onChange(field.key, on ? '예' : '아니오')} />
      </div>
    );
  } else if (field.type === 'select') {
    control = (
      <SheetSelect
        value={selValue}
        disabled={disabled}
        full
        size={size}
        placeholder="선택"
        title={field.label}
        onChange={(v) => onChange(field.key, v)}
        options={selectOpts}
        searchable={selectOpts.length > 8}
        style={fillStyle}
      />
    );
  } else if (field.type === 'catalog') {
    const listId = `cat-${field.key}`;
    control = (
      <>
        <Input
          list={listId}
          value={selValue}
          disabled={disabled}
          full
          size={size}
          placeholder={textPlaceholder || '입력'}
          ariaLabel={field.label}
          onChange={(next) => onChange(field.key, next)}
          style={fillStyle}
        />
        <datalist id={listId}>
          {baseOpts.map((option) => {
            const v = typeof option === 'string' ? option : option.value;
            return <option key={v} value={v} />;
          })}
        </datalist>
      </>
    );
  } else if (field.type === 'chips') {
    const selected = new Set(value.split(/[,/#|]/).map((item) => item.trim()).filter(Boolean));
    const locked = new Set(field.disabledOptions || []);
    const options = [...(field.options || [])];
    for (const item of selected) if (!options.includes(item)) options.push(item);
    control = (
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
  } else {
    control = (
      <>
        <Input
          type={field.type === 'date' ? 'date' : 'text'}
          inputMode={decimal ? 'decimal' : numeric ? 'numeric' : phone ? 'tel' : undefined}
          value={decimal ? value : numeric ? fmtNumber(value) : phone ? fmtPhone(value) : value}
          disabled={disabled}
          full
          size={size}
          ariaLabel={field.label}
          placeholder={textPlaceholder || '입력'}
          onChange={(next) => onChange(field.key, numeric ? next.replace(/[^\d.]/g, '') : phone ? fmtPhone(next) : next)}
          style={fillStyle}
        />
        {outOfRange && field.range ? (
          <span style={{ display: 'block', marginTop: 3, fontSize: FS.cap, color: C.danger }}>
            {field.range[0]}~{field.range[1]} 범위로 입력하세요 (예: 10% → 0.1)
          </span>
        ) : null}
      </>
    );
  }

  const note = showNotes && field.note && !outOfRange
    ? <span style={{ display: 'block', marginTop: 3, fontSize: FS.cap, color: C.faint, lineHeight: 1.45 }}>{field.note}</span>
    : null;

  return (
    <>
      <th scope="row" style={DT.labelTh} data-field={field.key}>{label}</th>
      <td style={DT.td} colSpan={full ? span - 1 : undefined}>
        {control}
        {note}
      </td>
    </>
  );
});

function FormTableShell({
  title,
  hint,
  accent,
  span,
  widths,
  children,
}: {
  title?: React.ReactNode;
  hint?: React.ReactNode;
  accent: SectionAccent;
  span: number;
  widths: (string | number | undefined)[];
  children: React.ReactNode;
}) {
  if (title != null && title !== '') {
    return (
      <DetailTable title={title} hint={hint} accent={accent} tone="main" span={span} widths={widths}>
        {children}
      </DetailTable>
    );
  }
  return (
    <div style={{ flexShrink: 0 }}>
      {hint ? <div style={{ fontSize: FS.cap, color: C.faint, marginBottom: 6, lineHeight: 1.4 }}>{hint}</div> : null}
      <div style={{ border: `1px solid ${C.line}`, borderRadius: R_CARD, overflow: 'hidden', background: C.taupeBg, flexShrink: 0 }}>
        <table style={DT.table}>
          <colgroup>{widths.map((w, i) => <col key={i} style={w == null ? undefined : { width: w }} />)}</colgroup>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

type FormTableProps = {
  fields: Field[];
  form: EntityRecord;
  selectOptions?: Record<string, SelectOption[]>;
  cols?: number;
  title?: React.ReactNode;
  hint?: React.ReactNode;
  /** 옛 ListGroup 헤더. title 이 있으면 title 이 이긴다. */
  header?: React.ReactNode;
  footer?: React.ReactNode;
  accent?: SectionAccent;
};

/** 조회 모드 — 값 칸만 글자. 골격은 FormGrid 와 같은 DetailTable. */
export function FormReadList({
  fields,
  form,
  selectOptions,
  header,
  footer,
  title,
  hint,
  cols = 2,
  accent = 'sub',
}: FormTableProps) {
  return (
    <FormGrid
      fields={fields}
      form={form}
      onChange={() => {}}
      disabled
      cols={cols}
      selectOptions={selectOptions}
      title={title ?? header}
      hint={hint ?? footer}
      accent={accent}
    />
  );
}

/**
 * 스키마 폼. 상품상세와 같은 표: 머리띠 → 한 줄 = 라벨 | 값.
 * 보기(disabled)=글자. 수정·신규=값 칸에 Input/Select. 신규 빈칸은 채울 자리로 읽힌다.
 */
export function FormGrid({
  fields,
  form,
  onChange,
  cols = 2,
  disabled,
  creating,
  selectOptions,
  showNotes,
  title,
  hint,
  header,
  footer,
  accent = 'sub',
}: FormTableProps & {
  onChange: (key: string, value: string) => void;
  disabled?: boolean;
  creating?: boolean;
  showNotes?: boolean;
}) {
  const mobile = useIsMobile();
  const pair = !mobile && cols >= 2;
  const span = pair ? 4 : 2;
  const widths = pair ? [KV_LABEL_W, undefined, KV_LABEL_W, undefined] : [KV_LABEL_W, undefined];
  const rows = chunkFields(fields, pair);
  const heading = title ?? header;
  const sub = hint ?? footer;

  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const dispatchChange = React.useCallback((key: string, value: string) => onChangeRef.current(key, value), []);

  return (
    <FormTableShell title={heading} hint={sub} accent={accent} span={span} widths={widths}>
      {rows.map((row, i) => (
        <tr key={row.map((field) => field.key).join('-')} style={DT.tr(i)}>
          {row.map((field) => (
            <FormFieldCells
              key={field.key}
              field={field}
              value={String(form[field.key] ?? '')}
              mobile={mobile}
              disabled={!!disabled}
              creating={creating}
              options={selectOptions?.[field.key]}
              showNotes={showNotes}
              span={span}
              full={row.length === 1 && pair && isFullRow(row[0])}
              onChange={dispatchChange}
            />
          ))}
          {pair && row.length === 1 && !isFullRow(row[0]) ? (
            <>
              <th style={DT.labelTh} />
              <td style={DT.td} />
            </>
          ) : null}
        </tr>
      ))}
    </FormTableShell>
  );
}
