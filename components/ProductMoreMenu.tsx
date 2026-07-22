'use client';
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { MoreVertical, Star, ThumbsDown, EyeOff } from 'lucide-react';
import { C, R, FW, FS, Btn, IconBtn } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { isFav, toggleFav, removeFav, subscribeInterest } from '@/lib/product-interest';
import { hideProduct } from '@/lib/product-hide';
import { passProduct, isPassed, unpassProduct, subscribePassed } from '@/lib/product-pass';
import { vehicleName } from '@/lib/domain/product';
import { toast } from '@/components/Toaster';
import { BottomSheet } from '@/components/BottomSheet';
import type { EntityRecord } from '@/lib/intake/entities';

/**
 * 상품 카드 ··· 메뉴 (웹·모바일 공통)
 *   트리거 = absolute(제목 줄높이·갭 불변). 부모는 relative + paddingRight.
 *   · 관심 있음 / 관심 해제 — 찜
 *   · 관심없음 — 목록 맨 뒤로
 *   · 숨기기 — 목록에서 완전 제외
 */
export function ProductMoreMenu({ p }: { p: EntityRecord }) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const code = String(p.product_code || p._key || '');
  const [fav, setFav] = useState(false);
  const [passed, setPassed] = useState(false);
  useEffect(() => {
    setFav(isFav(code));
    return subscribeInterest(() => setFav(isFav(code)));
  }, [code]);
  useEffect(() => {
    setPassed(isPassed(code));
    return subscribePassed(() => setPassed(isPassed(code)));
  }, [code]);

  // 웹 = 우클릭·설정으로. ⋯ 트리거는 모바일만.
  if (!mobile) return null;

  const openMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    haptic.tap();
    setOpen(true);
  };

  const meta = { code, name: vehicleName(p), plate: String(p.car_number || '') };

  const item = (label: string, onClick: () => void, opts?: { danger?: boolean; icon?: ReactNode; muted?: boolean }) => (
    <Btn
      key={label}
      full
      variant="ghost"
      onClick={() => { onClick(); setOpen(false); }}
      style={{
        display: 'flex', justifyContent: 'flex-start', gap: 12,
        minHeight: mobile ? 48 : 40, height: 'auto',
        padding: mobile ? '0 16px' : '0 14px',
        border: 'none', borderTop: `1px solid ${C.line2}`,
        background: C.taupeBg, boxShadow: 'none', borderRadius: 0,
        textAlign: 'left',
        fontSize: mobile ? FS.title : FS.body, fontWeight: FW.strong,
        color: opts?.danger ? C.danger : opts?.muted ? C.mute : C.ink,
      }}
    >
      {opts?.icon}
      <span style={{ flex: 1 }}>{label}</span>
    </Btn>
  );

  const panel = (
    <div style={{ paddingBottom: mobile ? 8 : 6 }}>
      {item(
        fav ? '관심 해제' : '관심 있음',
        () => {
          haptic.select();
          if (!fav && passed) unpassProduct(code);
          const next = toggleFav(p);
          setFav(next);
          toast(next ? '관심 상품에 추가' : '관심 해제', next ? 'ok' : 'info');
        },
        {
          icon: <Star size={18} strokeWidth={2.2} fill={fav ? C.brand : 'none'} color={fav ? C.brand : C.mute} />,
        },
      )}
      {item(
        passed ? '관심없음 해제' : '관심없음',
        () => {
          haptic.select();
          if (passed) {
            unpassProduct(code);
            setPassed(false);
            toast('다시 앞쪽에 표시합니다', 'ok');
          } else {
            if (fav) { removeFav(code); setFav(false); }
            passProduct(meta);
            setPassed(true);
            toast('관심없음 — 목록 맨 뒤로 보냈어요', 'info');
          }
        },
        {
          muted: !passed,
          icon: <ThumbsDown size={18} color={passed ? C.brand : C.mute} />,
        },
      )}
      {item(
        '숨기기',
        () => {
          haptic.impact();
          hideProduct(meta);
          toast('숨겼습니다. 설정에서 다시 볼 수 있어요.', 'info');
        },
        {
          danger: true,
          icon: <EyeOff size={18} color={C.danger} />,
        },
      )}
      <Btn
        full
        variant="ghost"
        onClick={() => { haptic.back(); setOpen(false); }}
        style={{
          minHeight: mobile ? 48 : 40, height: 'auto', marginTop: 6,
          border: 'none', borderTop: `1px solid ${C.line}`,
          background: C.head, boxShadow: 'none', borderRadius: 0,
          fontSize: mobile ? FS.title : FS.body, fontWeight: FW.strong, color: C.mute,
        }}
      >
        취소
      </Btn>
    </div>
  );

  // absolute — 제목 행 높이·줄간격에 영향 없음. 터치타깃은 40.
  const hit = mobile ? 40 : 32;
  return (
    <>
      <IconBtn
        title="더보기"
        onClick={openMenu}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          right: mobile ? -10 : -8,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 2,
          width: hit, height: hit,
          border: 'none', background: 'none', color: C.mute,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <MoreVertical size={mobile ? 18 : 16} strokeWidth={2.2} />
      </IconBtn>
      {mobile ? (
        <BottomSheet open={open} onClose={() => setOpen(false)} maxHeight="auto" title="상품">
          {panel}
        </BottomSheet>
      ) : open ? (
        <div
          role="presentation"
          style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(15,23,42,0.25)' }}
          onClick={() => { haptic.back(); setOpen(false); }}
        >
          <div
            role="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
              width: 'min(360px, calc(100vw - 32px))',
              background: C.taupeBg, borderRadius: R, border: `1px solid ${C.line}`,
              boxShadow: '0 16px 40px rgba(15,23,42,0.2)', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '12px 14px 8px', fontSize: FS.title, fontWeight: FW.title, color: C.ink }}>상품</div>
            {panel}
          </div>
        </div>
      ) : null}
    </>
  );
}
