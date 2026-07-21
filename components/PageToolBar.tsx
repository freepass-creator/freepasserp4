'use client';
import type { LucideIcon } from 'lucide-react';
import { CountPill, C } from '@/components/ui';
import { haptic } from '@/lib/haptics';

/**
 * 페이지 상단 툴바 SSOT (상품검색·업무목록 동일).
 *   아이콘+라벨 균등 행 → 탭 시 시트.
 *   스크롤에 안 딸려감 — 셸/파인더가 flex로 고정(sticky 아님).
 */
export type PageToolItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  /** 적용됨·건수 배지 */
  badge?: number;
  /** 조건이 켜진 상태(브랜드색) */
  active?: boolean;
  /** 시트 열림(aria-pressed) */
  pressed?: boolean;
  onClick: () => void;
};

export function PageToolBar({
  tools,
  hints,
  onClearHints,
  clearLabel = '해제',
}: {
  tools: PageToolItem[];
  hints?: string[];
  onClearHints?: () => void;
  clearLabel?: string;
}) {
  return (
    <div className="fp-page-toolbar is-page-tools">
      <div className="fp-page-tool-row">
        {tools.map((t) => {
          const Icon = t.icon;
          const on = !!(t.active || t.pressed);
          const badge = t.badge != null && t.badge > 0 ? t.badge : undefined;
          return (
            <button
              key={t.key}
              type="button"
              className="fp-press fp-page-tool"
              aria-label={badge != null ? `${t.label} ${badge}` : t.label}
              aria-pressed={!!t.pressed}
              data-active={on ? '1' : undefined}
              onClick={() => { haptic.tap(); t.onClick(); }}
            >
              <Icon size={18} strokeWidth={on ? 2.4 : 2} />
              <span>{t.label}</span>
              {badge != null ? (
                <span className="fp-page-tool-badge"><CountPill n={badge} /></span>
              ) : null}
            </button>
          );
        })}
      </div>
      {hints && hints.length > 0 ? (
        <div className="fp-page-tool-hints" title={hints.join(' · ')}>
          <span className="fp-page-tool-hints-label">적용</span>
          <span className="fp-page-tool-hints-text">{hints.join(' · ')}</span>
          {onClearHints ? (
            <button
              type="button"
              className="fp-press"
              onClick={() => { haptic.select(); onClearHints(); }}
              style={{
                flex: '0 0 auto', border: 'none', background: 'none',
                color: C.brand, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                padding: '0 2px',
              }}
            >
              {clearLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
