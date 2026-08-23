'use client';

import type { CSSProperties } from 'react';
import { Sparkles, type LucideIcon } from 'lucide-react';
import { type EntityRecord } from '@/lib/intake/entities';
import { benefitSignals, creditDisplay, eventSignals } from '@/lib/domain/product';
import { C, FW, FS, ICON } from '@/components/ui';
import { Badge, CREDIT_TONE } from '@/components/ui/badges';
import { badgeTip, benefitTip } from '@/components/product-card-badges';

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
 * CardBenefits — 조건(분납·무보증·연령·경력·무사고).
 *
 * **뱃지로 낸다.** 예전엔 아이콘+글자였는데 키마다 다른 아이콘 5개 + 다른 색 5가지라,
 * 한 카드에 다 붙으면 CORE 뱃지 3개와 뒤엉켜 무엇이 상태고 무엇이 혜택인지 안 잡혔다.
 * 회색 면 하나에 글자만 주색으로 통일하면 색이 5→1, 아이콘이 5→0 으로 줄고
 * «사각=혜택 / 알약=상태» 로 모양이 종류를 말해 준다. (2026-08-20 외부 시안 6벌 전부 이 결론)
 *
 * clamp=한 줄 말줄임 · inline=상태 뱃지 뒤에 이어붙임(width 100% 금지).
 */
export function CardBenefits({ p, dense, clamp, inline }: {
  p: EntityRecord; dense?: boolean; clamp?: boolean; inline?: boolean;
}) {
  const items = benefitSignals(p);
  const row: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: dense ? 4 : 5,
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
        <Badge key={s.key} variant="perk" title={benefitTip(s.key, s.label)}>{s.label}</Badge>
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
 *  creditFirst = 모바일 목록에서 상담 우선순위인 심사기준을 혜택보다 앞에 둔다.
 */
export function CardPerkLine({ p, dense, inline, creditFirst }: {
  p: EntityRecord; dense?: boolean; inline?: boolean; creditFirst?: boolean;
}) {
  const bens = benefitSignals(p);
  const credit = creditFirst ? creditDisplay(p) : '';
  const fs = FS.cap;
  if (!bens.length && !credit) {
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
      gap: 5, minHeight: 20,
      ...(inline ? { width: undefined, flex: '0 1 auto', overflow: 'hidden', lineHeight: 1.2 } : null),
    }}>
      {credit && (
        <Badge tone={CREDIT_TONE(credit)} title={badgeTip('cd', credit)}>{credit}</Badge>
      )}
      {bens.map((s) => (
        <Badge key={s.key} variant="perk" title={benefitTip(s.key, s.label)}>{s.label}</Badge>
      ))}
    </div>
  );
}
