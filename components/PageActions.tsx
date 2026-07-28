'use client';
import type { ReactNode } from 'react';
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { Btn, IconBtn } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { useIsMobile } from '@/lib/use-mobile';

/**
 * 하단 액션 슬롯 SSOT.
 *   목록: [등록…]
 *   보기: [수정] [삭제] [등록…]  — 선택 건 기준 액션 + 신규
 *   신규·수정: [취소] [저장]
 * 페이지는 이 조합만 — Btn 나열 손롤 지양.
 * 모바일: 저장·취소=텍스트 라벨 / 수정·삭제·등록=아이콘.
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
  const mobile = useIsMobile();
  const go = (fn: () => void) => () => { haptic.tap(); fn(); };
  const action = (
    spec: PageActionSpec | undefined,
    fallback: string,
    icon: ReactNode,
    variant: 'solid' | 'ghost' | 'danger',
    opts?: { textOnMobile?: boolean },
  ) => {
    if (!spec) return null;
    const label = spec.label || fallback;
    const textOnMobile = opts?.textOnMobile;
    if (mobile && !textOnMobile) {
      return (
        <IconBtn
          title={label}
          disabled={spec.disabled}
          active={variant === 'solid'}
          onClick={go(spec.onClick)}
          style={variant === 'danger' ? { color: 'var(--red-text)', borderColor: 'var(--red-border)' } : undefined}
        >
          {icon}
        </IconBtn>
      );
    }
    return (
      <Btn size="sm" variant={variant} disabled={spec.disabled} onClick={go(spec.onClick)}>
        {label}
      </Btn>
    );
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {extra}
      {action(cancel, '취소', <X size={18} />, 'ghost', { textOnMobile: true })}
      {action(edit, '수정', <Pencil size={18} />, 'ghost')}
      {action(remove, '삭제', <Trash2 size={18} />, 'danger')}
      {action(save, '저장', <Save size={18} />, 'solid', { textOnMobile: true })}
      {action(primary, '등록', <Plus size={18} />, 'solid')}
    </span>
  );
}
