'use client';

import type { CSSProperties } from 'react';
import { Wallet, UserRound, Briefcase, ShieldCheck, Sparkles, Coins, type LucideIcon } from 'lucide-react';
import { type EntityRecord } from '@/lib/intake/entities';
import { benefitSignals, eventSignals } from '@/lib/domain/product';
import { C, FW, FS, ICON } from '@/components/ui';
import { toneText } from '@/components/ui/badges';
import { benefitTip } from '@/components/product-card-badges';

/** MetaIcon — 혜택용. iconColor로 아이콘만 색(혜택 신호). */
export function MetaIcon({ icon: Icon, text, size = ICON.sm, strong, iconColor, title }: {
  icon: LucideIcon; text: string; size?: number; strong?: boolean; iconColor?: string; title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, flex: '0 0 auto', whiteSpace: 'nowrap',
        fontWeight: strong ? FW.strong : FW.body, color: strong ? C.ink : undefined,
        cursor: title ? 'help' : undefined,
      }}
    >
      <Icon size={size} strokeWidth={2.2} aria-hidden style={{ color: iconColor || C.faint, flex: '0 0 auto' }} />
      <span>{text}</span>
    </span>
  );
}

function benefitIcon(key: string): LucideIcon {
  if (key === 'ins') return Coins;
  if (key === 'nd') return Wallet;
  if (key === 'age') return UserRound;
  if (key === 'exp') return Briefcase;
  if (key === 'acc') return ShieldCheck;
  return Sparkles;
}

/** 혜택 아이콘 색 — 뱃지 tone과 맞춤(혜택이라 살짝 색). */
function benefitIconColor(key: string): string {
  if (key === 'ins') return toneText('teal');
  if (key === 'nd') return toneText('purple');
  if (key === 'age') return toneText('teal');
  if (key === 'exp') return toneText('purple');
  if (key === 'acc') return toneText('green');
  return C.brand;
}

function metaRow(dense: boolean, _mobile: boolean, strong?: boolean, clamp?: boolean, inline?: boolean): CSSProperties {
  // 카드 메타 = 웹/모바일 동일 치수
  const fs = FS.cap;
  return {
    display: 'flex', alignItems: 'center', gap: dense ? 8 : 10,
    flexWrap: clamp || inline ? 'nowrap' : 'wrap',
    overflow: clamp || inline ? 'hidden' : undefined,
    fontSize: fs, color: strong ? C.ink : C.mute, lineHeight: 1.35, minWidth: 0,
    width: inline ? undefined : (clamp ? '100%' : undefined),
    flex: inline ? '0 1 auto' : undefined,
  };
}

/** CardBenefits — 조건(분납·무보증·연령·경력·무사고).
 *  clamp=한 줄 말줄임 · inline=상태 뱃지 뒤에 이어붙임(width 100% 금지). */
export function CardBenefits({ p, dense, clamp, inline }: {
  p: EntityRecord; dense?: boolean; clamp?: boolean; inline?: boolean;
}) {
  const items = benefitSignals(p);
  if (!items.length) {
    return (
      <div style={{
        fontSize: FS.cap,
        color: C.faint, lineHeight: 1.35,
        flex: inline ? '0 0 auto' : undefined,
        whiteSpace: inline ? 'nowrap' : undefined,
      }}>조건없음</div>
    );
  }
  const ico = ICON.sm;
  return (
    <div style={metaRow(!!dense, false, true, clamp, inline)}>
      {items.map((s) => (
        <MetaIcon
          key={s.key}
          icon={benefitIcon(s.key)}
          text={s.label}
          size={ico}
          strong
          iconColor={benefitIconColor(s.key)}
          title={benefitTip(s.key, s.label)}
        />
      ))}
    </div>
  );
}

/** CardEvents — 한시 프로모. clamp=한 줄 · inline=뱃지 열에 이어붙임. */
export function CardEvents({ p, dense, clamp, inline }: {
  p: EntityRecord; dense?: boolean; clamp?: boolean; inline?: boolean;
}) {
  const items = eventSignals(p);
  if (!items.length) return null;
  const ico = ICON.sm;
  return (
    <div style={{ ...metaRow(!!dense, false, true, clamp, inline), color: C.brand }}>
      {items.map((s) => (
        <MetaIcon
          key={s.key}
          icon={Sparkles}
          text={s.label}
          size={ico}
          strong
          iconColor={C.brand}
          title={`이벤트: ${s.label}`}
        />
      ))}
    </div>
  );
}

/** 상세 4행 좌 · 간단 기간옆 — 조건. 없으면 조건없음.
 *  inline = 기간칩과 같은 wrap 흐름(width 100% 금지 → 60개월 옆으로 붙음).
 */
export function CardPerkLine({ p, dense, inline }: {
  p: EntityRecord; dense?: boolean; inline?: boolean;
}) {
  const bens = benefitSignals(p);
  const fs = FS.cap;
  if (!bens.length) {
    return (
      <div style={{
        fontSize: fs, color: C.faint, lineHeight: 1.35,
        minWidth: 0,
        width: inline ? undefined : '100%',
        flex: inline ? '0 0 auto' : undefined,
        whiteSpace: inline ? 'nowrap' : undefined,
      }}>조건없음</div>
    );
  }
  const ico = ICON.sm;
  return (
    <div style={{
      ...metaRow(!!dense, false, true, !inline),
      ...(inline ? { width: undefined, flex: '0 1 auto', overflow: 'hidden', lineHeight: 1.2 } : null),
    }}>
      {bens.map((s) => (
        <MetaIcon
          key={s.key}
          icon={benefitIcon(s.key)}
          text={s.label}
          size={ico}
          strong
          iconColor={benefitIconColor(s.key)}
          title={benefitTip(s.key, s.label)}
        />
      ))}
    </div>
  );
}
