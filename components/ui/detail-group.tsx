'use client';

import React, { Children, isValidElement, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { C, FS, FW, R, ctrlH } from './tokens';

/** 카드 밖 섹션 캡션 — 그룹리스트 헤더. */
export function GroupHeader({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: FS.cap,
      fontWeight: FW.meta,
      color: C.faint,
      padding: '0 4px 6px',
      letterSpacing: '-0.01em',
    }}>
      {children}
    </div>
  );
}

/** 카드 밑 설명 note. */
export function GroupFooter({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: FS.micro,
      color: C.faint,
      padding: '6px 4px 0',
      lineHeight: 1.45,
    }}>
      {children}
    </div>
  );
}

/**
 * 그룹리스트 카드 — 라운드 + inset divider.
 * header/footer는 카드 밖(캡션·note).
 */
export function ListGroup({
  header,
  footer,
  children,
  style,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const items = Children.toArray(children);
  return (
    // marginTop 없음 — 세로 간격은 컨테이너(PaneBody gap:12)가 담당. 둘 다 주면 24로 벌어진다.
    <div style={style}>
      {header != null && header !== '' ? (
        typeof header === 'string' || typeof header === 'number'
          ? <GroupHeader>{header}</GroupHeader>
          : header
      ) : null}
      <div style={{
        border: `1px solid ${C.line}`,
        borderRadius: R,
        background: C.taupeBg,
        overflow: 'hidden',
      }}>
        {items.map((child, i) => (
          <div
            key={isValidElement(child) && child.key != null ? String(child.key) : i}
            style={{ borderTop: i ? `1px solid ${C.line2}` : 'none' }}
          >
            {child}
          </div>
        ))}
      </div>
      {footer != null && footer !== '' ? (
        typeof footer === 'string' || typeof footer === 'number'
          ? <GroupFooter>{footer}</GroupFooter>
          : footer
      ) : null}
    </div>
  );
}

function displayValue(value: ReactNode): ReactNode {
  if (value == null || value === '') return <span style={{ color: C.faint }}>—</span>;
  return value;
}

/** 네비 행 — 탭 시 chevron. onClick=tap · href=nav. */
export function NavRow({
  icon,
  label,
  value,
  badge,
  onClick,
  href,
  danger,
}: {
  icon?: ReactNode;
  label: ReactNode;
  value?: ReactNode;
  badge?: ReactNode;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
}) {
  const mobile = useIsMobile();
  const interactive = !!(onClick || href);
  const rowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minHeight: ctrlH(mobile),
    padding: '0 12px',
    boxSizing: 'border-box',
    width: '100%',
    textDecoration: 'none',
    color: 'inherit',
    background: 'transparent',
    border: 'none',
    cursor: interactive ? 'pointer' : 'default',
    textAlign: 'left',
  };
  const body = (
    <>
      {icon != null ? <span style={{ flex: '0 0 auto', display: 'inline-flex', color: danger ? C.danger : C.mute }}>{icon}</span> : null}
      <span style={{
        flex: '1 1 auto',
        minWidth: 0,
        fontSize: FS.body,
        fontWeight: FW.body,
        color: danger ? C.danger : C.ink,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      {badge != null ? <span style={{ flex: '0 0 auto' }}>{badge}</span> : null}
      {value != null && value !== '' ? (
        <span style={{
          flex: '0 1 auto',
          maxWidth: '46%',
          minWidth: 0,
          fontSize: FS.body,
          color: C.mute,
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}>
          {value}
        </span>
      ) : null}
      {interactive ? (
        <ChevronRight size={16} strokeWidth={2.2} color={C.faint} aria-hidden style={{ flex: '0 0 auto' }} />
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="fp-press"
        onClick={() => { haptic.nav(); onClick?.(); }}
        style={rowStyle}
      >
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className="fp-press" onClick={() => { haptic.tap(); onClick(); }} style={rowStyle}>
        {body}
      </button>
    );
  }
  return <div style={rowStyle}>{body}</div>;
}

/**
 * 정보 행(네비 아님) — 라벨 좌 / 값 우.
 * stacked=값이 길 때 2줄(라벨 위·값 아래).
 */
export function DetailRow({
  label,
  value,
  stacked,
  valueColor,
}: {
  label: ReactNode;
  value?: ReactNode;
  stacked?: boolean;
  /** 금액 강조 등 — 기본 C.mute */
  valueColor?: string;
}) {
  const mobile = useIsMobile();
  const shown = displayValue(value);
  const plain = typeof value === 'string' || typeof value === 'number' || value == null || value === '';
  if (stacked) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minHeight: ctrlH(mobile),
        justifyContent: 'center',
        padding: '8px 12px',
        boxSizing: 'border-box',
      }}>
        <div style={{ fontSize: FS.body, color: C.mute }}>{label}</div>
        <div style={{
          fontSize: FS.body,
          color: valueColor ?? C.ink,
          fontVariantNumeric: 'tabular-nums',
          wordBreak: 'break-word',
        }}>
          {shown}
        </div>
      </div>
    );
  }
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      minHeight: ctrlH(mobile),
      padding: '0 12px',
      boxSizing: 'border-box',
    }}>
      {/* 정보행 SSOT — 라벨 mute / 값 ink(강조는 값에). 다른 정보행 구현들도 이 규격으로 수렴. */}
      <span style={{
        flex: '1 1 auto',
        minWidth: 0,
        fontSize: FS.body,
        color: C.mute,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      <span style={{
        flex: plain ? '0 1 auto' : '0 0 auto',
        maxWidth: plain ? '58%' : undefined,
        minWidth: 0,
        fontSize: FS.body,
        color: valueColor ?? C.ink,
        textAlign: 'right',
        overflow: plain ? 'hidden' : 'visible',
        textOverflow: plain ? 'ellipsis' : undefined,
        whiteSpace: plain ? 'nowrap' : undefined,
        fontVariantNumeric: 'tabular-nums',
        display: plain ? undefined : 'inline-flex',
        alignItems: plain ? undefined : 'center',
        justifyContent: 'flex-end',
        flexWrap: plain ? undefined : 'wrap',
        gap: plain ? undefined : 6,
      }}>
        {shown}
      </span>
    </div>
  );
}
