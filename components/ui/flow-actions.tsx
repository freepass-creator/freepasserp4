'use client';

import type { ReactNode } from 'react';
import { Btn } from './buttons';

/**
 * 단계형 고객 화면의 하단 동작 규격.
 * 보조 동작이 있으면 3 : 7, 없으면 주 동작이 전체 폭을 쓴다.
 */
export function FlowActions({
  secondary,
  primary,
}: {
  secondary?: {
    label: ReactNode;
    title: string;
    onClick: () => void;
    disabled?: boolean;
    children?: ReactNode;
  };
  primary: {
    label: ReactNode;
    title: string;
    onClick: () => void;
    disabled?: boolean;
  };
}) {
  return (
    <div style={{
      flex: '0 0 auto', display: 'grid', gap: 8, paddingTop: 12, background: 'var(--bg)', minWidth: 0,
      gridTemplateColumns: secondary ? 'minmax(0, 3fr) minmax(0, 7fr)' : 'minmax(0, 1fr)',
    }}>
      {secondary ? (
        <Btn full title={secondary.title} variant="ghost" disabled={secondary.disabled} onClick={secondary.onClick}>
          {secondary.children ?? secondary.label}
        </Btn>
      ) : null}
      <Btn full title={primary.title} disabled={primary.disabled} onClick={primary.onClick}>
        {primary.label}
      </Btn>
    </div>
  );
}
