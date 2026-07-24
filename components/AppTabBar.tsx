'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { C, CountPill, FS, FW } from '@/components/ui';
import { getRole, type Role } from '@/lib/domain/deal';
import { useSession } from '@/lib/auth-context';
import { loadMenuBadges, type MenuBadgeMap } from '@/lib/domain/menu-badges';
import { appTabsFor, isTabRoute, useTabBarHidden } from '@/lib/tabbar';
import { refreshCurrentPage } from '@/lib/page-refresh';

/**
 * 모바일 하단 탭.
 *   공통: 상품찾기 · 계약문의 · 계약진행 · 설정
 *   공급사·관리자: + 재고관리
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
    const stop = refreshBadges(tabRole);
    const onFocus = () => refreshBadges(tabRole);
    const onUnread = () => refreshBadges(tabRole);
    window.addEventListener('focus', onFocus);
    window.addEventListener('fp:unread', onUnread);
    return () => { stop(); window.removeEventListener('focus', onFocus); window.removeEventListener('fp:unread', onUnread); };
  }, [tabRole, refreshBadges]);

  const tabs = tabRole ? appTabsFor(tabRole) : [];
  const show = !!tabRole
    && mobile
    && isTabRoute(path, tabRole)
    && !hidden
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
    if (href === '/') return path === '/' || path.startsWith('/m/');
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
        boxShadow: '0 -2px 12px rgba(15,23,42,0.06)',
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
                fontWeight: on ? FW.head : FW.meta,
                fontSize: FS.cap,
                letterSpacing: '-0.02em',
                lineHeight: 1,
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <t.icon size={20} strokeWidth={on ? 2.4 : 1.75} />
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
