'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import {
  C, R, FW, FS, EXCEL_OPT_BOX_H, EXCEL_OPT_CHIP_H, EXCEL_OPT_ROW_GAP, EXCEL_BADGE_GAP_X,
} from '@/components/ui';

const OPT_CHIP_MAX = 2;

export function productOptions(product: EntityRecord): string[] {
  return String(product.options || '').split(/[,/]/).map((option) => option.trim()).filter(Boolean);
}

export function OptionChips({ p, clamp, lines = 1, expand }: {
  p: EntityRecord;
  clamp?: boolean;
  lines?: 1 | 2;
  expand?: boolean;
}) {
  const options = productOptions(p);
  const rowRef = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  const wrap2 = lines >= 2;

  useEffect(() => {
    if (expand) return;
    const element = rowRef.current;
    if (!element) return;
    const check = () => {
      if (wrap2) setClipped(element.scrollHeight > element.clientHeight + 1);
      else setClipped(element.scrollWidth > element.clientWidth + 1);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
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
      fontSize: FS.sub, color: C.mute, background: C.head, borderRadius: R,
      padding: '2px 8px', whiteSpace: 'nowrap',
    };
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, minWidth: 0, width: '100%' }}>
        {options.map((option, index) => <span key={index} style={chip}>{option}</span>)}
      </div>
    );
  }

  const over = options.length > OPT_CHIP_MAX;
  const shown = over ? options.slice(0, OPT_CHIP_MAX) : options;
  const tip = options.join(' · ');
  const more = over || clipped;
  const optionChip: CSSProperties = wrap2 ? {
    fontSize: FS.sub, color: C.mute, background: C.head, borderRadius: R,
    padding: '0 5px', height: EXCEL_OPT_CHIP_H,
    display: 'inline-flex', alignItems: 'center',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    maxWidth: '100%', minWidth: 0, flex: '0 0 auto', boxSizing: 'border-box',
  } : {
    fontSize: FS.cap, color: C.mute, background: C.head, borderRadius: R,
    padding: '1px 5px',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    maxWidth: 140, minWidth: 0, flex: '0 1 auto', boxSizing: 'border-box',
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
        flexWrap: 'nowrap', overflow: 'hidden',
      }}>
        {shown.map((option, index) => <span key={index} style={optionChip}>{option}</span>)}
      </div>
      {more && (
        <span style={{
          flex: '0 0 auto', fontSize: FS.cap, fontWeight: FW.strong,
          color: C.faint, paddingInline: 2, letterSpacing: '0.04em', lineHeight: 1,
        }}>…</span>
      )}
    </div>
  );
}

/** @deprecated 카드는 OptionChips SSOT. 호환용 래퍼. */
export function OptionsInline({ p }: { p: EntityRecord }) {
  return <OptionChips p={p} clamp />;
}
