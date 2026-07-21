'use client';
import { useRef, useState } from 'react';
import { Btn, C, R } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';

const LONG_MS = 480;
const MOVE_PX = 10;

// 차량 사진 업로드 — photos[] ([0]=대표). interior_photo=실내 URL.
// 모바일: 탭=크게 · 꾹=대표/실내/삭제 시트. 웹: 왕관·× 오버레이.
export function PhotoUpload({
  photos,
  onChange,
  interiorUrl,
  onInteriorChange,
  title = '차량 사진',
  hideTitle,
}: {
  photos: unknown;
  onChange: (p: string[]) => void;
  interiorUrl?: string;
  onInteriorChange?: (url: string | null) => void;
  title?: string;
  hideTitle?: boolean;
}) {
  const mobile = useIsMobile();
  const list: string[] = Array.isArray(photos) ? (photos as unknown[]).map(String) : [];
  const interior = String(interiorUrl || '');
  const [full, setFull] = useState<number | null>(null);
  const [sheet, setSheet] = useState<number | null>(null);
  const press = useRef<{
    i: number; x: number; y: number; timer: ReturnType<typeof setTimeout>; long: boolean; pid: number;
  } | null>(null);

  const add = (files: FileList | null) => {
    if (!files || !files.length) return;
    const readers = Array.from(files).map((f) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f); }));
    Promise.all(readers).then((urls) => onChange([...list, ...urls]));
  };

  const makeCover = (i: number) => {
    if (i <= 0) return;
    onChange([list[i], ...list.filter((_, j) => j !== i)]);
  };

  const makeInterior = (i: number) => {
    const url = list[i];
    if (!url || !onInteriorChange) return;
    onInteriorChange(interior === url ? null : url);
  };

  const del = (i: number) => {
    const url = list[i];
    onChange(list.filter((_, j) => j !== i));
    if (url && interior === url) onInteriorChange?.(null);
  };

  const clearPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  const onPointerDown = (i: number, e: React.PointerEvent) => {
    if (!mobile) return;
    if (e.button != null && e.button !== 0) return;
    clearPress();
    const pid = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture?.(pid);
    press.current = {
      i, x: e.clientX, y: e.clientY, pid, long: false,
      timer: setTimeout(() => {
        if (!press.current || press.current.i !== i) return;
        press.current.long = true;
        haptic.impact();
        setSheet(i);
      }, LONG_MS),
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_PX) clearPress();
  };

  const onPointerUp = (i: number) => {
    const p = press.current;
    const wasLong = !!p?.long;
    clearPress();
    if (!mobile) return;
    if (!wasLong) setFull(i); // 탭 = 크게
  };

  const fullIdx = full == null ? null : Math.min(full, list.length - 1);
  const sheetUrl = sheet != null ? list[sheet] : null;
  const sheetIsCover = sheet === 0;
  const sheetIsInterior = !!sheetUrl && interior === sheetUrl;

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: '#fff', padding: '10px 12px' }}>
      {!hideTitle && (
        <div style={{ fontSize: 12, fontWeight: 800, color: C.ink, marginBottom: 7 }}>{title} <span style={{ color: C.faint, fontWeight: 600 }}>{list.length}</span>
          <span style={{ fontSize: 10.5, color: C.faint, fontWeight: 400, marginLeft: 6 }}>
            {mobile ? '· 탭=크게 · 꾹=메뉴' : '· 왕관=대표 · 클릭=크게'}
          </span>
        </div>
      )}
      {list.length === 0 && (
        <div style={{ fontSize: 12, color: C.mute, marginBottom: 8, lineHeight: 1.45 }}>
          사진 없음 — 오른쪽 <b style={{ color: C.brand }}>+</b> 칸을 눌러 추가하세요
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {list.map((u, i) => {
          const isCover = i === 0;
          const isInterior = interior === u;
          return (
            <div
              key={`${i}-${u.slice(0, 24)}`}
              style={{
                position: 'relative', width: 76, height: 57, borderRadius: R, overflow: 'hidden',
                border: `${isCover ? 2 : 1}px solid ${isCover ? C.brand : C.line}`,
                touchAction: 'manipulation', userSelect: 'none',
              }}
              onPointerDown={(e) => onPointerDown(i, e)}
              onPointerMove={onPointerMove}
              onPointerUp={() => onPointerUp(i)}
              onPointerCancel={clearPress}
              onContextMenu={(e) => { if (mobile) e.preventDefault(); }}
            >
              <img
                src={u}
                alt=""
                draggable={false}
                onClick={() => { if (!mobile) setFull(i); }}
                style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in', display: 'block', pointerEvents: mobile ? 'none' : 'auto' }}
              />
              <div style={{ position: 'absolute', left: 2, top: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {isCover && (
                  <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', background: C.brand, borderRadius: 3, padding: '0 4px' }}>대표</span>
                )}
                {isInterior && (
                  <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', background: C.ok, borderRadius: 3, padding: '0 4px' }}>실내</span>
                )}
              </div>
              {/* 웹만 오버레이 조작 — 모바일은 꾹 메뉴 */}
              {!mobile && (
                <>
                  {!isCover && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); makeCover(i); }} aria-label="대표설정" title="대표로"
                      style={{ position: 'absolute', bottom: 2, left: 2, width: 18, height: 18, borderRadius: 3, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 10, cursor: 'pointer', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>♛</button>
                  )}
                  <button type="button" onClick={(e) => { e.stopPropagation(); makeInterior(i); }} aria-label="실내설정" title={isInterior ? '실내 해제' : '실내로'}
                    style={{ position: 'absolute', bottom: 2, left: isCover ? 2 : 22, height: 18, padding: '0 4px', borderRadius: 3, border: 'none', background: isInterior ? C.ok : 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 9, fontWeight: 800, cursor: 'pointer', lineHeight: 1 }}>실내</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); del(i); }} aria-label="삭제"
                    style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: 9, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 12, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                </>
              )}
            </div>
          );
        })}
        <label style={{
          width: 76, height: 57, borderRadius: R,
          border: `1.5px dashed ${C.brand}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: C.brand, fontSize: 20, fontWeight: 700,
          background: C.selected, gap: 2,
        }}>
          +
          {list.length === 0 && <span style={{ fontSize: 9.5, fontWeight: 700 }}>추가</span>}
          <input type="file" accept="image/*" multiple onChange={(e) => add(e.target.files)} style={{ display: 'none' }} />
        </label>
      </div>

      {/* 모바일 꾹 메뉴 */}
      {sheet != null && sheetUrl && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(15,23,42,0.4)' }}
          onClick={() => { haptic.back(); setSheet(null); }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              background: C.taupeBg, borderRadius: '12px 12px 0 0',
              padding: '12px 14px calc(12px + env(safe-area-inset-bottom))',
              boxShadow: '0 -8px 28px rgba(15,23,42,0.18)',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, marginBottom: 2 }}>사진 메뉴</div>
            <Btn
              full
              variant="ghost"
              disabled={sheetIsCover}
              onClick={() => { makeCover(sheet); haptic.select(); setSheet(null); }}
            >
              {sheetIsCover ? '이미 대표사진' : '대표사진으로'}
            </Btn>
            {onInteriorChange && (
              <Btn
                full
                variant="ghost"
                onClick={() => { makeInterior(sheet); haptic.select(); setSheet(null); }}
              >
                {sheetIsInterior ? '실내사진 해제' : '실내사진으로'}
              </Btn>
            )}
            <Btn
              full
              variant="danger"
              onClick={() => { del(sheet); haptic.impact(); setSheet(null); }}
            >
              삭제
            </Btn>
            <Btn full variant="ghost" onClick={() => { haptic.back(); setSheet(null); }}>취소</Btn>
          </div>
        </div>
      )}

      {fullIdx != null && list[fullIdx] && (
        <div onClick={() => setFull(null)} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <button onClick={(e) => { e.stopPropagation(); setFull(null); }} aria-label="닫기" style={{ position: 'fixed', top: 14, right: 16, width: 38, height: 38, borderRadius: 19, border: 'none', background: 'rgba(255,255,255,0.18)', color: '#fff', fontSize: 21, cursor: 'pointer' }}>×</button>
          {fullIdx > 0 && <button onClick={(e) => { e.stopPropagation(); setFull(fullIdx - 1); }} aria-label="이전" style={{ position: 'fixed', left: 12, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: 20, border: 'none', background: 'rgba(255,255,255,0.18)', color: '#fff', fontSize: 22, cursor: 'pointer' }}>‹</button>}
          {fullIdx < list.length - 1 && <button onClick={(e) => { e.stopPropagation(); setFull(fullIdx + 1); }} aria-label="다음" style={{ position: 'fixed', right: 12, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: 20, border: 'none', background: 'rgba(255,255,255,0.18)', color: '#fff', fontSize: 22, cursor: 'pointer' }}>›</button>}
          <img src={list[fullIdx]} alt="" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6 }} />
        </div>
      )}
    </div>
  );
}
