'use client';
import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useIsMobile } from '@/lib/use-mobile';
import { C, R, FS } from '@/components/ui/tokens';
import { type BadgeTone, toneSoft, toneText } from '@/components/ui/badges';

/** 업무 목록 3줄 — 스캔성·한 화면에 많이. 행·아이콘을 키우면 피드가 되어 답답해진다. */
const LINE = {
  title: 18,   // FeedTitle
  badges: 20,  // Badge 레일 — Badge 실제 높이(20)와 일치시켜 삐져나옴·어긋남 제거
  sub: 15,     // FeedSub
} as const;

/**
 * 목록행 SSOT — 문의·계약·재고·정책.
 *   [상태 칩] + 3줄 본문. 상태칩은 작을수록 목록다움(B2C 큰 썸네일 금지).
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
  // 상태 칩(목록 레일) — 28/32. 40+면 피드·답답.
  const w = size ?? (mobile ? 28 : 32);
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
      {/* SVG=인라인이라 baseline 여백이 껴 미세하게 떠 보임 → block 으로 제거(정중앙 고정). */}
      <Icon size={mobile ? 14 : 15} strokeWidth={2.25} style={{ display: 'block' }} />
    </div>
  );
}

export function FeedListRow({
  thumb,
  lines,
  selected,
  onClick,
  href,
  accent,
}: {
  thumb?: ReactNode;
  /** 일반 목록 = 3줄 SSOT. (상품 파인더 ProductRowCard는 별도) */
  lines: ReactNode[];
  selected?: boolean;
  onClick?: () => void;
  href?: string;
  /** 주의환기 좌측 액센트 바 — 안읽음(amber)·진행중(blue) 등. 레이아웃 불변(inset). */
  accent?: BadgeTone;
}) {
  const mobile = useIsMobile();
  const gap = 3;
  const lineH = [LINE.title, LINE.badges, LINE.sub];
  const style: CSSProperties = {
    display: 'flex',
    gap: mobile ? 10 : 11,
    alignItems: 'center',
    padding: mobile ? '8px 14px' : '7px 14px',
    borderBottom: `1px solid ${C.line}`,
    background: selected ? C.selected : undefined, // 짝수 행 지브라는 globals.css(.fp-card-row:nth-child(even))가 담당
    boxShadow: accent ? `inset 3px 0 0 0 ${toneText(accent)}` : undefined,
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
      fontSize: FS.title, fontWeight: 700, color: C.ink, letterSpacing: '-0.02em',
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
      display: 'flex', alignItems: 'center', gap: 7,
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
