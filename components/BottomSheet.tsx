'use client';
import { useEffect, useState, useRef, type ReactNode } from 'react';
import { Btn, C, FW, FS } from '@/components/ui';
import { haptic } from '@/lib/haptics';

/**
 * 하단 시트 SSOT — 화면 바닥에서 슬라이드업.
 * 검색·정렬·필터·메뉴 전부 이거. MobileFilterSheet 별도 구현 금지.
 *
 * footer='filter' → 적용·해제·닫기 표준 액션바.
 */
export function BottomSheet({
  open,
  onClose,
  children,
  title,
  dockH = 0,
  maxHeight = 'min(58vh, 520px)',
  footer,
  onClear,
  onCancel,
  dirty = false,
  closeLabel = '닫기',
  commitLabel = '적용',
  clearLabel = '해제',
  cancelLabel = '취소',
  footerInfo,
  pad = true,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  dockH?: number | string;
  maxHeight?: string | number;
  /**
   * 하단바 SSOT — 두 표준 타입:
   *  'std'    = [해제/비우기 좌(ghost, onClear시) · info 가운데 · 닫기 우(solid)]. 즉시반영 시트(최근·관심·검색·정렬).
   *  'commit' = [해제 좌(ghost, onClear시) · 취소(ghost, onCancel시) · 적용 우(solid, closeLabel)]. 조건 조정 후 확정하는 필터용.
   *  'filter' = 'std' 별칭(하위호환). ReactNode = 완전 커스텀.
   */
  footer?: 'std' | 'commit' | 'filter' | ReactNode;
  onClear?: () => void;
  /** 'commit'에서 취소(되돌리기) 액션 */
  onCancel?: () => void;
  /** 'commit' 변경됨 여부. true면 [취소·적용], false면 [닫기] */
  dirty?: boolean;
  /** 우측 solid 버튼 라벨(std:닫기 · commit clean:닫기) */
  closeLabel?: string;
  /** commit dirty 시 우측 solid 라벨(기본 '적용') */
  commitLabel?: string;
  /** 좌측 ghost 액션 라벨(비우기·해제·지우기·기본 등). onClear 있을 때만 노출 */
  clearLabel?: string;
  /** commit 취소 버튼 라벨(기본 '취소'). onCancel 있을 때만 노출 */
  cancelLabel?: string;
  /** std 가운데 뮤트 정보(예: '결과 N대'). commit엔 없음(제목 옆으로) */
  footerInfo?: ReactNode;
  /** 본문 좌우 패딩(기본 on) */
  pad?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 스와이프-다운 닫기 — 핸들을 손으로 내리면 닫힘(임계 90px). 백드롭 탭 닫기는 아래 onClick.
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);

  if (!open) return null;

  // 하단바 SSOT — 공통 컨테이너 규격에 std/commit 두 타입.
  const isStd = footer === 'std' || footer === 'filter';
  const isCommit = footer === 'commit';
  const sheetFooter = (isStd || isCommit) ? (
    <div style={{
      flex: '0 0 auto',
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '10px 14px',
      paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
      borderTop: `1px solid ${C.line}`,
      background: C.taupeBg,
    }}>
      {/* std: [해제 좌 · info 가운데 · 닫기 우]. onClear 있을 때만 해제 노출 */}
      {isStd && onClear ? (
        <Btn variant="ghost" onClick={() => { haptic.tap(); onClear(); }}>{clearLabel}</Btn>
      ) : null}
      {isCommit ? <span style={{ flex: 1 }} /> : (
        <span style={{
          flex: 1, minWidth: 0, fontSize: FS.sub, color: C.mute,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{footerInfo}</span>
      )}
      {/* commit: 변경 전엔 [닫기]만, 변경되면 [취소·적용] */}
      {isCommit && dirty && onCancel ? (
        <Btn variant="ghost" onClick={() => { onCancel(); }}>{cancelLabel}</Btn>
      ) : null}
      <Btn onClick={() => { haptic.nav(); onClose(); }} style={{ minWidth: isCommit ? 96 : 100 }}>
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
    }}>
      {footer}
    </div>
  ) : null;

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed', inset: 0, zIndex: 62,
        background: 'rgba(15,23,42,0.38)',
      }}
      onClick={() => { haptic.back(); onClose(); }}
    >
      <div
        role="dialog"
        aria-modal
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', left: 0, right: 0,
          bottom: dockH,
          maxHeight,
          display: 'flex', flexDirection: 'column',
          background: C.taupeBg,
          borderRadius: '14px 14px 0 0',
          boxShadow: '0 -10px 32px rgba(15,23,42,0.2)',
          animation: 'sheetUp .22s ease',
          paddingBottom: sheetFooter ? 0 : 'env(safe-area-inset-bottom, 0px)',
          overflow: 'hidden',
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragY ? 'none' : 'transform .22s ease',
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
          <span style={{ width: 36, height: 4, borderRadius: 2, background: C.line }} />
        </div>
        {title != null && (
          <div style={{
            flex: '0 0 auto', padding: '2px 16px 10px',
            fontSize: FS.title, fontWeight: FW.title, color: C.ink, letterSpacing: '-0.02em',
          }}>{title}</div>
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
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  onClear?: () => void;
  children: ReactNode;
  maxHeight?: string | number;
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      maxHeight={maxHeight}
      footer="filter"
      onClear={onClear}
      pad
    >
      {children}
    </BottomSheet>
  );
}
