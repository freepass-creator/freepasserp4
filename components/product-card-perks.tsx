'use client';

import type { CSSProperties } from 'react';
import { Wallet, UserRound, Briefcase, ShieldCheck, Sparkles, Coins, type LucideIcon } from 'lucide-react';
import { type EntityRecord } from '@/lib/intake/entities';
import { benefitSignals, eventSignals } from '@/lib/domain/product';
import { C, FW, FS, ICON } from '@/components/ui';
import { toneText } from '@/components/ui/badges';
import { benefitTip } from '@/components/product-card-badges';

/**
 * 혜택 그림 — 「분납가능」·「만21세」를 글자 읽기 전에 알아보게 한다(사장님 2026-08-20
 * 「여기 하단에 우대조건 아이콘 있었는데 어디갔어」). 뱃지로 바꾸면서 같이 지웠던 것을 되살린다.
 *
 * ⚠ **색은 안 되돌린다.** 예전엔 키마다 다른 색(teal·purple·green) 5가지였는데, CORE 뱃지 3개와
 *   뒤엉켜 무엇이 상태고 무엇이 혜택인지 안 잡혔다. 그림은 그대로, 색만 하나(글자색)로 둔다.
 */
function benefitIcon(key: string): LucideIcon {
  if (key === 'ins') return Coins;
  if (key === 'nd') return Wallet;
  if (key === 'age') return UserRound;
  if (key === 'exp') return Briefcase;
  if (key === 'acc') return ShieldCheck;
  return Sparkles;
}

/**
 * 혜택 그림 색 — **다섯 갈래를 각각 다른 톤으로**(사장님 2026-08-20 「각 우대조건을 색깔을 달리해야 하고 · 은은하게」).
 *
 *   teal   분납(ins)      · purple 무보증(nd)   · blue  만21세(age)
 *   amber  경력무관(exp)  · green  무사고(acc)
 *
 * 성질 셋으로 묶어 봤다가 되돌렸다 — 조건마다 «다른 혜택»인데 같은 색이면 카드에서 구별이 안 된다.
 * 색은 `--bdg-*-fg`(글자 톤)라 원래 은은하다. 글자는 먹색 그대로이고 **그림에만** 색이 들어가므로
 * 다섯 색이어도 면이 시끄러워지지 않는다.
 * (면·머리띠 색 규칙은 docs/DESIGN_COLOR_LADDER.md — 그쪽은 네이비 하나. 여기는 그림 틴트라 별개다.)
 */
function benefitIconColor(key: string): string {
  if (key === 'ins') return toneText('teal');
  if (key === 'nd') return toneText('purple');
  if (key === 'age') return toneText('blue');
  if (key === 'exp') return toneText('amber');
  if (key === 'acc') return toneText('green');
  return C.brand;
}

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

/**
 * CardBenefits — 우대조건(분납·무보증·연령·경력·무사고).
 *
 * **아이콘 + 글자.** 상자(뱃지)를 씌우지 않는다 — 사장님 2026-08-20 「우대조건은 아이콘+텍스트지」.
 *   뱃지로 만들어 봤다가 되돌렸다: 한 카드에 CORE 뱃지 3개가 이미 상자로 서 있어서
 *   혜택까지 상자가 되면 8개가 같은 모양으로 늘어서 «상태인지 혜택인지»가 오히려 안 갈렸다.
 *   상자 없는 아이콘+글자는 그 자체로 «다른 종류»라 모양을 더 만들 필요가 없다.
 *
 * 아이콘에는 **조건마다 다른 은은한 톤**이 들어간다(benefitIconColor).
 *   글자는 먹색 그대로라 색은 그림에만 있고, 면·테두리에는 없다.
 *
 * clamp=한 줄 말줄임 · inline=상태 뱃지 뒤에 이어붙임(width 100% 금지).
 */
export function CardBenefits({ p, dense, clamp, inline }: {
  p: EntityRecord; dense?: boolean; clamp?: boolean; inline?: boolean;
}) {
  const items = benefitSignals(p);
  const row: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: dense ? 8 : 10,
    flexWrap: clamp || inline ? 'nowrap' : 'wrap',
    overflow: clamp || inline ? 'hidden' : undefined,
    // 혜택이 없는 차에서도 줄 높이를 지킨다 — 안 그러면 나란한 카드의 바닥선이 어긋난다.
    minHeight: 20,
    lineHeight: 1.35, minWidth: 0,
    width: inline ? undefined : (clamp ? '100%' : undefined),
    flex: inline ? '0 1 auto' : undefined,
  };
  if (!items.length) {
    return (
      <div style={{ ...row, fontSize: FS.cap, color: C.faint, whiteSpace: inline ? 'nowrap' : undefined }}>조건없음</div>
    );
  }
  return (
    <div style={row}>
      {items.map((s) => (
        <MetaIcon
          key={s.key}
          icon={benefitIcon(s.key)}
          text={s.label}
          size={ICON.sm}
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
          iconColor={benefitIconColor(s.key)}
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
  return (
    <div style={{
      ...metaRow(!!dense, false, true, !inline),
      minHeight: 20,
      ...(inline ? { width: undefined, flex: '0 1 auto', overflow: 'hidden', lineHeight: 1.2 } : null),
    }}>
      {bens.map((s) => (
        <MetaIcon
          key={s.key}
          icon={benefitIcon(s.key)}
          text={s.label}
          size={ICON.sm}
          strong
          iconColor={benefitIconColor(s.key)}
          title={benefitTip(s.key, s.label)}
        />
      ))}
    </div>
  );
}
