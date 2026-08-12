'use client';
import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { C, R, FS, FW, ICON, ctrlH } from '@/components/ui/tokens';
import { type BadgeTone, toneSoft, toneText } from '@/components/ui/badges';

/**
 * 업무 목록 2줄(카톡형) — ①주제·메타 ②맥락·안읽음.
 * 상태는 왼쪽 아이콘 색이 맡고, 중간 뱃지 레일(구 3줄의②)은 접는다.
 */
export const FEED_LINE = {
  title: 18, // FeedTitle
  sub: 20,   // FeedSub·Badge·CountPill — 뱃지 실높이(20)와 맞춤
  gap: 3,
} as const;

/**
 * 목록행 SSOT — 문의·계약·재고·정책·회원·정산.
 *   [상태 칩] + 2줄 본문. 칩 = ctrlH(웹32/모바일36) — 2줄 본문과 눈높이 맞춤.
 */
export function FeedThumbIcon({
  icon: Icon,
  tone = 'gray',
  size,
  title,
  decorative = false,
}: {
  icon: LucideIcon;
  tone?: BadgeTone;
  size?: number;
  /** 접근성 — 상태 요약 */
  title?: string;
  /** 같은 상태가 행 안의 텍스트로 이미 제공되면 중복 낭독하지 않는다. */
  decorative?: boolean;
}) {
  const mobile = useIsMobile();
  const w = size ?? ctrlH(mobile);
  return (
    <div
      role={title && !decorative ? 'img' : undefined}
      aria-label={title && !decorative ? title : undefined}
      aria-hidden={!title || decorative ? true : undefined}
      title={title}
      style={{
        position: 'relative',
        width: w,
        flex: `0 0 ${w}px`,
        height: w,
        alignSelf: 'center',
        borderRadius: R,
        background: toneSoft(tone),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: toneText(tone),
        overflow: 'hidden',
      }}
    >
      {/* SVG=인라인이라 baseline 여백이 껴 미세하게 떠 보임 → block 으로 제거(정중앙 고정). */}
      <Icon size={mobile ? ICON.lg : ICON.md} strokeWidth={2.25} style={{ display: 'block' }} />
    </div>
  );
}

export function FeedListRow({
  thumb,
  lines,
  selected,
  attentionTone,
  onClick,
  href,
}: {
  thumb?: ReactNode;
  /** 일반 목록 = 2줄 SSOT. (상품 파인더 ProductRowCard는 별도) */
  lines: ReactNode[];
  selected?: boolean;
  /** 목록에서 즉시 처리할 행의 좌측 신호. 상태 의미는 도메인 행이 결정한다. */
  attentionTone?: 'amber' | 'red';
  onClick?: () => void;
  href?: string;
}) {
  const mobile = useIsMobile();
  const lineH = [FEED_LINE.title, FEED_LINE.sub];
  const style: CSSProperties = {
    display: 'flex',
    gap: mobile ? 10 : 11,
    alignItems: 'center',
    padding: mobile ? '8px 12px' : '7px 14px', // 모바일 좌우 12 = 툴바·독과 좌측 정렬 일치
    borderBottom: `1px solid ${C.line}`,
    // 선택은 배경으로만 표시한다. 상태는 썸네일 아이콘·배지·카운트로 전달한다.
    background: selected ? C.selected : undefined, // 짝수 행 지브라는 globals.css(.fp-card-row:nth-child(even))가 담당
    textDecoration: 'none',
    color: 'inherit',
    cursor: href || onClick ? 'pointer' : 'default',
    boxSizing: 'border-box',
  };
  const body = (
    <>
      {thumb ?? null}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: FEED_LINE.gap,
        flex: '1 1 auto',
        minWidth: 0,
        justifyContent: 'center',
      }}>
        {lines.slice(0, 2).map((line, i) => (
          <div
            key={i}
            style={{
              minWidth: 0,
              width: '100%',
              height: lineH[i] ?? FEED_LINE.sub,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </>
  );
  if (href) {
    return <a href={href} className="fp-card fp-card-row" data-attention={attentionTone} style={style} onClick={() => haptic.nav()}>{body}</a>;
  }
  return (
    <div role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      aria-current={onClick && selected ? 'true' : undefined}
      data-attention={attentionTone}
      className="fp-card fp-card-row"
      onClick={onClick ? () => { haptic.tap(); onClick(); } : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      style={style}
    >
      {body}
    </div>
  );
}

/** 1줄 타이틀 */
export function FeedTitle({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <div style={{
      fontSize: FS.title, fontWeight: FW.title, color: C.ink, letterSpacing: '-0.02em',
      lineHeight: `${FEED_LINE.title}px`, height: FEED_LINE.title,
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      fontFamily: mono ? 'var(--font-mono)' : undefined,
      width: '100%',
    }}>
      {children}
    </div>
  );
}

/** 뮤트 한 줄(메시지·스펙) — 개행·연속공백 무시, 말줄임 */
export function FeedSub({ children, strong }: { children: ReactNode; strong?: boolean }) {
  const text = typeof children === 'string' || typeof children === 'number'
    ? String(children).replace(/\s+/g, ' ').trim()
    : children;
  return (
    <div style={{
      fontSize: FS.sub,
      fontWeight: strong ? FW.strong : FW.meta,
      color: C.mute,
      lineHeight: `${FEED_LINE.sub}px`, height: FEED_LINE.sub,
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      width: '100%',
    }}>
      {text}
    </div>
  );
}

/** 뱃지·칩 가로 레일 — 한 줄 고정, 넘치면 잘림(2줄 행의 ②에 얹을 때) */
export function FeedBadges({ children }: { children: ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 7,
      minWidth: 0, width: '100%', height: FEED_LINE.sub,
      overflow: 'hidden', flexWrap: 'nowrap',
    }}>
      {children}
    </div>
  );
}

/** 타이틀 행에 우측 메타(시간·진행률) */
export function FeedTitleRow({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, width: '100%',
      height: FEED_LINE.title,
    }}>
      <div style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden' }}>{title}</div>
      {meta != null ? <div style={{ flex: '0 0 auto', lineHeight: 1 }}>{meta}</div> : null}
    </div>
  );
}
