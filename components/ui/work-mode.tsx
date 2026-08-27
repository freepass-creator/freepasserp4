'use client';
/**
 * **업무 화면 필드 표 SSOT.** 정본은 재고관리.
 *
 * ★사장님 2026-08-27
 *   보기·수정·신규가 페이지마다 갈리면 안 된다. 자리는 같고, 모드만 갈린다.
 *   표·버튼·드롭다운·입력칸은 여기 원자를 갖다 쓴다. 페이지에서 줄을 손수 짜지 않는다.
 *   매물을 고르는 화면(`/finder`·`/catalog`)은 **이 표 문법을 안 쓴다** — 매물 카드 문법
 *   (`ProductRowCard`/`ProductCard`)을 쓴다. 페이지 전용 규격이 있는 게 아니다.
 *
 * 페이지는 이 파일만 쓴다. `FormGrid`/`FormReadList` 를 페이지에서 직접 갈라 쓰지 않는다.
 *
 * ```
 * 스키마 표  WorkFields           엔티티 필드 배열
 * 자유 표    WorkTable + WorkRow  머리띠 → 라벨 | 값
 * 입력       WorkInput            표 안 한 줄 입력 (Input)
 * 드롭다운   WorkSelect           표 안 선택 (SheetSelect → 웹 Select · 모바일 시트)
 * 여러 줄    WorkTextarea
 * 버튼       Btn                  공용 버튼. 새로 만들지 않는다
 * 보기       WorkFields mode=view 글자. 입력칸처럼 안 보인다
 * 수정       WorkFields mode=edit 같은 자리, 값 칸을 고친다
 * 신규       WorkFields mode=create 같은 자리, 빈칸부터 채운다
 * 배너       WorkModeBanner       첫 업무 패널에만
 * 하단       WorkDock             보기=수정·삭제 / 신규·수정=취소·저장
 * ```
 * 대화 스레드·사진 업로드처럼 표가 아닌 자리는 기존 원자(ChatThread·PhotoUpload·FormCard)를 쓴다.
 */
import { Children, cloneElement, isValidElement, type ComponentProps, type CSSProperties, type FocusEventHandler, type ReactElement, type ReactNode } from 'react';
import type { EntityRecord, Field } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';
import { PageActions } from '../PageActions';
import { DetailTable, DtRow, DT, type SectionAccent } from './detail';
import { Message } from './feedback';
import { FormGrid } from './form-grid';
import { Input, Textarea } from './form-controls';
import { SheetSelect } from './native-form';
import { KV_LABEL_W } from './tokens';

export type WorkMode = 'view' | 'edit' | 'create';

export function workMode(creating: boolean, editing: boolean): WorkMode {
  if (creating) return 'create';
  if (editing) return 'edit';
  return 'view';
}

/** 업무 표 안 컨트롤 크기 — FormGrid와 같음 (웹 sm / 모바일 md). */
export function workCtrlSize(mobile: boolean): 'sm' | 'md' {
  return mobile ? 'md' : 'sm';
}

export function WorkModeBanner({
  mode, create, edit,
}: {
  mode: WorkMode;
  create?: ReactNode;
  edit?: ReactNode;
}) {
  if (mode === 'create') {
    return <Message variant="info">{create ?? '신규 입력 — 저장해야 반영됩니다'}</Message>;
  }
  if (mode === 'edit') {
    return <Message variant="warning">{edit ?? '수정 중 · 저장해야 반영됩니다'}</Message>;
  }
  return null;
}

type SelectOption = string | { value: string; label: string };

