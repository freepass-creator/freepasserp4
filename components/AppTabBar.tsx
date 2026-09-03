'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { useIsMobile } from '@/lib/use-mobile';
import { useKeyboardOpen } from '@/lib/use-keyboard';
import { haptic } from '@/lib/haptics';
import { Btn, C, CountPill, FS, FW, SH, ICON } from '@/components/ui';
import { getRole, type Role } from '@/lib/domain/deal';
import { useSession } from '@/lib/auth-context';
import { useMenuBadges } from '@/lib/menu-badge-store';
import { appTabsFor, isTabRoute, useTabBarHidden, type AppTab } from '@/lib/tabbar';
import { useAppBarSlots } from '@/lib/appbar';
import { refreshCurrentPage } from '@/lib/page-refresh';
import { toast } from '@/components/Toaster';

/**
 * 모바일 하단 홈바 — **홈 · 검색 · 설정 셋**(항목 = lib/tabbar appTabsFor SSOT).
 * 폰에서 하는 일은 「상품 찾아서 손님한테 보내기」뿐이라, 하단바에도 그 일에 쓰는 것만 둔다.
 *
 * ★**검색 탭은 라우트가 아니라 행동**이다 — 지금 페이지가 `lib/appbar` 의 search 슬롯에 등록해 둔
 *   시트를 하단에서 연다. 등록이 없는 페이지(설정 등)에서는 찾는 곳(/finder)으로 데려간다.
 *   그래서 «어디서 눌러도 검색이 되는» 버튼이 되고, 탭 수는 어느 화면에서나 셋으로 고정된다.
 *
 * ★생김새는 당근 하단바 규격 — **큰 글리프(ICON.tab 24) + 작은 라벨(FS.cap)**, 흰 바탕에 윗선 하나.
 *   꺼진 탭은 «흐리게»가 아니라 «회색»이다(opacity 를 겹쳐 깎으면 글리프 획이 물에 빠진 것처럼 뭉갠다).
 */
/** 탭 한 칸 — 세 갈래(검색 버튼·준비중·이동)가 «같은 칸»이어야 줄이 안 흔들린다. */
const TAB_CELL: React.CSSProperties = {
  position: 'relative', flex: '1 1 0', minWidth: 0,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: 5, paddingTop: 2, border: 'none', background: 'transparent',
  textDecoration: 'none', fontWeight: FW.strong, fontSize: FS.cap,
  letterSpacing: '-0.02em', lineHeight: 1,
  WebkitTapHighlightColor: 'transparent',
};

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
  const router = useRouter();
  const hidden = useTabBarHidden();
  const session = useSession();
  const kb = useKeyboardOpen();
  // 검색 탭이 열 시트 — 지금 페이지가 등록해 둔 것(없으면 /finder 로 보낸다).
  const { search: searchSlot } = useAppBarSlots();
  // null = 역할 미확정(첫 페인트). agent 가정으로 탭 수 점프 금지.
  const [role, setRole] = useState<Role | null>(null);

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

  // 상품찾기·공유 화면은 읽기 중심이다. 전역 메뉴 숫자를 갱신하려고 방·계약·정산
  // 원장을 주기적으로 읽지 않는다. 업무 화면에 들어갔을 때만 갱신한다.
  const needsWorkspaceBadges = path.startsWith('/chat') || path.startsWith('/contract') || path.startsWith('/settlement');
  const { badges } = useMenuBadges(needsWorkspaceBadges ? tabRole : null, `${session?.uid || ''}:${session?.rawRole || ''}:${session?.company_code || ''}`);

  const tabs = tabRole ? appTabsFor(tabRole) : [];
  // 고정 하단 탭은 다음 이동 후보가 2~4개로 매우 작다. 유휴 시간에 route shell만
  // 미리 받아 두면 탭을 누른 뒤 네트워크 왕복 때문에 화면이 멈춘 듯 보이지 않는다.
  // 개별 상품 상세는 수백 개라 여기서 prefetch하지 않는다.
  useEffect(() => {
    if (!tabRole) return;
    const preload = () => {
      for (const tab of appTabsFor(tabRole)) {
        if (tab.href !== path && !tab.soon) router.prefetch(tab.href);
      }
    };
    const idle = typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(preload, { timeout: 1_500 })
      : window.setTimeout(preload, 350);
    return () => {
      if (typeof window.cancelIdleCallback === 'function' && typeof idle === 'number') window.cancelIdleCallback(idle);
      else window.clearTimeout(idle as number);
    };
  }, [path, router, tabRole]);
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

  const active = (t: AppTab) => {
    // 검색은 «가는 곳»이 아니라 «여는 것» — 현재 위치로 불이 들어오면 안 된다.
    // 대신 검색어·조건이 걸려 있을 때(slot.active) 켠다.
    if (t.action === 'search') return !!searchSlot?.active;
    if (t.href === '/finder') return path === '/finder' || path.startsWith('/m/');
    return path === t.href || path.startsWith(t.href + '/');
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
        /* 하단바 = 상단 라인 «하나만»(사장님 2026-08-22 검수) — 그림자 없음. */
        borderTop: `1px solid ${C.line}`,
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'stretch',
        height: 'var(--fp-bar-h)',
        boxSizing: 'border-box',
      }}>
        {tabs.map((t) => {
          const on = active(t);
          const n = t.badgeKey ? badges[t.badgeKey] : 0;
          if (t.action === 'search') {
            // 하단에서 «튀어나오는» 검색 — 이 페이지에 시트가 있으면 열고, 없으면 찾는 곳으로 간다.
            return (
              <Btn
                key="search"
                type="button"
                /* ★bare 필수 — 기본값 solid 는 height(40)·테두리·그림자를 얹는다.
                   옆 칸(Link)은 바 높이(56)를 꽉 채우므로 그 순간 아이콘 줄이 어긋난다(2026-08-30 실측). */
                variant="bare"
                haptic={false}
                onClick={() => {
                  haptic.nav();
                  if (searchSlot) searchSlot.onOpen();
                  else router.push(t.href);
                }}
                style={{ ...TAB_CELL, color: on ? C.brand : C.faint }}
              >
                <t.icon size={ICON.tab} strokeWidth={2.1} />
                <span style={{ whiteSpace: 'nowrap' }}>{t.label}</span>
              </Btn>
            );
          }
          if (t.soon) {
            // 준비중 — 자리만 보여주고 이동하지 않는다(햄버거 soon 과 같은 규칙).
            return (
              <Btn
                key={t.href}
                type="button"
                variant="bare"
                aria-disabled
                haptic={false}
                onClick={() => { haptic.tap(); toast(`${t.label}은 준비중입니다`, 'info'); }}
                style={{ ...TAB_CELL, color: C.faint, opacity: 0.4, cursor: 'default' }}
              >
                <t.icon size={ICON.tab} strokeWidth={2.1} />
                <span style={{ whiteSpace: 'nowrap' }}>{t.label}</span>
              </Btn>
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
              style={{ ...TAB_CELL, color: on ? C.brand : C.faint }}
            >
              <t.icon size={ICON.tab} strokeWidth={2.1} />
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
