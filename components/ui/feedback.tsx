'use client';

import React from 'react';
import { C, FS, R } from './tokens';
import { Btn } from './buttons';

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      marginTop: 12,
      padding: 20,
      textAlign: 'center',
      color: C.faint,
      border: `1px solid ${C.line}`,
      borderRadius: R,
      background: C.taupeBg,
      fontSize: FS.body,
    }}>
      {children}
    </div>
  );
}

export function Loading({
  label = '불러오는 중…',
  minHeight = '100%',
  delayedAfterMs = 12_000,
}: {
  label?: React.ReactNode;
  minHeight?: string | number;
  /** 장시간 응답이 없을 때 무한 스피너 대신 사용자가 직접 복구할 수 있게 한다. */
  delayedAfterMs?: number;
}) {
  const [delayed, setDelayed] = React.useState(false);

  React.useEffect(() => {
    if (delayedAfterMs <= 0) return;
    const timer = window.setTimeout(() => setDelayed(true), delayedAfterMs);
    return () => window.clearTimeout(timer);
  }, [delayedAfterMs]);

  return (
    <div style={{
      minHeight,
      flex: 1,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      padding: '40px 16px',
      boxSizing: 'border-box',
    }}>
      <span
        aria-label="로딩"
        role="status"
        style={{
          width: 26,
          height: 26,
          border: `3px solid ${C.line}`,
          borderTopColor: C.brand,
          borderRadius: '50%',
          animation: 'fp-spin 0.7s linear infinite',
        }}
      />
      {/* 스피너 위 · 문구 아래 가운데정렬. 여러 줄로 접혀도 가운데 유지(textAlign 없으면 왼쪽으로 붙는다). */}
      {label != null && label !== '' && (
        <span style={{ fontSize: FS.sub, color: C.faint, textAlign: 'center', lineHeight: 1.45 }}>{label}</span>
      )}
      {delayed && (
        <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: FS.cap, color: C.mute, textAlign: 'center', lineHeight: 1.5 }}>
            평소보다 오래 걸리고 있습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.
          </span>
          <Btn size="sm" variant="ghost" onClick={() => window.location.reload()}>
            새로고침
          </Btn>
        </div>
      )}
    </div>
  );
}

/** 스켈레톤 박스 SSOT — shimmer. reduced-motion = .fp-skeleton 정적. */
export function Skeleton({
  width = '100%',
  height = 12,
  radius = R,
  style,
  className,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={className ? `fp-skeleton ${className}` : 'fp-skeleton'}
      style={{
        display: 'block',
        width,
        height,
        borderRadius: radius,
        background: 'var(--bg-placeholder)',
        ...style,
      }}
    />
  );
}

/** FeedListRow 3줄 골격 — title18 / badges20 / sub15. */
export function FeedRowSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div role="status" aria-label="목록 불러오는 중" style={{ width: '100%' }}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="fp-card-row"
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            padding: '8px 14px',
            borderBottom: `1px solid ${C.line}`,
            boxSizing: 'border-box',
          }}
        >
          <Skeleton width={28} height={28} radius={R} style={{ flex: '0 0 28px' }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <Skeleton width="72%" height={18} />
            <Skeleton width="48%" height={20} />
            <Skeleton width="58%" height={15} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** ProductCard / ProductRowCard 로딩 골격. */
export function ProductCardSkeleton({ count = 4, dense }: { count?: number; dense?: boolean }) {
  return (
    <div
      role="status"
      aria-label="상품 불러오는 중"
      style={{
        display: dense ? 'flex' : 'grid',
        flexDirection: dense ? 'column' : undefined,
        gridTemplateColumns: dense ? undefined : 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: dense ? 0 : 12,
        width: '100%',
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        dense ? (
          <div
            key={i}
            style={{
              display: 'flex', gap: 12, alignItems: 'stretch',
              padding: '10px 12px', borderBottom: `1px solid ${C.line}`,
              boxSizing: 'border-box',
            }}
          >
            <Skeleton width={56} height={56} radius={R} style={{ flex: '0 0 56px' }} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5, justifyContent: 'center' }}>
              <Skeleton width="85%" height={14} />
              <Skeleton width="55%" height={11} />
              <Skeleton width="70%" height={15} />
              <Skeleton width="40%" height={11} />
            </div>
          </div>
        ) : (
          <div
            key={i}
            style={{
              border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden',
              background: C.taupeBg,
            }}
          >
            <div style={{ position: 'relative', width: '100%', paddingTop: '50%', background: 'var(--bg-placeholder)' }}>
              <span className="fp-skeleton" style={{ position: 'absolute', inset: 0, display: 'block', borderRadius: 0 }} />
            </div>
            <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Skeleton width="90%" height={14} />
              <Skeleton width="60%" height={11} />
              <Skeleton width="70%" height={11} />
              <Skeleton width="50%" height={16} />
            </div>
          </div>
        )
      ))}
    </div>
  );
}

/**
 * 빈 상태 문구 — 패널 본문 한가운데.
 * minHeight '100%' = **PaneBody 안**에서 스크롤 박스를 채워 세로 중앙에 놓이기 위한 값이다.
 * 그래서 두 가지를 지켜야 한다(안 지키면 문구가 위로 붙거나 뒤 형제가 화면 밖으로 밀린다).
 *   · PaneHead의 형제로 두지 말 것 — 헤더 높이까지 먹어 문구 중심이 헤더 절반만큼 내려간다.
 *   · 뒤에 형제를 두지 말 것 — 이게 열을 다 먹어 형제가 스크롤 밖으로 밀린다. 함께 보여야 하면
 *     children 안에 넣는다(app/members/page.tsx 관리자 도구가 그렇게 눌리지 않았다).
 */
export function CenterNote({
  children,
  minHeight = '100%',
}: {
  children: React.ReactNode;
  minHeight?: string | number;
}) {
  return (
    <div style={{
      minHeight,
      flex: 1,
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: C.faint,
      fontSize: FS.body,
      textAlign: 'center',
      padding: '40px 16px',
      boxSizing: 'border-box',
    }}>
      {children}
    </div>
  );
}

export type MessageVariant = 'info' | 'success' | 'warning' | 'danger';

export function Message({
  variant = 'info',
  children,
}: {
  variant?: MessageVariant;
  children: React.ReactNode;
}) {
  const palette: Record<MessageVariant, { bg: string; border: string; color: string }> = {
    info: { bg: 'var(--blue-bg)', border: 'var(--blue-border)', color: 'var(--blue-text)' },
    success: { bg: 'var(--green-bg)', border: 'var(--green-border)', color: 'var(--green-text)' },
    warning: { bg: 'var(--orange-bg)', border: 'var(--orange-border)', color: 'var(--orange-text)' },
    danger: { bg: 'var(--red-bg)', border: 'var(--red-border)', color: 'var(--red-text)' },
  };
  const p = palette[variant];
  return (
    <div style={{
      marginTop: 12,
      padding: '12px 14px',
      borderRadius: R,
      border: `1px solid ${p.border}`,
      background: p.bg,
      color: p.color,
      fontSize: FS.body,
      lineHeight: 1.5,
    }}>
      {children}
    </div>
  );
}