export function WorkFields({
  mode,
  fields,
  form,
  onChange,
  cols = 2,
  selectOptions,
  showNotes,
  title,
  hint,
  header,
  footer,
  accent = 'sub',
}: {
  mode: WorkMode;
  fields: Field[];
  form: EntityRecord;
  onChange?: (key: string, value: string) => void;
  cols?: number;
  selectOptions?: Record<string, SelectOption[]>;
  showNotes?: boolean;
  title?: ReactNode;
  hint?: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  accent?: SectionAccent;
}) {
  const view = mode === 'view';
  return (
    <FormGrid
      fields={fields}
      form={form}
      onChange={view ? () => {} : (onChange || (() => {}))}
      disabled={view}
      creating={mode === 'create'}
      cols={cols}
      selectOptions={selectOptions}
      showNotes={showNotes}
      title={title ?? header}
      hint={hint ?? footer}
      accent={accent}
    />
  );
}

/** 머리띠 → 라벨 | 값. 스키마가 없는 업무 표는 이걸 쓴다. */
export function WorkTable({
  title,
  hint,
  accent = 'sub',
  children,
  style,
  onFocusCapture,
  onBlurCapture,
}: {
  title: ReactNode;
  hint?: ReactNode;
  accent?: SectionAccent;
  children: ReactNode;
  style?: CSSProperties;
  onFocusCapture?: FocusEventHandler<HTMLElement>;
  onBlurCapture?: FocusEventHandler<HTMLElement>;
}) {
  let n = 0;
  const rows = Children.toArray(children).map((child) => {
    if (!isValidElement(child) || child.type !== WorkRow) return child;
    const given = (child.props as { i?: number }).i;
    return cloneElement(child as ReactElement<{ i?: number }>, { i: given ?? n++ });
  });
  return (
    <div onFocusCapture={onFocusCapture} onBlurCapture={onBlurCapture} style={style}>
      <DetailTable title={title} hint={hint} accent={accent} span={2} widths={[KV_LABEL_W, undefined]}>
        {rows}
      </DetailTable>
    </div>
  );
}

export function WorkRow({ i = 0, label, children, valueStyle }: {
  i?: number;
  label: ReactNode;
  children?: ReactNode;
  valueStyle?: CSSProperties;
}) {
  return <DtRow i={i} label={label} valueStyle={valueStyle}>{children}</DtRow>;
}

/** 한 표 안에서 갈래만 나눌 때. 표를 안에 또 넣지 않는다. */
export function WorkSplit({ label }: { label: ReactNode }) {
  return (
    <tr>
      <th colSpan={2} style={DT.split}>{label}</th>
    </tr>
  );
}

export function WorkInput({ size, full = true, ...rest }: ComponentProps<typeof Input>) {
  const mobile = useIsMobile();
  return <Input size={size ?? workCtrlSize(mobile)} full={full} {...rest} />;
}

export function WorkSelect({ size, full = true, searchable, options, ...rest }: ComponentProps<typeof SheetSelect>) {
  const mobile = useIsMobile();
  const n = options?.length ?? 0;
  return (
    <SheetSelect
      size={size ?? workCtrlSize(mobile)}
      full={full}
      searchable={searchable ?? n > 8}
      options={options}
      {...rest}
    />
  );
}

export function WorkTextarea({ size, full = true, ...rest }: ComponentProps<typeof Textarea>) {
  const mobile = useIsMobile();
  return <Textarea size={size ?? workCtrlSize(mobile)} full={full} {...rest} />;
}

export function WorkDock({
  mode,
  selected,
  saving,
  dirty,
  onCancel,
  onSave,
  onEdit,
  onRemove,
  extra,
  saveLabel,
}: {
  mode: WorkMode;
  selected: boolean;
  saving?: boolean;
  dirty?: boolean;
  onCancel: () => void;
  onSave: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
  extra?: ReactNode;
  saveLabel?: string;
}) {
  if (mode !== 'view') {
    return (
      <PageActions
        cancel={{ onClick: onCancel, disabled: saving }}
        save={{ onClick: onSave, disabled: !!saving || dirty === false, label: saveLabel }}
        extra={extra}
      />
    );
  }
  if (!selected) return null;
  return (
    <PageActions
      edit={onEdit ? { onClick: onEdit } : undefined}
      remove={onRemove ? { onClick: onRemove } : undefined}
      extra={extra}
    />
  );
}
