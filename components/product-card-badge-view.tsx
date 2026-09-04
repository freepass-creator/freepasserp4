'use client';

import type { EntityRecord } from '@/lib/intake/entities';
import { type Audience } from '@/lib/domain/product';
import { ICON } from '@/components/ui';
import { CircleCheck, Clock, CircleSlash, CircleDot, Tag, FileCheck, type LucideIcon } from 'lucide-react';
import { toneText } from '@/components/ui/badges';
import { MetaIcon } from '@/components/product-card-perks';
import {
  badgeTip, badgeSpecs, type BadgeSpec, HEAD_BADGE_KEYS,
} from '@/components/product-card-badges';


/**
 * ★**차량 신호는 상자(뱃지)가 아니라 아이콘 + 글자**
 *   (사장님 2026-08-28 「박스 뱃지 쓰지 말고 아이콘 텍스트 형태의 뱃지를 쓰자 · 우리도 기존에 썼었지 ·
 *    모든 곳에서 그렇게 하자」).
 *
 *   바로 아래 우대조건 줄(분납가능·만21세)이 이미 아이콘+글자다. 위는 상자, 아래는 아이콘+글자면
 *   한 카드 안에서 같은 성질의 값이 두 문법으로 서서, 무엇이 무엇인지 눈이 매번 다시 맞춘다.
 *   **문법을 하나로 맞춘다** — 색은 아이콘에만, 글자는 먹색.
 *
 *   ⚠ 아이콘은 «값»이 아니라 «갈래»를 가리킨다. 출고상태만 상태에 따라 그림이 갈린다
 *     (살 수 있나 / 기다려야 하나 / 안 되나) — 글자를 못 읽어도 그림으로 먼저 걸러진다.
 */
const SIGNAL_ICON = (key: string, label: string): LucideIcon => {
  if (key === 'pt') return Tag;
  if (key === 'cd') return FileCheck;
  if (key !== 'st') return CircleDot;
  if (/출고가능|즉시출고/.test(label)) return CircleCheck;
  if (/불가|종료|말소/.test(label)) return CircleSlash;
  return Clock; // 계약중·상품화중·출고협의 = 기다려야 하는 상태
};

export function SignalMarks({ p, audience = 'agent', keys, hideStatus, dense, chip }: {
  p: EntityRecord;
  audience?: Audience;
  /** 안 주면 하단 뱃지 차례(심사 → 출고상태 → 상품구분). */
  keys?: readonly string[];
  hideStatus?: boolean;
  dense?: boolean;
  /**
   * ★사진 위(썸네일 우하)일 때만 — **낱개마다 얇은 칩**을 두른다.
   * 사장님 2026-09-04 「두 개를 한 박스에 넣어놨잖아 · 박스를 달리해서 텍스트에 딱 붙여 두 개로」.
   * 한 그릇에 담으면 「출고가능 픽업구독」이 한 덩어리 문장처럼 읽힌다 — 둘은 «다른 갈래»다.
   * 칩은 글자에 딱 붙는다(좌우 6 · 상하 2) — 상자를 키우면 사진을 가린다.
   */
  chip?: boolean;
}) {
  const order = keys ?? HEAD_BADGE_KEYS;  // 기본 = 출고상태 · 상품구분(심사는 우대조건 줄이 든다)
  const byKey = new Map(badgeSpecs(p, false, false, audience).map((spec) => [spec.key, spec]));
  const specs = order
    .map((key) => byKey.get(key))
    .filter((spec): spec is BadgeSpec => !!spec && !(hideStatus && spec.key === 'st'));
  if (!specs.length) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: chip ? 4 : (dense ? 8 : 10),
      flexWrap: 'nowrap', overflow: 'hidden', minWidth: 0, flex: '0 1 auto', lineHeight: 1.35,
    }}>
      {specs.map((spec) => {
        const mark = (
          <MetaIcon
            icon={SIGNAL_ICON(spec.key, spec.label)}
            text={spec.label}
            size={ICON.sm}
            strong
            iconColor={chip ? undefined : toneText(spec.tone)}
            title={badgeTip(spec.key, spec.label)}
          />
        );
        if (!chip) return <span key={spec.key}>{mark}</span>;
        return (
          <span key={spec.key} className="fp-signal-chip">{mark}</span>
        );
      })}
    </div>
  );
}

/**
 * ★**뱃지는 언제나 «이름 바로 뒤»에 붙는다**(사장님 2026-08-23 「뱃지가 어떤 건 우측정렬 어떤 건 차종 뒤에 붙고 ·
 *   중구난방인데 규격 통일 좀」).
 *
 *   전에는 부르는 쪽마다 자리를 정했다 — 웹 행은 별도 칸에 우측정렬(`align='end'`),
 *   모바일 행은 차명 옆(`align='start'`). 같은 뱃지가 화면마다 다른 데 서니 눈이 매번 다시 찾는다.
 *   **기본을 «이름 뒤(start)»로 못 박는다** — 뱃지는 그 차를 설명하는 말이라 이름에 붙어 있어야 한다.
 *   표(엑셀보기)처럼 «칸이 정해진 자리»만 `align="end"` 를 명시해서 쓴다.
 */
export function CardRailBadges({ p, audience = 'agent', dense, align = 'start' }: {
  p: EntityRecord;
  audience?: Audience;
  dense?: boolean;
  align?: 'start' | 'end';
}) {
  /*
   * 상자(뱃지) 대신 **아이콘 + 글자**(사장님 2026-08-28 「모든 곳에서 그렇게 하자」).
   * 차례는 product-card-badges 가 정한다(HEAD_BADGE_KEYS) — 여기서 따로 적으면 또 갈린다.
   */
  return (
    <div style={{
      display: 'flex',
      justifyContent: align === 'start' ? 'flex-start' : 'flex-end', alignItems: 'center',
      flex: '0 0 auto', overflow: 'hidden', maxWidth: dense ? 200 : 280, minWidth: 0,
    }}>
      <SignalMarks p={p} audience={audience} dense={dense} />
    </div>
  );
}
