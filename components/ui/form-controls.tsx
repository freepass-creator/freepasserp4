'use client';

import React from 'react';
import { Search, X } from 'lucide-react';
import { useIsMobile } from '@/lib/use-mobile';
import { C, R, ctrlH, ctrlInputFs, ctrlPadX, ICON } from './tokens';

type Option = string | { value: string; label: string };

/* 낱개 입력 원자(SSOT). FormGrid=스키마폼용 / 이 파일은 툴바·필터의 단일 입력용. */
export function Select({ value, onChange, options, groups, placeholder, ariaLabel, size = 'md', width, full, disabled, style }: {
  value: string;
  onChange: (v: string) => void;
  options?: Option[];
  groups?: { label: string; options: Option[] }[];
  placeholder?: string;
  ariaLabel?: string;
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
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} aria-label={ariaLabel || placeholder || '선택'}
      style={{
        height: ctrlH(mobile, size), boxSizing: 'border-box',
        padding: `0 ${ctrlPadX(mobile, size)}px`,
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

export function Input({ value, onChange, placeholder, ariaLabel, size = 'md', type = 'text', inputMode, width, full, style, onEnter, onKeyDown, onFocus, onBlur, autoFocus, disabled, readOnly, noAutofill, enterKeyHint, list }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  type?: string;
  inputMode?: 'text' | 'search' | 'numeric' | 'tel' | 'email' | 'url' | 'decimal';
  width?: number;
  full?: boolean;
  style?: React.CSSProperties;
  onEnter?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  /** 자동완성 차단 — 브라우저·비밀번호관리자가 키보드 위에 열쇠·카드·주소 툴바를 띄우는 것 방지(채팅 등 자유입력). */
  noAutofill?: boolean;
  /** 모바일 키보드 확인키 라벨(채팅=send). */
  enterKeyHint?: 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send';
  /** catalog datalist 연결. 자유 입력은 막지 않는다. */
  list?: string;
}) {
  const mobile = useIsMobile();
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={ariaLabel || placeholder} type={type} inputMode={inputMode} autoFocus={autoFocus} disabled={disabled} readOnly={readOnly}
    list={list}
    onFocus={onFocus} onBlur={onBlur} enterKeyHint={enterKeyHint}
    {...(noAutofill ? {
      autoComplete: 'off', autoCorrect: 'off', autoCapitalize: 'none', spellCheck: false,
      name: 'fp-freetext', 'data-lpignore': 'true', 'data-1p-ignore': '', 'data-form-type': 'other',
    } : null)}
    onKeyDown={(e) => { onKeyDown?.(e); if (onEnter && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onEnter(); } }}
    style={{ height: ctrlH(mobile, size), boxSizing: 'border-box', padding: `0 ${ctrlPadX(mobile, size)}px`, border: `1px solid ${C.line}`, borderRadius: R, fontSize: ctrlInputFs(mobile, size), background: disabled || readOnly ? C.head : C.taupeBg, color: C.ink, opacity: disabled ? 0.7 : 1, cursor: disabled ? 'default' : undefined, ...(full ? { width: '100%' } : width ? { width } : {}), ...style }} />;
}

/** 네이티브 접근성은 유지하되 업무 화면이 직접 raw input을 만들지 않게 하는 체크 원자. */
export function Checkbox({ checked, onChange, ariaLabel, disabled, className, style }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return <input
    type="checkbox"
    checked={checked}
    onChange={(event) => onChange(event.target.checked)}
    disabled={disabled}
    className={className}
    {...(ariaLabel ? { 'aria-label': ariaLabel } : null)}
    style={style}
  />;
}

export function Textarea({ value, onChange, onBlur, placeholder, ariaLabel, size = 'md', rows = 3, full, style, disabled, autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  ariaLabel?: string;
  size?: 'sm' | 'md';
  rows?: number;
  full?: boolean;
  style?: React.CSSProperties;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const mobile = useIsMobile();
  const inputFontSize = ctrlInputFs(mobile, size);
  const paddingY = mobile ? 10 : 8;
  const minHeight = Math.ceil(inputFontSize * 1.5 * Math.max(rows, 1) + paddingY * 2 + 2);
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder} aria-label={ariaLabel || placeholder} rows={rows} disabled={disabled} autoFocus={autoFocus}
    style={{ boxSizing: 'border-box', minHeight, padding: mobile ? '10px 12px' : '8px 10px', border: `1px solid ${C.line}`, borderRadius: R, fontSize: inputFontSize, lineHeight: 1.5, fontFamily: 'inherit', background: disabled ? C.head : C.taupeBg, color: C.ink, opacity: disabled ? 0.7 : 1, resize: 'vertical', ...(full ? { width: '100%' } : {}), ...style }} />;
}

export function SearchInput({ value, onChange, placeholder = '검색', ariaLabel, width, full, style, inputStyle, autoFocus, trailing }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  width?: number;
  full?: boolean;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
  autoFocus?: boolean;
  /**
   * **입력칸 «안» 우측에 세우는 것**(필터 등) — 사장님 2026-08-22
   * 「검색창을 길게 빼고 그 안에 필터 버튼을 넣으면 어때? 글씨 쓰면 나오는 X는 그 필터 옆에」.
   * 검색줄이 두 컨트롤로 갈리지 않고 한 줄이 되어 입력 폭이 그만큼 넓어진다(네이버·당근·Gmail 배치).
   * 지우기(X) → 얇은 세로선 → trailing 순. 입력 padding-right 는 **X 유무와 무관하게 고정**이라
   * 글자를 지워도 텍스트가 좌우로 튀지 않는다.
   */
  trailing?: React.ReactNode;
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
  const slotW = mobile ? h : 20;
  // 오른쪽 슬롯 총 폭 — X 자리는 값이 없어도 비워 둔다(지울 때 글자가 튀지 않게).
  const rightPad = trailing ? slotW * 2 + 12 : (mobile ? 40 : 28);
  const iconLeft = mobile ? ctrlPadX(mobile) : 9;
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', overflow: 'visible', ...(full ? { flex: '1 1 auto', width: '100%' } : width ? { width } : {}), ...style }}>
      <Search aria-hidden size={mobile ? ICON.xl : ICON.sm} style={{ position: 'absolute', left: iconLeft, color: focus ? C.accent : C.faint, pointerEvents: 'none' }} />
      <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={ariaLabel || placeholder || '검색'} inputMode="search" autoFocus={autoFocus}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        /* 알약형은 하루 만에 되돌림(사장님 2026-08-22 「둥글게 검색창 한 적 없고 딱 깔끔하게」) — 원래의 각진 입력칸 그대로. */
        style={{ width: '100%', height: h, boxSizing: 'border-box', padding: `0 ${rightPad}px 0 ${mobile ? h : 28}px`, border: `1px solid ${focus ? C.accent : C.line}`, borderRadius: R, fontSize: ctrlInputFs(mobile), background: C.taupeBg, color: C.ink, outline: 'none', boxShadow: focus ? `0 0 0 3px ${C.focusRing}` : 'none', transition: 'border-color .12s, box-shadow .12s, background-color .12s', ...inputStyle }} />
      {/* 입력칸 안 우측 슬롯 — 판은 클릭을 통과시키고(pointerEvents none) 버튼만 받는다.
          trailing 칸 = 입력 높이와 같은 정사각(모바일 검색·필터가 다른 크기로 보이던 원인). */}
      <div style={{
        position: 'absolute', right: trailing ? (mobile ? 0 : 4) : (mobile ? 4 : 7), top: 0, bottom: 0,
        display: 'inline-flex', alignItems: 'center', gap: trailing ? 2 : 0, pointerEvents: 'none',
      }}>
        {value ? (
          <button type="button" aria-label="검색어 지우기" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange('')}
            style={{ pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: slotW, height: mobile ? h : 17, padding: 0, borderRadius: '50%', border: 'none', background: 'transparent', color: C.mute, cursor: 'pointer' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: mobile ? 22 : 17, height: mobile ? 22 : 17, borderRadius: '50%', background: C.line2 }}>
              <X size={mobile ? ICON.sm : 11} />
            </span>
          </button>
        ) : trailing ? <span style={{ width: slotW, height: slotW, flex: '0 0 auto' }} /> : null}
        {trailing ? (
          <>
            {/* 얇은 세로선 — 검색(글자)과 필터(조건)는 다른 일이라는 표시. 없으면 X 와 한 덩어리로 읽힌다. */}
            <span aria-hidden style={{ width: 1, height: ICON.xl, background: C.line, flex: '0 0 auto' }} />
            <span style={{ pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: slotW, height: slotW, flex: '0 0 auto' }}>{trailing}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
