'use client';
import React from 'react';
import { C, R, NUM, FW, FS, SH, SCRIM } from './tokens';
import { companyTone, companyShort } from '@/lib/companies';
import { colorChip } from '@/lib/domain/color-chips';
import { useIsMobile } from '@/lib/use-mobile';

/**
 * 상태/라벨 SSOT — ERP 절제형.
 * 파스텔 필·좌측 | 바 금지. 헤어라인 + 톤 글자색.
 */
export type BadgeTone = 'gray' | 'green' | 'red' | 'amber' | 'blue' | 'orange' | 'purple' | 'teal';

/** [text, softBg, accent] — accent=아이콘·점·솔리드 틴트용.
 * 값 = globals.css --bdg-* 변수(라이트/다크 SSOT). 여기 hex 직접 금지(다크모드 깨짐 원흉이었음). */
const BADGE: Record<BadgeTone, [string, string, string]> = {
  gray: ['var(--bdg-gray-fg)', 'var(--bdg-gray-bg)', 'var(--bdg-gray-ac)'],
  green: ['var(--bdg-green-fg)', 'var(--bdg-green-bg)', 'var(--bdg-green-ac)'],
  red: ['var(--bdg-red-fg)', 'var(--bdg-red-bg)', 'var(--bdg-red-ac)'],
  amber: ['var(--bdg-amber-fg)', 'var(--bdg-amber-bg)', 'var(--bdg-amber-ac)'],
  blue: ['var(--bdg-blue-fg)', 'var(--bdg-blue-bg)', 'var(--bdg-blue-ac)'],
  orange: ['var(--bdg-orange-fg)', 'var(--bdg-orange-bg)', 'var(--bdg-orange-ac)'],
  purple: ['var(--bdg-purple-fg)', 'var(--bdg-purple-bg)', 'var(--bdg-purple-ac)'],
  teal: ['var(--bdg-teal-fg)', 'var(--bdg-teal-bg)', 'var(--bdg-teal-ac)'],
};

export function toneText(tone: BadgeTone): string { return (BADGE[tone] || BADGE.gray)[0]; }
/** 연한 바탕(목록 상태 아이콘 등). */
export function toneSoft(tone: BadgeTone): string { return (BADGE[tone] || BADGE.gray)[1]; }
/** 사진 위 칩용 accent(테두리·워시). */
export function toneAccent(tone: BadgeTone): string { return (BADGE[tone] || BADGE.gray)[2]; }
export const ACTOR_TONE: Record<string, BadgeTone> = { agent: 'blue', provider: 'green', admin: 'orange' };
export function actorColor(actor: string): string { return toneText(ACTOR_TONE[actor] || 'gray'); }

