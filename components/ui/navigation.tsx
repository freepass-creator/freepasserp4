'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, List, X } from 'lucide-react';
import { useIsMobile } from '@/lib/use-mobile';
import { Btn, IconBtn } from './buttons';
import { C, SH, ICON } from './tokens';

export type NavBackKind = 'history' | 'list' | 'cancel';

export function NavBack({
  kind = 'history',
  onClick,
  showLabel = false,
  size = 'sm',
}: {
  kind?: NavBackKind;
  onClick?: () => void;
  /** 모바일도 아이콘+텍스트(업무 swap 독 등). 기본=모바일 아이콘만. */
  showLabel?: boolean;
  /**
   * ★**같은 줄에 서는 컨트롤과 같은 size** (CLAUDE.md 컨트롤 규격).
   * 기본 sm — 상담방 머리줄처럼 짝이 sm 인 자리가 대부분이다.
   * 바(56)인 **하단 실행독은 md** 다 → `BottomNav` 가 md 를 넘긴다.
   * ⚠ 여기서 전역으로 md 를 박으면 짝이 sm 인 줄들이 대신 어긋난다(2026-08-30 실측).
   */
  size?: 'sm' | 'md';
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
  const Glyph = kind === 'list' ? List : kind === 'cancel' ? X : ChevronLeft;
  // 목록·취소는 모바일서 항상 아이콘+라벨(호출부 backShowLabel 의존 제거 → 전 페이지 자동 통일).
  // 이전(history)은 범용 back이라 아이콘only 유지(showLabel 주면 라벨).
  if (mobile && !showLabel && kind === 'history') {
    // 맨 글리프 = 크게(ICON.xl). 옆에 글자가 없으니 이게 곧 표적이다.
    return (
      <IconBtn haptic="back" title={label} onClick={go}>
        <Glyph size={mobile ? ICON.xl : ICON.md} strokeWidth={2.25} aria-hidden />
      </IconBtn>
    );
  }
  /**
   * ★size 는 «부르는 쪽»이 정한다 — 같은 줄에 서는 컨트롤과 같아야 한다(CLAUDE.md).
   *   하단독(바 56)은 md, 상담방 머리줄(32/40)은 sm. 전에는 여기서 sm 을 박아 두어 독에서
   *   「공유하기」(md 40)와 4px 어긋났다(사장님 2026-08-30 「이전하고 공유하기 크기가 좀 다른데?」).
   *   글리프는 어느 size 든 ICON.md — 라벨이 있는 버튼의 아이콘은 «글자 옆 표식»이지 표적이 아니다.
   *   (ICON.xl 20 은 라벨 없는 맨 글리프 전용. 위 아이콘only 갈래가 그걸 쓴다.)
   */
  return (
    <Btn variant="ghost" size={size} title={label} haptic="back" onClick={go}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Glyph size={ICON.md} strokeWidth={2.25} aria-hidden />
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
      {/* 독은 바(56) — 안에 서는 버튼은 전부 md. */}
      <NavBack kind={backKind} onClick={onBack} showLabel={backShowLabel} size="md" />
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
