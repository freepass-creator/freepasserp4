'use client';
import { useRef, useState } from 'react';
import { Btn, IconBtn, C, R, FS } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';

const LONG_MS = 480;
const MOVE_PX = 10;
const THUMB_W = 76;

// 차량 사진 업로드 — photos[] ([0]=대표). interior_photo=실내 URL.
// 모바일: 탭=크게 · 꾹=대표/실내/삭제 시트. 웹: 클릭=크게 · 라이트박스에서 조작.
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
  const fileRef = useRef<HTMLInputElement>(null);
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
    if (fileRef.current) fileRef.current.value = '';
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
    const nextLen = list.length - 1;
    onChange(list.filter((_, j) => j !== i));
    if (url && interior === url) onInteriorChange?.(null);
    if (full != null) {
      if (nextLen <= 0) setFull(null);
      else setFull(Math.min(full, nextLen - 1));
    }
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
  const fullIsCover = fullIdx === 0;
  const fullIsInterior = fullIdx != null && !!list[fullIdx] && interior === list[fullIdx];

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, padding: '10px 12px' }}>
      {!hideTitle && (
        <div style={{ fontSize: FS.sub, fontWeight: 800, color: C.ink, marginBottom: 7 }}>{title} <span style={{ color: C.faint, fontWeight: 600 }}>{list.length}</span>
          <span style={{ fontSize: FS.micro, color: C.faint, fontWeight: 400, marginLeft: 6 }}>
            {mobile ? '· 탭=크게 · 꾹=메뉴' : '· 클릭=크게 · 메뉴는 확대 화면'}
          </span>
        </div>
      )}
      {list.length === 0 && (
        <div style={{ fontSize: FS.sub, color: C.mute, marginBottom: 8, lineHeight: 1.45 }}>
          사진 없음 — <b style={{ color: C.brand }}>+</b> 칸을 눌러 추가하세요
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'stretch' }}>
        {list.map((u, i) => {
          const isCover = i === 0;
          const isInterior = interior === u;
          return (
            <div
              key={`${i}-${u.slice(0, 24)}`}
              style={{
                position: 'relative', width: THUMB_W, aspectRatio: '4 / 3', borderRadius: R, overflow: 'hidden',
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
                  <span style={{ fontSize: FS.micro, fontWeight: 800, color: C.taupeBg, background: C.brand, borderRadius: R, padding: '0 4px' }}>대표</span>
                )}
                {isInterior && (
                  <span style={{ fontSize: FS.micro, fontWeight: 800, color: C.taupeBg, background: C.ok, borderRadius: R, padding: '0 4px' }}>실내</span>
                )}
              </div>
            </div>
          );
        })}
        <div
          style={{
            width: THUMB_W, aspectRatio: '4 / 3', borderRadius: R,
            border: `1.5px dashed ${C.brand}`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: C.selected, gap: 2,
          }}
        >
          <IconBtn onClick={() => fileRef.current?.click()} title="사진 추가">+</IconBtn>
          {list.length === 0 && <span style={{ fontSize: FS.micro, fontWeight: 700, color: C.brand }}>추가</span>}
          <input ref={fileRef} type="file" accept="image/*" multiple onChange={(e) => add(e.target.files)} style={{ display: 'none' }} />
        </div>
      </div>

      {/* 모바일 꾹 메뉴 */}
      {sheet != null && sheetUrl && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 100 }}
          onClick={() => { haptic.back(); setSheet(null); }}
        >
          <div style={{ position: 'absolute', inset: 0, background: C.ink, opacity: 0.4 }} />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              background: C.taupeBg, borderRadius: `${R}px ${R}px 0 0`,
              padding: '12px 14px calc(12px + env(safe-area-inset-bottom))',
              display: 'flex', flexDirection: 'column', gap: 8,
              zIndex: 1,
            }}
          >
            <div style={{ fontSize: FS.body, fontWeight: 800, color: C.ink, marginBottom: 2 }}>사진 메뉴</div>
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
        <div onClick={() => setFull(null)} style={{ position: 'fixed', inset: 0, zIndex: 90, background: C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ position: 'fixed', top: 14, right: 16, zIndex: 1 }} onClick={(e) => e.stopPropagation()}>
            <IconBtn onClick={() => setFull(null)} title="닫기">×</IconBtn>
          </div>
          {fullIdx > 0 && (
            <div style={{ position: 'fixed', left: 12, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }} onClick={(e) => e.stopPropagation()}>
              <IconBtn onClick={() => setFull(fullIdx - 1)} title="이전">‹</IconBtn>
            </div>
          )}
          {fullIdx < list.length - 1 && (
            <div style={{ position: 'fixed', right: 12, top: '50%', transform: 'translateY(-50%)', zIndex: 1 }} onClick={(e) => e.stopPropagation()}>
              <IconBtn onClick={() => setFull(fullIdx + 1)} title="다음">›</IconBtn>
            </div>
          )}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: '12px 14px calc(12px + env(safe-area-inset-bottom))', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', background: C.head, zIndex: 1 }}
          >
            <Btn size="sm" variant="ghost" disabled={fullIsCover} onClick={() => { if (fullIdx != null) { makeCover(fullIdx); setFull(0); } }}>
              {fullIsCover ? '대표사진' : '대표로'}
            </Btn>
            {onInteriorChange && (
              <Btn size="sm" variant="ghost" onClick={() => { if (fullIdx != null) makeInterior(fullIdx); }}>
                {fullIsInterior ? '실내 해제' : '실내로'}
              </Btn>
            )}
            <Btn size="sm" variant="danger" onClick={() => { if (fullIdx != null) del(fullIdx); }}>
              삭제
            </Btn>
          </div>
          <img src={list[fullIdx]} alt="" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: R }} />
        </div>
      )}
    </div>
  );
}
