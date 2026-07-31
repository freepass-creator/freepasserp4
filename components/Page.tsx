'use client';
import type { ReactNode } from 'react';
import { useIsMobile } from '@/lib/use-mobile';
import { useAppBar } from '@/lib/appbar';
import { BottomNav, C, NUM, FW, FS, ctrlPadX } from '@/components/ui';
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
    statusTitle != null
      ? { title: statusTitle, actions: right ?? undefined }
      : (right != null ? { actions: right } : {}),
    [title, meta, countSuffix, right],
  );

  if (mobile) {
    const info = left != null
      ? left
      : (typeof title !== 'string' && title != null)
        ? (
          <span style={{ fontSize: FS.body, color: C.mute, whiteSpace: 'nowrap' }}>
            {title}
            {meta != null && meta !== '' ? <>{' '}<b style={{ color: C.ink, fontFamily: NUM }}>{meta}</b></> : null}
          </span>
        )
        : undefined;
    return (
      <MobilePageShell
        // 건수·타이틀은 상단바 PageStatus — 셸은 툴만
        // right = TopBar actions(erp3 headerRight). 툴바 우측과 이중 노출 금지.
        info={info}
        search={search}
        listTools={listTools}
        tools={tools}
        bottomActions={bottomActions}
      >
        {/* 문서형 본문 좌우 기준선 — 툴바(ctrlPadX(true)=12)와 같은 선에 맞춘다.
            .fp-page-scroll 자체에 주면 안 된다 — 그 경로는 WorkPage 목록도 지나가서 풀블리드 행이 깨진다. */}
        <div style={{ padding: `0 ${ctrlPadX(true)}px` }}>{children}</div>
      </MobilePageShell>
    );
  }
  return (
    <>
    <main style={{ maxWidth: 1480, margin: '0 auto', padding: '16px 20px 72px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingBottom: 12, borderBottom: `1px solid ${C.line}`, minHeight: 42 }}>
        {left != null ? left : (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            {title != null && title !== '' && <h1 style={{ fontSize: FS.page, fontWeight: FW.title, letterSpacing: '-0.02em', margin: 0 }}>{title}</h1>}
            {meta && <span style={{ fontSize: FS.sub, color: C.faint, whiteSpace: 'nowrap' }}>{meta}</span>}
          </div>
        )}
        {/* right = TopBar actions만(본문 헤더 중복 금지) */}
      </div>
      {children}
    </main>
    <BottomNav actions={bottomActions} />
    </>
  );
}
