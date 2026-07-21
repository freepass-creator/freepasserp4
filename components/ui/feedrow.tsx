'use client';
import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useIsMobile } from '@/lib/use-mobile';
import { C, R, FS } from '@/components/ui/tokens';
import { type BadgeTone, toneSoft, toneText } from '@/components/ui/badges';

/** 일반 목록 3줄 행 — 줄 높이 고정(내용 길이와 무관).
 *  ERP 목록 = 스캔성 우선(한 화면에 많이). 값을 키우면 보이는 건수가 줄어 목록의 본분이 깨진다. */
const LINE = {
  title: 19,   // FeedTitle 14.5
  badges: 20,  // Badge 레일
  sub: 15,     // FeedSub 12
} as const;

/**
 * 피드 목록행 SSOT — 상품 ProductRowCard와 같은 DNA.
 *   [상태 아이콘] + 3줄 본문 (문의·계약·재고)
 * 줄 높이 고정 → 채팅 내용·뱃지 길이와 무관하게 행 높이 동일.
 * tone = 확인필요·진행·판매중 등 상태색.
 */
export function FeedThumbIcon({
  icon: Icon,
  tone = 'gray',
  size,
  title,
}: {
  icon: LucideIcon;
  tone?: BadgeTone;
  size?: number;
  /** 접근성 — 상태 요약 */
  title?: string;
}) {
  const mobile = useIsMobile();
  // 상태 표시용 레일 — 사진이 아니라 "상태 한 글자"다. 크게 두면 목록이 B2C 피드처럼 보이고 스캔성이 죽는다.
  const w = size ?? (mobile ? 40 : 44);
  return (
    <div
      aria-hidden={title ? undefined : true}
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
      <Icon size={mobile ? 18 : 20} strokeWidth={2} />
    </div>
  );
}

export function FeedListRow({
  thumb,
  lines,
  selected,
  onClick,
  href,
}: {
  thumb: ReactNode;
  /** 일반 목록 = 3줄 SSOT. (상품 파인더 ProductRowCard는 별도) */
  lines: ReactNode[];
  selected?: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const mobile = useIsMobile();
  const gap = 3;
  const lineH = [LINE.title, LINE.badges, LINE.sub];
  const style: CSSProperties = {
    display: 'flex',
    gap: mobile ? 10 : 11,
    alignItems: 'center',
    padding: mobile ? '8px 12px' : '8px 14px',
    borderBottom: `1px solid ${C.line2}`,
    background: selected ? C.selected : 'transparent',
    textDecoration: 'none',
    color: 'inherit',
    cursor: href || onClick ? 'pointer' : 'default',
    boxSizing: 'border-box',
  };
  const body = (
    <>
      {thumb}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap,
        flex: '1 1 auto',
        minWidth: 0,
        justifyContent: 'center',
      }}>
        {lines.slice(0, 3).map((line, i) => (
          <div
            key={i}
            style={{
              minWidth: 0,
              width: '100%',
              height: lineH[i] ?? LINE.sub,
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
    return <a href={href} className="fp-card fp-card-row" style={style}>{body}</a>;
  }
  return (
    <div role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      className="fp-card fp-card-row"
      onClick={onClick}
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
      fontSize: FS.title, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em',
      lineHeight: `${LINE.title}px`, height: LINE.title,
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
      fontWeight: strong ? 600 : 500,
      color: strong ? C.mute : C.faint,
      lineHeight: `${LINE.sub}px`, height: LINE.sub,
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      width: '100%',
    }}>
      {text}
    </div>
  );
}

/** 뱃지·칩 가로 레일 — 한 줄 고정, 넘치면 잘림 */
export function FeedBadges({ children }: { children: ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      minWidth: 0, width: '100%', height: LINE.badges,
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
      height: LINE.title,
    }}>
      <div style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden' }}>{title}</div>
      {meta != null ? <div style={{ flex: '0 0 auto', lineHeight: 1 }}>{meta}</div> : null}
    </div>
  );
}
