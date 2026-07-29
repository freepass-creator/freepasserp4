'use client';
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { MoreVertical, Star, ThumbsDown, EyeOff, MessageCircleMore, Share2 } from 'lucide-react';
import { C, R, FW, FS, Btn, IconBtn, ctrlH, SH, SCRIM } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { isFav, toggleFav, removeFav, subscribeInterest } from '@/lib/product-interest';
import { hideProduct } from '@/lib/product-hide';
import { passProduct, isPassed, unpassProduct, subscribePassed } from '@/lib/product-pass';
import { vehicleName } from '@/lib/domain/product';
import { actor, getRole, ensureRoom } from '@/lib/domain/deal';
import { guestShareUrl } from '@/lib/domain/product-share';
import { toast } from '@/components/Toaster';
import { BottomSheet } from '@/components/BottomSheet';
import type { EntityRecord } from '@/lib/intake/entities';
import { copyText } from '@/lib/clipboard';

/**
 * 상품 카드 ··· 메뉴 (웹·모바일 공통)
 *   트리거 = absolute(제목 줄높이·갭 불변). 부모는 relative + paddingRight.
 *   · 계약문의 / 손님공유 — 영업·관리자(웹 우클릭과 동일)
 *   · 관심 있음 / 관심 해제 — 찜
 *   · 관심없음 — 목록 맨 뒤로
 *   · 숨기기 — 목록에서 완전 제외
 */
export function ProductMoreMenu({ p }: { p: EntityRecord }) {
  const mobile = useIsMobile();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const code = String(p.product_code || p._key || '');
  const [fav, setFav] = useState(false);
  const [passed, setPassed] = useState(false);
  const role = getRole();
  const canDeal = role === 'agent' || role === 'admin';
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
    setOpen(true);
  };

  const meta = { code, name: vehicleName(p), plate: String(p.car_number || '') };
  const rowH = ctrlH(mobile);

  const item = (label: string, onClick: () => void, opts?: { danger?: boolean; icon?: ReactNode; muted?: boolean; haptic?: 'tap' | 'nav' | 'select' | 'impact' }) => (
    <Btn
      key={label}
      full
      variant="ghost"
      haptic={opts?.haptic ?? 'tap'}
      onClick={() => { onClick(); setOpen(false); }}
      style={{
        display: 'flex', justifyContent: 'flex-start', gap: 12,
        minHeight: rowH, height: 'auto',
        padding: '0 16px',
        border: 'none', borderTop: `1px solid ${C.line2}`,
        background: C.taupeBg, boxShadow: 'none', borderRadius: 0,
        textAlign: 'left',
        fontSize: FS.title, fontWeight: FW.strong,
        color: opts?.danger ? C.danger : opts?.muted ? C.mute : C.ink,
      }}
    >
      {opts?.icon}
      <span style={{ flex: 1 }}>{label}</span>
    </Btn>
  );

  const panel = (
    <div style={{ paddingBottom: mobile ? 8 : 6 }}>
      {canDeal ? (
        <>
          {item(
            '계약문의',
            async () => {
              try {
                const a = actor(role);
                const room = await ensureRoom(p, a);
                router.push(`/chat?room=${encodeURIComponent(room)}`);
              } catch (e) {
                toast(e instanceof Error ? e.message : '계약문의 실패', 'error');
              }
            },
            { icon: <MessageCircleMore size={18} color={C.brand} />, haptic: 'nav' },
          )}
          {item(
            '손님공유',
            async () => {
              const a = actor(role);
              const url = guestShareUrl(p, a.code || a.uid);
              if (navigator.share) {
                navigator.share({ title: vehicleName(p), url }).catch(() => {});
                return;
              }
              if (await copyText(url)) toast('손님용 매물 링크 복사됨', 'ok');
              else prompt('링크', url);
            },
            { icon: <Share2 size={18} color={C.brand} />, haptic: 'select' },
          )}
        </>
      ) : null}
      {item(
        fav ? '관심 해제' : '관심 있음',
        () => {
          if (!fav && passed) unpassProduct(code);
          const next = toggleFav(p);
          setFav(next);
          toast(next ? '관심 상품에 추가' : '관심 해제', next ? 'ok' : 'info');
        },
        {
          icon: <Star size={18} strokeWidth={2.2} fill={fav ? C.brand : 'none'} color={fav ? C.brand : C.mute} />,
          haptic: 'select',
        },
      )}
      {item(
        passed ? '관심없음 해제' : '관심없음',
        () => {
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
          haptic: 'select',
        },
      )}
      {item(
        '숨기기',
        () => {
          hideProduct(meta);
          toast('숨겼습니다. 설정에서 다시 볼 수 있어요.', 'info');
        },
        {
          danger: true,
          icon: <EyeOff size={18} color={C.danger} />,
          haptic: 'impact',
        },
      )}
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
        <BottomSheet open={open} onClose={() => setOpen(false)} maxHeight="auto" title="상품" footer="std" pad={false}>
          {panel}
        </BottomSheet>
      ) : open ? (
        <div
          role="presentation"
          style={{ position: 'fixed', inset: 0, zIndex: 90, background: SCRIM.light }}
          onClick={() => { haptic.back(); setOpen(false); }}
        >
          <div
            role="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
              width: 'min(360px, calc(100vw - 32px))',
              background: C.taupeBg, borderRadius: R, border: `1px solid ${C.line}`,
              boxShadow: SH.menu, overflow: 'hidden',
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
