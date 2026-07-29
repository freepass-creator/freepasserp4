'use client';
import type { ReactNode } from 'react';
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { Btn } from '@/components/ui';
import { haptic } from '@/lib/haptics';

/**
 * 하단 액션 슬롯 SSOT.
 *   목록: [등록…]
 *   보기: [수정] [삭제] [등록…]  — 선택 건 기준 액션 + 신규
 *   신규·수정: [취소] [저장]
 * 페이지는 이 조합만 — Btn 나열 손롤 지양.
 * 독 액션은 폭 여유 있음 → 아이콘+텍스트(아이콘온리 금지).
 */
export type PageActionSpec = {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
};

export function PageActions({
  primary,
  edit,
  cancel,
  remove,
  save,
  extra,
}: {
  /** 목록 주액션(매물 등록 등) */
  primary?: PageActionSpec;
  edit?: PageActionSpec;
  cancel?: PageActionSpec;
  remove?: PageActionSpec;
  save?: PageActionSpec;
  extra?: ReactNode;
}) {
  const go = (fn: () => void) => () => { haptic.tap(); fn(); };
  const action = (
    spec: PageActionSpec | undefined,
    fallback: string,
    icon: ReactNode,
    variant: 'solid' | 'ghost' | 'danger',
  ) => {
    if (!spec) return null;
    const label = spec.label || fallback;
    return (
      <Btn size="sm" variant={variant} disabled={spec.disabled} title={label} onClick={go(spec.onClick)}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {icon}
          {label}
        </span>
      </Btn>
    );
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {extra}
      {action(cancel, '취소', <X size={16} aria-hidden />, 'ghost')}
      {action(edit, '수정', <Pencil size={16} aria-hidden />, 'ghost')}
      {action(remove, '삭제', <Trash2 size={16} aria-hidden />, 'danger')}
      {action(save, '저장', <Save size={16} aria-hidden />, 'solid')}
      {action(primary, '등록', <Plus size={16} aria-hidden />, 'solid')}
    </span>
  );
}
