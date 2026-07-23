'use client';
import React from 'react';
import { C, R, NUM, FW, FS } from './tokens';
import { companyTone, companyShort } from '@/lib/companies';
import { useIsMobile } from '@/lib/use-mobile';

/**
 * 상태/라벨 SSOT — ERP 절제형.
 * 파스텔 필·좌측 | 바 금지. 헤어라인 + 톤 글자색.
 */
export type BadgeTone = 'gray' | 'green' | 'red' | 'amber' | 'blue' | 'orange' | 'purple' | 'teal';

/** [text, softBg, accent] — accent=왼쪽 바·솔리드 틴트용. */
const BADGE: Record<BadgeTone, [string, string, string]> = {
  gray: ['#52525b', '#f4f4f5', '#a1a1aa'],
  green: ['#166534', '#f0fdf4', '#16a34a'],
  red: ['#b91c1c', '#fef2f2', '#dc2626'],
  amber: ['#a16207', '#fefce8', '#ca8a04'],
  blue: ['#1e3a5f', '#f1f5f9', '#1B2A4A'],
  orange: ['#c2410c', '#fff7ed', '#ea580c'],
  purple: ['#5b21b6', '#faf5ff', '#7c3aed'],
  teal: ['#0f766e', '#f0fdfa', '#0d9488'],
};

export function toneText(tone: BadgeTone): string { return (BADGE[tone] || BADGE.gray)[0]; }
/** 연한 바탕(목록 상태 아이콘 등). */
export function toneSoft(tone: BadgeTone): string { return (BADGE[tone] || BADGE.gray)[1]; }
/** 사진 위 칩용 accent(테두리·워시). */
export function toneAccent(tone: BadgeTone): string { return (BADGE[tone] || BADGE.gray)[2]; }
export const ACTOR_TONE: Record<string, BadgeTone> = { agent: 'blue', provider: 'green', admin: 'orange' };
export function actorColor(actor: string): string { return toneText(ACTOR_TONE[actor] || 'gray'); }

export function Badge({ children, tone = 'gray', overlay = false, title, variant = 'line', frosted = false, pulse = false }: {
  children: React.ReactNode; tone?: BadgeTone; overlay?: boolean; title?: string;
  /** line=기본 · quiet=무채 · solid=약한틴트. 박스 크기 동일, 색만 다름. 좌측 | 바 없음. */
  variant?: 'line' | 'quiet' | 'solid' | 'fill';
  /** 사진 위 — 상세와 동일 톤·variant, 배경만 반투명+블러 */
  frosted?: boolean;
  /** 계약중 등 — 은은한 주황 펄스 */
  pulse?: boolean;
}) {
  const m = BADGE[tone] || BADGE.gray;
  // 카드·레일 뱃지 = 웹/모바일 동일 치수(SSOT). 터치타깃은 행·버튼이 담당.
  const h = frosted ? 18 : 20;
  const fs = FS.micro;
  const pulseCls = pulse ? 'fp-badge-pulse' : undefined;

  const shell: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    height: h, boxSizing: 'border-box',
    padding: frosted ? '0 6px' : '0 7px', borderRadius: R,
    fontSize: fs, fontWeight: FW.strong,
    whiteSpace: 'nowrap', letterSpacing: '-0.01em',
    lineHeight: 1,
    cursor: title ? 'help' : undefined,
  };

  if (overlay) {
    return (
      <span title={title} className={pulseCls} style={{
        ...shell, height: 16, fontSize: FS.micro,
        padding: '0 6px',
        color: '#fff', background: 'rgba(15,23,42,0.55)',
      }}>
        {children}
      </span>
    );
  }

  const v = variant === 'fill' ? 'solid' : variant;

  if (frosted) {
    // 상세 Badge와 같은 글자색·variant · 흰/틴트만 반투명+블러
    const bg = v === 'solid' ? `${m[1]}e6` : 'rgba(255,255,255,0.84)';
    const fg = v === 'quiet' ? (tone === 'red' ? m[0] : C.mute) : m[0];
    return (
      <span title={title} className={pulseCls} style={{
        ...shell,
        color: fg,
        background: bg,
        border: `1px solid ${C.line}`,
        boxShadow: '0 1px 2px rgba(15,23,42,0.08)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}>{children}</span>
    );
  }

  if (v === 'quiet') {
    return (
      <span title={title} className={pulseCls} style={{
        ...shell,
        color: tone === 'red' ? m[0] : C.mute,
        background: C.taupeBg,
        border: `1px solid ${C.line}`,
      }}>{children}</span>
    );
  }

  if (v === 'solid') {
    return (
      <span title={title} className={pulseCls} style={{
        ...shell,
        color: m[0], background: m[1], border: `1px solid ${C.line}`,
      }}>{children}</span>
    );
  }

  // line — 톤 글자색 + 헤어라인 (출고불가=red 등)
  return (
    <span title={title} className={pulseCls} style={{
      ...shell,
      color: m[0], background: C.taupeBg, border: `1px solid ${C.line}`,
    }}>{children}</span>
  );
}

/** 회사 뱃지 — 아웃라인 + 작은 톤 점. */
export function CompanyBadge({ co }: { co: string }) {
  const m = BADGE[companyTone(co)] || BADGE.gray;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
      height: 20, boxSizing: 'border-box',
      padding: '0 7px 0 6px', borderRadius: R,
      border: `1px solid ${C.line}`, background: C.taupeBg, color: C.ink,
      fontSize: FS.micro, fontWeight: FW.strong, whiteSpace: 'nowrap',
      lineHeight: 1,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 1, background: m[2], flex: '0 0 auto', opacity: 0.8 }} />
      {companyShort(co)}
    </span>
  );
}

