'use client';
import { useEffect, useState, useRef, type ReactNode } from 'react';
import { Btn, C, FW, FS, R, SCRIM, SH, ctrlH } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';

const EXIT_MS = 220; // sheetUp .22s와 대칭

/**
 * 하단 시트 SSOT — 화면 바닥에서 슬라이드업.
 * 검색·정렬·필터·최근·관심·업무목록 전부 이거. 별도 FilterSheet UI 금지.
 *
 * 액션 규격:
 *   · 시트 고유(지우기·기본·초기화·비우기) = 제목 오른쪽 파란 bare(onClear)
 *   · footer std = 닫기
 *   · footer commit = 미변경 닫기만 / 변경 시 취소·적용 (onCommit)
 */
export function BottomSheet({
  open,
  onClose,
  children,
  title,
  dockH = 0,
  topInset = 0,
  maxHeight = 'min(58vh, 520px)',
  /** true면 maxHeight를 고정 높이로 씀(필터 시트 출렁임 방지) */
  fixedHeight = false,
  footer,
  onClear,
  onCancel,
  onCommit,
  dirty = false,
  closeLabel = '닫기',
  commitLabel = '적용',
  clearLabel = '초기화',
  cancelLabel = '취소',
  footerInfo,
  pad = true,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  dockH?: number | string;
  /** 상단 툴바를 시트·백드롭 밖에 두어 필터 버튼 재탭 닫기 가능 */
  topInset?: number | string;
  maxHeight?: string | number;
  fixedHeight?: boolean;
  footer?: 'std' | 'commit' | 'filter' | ReactNode;
  onClear?: () => void;
  onCancel?: () => void;
  onCommit?: () => void;
  dirty?: boolean;
  closeLabel?: string;
  commitLabel?: string;
  clearLabel?: string;
  cancelLabel?: string;
  footerInfo?: ReactNode;
  pad?: boolean;
}) {
  const mobile = useIsMobile();
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);

  // 닫힘 = 즉시 언마운트 금지 → 퇴장 애니메이션 후 언마운트(입장 sheetUp과 대칭)
  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const t = window.setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, EXIT_MS);
    return () => window.clearTimeout(t);
  }, [open, mounted]);

  useEffect(() => {
    if (!mounted || leaving) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, leaving, onClose]);

  // 스와이프-다운 닫기 — 핸들을 손으로 내리면 닫힘(임계 90px). 백드롭 탭 닫기는 아래 onClick.
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);

  if (!mounted) return null;

  // 하단바 SSOT — commit: 미변경=닫기 / 변경=취소·적용. 슬롯은 항상 예약(크기 불변).
  const isStd = footer === 'std' || footer === 'filter';
  const isCommit = footer === 'commit';
  const clearVisible = !!onClear;
  const cancelVisible = !!(isCommit && dirty && onCancel);
  const sheetFooter = (isStd || isCommit) ? (
    <div style={{
      flex: '0 0 auto',
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '10px 14px',
      paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
      borderTop: `1px solid ${C.line}`,
      background: C.taupeBg,
      minHeight: ctrlH(mobile) + 20,
      boxSizing: 'border-box',
    }}>
      {isCommit ? <span style={{ flex: 1 }} /> : (
        <span style={{
          flex: 1, minWidth: 0, fontSize: FS.sub, color: C.mute,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{footerInfo}</span>
      )}
      {isCommit ? (
        <Btn
          title={cancelLabel}
          variant="ghost"
          haptic="back"
          disabled={!cancelVisible}
          onClick={() => { if (!cancelVisible || !onCancel) return; onCancel(); }}
          style={{
            minWidth: 72,
            visibility: cancelVisible ? 'visible' : 'hidden',
            pointerEvents: cancelVisible ? 'auto' : 'none',
          }}
        >{cancelLabel}</Btn>
      ) : null}
      <Btn
        title={isCommit ? (dirty ? commitLabel : closeLabel) : closeLabel}
        haptic={isCommit && dirty ? 'nav' : 'back'}
        onClick={() => {
          if (isCommit && dirty && onCommit) onCommit();
          else onClose();
        }}
        style={{ minWidth: isCommit ? 96 : 100 }}
      >
        {isCommit ? (dirty ? commitLabel : closeLabel) : closeLabel}
      </Btn>
    </div>
  ) : footer != null ? (
    <div style={{
      flex: '0 0 auto',
      padding: '10px 14px',
      paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
      borderTop: `1px solid ${C.line}`,
      background: C.taupeBg,
      minHeight: ctrlH(mobile) + 20,
      boxSizing: 'border-box',
    }}>
      {footer}
    </div>
  ) : null;

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed',
        top: topInset, left: 0, right: 0, bottom: 0,
        zIndex: 62,
        background: SCRIM.heavy,
        opacity: leaving ? 0 : 1,
        transition: 'opacity .22s ease',
        animation: leaving ? undefined : 'scrimIn .22s ease',
        pointerEvents: leaving ? 'none' : 'auto',
      }}
      onClick={() => { if (leaving) return; haptic.back(); onClose(); }}
    >
      <div
        role="dialog"
        aria-modal
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', left: 0, right: 0,
          bottom: dockH,
          maxHeight,
          height: fixedHeight ? maxHeight : undefined,
          display: 'flex', flexDirection: 'column',
          background: C.taupeBg,
          borderRadius: `${R}px ${R}px 0 0`,
          boxShadow: SH.menu,
          animation: leaving ? 'sheetDown .22s ease forwards' : 'sheetUp .22s ease',
          paddingBottom: sheetFooter ? 0 : 'env(safe-area-inset-bottom, 0px)',
          overflow: 'hidden',
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragY ? 'none' : undefined,
        }}
      >
        <div
          onTouchStart={(e) => { dragStart.current = e.touches[0].clientY; }}
          onTouchMove={(e) => { if (dragStart.current == null) return; const dy = e.touches[0].clientY - dragStart.current; setDragY(dy > 0 ? dy : 0); }}
          onTouchEnd={() => { if (dragY > 90) { haptic.back(); onClose(); } setDragY(0); dragStart.current = null; }}
          style={{
            flex: '0 0 auto', display: 'flex', justifyContent: 'center', padding: '12px 0 8px',
            cursor: 'grab', touchAction: 'none',
          }}
        >
          <span style={{ width: 36, height: 4, borderRadius: R, background: C.line }} />
        </div>
        {title != null && (
          <div style={{
            flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10,
            padding: '2px 16px 10px',
            minHeight: ctrlH(mobile),
            boxSizing: 'border-box',
          }}>
            <div style={{
              flex: '1 1 auto', minWidth: 0,
              fontSize: FS.title, fontWeight: FW.title, color: C.ink, letterSpacing: '-0.02em',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{title}</div>
            {/* 초기화 슬롯 항상 예약 — 보일 때만 보이게(레이아웃 불변) */}
            {(isCommit || onClear) ? (
              <Btn
                title={clearLabel}
                variant="bare"
                haptic="select"
                disabled={!clearVisible}
                onClick={() => { if (!onClear) return; onClear(); }}
                style={{
                  flex: '0 0 auto', color: C.accent, fontSize: FS.sub, fontWeight: FW.strong,
                  minHeight: ctrlH(mobile), minWidth: 52, padding: mobile ? '0 10px' : '0 6px',
                  visibility: clearVisible ? 'visible' : 'hidden',
                  pointerEvents: clearVisible ? 'auto' : 'none',
                }}
              >{clearLabel}</Btn>
            ) : null}
          </div>
        )}
        <div
          className="fp-bottom-sheet-body"
          style={{
            flex: '1 1 auto', minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain',
            padding: pad ? '4px 16px 16px' : undefined,
          }}
        >
          {children}
        </div>
        {sheetFooter}
      </div>
    </div>
  );
}

/**
 * 필터 시트 — BottomSheet footer='filter' 래퍼.
 * 페이지는 본문(칩·섹션)만 넘김. 시트 껍데기·푸터는 SSOT.
 */
export function FilterSheet({
  open,
  title = '필터',
  onClose,
  onClear,
  children,
  maxHeight = 'min(68vh, 560px)',
  clearLabel = '초기화',
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  onClear?: () => void;
  children: ReactNode;
  maxHeight?: string | number;
  clearLabel?: string;
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      maxHeight={maxHeight}
      footer="std"
      clearLabel={clearLabel}
      onClear={onClear}
      pad
    >
      {children}
    </BottomSheet>
  );
}
