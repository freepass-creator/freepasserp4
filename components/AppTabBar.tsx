'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { useIsMobile } from '@/lib/use-mobile';
import { useKeyboardOpen } from '@/lib/use-keyboard';
import { haptic } from '@/lib/haptics';
import { C, CountPill, FS, FW, SH, ICON } from '@/components/ui';
import { getRole, type Role } from '@/lib/domain/deal';
import { useSession } from '@/lib/auth-context';
import { loadMenuBadges, type MenuBadgeMap } from '@/lib/domain/menu-badges';
import { appTabsFor, isTabRoute, useTabBarHidden } from '@/lib/tabbar';
import { refreshCurrentPage } from '@/lib/page-refresh';
import { toast } from '@/components/Toaster';

/**
 * 모바일 하단 탭.
 *   영업자: 상품찾기 · 계약진행 · 전자계약
 *   공급사: 상품찾기 · 계약진행 · 재고관리
 *   관리자: 상품찾기 · 계약진행 · 정산확인 · 재고관리
 * 라벨 = NAV_LABEL SSOT · 아이콘 = NAV_ICON SSOT (상단 메뉴와 동일)
 */
function setTabCss(on: boolean) {
  const root = document.documentElement;
  if (on) {
    root.style.setProperty('--fp-tabbar-h', 'calc(var(--fp-bar-h) + env(safe-area-inset-bottom, 0px))');
    root.style.setProperty('--fp-dock-safe', '0px');
  } else {
    root.style.setProperty('--fp-tabbar-h', '0px');
    root.style.setProperty('--fp-dock-safe', 'env(safe-area-inset-bottom, 0px)');
  }
}

export default function AppTabBar() {
  const mobile = useIsMobile();
  const path = usePathname();
  const hidden = useTabBarHidden();
  const session = useSession();
  const kb = useKeyboardOpen();
  // null = 역할 미확정(첫 페인트). agent 가정으로 탭 수 점프 금지.
  const [role, setRole] = useState<Role | null>(null);
  const [badges, setBadges] = useState<MenuBadgeMap>({});

  useEffect(() => {
    setRole(getRole());
    const onRole = (e: Event) => setRole((e as CustomEvent).detail as Role);
    const onSess = () => setRole(getRole());
    window.addEventListener('fp:role', onRole);
    window.addEventListener('fp:session', onSess);
    return () => {
      window.removeEventListener('fp:role', onRole);
      window.removeEventListener('fp:session', onSess);
    };
  }, [session]);

  const tabRole: Role | null =
    session?.role === 'admin' || session?.role === 'provider' || session?.role === 'agent'
      ? session.role
      : role;

  const refreshBadges = useCallback((r: Role) => {
    let alive = true;
    loadMenuBadges(r).then((m) => { if (alive) setBadges(m); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!tabRole) return;
    // 앞선 요청은 취소하고 다시 — 취소자를 버리면 언마운트 뒤 늦은 응답이 setState 한다.
    let cancel = refreshBadges(tabRole);
    const run = () => { cancel(); cancel = refreshBadges(tabRole); };
    // 보이는 동안만 주기 갱신 — 상대가 보낸 새 문의는 이쪽에 알릴 계기가 없다(QA SYNC-1).
    //  모바일은 앱 전환 복귀에 focus 가 안 오는 경우가 있어 visibilitychange 도 같이 듣는다.
    const tick = () => { if (document.visibilityState === 'visible') run(); };
    const id = window.setInterval(tick, 30_000);
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('fp:unread', run);
    return () => {
      cancel();
      window.clearInterval(id);
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('fp:unread', run);
    };
  }, [tabRole, refreshBadges]);

  const tabs = tabRole ? appTabsFor(tabRole) : [];
  // 키보드가 올라오면 하단탭을 접는다. 키보드가 탭바를 밀어 올려 입력칸 바로 위에 겹쳐 앉고,
  //  오타 한 번에 다른 화면으로 튄다. 접으면 --fp-tabbar-h 도 0이 돼 본문이 그 자리를 되찾는다.
  //  ⚠ **focus 가 아니라 시각 뷰포트 축소로 잰다**(use-keyboard.ts) — 뒤로가기로 키보드만 내려도
  //    입력칸은 계속 focus 상태라, focus 기준이면 탭바가 영영 안 돌아와 화면을 빠져나갈 수 없다.
  //    visualViewport 미지원 환경은 kb.open 이 항상 false → 종전 동작 그대로.
  const show = !!tabRole
    && mobile
    && !kb.open
    && isTabRoute(path, tabRole)
    && !hidden
    && path !== '/'          // 공개 안내 페이지(상품시트 입장)에는 ERP 탭바를 안 띄운다
    && path !== '/login'
    && !path.startsWith('/q/')
    && !path.startsWith('/catalog')
    && !path.startsWith('/sign/');

  useEffect(() => {
    setTabCss(show);
    return () => setTabCss(false);
  }, [show]);

  if (!show) return null;

  const active = (href: string) => {
    if (href === '/finder') return path === '/finder' || path.startsWith('/m/');
    return path === href || path.startsWith(href + '/');
  };

  return (
    <nav
      className="fp-tabbar"
      aria-label="주요 메뉴"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 52,
        boxSizing: 'border-box',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        background: C.taupeBg,
        borderTop: `1px solid ${C.line}`,
        boxShadow: SH.dock,
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'stretch',
        height: 'var(--fp-bar-h)',
        boxSizing: 'border-box',
      }}>
        {tabs.map((t) => {
          const on = active(t.href);
          const n = t.badgeKey ? badges[t.badgeKey] : 0;
          if (t.soon) {
            // 준비중 — 자리만 보여주고 이동하지 않는다(햄버거 soon 과 같은 규칙).
            return (
              <button
                key={t.href}
                type="button"
                aria-disabled
                onClick={() => { haptic.tap(); toast(`${t.label}은 준비중입니다`, 'info'); }}
                style={{
                  position: 'relative', flex: '1 1 0', minWidth: 0,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 5, paddingTop: 2, border: 'none', background: 'transparent',
                  color: C.faint, opacity: 0.4, fontWeight: FW.strong, fontSize: FS.cap,
                  letterSpacing: '-0.02em', lineHeight: 1, cursor: 'default',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <t.icon size={ICON.xl} strokeWidth={2.2} />
                <span style={{ whiteSpace: 'nowrap' }}>{t.label}</span>
              </button>
            );
          }
          return (
            <Link
              key={t.href}
              href={t.href}
              onClick={(e) => {
                if (on) {
                  e.preventDefault();
                  haptic.nav();
                  refreshCurrentPage(t.href);
                  return;
                }
                haptic.nav();
              }}
              aria-current={on ? 'page' : undefined}
              style={{
                position: 'relative',
                flex: '1 1 0', minWidth: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 5,
                paddingTop: 2,
                textDecoration: 'none',
                color: on ? C.brand : C.faint,
                opacity: on ? 1 : 0.72,
                fontWeight: FW.strong,
                fontSize: FS.cap,
                letterSpacing: '-0.02em',
                lineHeight: 1,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <t.icon size={ICON.xl} strokeWidth={2.2} />
              {/* 라벨이 4글자(계약문의 등) — 좁은 화면에서 줄바꿈되면 탭 높이가 깨지므로 한 줄 고정. */}
              <span style={{ whiteSpace: 'nowrap' }}>{t.label}</span>
              {n != null && n > 0 ? (
                <span style={{ position: 'absolute', top: 4, right: '18%', pointerEvents: 'none' }}>
                  <CountPill n={n} max={99} />
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
