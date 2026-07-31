'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import {
  C, R, FW, FS, EXCEL_OPT_BOX_H, EXCEL_OPT_CHIP_H, EXCEL_OPT_ROW_GAP, EXCEL_BADGE_GAP_X,
} from '@/components/ui';
import { parseProductOptions } from '@/lib/domain/product';

/**
 * 안전망 상한 — **개수로 자르는 값이 아니다.**
 * 실제 잘림은 컨테이너 폭·높이(overflow hidden)가 정하고, `…`는 정말 넘칠 때만 붙는다.
 * 예전엔 이 값이 2라서 **폭이 남아도 2개에서 끊고 `…`를 달았다**(2026-07-31 사용자 지적).
 * 여기 남긴 이유는 옵션이 수십 개인 매물에서 DOM 노드를 무한정 만들지 않기 위해서다.
 */
const OPT_CHIP_MAX = 40;

/** 칩·엑셀용 — 도메인 `parseProductOptions`(구분 `,` `/`) 래퍼. */
export function productOptions(product: EntityRecord): string[] {
  return parseProductOptions(product.options);
}

export function OptionChips({ p, clamp, lines = 1, expand }: {
  p: EntityRecord;
  clamp?: boolean;
  lines?: 1 | 2;
  expand?: boolean;
}) {
  const options = productOptions(p);
  const rowRef = useRef<HTMLDivElement>(null);
  /** 측정용 유령 줄 — 항상 전량을 자연폭으로 그린다. 보이는 줄에서 재면 개수가 줄었다 늘었다 진동한다. */
  const ghostRef = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  /** 한 줄에 실제로 들어가는 칩 수. null = 아직 안 잼(전량 표시). */
  const [fit, setFit] = useState<number | null>(null);
  const wrap2 = lines >= 2;

  useEffect(() => {
    if (expand) return;
    const element = rowRef.current;
    if (!element) return;
    const check = () => {
      if (wrap2) {
        // 2줄 박스는 높이로 잘린다 — 두 줄을 꽉 채우고 넘칠 때만 …
        setClipped(element.scrollHeight > element.clientHeight + 1);
        return;
      }
      // 한 줄 — **폭이 허용하는 만큼 채우고**, 못 들어간 게 있을 때만 …
      //  개수로 미리 자르면(예전 OPT_CHIP_MAX=2) 폭이 남아도 잘린다.
      const ghost = ghostRef.current;
      const avail = element.clientWidth;
      if (!ghost || !avail) return;
      const kids = Array.from(ghost.children) as HTMLElement[];
      const GAP = 4;      // 칩 사이 간격(아래 렌더와 동일)
      const ELLIPSIS = 14; // … 자리
      let used = 0; let n = 0;
      for (let i = 0; i < kids.length; i++) {
        const w = kids[i].offsetWidth + (i ? GAP : 0);
        // 마지막 칩이 아니면 … 자리를 남겨 둔다
        const need = used + w + (i < kids.length - 1 ? ELLIPSIS : 0);
        if (need > avail) break;
        used += w; n++;
      }
      const shownCount = Math.max(1, n); // 하나도 안 들어가면 최소 1개는 보여준다(잘린 채로)
      setFit(shownCount);
      setClipped(shownCount < kids.length);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    if (ghostRef.current) observer.observe(ghostRef.current);
    return () => observer.disconnect();
  }, [options.join('\0'), clamp, wrap2, expand]);

  if (!options.length) {
    return (
      <div style={{
        fontSize: FS.cap, color: C.faint, lineHeight: 1.45,
        minWidth: 0, width: '100%',
      }}>옵션미입력</div>
    );
  }
  if (expand) {
    const chip: CSSProperties = {
      fontSize: FS.cap, color: C.mute, background: C.head, borderRadius: R,
      padding: '2px 8px', whiteSpace: 'nowrap',
    };
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, minWidth: 0, width: '100%' }}>
        {options.map((option, index) => <span key={index} style={chip}>{option}</span>)}
      </div>
    );
  }

  // 상한은 DOM 폭주 방지용 안전망일 뿐 — 실제 잘림은 폭·높이가 정한다.
  const capped = options.slice(0, OPT_CHIP_MAX);
  const shown = wrap2 ? capped : capped.slice(0, fit ?? capped.length);
  const tip = options.join(' · ');
  const more = clipped || options.length > capped.length;
  const optionChip: CSSProperties = wrap2 ? {
    fontSize: FS.cap, color: C.mute, background: C.head, borderRadius: R,
    padding: '0 5px', height: EXCEL_OPT_CHIP_H,
    display: 'inline-flex', alignItems: 'center',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    maxWidth: '100%', minWidth: 0, flex: '0 0 auto', boxSizing: 'border-box',
  } : {
    fontSize: FS.cap, color: C.mute, background: C.head, borderRadius: R,
    padding: '1px 5px',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    // flex 0 0 auto — 줄이지 않는다. 줄어들게 두면 칩이 전부 쭈그러들어 글자를 못 읽고,
    //  "몇 개가 들어가는가" 측정도 무의미해진다. 안 들어가는 칩은 …로 넘긴다.
    maxWidth: 140, minWidth: 0, flex: '0 0 auto', boxSizing: 'border-box',
  };

  if (wrap2) {
    return (
      <div title={tip} style={{ display: 'flex', alignItems: 'flex-start', gap: 4, minWidth: 0, width: '100%' }}>
        <div ref={rowRef} style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', alignContent: 'flex-start',
          columnGap: EXCEL_BADGE_GAP_X, rowGap: EXCEL_OPT_ROW_GAP, minWidth: 0, flex: '1 1 auto',
          maxHeight: EXCEL_OPT_BOX_H, overflow: 'hidden',
        }}>
          {shown.map((option, index) => <span key={index} style={optionChip}>{option}</span>)}
        </div>
        {more && (
          <span style={{
            flex: '0 0 auto', fontSize: FS.cap, fontWeight: FW.strong,
            color: C.faint, paddingInline: 2, letterSpacing: '0.04em', lineHeight: 1.2, marginTop: 2,
          }}>…</span>
        )}
      </div>
    );
  }

  return (
    <div title={tip} style={{
      display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, width: '100%',
      flexWrap: 'nowrap', overflow: 'hidden',
    }}>
      <div ref={rowRef} style={{
        display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: '1 1 auto',
        flexWrap: 'nowrap', overflow: 'hidden', position: 'relative',
      }}>
        {shown.map((option, index) => <span key={index} style={optionChip}>{option}</span>)}
        {/* … 는 **마지막 칩 바로 뒤**에 온다. 줄 밖 형제로 두면 줄이 남은 폭을 다 먹어
            점이 오른쪽 끝으로 떨어져 나가 무엇이 생략됐는지 안 읽힌다. */}
        {more && (
          <span style={{
            flex: '0 0 auto', fontSize: FS.cap, fontWeight: FW.strong,
            color: C.faint, paddingInline: 2, letterSpacing: '0.04em', lineHeight: 1,
          }}>…</span>
        )}
        {/* 측정 전용 — 항상 전량을 자연폭으로 그려 두고 여기서만 잰다.
            보이는 줄에서 재면 "줄였다 → 남네 → 늘렸다 → 넘치네" 로 진동한다. */}
        <div ref={ghostRef} aria-hidden style={{
          position: 'absolute', top: 0, left: 0, visibility: 'hidden', pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap', whiteSpace: 'nowrap',
        }}>
          {capped.map((option, index) => <span key={index} style={{ ...optionChip, maxWidth: 'none' }}>{option}</span>)}
        </div>
      </div>
    </div>
  );
}

/** @deprecated 카드는 OptionChips SSOT. 호환용 래퍼. */
export function OptionsInline({ p }: { p: EntityRecord }) {
  return <OptionChips p={p} clamp />;
}