/* 상태 = 점 + 텍스트. 필 뱃지 대신 기본 상태표시. */
type Tone = 'gray' | 'green' | 'red' | 'amber' | 'blue';
export function Status({ label, tone = 'gray' }: { label: React.ReactNode; tone?: Tone }) {
  const dot = { gray: '#a1a1aa', green: '#16a34a', red: '#dc2626', amber: '#ca8a04', blue: '#1B2A4A' }[tone];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: FS.sub, color: C.ink, whiteSpace: 'nowrap', fontWeight: FW.meta }}>
      <span style={{ width: 6, height: 6, borderRadius: 1, background: dot, flex: '0 0 6px' }} />
      {label}
    </span>
  );
}

export const STATUS_TONE: Record<string, Tone> = {
  운행: 'green', 대기: 'blue', 반납: 'gray', 해지: 'gray', 채권: 'red',
  구매대기: 'gray', 등록대기: 'gray', 상품화: 'blue', 상품대기: 'blue',
  연장대기: 'amber', 종료대기: 'amber', 휴차: 'gray', 정비: 'amber', 사고: 'amber',
  매각대기: 'gray', 매각: 'gray', 말소: 'gray',
};
export function StatusTag({ value }: { value: unknown }) {
  const s = String(value || '');
  return s ? <Status label={s} tone={STATUS_TONE[s] || 'gray'} /> : <span style={{ color: C.faint }}>—</span>;
}

export const RISK_TONE: Record<string, Tone> = {
  미수: 'red', 보험불일치: 'red', 반납지남: 'amber', 필수누락: 'red',
  보험만료: 'red', 보험임박: 'amber', 검사만료: 'red', 검사임박: 'amber',
  plate고아: 'amber', 날짜역전: 'red', 위반: 'amber', 사고: 'red',
};
/** 리스크 — solid(약한 틴트)만 허용. */
export function RiskTag({ kind }: { kind: string }) {
  return <Badge tone={RISK_TONE[kind] || 'gray'} variant="solid">{kind}</Badge>;
}
export function SevTag({ high }: { high: boolean }) {
  return <Badge tone={high ? 'red' : 'amber'} variant="solid">{high ? '위험' : '주의'}</Badge>;
}

export const PRODUCT_TYPE_TONE: Record<string, BadgeTone> = {
  '신차렌트': 'blue', '신차구독': 'blue', '중고렌트': 'gray', '중고구독': 'gray',
  '신차': 'blue', '중고': 'gray',
};

/**
 * 상품구분 — 은은한 2축 (박스 크기 동일):
 *  · 신차 → blue 글자 / 중고 → gray 글자
 *  · 렌트 → line(흰바탕) / 구독 → solid(아주 옅은 틴트)
 */
export function productTypeStyle(pt: string): { tone: BadgeTone; variant: 'line' | 'solid' } {
  const s = String(pt || '').replace(/\s+/g, '');
  const isNew = s.includes('신차');
  const isSub = s.includes('구독');
  return {
    tone: (PRODUCT_TYPE_TONE[s] || (isNew ? 'blue' : 'gray')) as BadgeTone,
    variant: isSub ? 'solid' : 'line',
  };
}
export const PERK_TONE = { 무보증: 'purple' as BadgeTone, 경력무관: 'purple' as BadgeTone };
export const CREDIT_TONE = (label: string): BadgeTone => (label === '무심사' ? 'green' : 'amber');
/** 출고상태 톤 — product.VEHICLE_STATUS_TONES SSOT */
export { VEHICLE_STATUS_TONES as VEHICLE_STATUS_TONE } from '@/lib/domain/product';
export const SETTLEMENT_STATUS_TONE: Record<string, BadgeTone> = {
  정산대기: 'amber', 정산완료: 'green', 정산보류: 'gray', 환수대기: 'red', 환수결정: 'red',
};

/** 필터 선택 개수 — erp3 m-filter-section-count. 작게 유지(헤더 늘어남 방지). */
export function CountPill({ n, tone = 'brand', max = 999 }: {
  n: number; tone?: BadgeTone | 'brand' | 'red'; max?: number;
}) {
  const mobile = useIsMobile();
  if (!n) return null;
  const label = n > max ? `${max}+` : String(n);
  if (tone === 'brand' || tone === 'blue') {
    return (
      <span
        title={`${n}개 선택`}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flex: '0 0 auto',
          minWidth: mobile ? 18 : 16, height: mobile ? 16 : 15, boxSizing: 'border-box',
          padding: '0 5px', borderRadius: R,
          background: C.brand, color: C.taupeBg,
          fontSize: FS.micro, fontWeight: FW.strong, lineHeight: 1,
          fontFamily: NUM, fontVariantNumeric: 'tabular-nums',
        }}
      >
        {label}
      </span>
    );
  }
  const t: BadgeTone = tone === 'red' ? 'red' : 'gray';
  return <Badge tone={t} variant="solid" title={`${n}개 선택`}>{label}</Badge>;
}
