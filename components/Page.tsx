'use client';
import type { ReactNode } from 'react';
import { useIsMobile } from '@/lib/use-mobile';
import { useAppBar } from '@/lib/appbar';
import { BottomNav, C, NUM } from '@/components/ui';
import { MobilePageShell, type ListToolsConfig } from '@/components/MobilePageShell';
import type { PageToolItem } from '@/components/PageToolBar';
import { PageStatus, statusIconFor } from '@/components/PageStatus';

/**
 * 일반 페이지 껍데기.
 *   상단바 상태 = PageStatus(상품검색과 동일 DNA)
 *   모바일 = MobilePageShell (툴·시트). 건수는 상단바로.
 */
export function Page({
  title, meta, left, right, bottomActions, search, listTools, tools, countSuffix = '건', children,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  bottomActions?: ReactNode;
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  listTools?: ListToolsConfig;
  tools?: PageToolItem[];
  countSuffix?: string;
  children: ReactNode;
}) {
  const mobile = useIsMobile();
  const titleStr = typeof title === 'string' ? title : undefined;
  const countVal = meta == null || meta === ''
    ? null
    : (typeof meta === 'number' || typeof meta === 'string' ? meta : null);

  const statusTitle = titleStr
    ? (
      <PageStatus
        icon={statusIconFor(titleStr)}
        label={titleStr.replace(/\s*·\s*.*$/, '') || titleStr}
        count={countVal != null ? String(countVal).replace(/건$/, '') : null}
        unit={countSuffix}
      />
    )
    : (title != null && title !== '' ? title : undefined);

  useAppBar(
    statusTitle != null ? { title: statusTitle } : {},
    [title, meta, countSuffix],
  );

  if (mobile) {
    const info = left != null
      ? left
      : (typeof title !== 'string' && title != null)
        ? (
          <span style={{ fontSize: 13.5, color: C.mute, whiteSpace: 'nowrap' }}>
            {title}
            {meta != null && meta !== '' ? <>{' '}<b style={{ color: C.ink, fontFamily: NUM }}>{meta}</b></> : null}
          </span>
        )
        : undefined;
    return (
      <MobilePageShell
        // 건수·타이틀은 상단바 PageStatus — 셸은 툴만
        info={info}
        search={search}
        listTools={listTools}
        tools={tools}
        toolbarRight={right}
        bottomActions={bottomActions}
      >
        {children}
      </MobilePageShell>
    );
  }
  return (
    <>
      <main style={{ maxWidth: 1480, margin: '0 auto', padding: '16px 20px 72px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingBottom: 12, borderBottom: `1px solid ${C.line}`, minHeight: 42 }}>
          {left != null ? left : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
              {title != null && title !== '' && <h1 style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>{title}</h1>}
              {meta && <span style={{ fontSize: 12.5, color: C.faint, whiteSpace: 'nowrap' }}>{meta}</span>}
            </div>
          )}
          {right != null && <><span style={{ flex: 1 }} />{right}</>}
        </div>
        {children}
      </main>
      <BottomNav actions={bottomActions} />
    </>
  );
}
