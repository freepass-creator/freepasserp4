'use client';
import type { ReactNode } from 'react';
import { Btn } from '@/components/ui';
import { haptic } from '@/lib/haptics';

/**
 * 하단 액션 슬롯 SSOT.
 *   목록: [등록…]
 *   보기: [수정] [삭제] [등록…]  — 선택 건 기준 액션 + 신규
 *   신규·수정: [취소] [저장]
 * 페이지는 이 조합만 — Btn 나열 손롤 지양.
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
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {extra}
      {cancel ? (
        <Btn size="sm" variant="ghost" disabled={cancel.disabled} onClick={go(cancel.onClick)}>
          {cancel.label || '취소'}
        </Btn>
      ) : null}
      {edit ? (
        <Btn size="sm" variant="ghost" disabled={edit.disabled} onClick={go(edit.onClick)}>
          {edit.label || '수정'}
        </Btn>
      ) : null}
      {remove ? (
        <Btn size="sm" variant="danger" disabled={remove.disabled} onClick={go(remove.onClick)}>
          {remove.label || '삭제'}
        </Btn>
      ) : null}
      {save ? (
        <Btn size="sm" disabled={save.disabled} onClick={go(save.onClick)}>
          {save.label || '저장'}
        </Btn>
      ) : null}
      {primary ? (
        <Btn size="sm" disabled={primary.disabled} onClick={go(primary.onClick)}>
          {primary.label || '등록'}
        </Btn>
      ) : null}
    </span>
  );
}
