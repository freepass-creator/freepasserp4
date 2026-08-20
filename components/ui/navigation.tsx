'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, List, X } from 'lucide-react';
import { useIsMobile } from '@/lib/use-mobile';
import { Btn, IconBtn } from './buttons';
import { C, SH } from './tokens';

export type NavBackKind = 'history' | 'list' | 'cancel';

export function NavBack({
  kind = 'history',
  onClick,
  showLabel = false,
}: {
  kind?: NavBackKind;
  onClick?: () => void;
  /** 모바일도 아이콘+텍스트(업무 swap 독 등). 기본=모바일 아이콘만. */
  showLabel?: boolean;
}) {
  const router = useRouter();
  const mobile = useIsMobile();
  const go = () => {
    if (kind === 'list' || kind === 'cancel') {
      onClick?.();
      return;
    }
    if (onClick) {
      onClick();
      return;
    }
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push('/');
  };
  const label = kind === 'list' ? '목록' : kind === 'cancel' ? '취소' : '이전';
  const icon = kind === 'list'
    ? <List size={mobile ? 18 : 16} strokeWidth={2.25} aria-hidden />
    : kind === 'cancel'
    ? <X size={mobile ? 18 : 16} strokeWidth={2.25} aria-hidden />
    : <ChevronLeft size={mobile ? 18 : 16} strokeWidth={2.25} aria-hidden />;
  // 목록·취소는 모바일서 항상 아이콘+라벨(호출부 backShowLabel 의존 제거 → 전 페이지 자동 통일).
  // 이전(history)은 범용 back이라 아이콘only 유지(showLabel 주면 라벨).
  if (mobile && !showLabel && kind === 'history') {
    return <IconBtn haptic="back" title={label} onClick={go}>{icon}</IconBtn>;
  }
  return (
    <Btn variant="ghost" size="sm" title={label} haptic="back" onClick={go}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {icon}
        {label}
      </span>
    </Btn>
  );
}

export function BottomNav({
  actions,
  maxWidth = 1480,
  padX = 20,
  backKind = 'history',
  onBack,
  embedded,
  zIndex = 45,
  backShowLabel = false,
  sticky = false,
  gapTop,
}: {
  actions?: React.ReactNode;
  maxWidth?: number;
  padX?: number;
  /** 화면이 아니라 **자기가 속한 칼럼**을 따라다닌다(본문 안에 넣어 쓴다). */
  sticky?: boolean;
  backKind?: NavBackKind;
  onBack?: () => void;
  embedded?: boolean;
  zIndex?: number;
  /** 모바일 목록/이전에도 텍스트 라벨(swap 독). */
  backShowLabel?: boolean;
  /**
   * sticky 독 **위**의 여백. 본문 마지막 표와 독이 맞닿아 표의 일부처럼 보이는 걸 막는다.
   * 페이지 하단 패딩으로 만들면 안 된다 — sticky 는 그만큼 위로 떠서 바가 브라우저 바닥에서 떨어진다.
   */
  gapTop?: number;
}) {
  const mobile = useIsMobile();
  React.useEffect(() => {
    if (embedded) return;
    const el = document.querySelector('.fp-main-pad') as HTMLElement | null;
    if (el) document.documentElement.style.setProperty('--sbw', `${Math.max(0, el.offsetWidth - el.clientWidth)}px`);
  }, [embedded]);
  const row: React.CSSProperties = mobile || embedded
    ? {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 'var(--fp-bar-h)',
        boxSizing: 'border-box',
        padding: '0 var(--fp-bar-pad-x)',
        width: '100%',
      }
    : {
        maxWidth,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 'var(--fp-bar-h)',
        boxSizing: 'border-box',
        padding: `0 ${padX}px`,
      };
  const inner = (
    <div className="fp-action-dock__row" style={row}>
      <NavBack kind={backKind} onClick={onBack} showLabel={backShowLabel} />
      {actions != null && (
        <div className="fp-action-dock__actions" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
          {actions}
        </div>
      )}
    </div>
  );
  if (embedded) return inner;
  // 독의 껍데기(배경·윗선·그림자·안전영역)는 **여기 한 곳**에만 있다.
  //  페이지가 손으로 만들면 배경이 bg-page/bg-card로 갈리고 그림자가 빠진다(실제로 그랬다).
  const chrome: React.CSSProperties = {
    zIndex,
    boxSizing: 'border-box',
    background: C.taupeBg,
    borderTop: `1px solid ${C.line}`,
    boxShadow: SH.dock,
    paddingBottom: 'var(--fp-dock-safe, env(safe-area-inset-bottom))',
  };
  // sticky = 화면이 아니라 **자기가 속한 칼럼**을 따라다닌다. 옆에 보조 칼럼이 서서
  //  본문이 화면 중앙이 아닐 때 «상세 밑»을 지키는 유일한 방법이다(고정독은 화면 기준이라 어긋난다).
  if (sticky) return <div className="fp-action-dock fp-action-dock--sticky" style={{ ...chrome, position: 'sticky', bottom: 0, marginTop: gapTop }}>{inner}</div>;
  return (
    <div className="fp-action-dock" style={{
      ...chrome,
      position: 'fixed',
      left: 0,
      right: 0,
      bottom: 'var(--fp-tabbar-h, 0px)',
      paddingRight: 'var(--sbw, 0px)',
    }}>
      {inner}
    </div>
  );
}
