'use client';

import React from 'react';
import { Badge } from './badges';
import { C, FS, FW, R } from './tokens';

/* 링크·선택형 리스트 행 — WorkPage 목록 SSOT. selected = C.selected. */
/* 업무 목록행 = FeedListRow(ui/feedrow) + list-rows 도메인행. 이 2줄 ListRow는 보조/단순용. */
export function ListRow({ badge, badgeTone = 'gray', main, sub, right, href, onClick, selected }: {
  badge?: React.ReactNode;
  badgeTone?: 'gray' | 'green' | 'red' | 'amber' | 'blue';
  main: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  selected?: boolean;
}) {
  const style: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '11px 14px',
    borderBottom: `1px solid ${C.line2}`,
    background: selected ? C.selected : 'transparent',
    textDecoration: 'none',
    color: 'inherit',
    cursor: href || onClick ? 'pointer' : 'default',
  };
  const content = (
    <>
      {badge != null && <Badge tone={badgeTone}>{badge}</Badge>}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{ fontSize: FS.body, fontWeight: FW.title, color: C.ink, minWidth: 0, overflow: 'hidden' }}>{main}</div>
        {sub != null && <div style={{ fontSize: FS.cap, color: C.mute, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
      </div>
      {right}
    </>
  );
  if (href) {
    return (
      <a href={href} aria-current={selected ? 'true' : undefined} onClick={onClick} style={style}>
        {content}
      </a>
    );
  }
  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-current={selected ? 'true' : undefined}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onClick();
        }}
        style={style}
      >
        {content}
      </div>
    );
  }
  return <div style={style}>{content}</div>;
}

export function ListBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10, border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden', background: C.taupeBg }}>
      {children}
    </div>
  );
}