export function Badge({ children, tone = 'gray', overlay = false, title, variant = 'line', frosted = false, pulse = false, size }: {
  children: React.ReactNode; tone?: BadgeTone; overlay?: boolean; title?: string;
  /** line=기본 · quiet=무채 · solid=약한틴트 · perk=혜택(면은 분류와 같고 글자만 주색). 박스 크기 동일, 색만 다름. 좌측 | 바 없음. */
  variant?: 'line' | 'quiet' | 'solid' | 'fill' | 'perk';
  /** 사진 위 — 상세와 동일 톤·variant, 배경만 반투명+블러 */
  frosted?: boolean;
  /** 계약중 등 — 은은한 주황 펄스 */
  pulse?: boolean;
  /** 글자 크기(기본 micro=10). 표·엑셀은 기본, 상품카드 레일은 sub=12로 또렷하게. */
  size?: number;
}) {
  const m = BADGE[tone] || BADGE.gray;
  // 카드·레일 뱃지 = 웹/모바일 동일 치수(SSOT). 터치타깃은 행·버튼이 담당.
  const fs = size ?? FS.micro;
  // 기본(size 미지정) 높이 20 유지(엑셀·표 행 맞춤). size 지정 시에만 글자+8로 여백 확보(상한 22).
  const h = frosted ? 18 : (size ? Math.min(22, fs + 8) : 20);
  const pulseCls = pulse ? 'fp-badge-pulse' : undefined;

  const shell: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 3,
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
        color: C.inverse, background: SCRIM.heavy,
      }}>
        {children}
      </span>
    );
  }

  const v = variant === 'fill' ? 'solid' : variant;

  if (frosted) {
    // 상세 Badge와 같은 글자색·variant · 흰/틴트만 반투명+블러
    const bg = v === 'solid' ? `color-mix(in srgb, ${m[1]} 90%, transparent)` : `color-mix(in srgb, ${C.inverse} 84%, transparent)`;
    const fg = v === 'quiet' ? (tone === 'red' ? m[0] : C.mute) : m[0];
    return (
      <span title={title} className={pulseCls} style={{
        ...shell,
        color: fg,
        background: bg,
        border: `1px solid ${C.line}`,
        boxShadow: SH.cardRest,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}>{children}</span>
    );
  }

  if (v === 'perk') {
    // 혜택(분납·무보증·만21세·경력무관·무사고) — 면은 분류 뱃지와 같게 두고 «글자만» 주색으로 세운다.
    // ⚠ 흐리게 만들어 조용하게 하려 들면 안 된다: 영업사원이 카드에서 가장 먼저 찾는 값이다.
    //   시끄러움은 세기를 낮춰서가 아니라 갈래(모양·자리)를 나눠서 푼다.
    return (
      <span title={title} className={pulseCls} style={{
        ...shell,
        color: C.ink, fontWeight: FW.title,
        background: BADGE.gray[1], border: `1px solid ${C.line}`,
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
  const dot = toneAccent(tone); // 점 색 = BADGE accent SSOT(로컬 hex맵 제거)
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
  // 픽업구독(손오공 T카) = 중고구독과 다른 갈래라 색도 가른다(2026-08-28).
  '픽업구독': 'teal',
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
export function CountPill({ n, tone = 'brand', max = 999, title }: {
  n: number; tone?: BadgeTone | 'brand' | 'red' | 'accent'; max?: number; title?: string;
}) {
  const mobile = useIsMobile();
  if (!n) return null;
  const label = n > max ? `${max}+` : String(n);
  // accent = 필터 카운트 뱃지용(해제색=링크 블루). pill 규격은 brand와 100% 동일, 배경색만.
  if (tone === 'brand' || tone === 'blue' || tone === 'accent') {
    return (
      <span
        title={title || `${n}개 선택`}
        aria-label={title || undefined}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flex: '0 0 auto',
          // 높이 15 = 목록행 sub 줄(LINE.sub=15, overflow:hidden)에 딱 맞춤 — 모바일 16이면 그 줄에 세로로 잘렸음(문의 안읽음 뱃지).
          minWidth: mobile ? 18 : 16, height: 15, boxSizing: 'border-box',
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
  return <Badge tone={t} variant="solid" title={title || `${n}개 선택`}>{label}</Badge>;
}

/**
 * **색 견본** — 색 이름 옆에 그 «색»을 동그라미로 보여 준다.
 *
 * ★왜(사장님 2026-09-05 「그 **색상 칩**을 만들었거든? 이렇게 색상 보이는 거, **직관적으로**?
 *   색상 칩 달아주면 되고」). 「소닉실버」·「어비스블랙펄」 같은 이름은 **글자로는 무슨 색인지 모른다.**
 *   차를 고르는 사람이 제일 먼저 보는 값인데 이름만 있으면 매번 상상해야 한다.
 * ★색 코드는 `lib/domain/color-chips` 가 정본이다 — 여기서 hex 를 새로 정하지 않는다(로컬 색맵 금지).
 *   못 알아보는 이름은 동그라미 없이 «이름만» 나간다. 모르는 색을 회색으로 지어내지 않는다.
 * ★흰·실버처럼 옅은 색은 테두리를 둘러야 보인다(`chip.border`).
 */
export function ColorDot({ name, size = 12 }: { name: unknown; size?: number }) {
  const chip = colorChip(name);
  if (!chip) return null;
  return (
    <span aria-hidden style={{
      display: 'inline-block', flex: '0 0 auto',
      width: size, height: size, borderRadius: 999,
      background: chip.code,
      border: chip.border ? `1px solid ${C.line}` : 'none',
      boxSizing: 'border-box',
    }} />
  );
}

/**
 * **색 한 칸** — 견본 + 이름. 앞에 「외부」·「내부」 같은 꼬리표를 붙일 수 있다.
 * 이름이 없으면 아무것도 안 그린다(빈 동그라미를 남기지 않는다).
 */
export function ColorMark({ name, label, size = 12, fontSize }: {
  name: unknown; label?: string; size?: number;
  /** 글자 크기 — 숫자든 CSS 변수든 받는다(손님 동 사다리는 폰에서 한 단 올라간다). */
  fontSize?: number | string;
}) {
  const text = String(name ?? '').trim();
  if (!text) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
      {label ? <span style={{ color: C.faint, fontWeight: FW.meta, fontSize: fontSize ?? FS.cap }}>{label}</span> : null}
      <ColorDot name={text} size={size} />
      <span>{text}</span>
    </span>
  );
}
