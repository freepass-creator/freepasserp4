'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useCallback, type CSSProperties, type ReactNode } from 'react';
import { Menu, X, Search, FileText, ScrollText, Settings, ChevronLeft, List, History, Users, Wrench, HelpCircle, type LucideIcon } from 'lucide-react';
import { useAppBarSlots } from '@/lib/appbar';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { getRole, actor, ROLE_LABEL, type Role } from '@/lib/domain/deal';
import { useSession } from '@/lib/auth-context';
import { isGuest } from '@/lib/auth-session';
import { loadMenuBadges, menuItemBadge, type MenuBadgeMap } from '@/lib/domain/menu-badges';
import { C, R, CountPill, NUM, ctrlH, ctrlFs } from '@/components/ui';
import { NAV_ICON, NAV_LABEL } from '@/lib/tabbar';
import { refreshCurrentPage } from '@/lib/page-refresh';
import { PageStatus, statusIconFor } from '@/components/PageStatus';
import { getStore, peekList } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { BRAND } from '@/lib/brand';
import type { EntityRecord } from '@/lib/intake/entities';

// 상단바 = 상태창(어디·몇 건). 웹 메뉴=좌측 · 모바일 메뉴=우측.
// 웹 우측 = 오늘·소속·이름·직책. 주탭 아이콘·워딩 = NAV_ICON / NAV_LABEL SSOT.
const ALL_ROLES: Role[] = ['agent', 'provider', 'admin'];
const GROUPS: { title: string; items: { href?: string; label: string; icon: LucideIcon; soon?: boolean; roles?: Role[]; hideMobile?: boolean }[] }[] = [
  { title: '', items: [{ href: '/', label: NAV_LABEL.product, icon: NAV_ICON.product, roles: ALL_ROLES }] },
  { title: '영업', items: [
    { href: '/chat', label: NAV_LABEL.chat, icon: NAV_ICON.chat, roles: ALL_ROLES },
    { href: '/contract', label: NAV_LABEL.contract, icon: NAV_ICON.contract, roles: ['agent', 'provider', 'admin'] },
  ] },
  { title: '공급관리', items: [
    { href: '/inventory', label: NAV_LABEL.inventory, icon: NAV_ICON.inventory, roles: ['provider', 'admin'] },
    { href: '/policy', label: NAV_LABEL.policy, icon: ScrollText, roles: ['provider', 'admin'] },
  ] },
  { title: '관리자', items: [
    { href: '/settlement', label: NAV_LABEL.settlement, icon: FileText, roles: ['admin'] },
    { href: '/members', label: NAV_LABEL.members, icon: Users, roles: ['admin'] },
    { href: '/audit', label: NAV_LABEL.audit, icon: History, roles: ['admin'] },
    { href: '/data-check', label: NAV_LABEL.dataCheck, icon: Search, roles: ['admin'] },
  ] },
  { title: '', items: [
    { href: '/dev', label: NAV_LABEL.dev, icon: Wrench, roles: ['admin'], hideMobile: true },
    { href: '/faq', label: NAV_LABEL.faq, icon: HelpCircle, roles: ['agent', 'admin'] },
    { href: '/settings', label: NAV_LABEL.settings, icon: NAV_ICON.settings, roles: ALL_ROLES },
  ] },
];

/** 라우트 → 상태 라벨(앱바 title 없을 때). */
function statusFromPath(path: string): ReactNode {
  // WorkPage KPI 라벨과 맞춤 — 마운트 전 NAV→KPI 플래시 방지
  if (path === '/') return <PageStatus icon={NAV_ICON.product} label={NAV_LABEL.product} />;
  if (path.startsWith('/m/')) return <PageStatus icon={NAV_ICON.product} label="상품 상세" />;
  if (path.startsWith('/chat')) return <PageStatus icon={NAV_ICON.chat} label="문의 미확인" />;
  if (path.startsWith('/contract')) return <PageStatus icon={NAV_ICON.contract} label="계약진행중" />;
  if (path.startsWith('/inventory')) return <PageStatus icon={NAV_ICON.inventory} label="출고가능" />;
  if (path.startsWith('/policy')) return <PageStatus icon={statusIconFor('정책')} label={NAV_LABEL.policy} />;
  if (path.startsWith('/settlement')) return <PageStatus icon={statusIconFor('정산')} label={NAV_LABEL.settlement} />;
  if (path.startsWith('/members')) return <PageStatus icon={statusIconFor('회원')} label={NAV_LABEL.members} />;
  if (path.startsWith('/audit')) return <PageStatus icon={statusIconFor('감사')} label={NAV_LABEL.audit} />;
  if (path.startsWith('/data-check')) return <PageStatus icon={statusIconFor('데이터')} label={NAV_LABEL.dataCheck} />;
  if (path.startsWith('/settings')) return <PageStatus icon={NAV_ICON.settings} label={NAV_LABEL.settings} />;
  if (path.startsWith('/dev')) return <PageStatus icon={statusIconFor('개발')} label={NAV_LABEL.dev} />;
  return 'freepass';
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'] as const;

function todayLabel(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}.${m}.${day} (${DOW[d.getDay()]})`;
}

function partnerName(rows: EntityRecord[], code: string): string {
  const p = rows.find((r) => String(r.partner_code || r._key) === code);
  return String(p?.name || p?.partner_name || p?.company_name || code).trim();
}

/** 웹 우측 — 오늘 · 소속 · 이름 · 직책 (탭 → 설정). */
function WebSessionMeta() {
  const session = useSession();
  // SSR·첫 클라 렌더 동일 — getRole()/actor()/isGuest()는 localStorage 의존이라 서버엔 값이 없다.
  // 렌더 중에 읽으면 서버 폴백(박영업)과 클라 실제세션(박영협)이 어긋나 hydration mismatch. NavMenu와 동일하게 마운트 후에만 읽는다.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const role = session?.role ?? (mounted ? getRole() : 'agent');
  const me = mounted ? actor(role) : null;
  const guest = mounted ? isGuest() : false;
  const [date, setDate] = useState(() => todayLabel());
  const [org, setOrg] = useState('');

  useEffect(() => {
    setDate(todayLabel());
    const id = window.setInterval(() => setDate(todayLabel()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const code = String(session?.company_code || '').trim();
    if (!code) {
      setOrg(role === 'admin' ? BRAND : guest ? '둘러보기' : '');
      return;
    }
    const co = getCompanyId();
    const cached = peekList('partner', co);
    if (cached) { setOrg(partnerName(cached, code)); return; }
    let alive = true;
    getStore().list('partner', co)
      .then((rows) => { if (alive) setOrg(partnerName(rows, code)); })
      .catch(() => { if (alive) setOrg(code); });
    return () => { alive = false; };
  }, [session?.company_code, role, guest]);

  const name = session?.name || me?.name || '';
  const job = mounted ? (ROLE_LABEL[role] || role) : '';
  const bits = [org, name, job].filter(Boolean);

  return (
    <Link
      href="/settings"
      onClick={() => haptic.nav()}
      title="설정"
      style={{
        flex: '0 0 auto', maxWidth: 420, minWidth: 0,
        display: 'flex', alignItems: 'center', gap: 8,
        textDecoration: 'none', color: 'inherit',
        padding: '0 4px', height: ctrlH(false),
        borderRadius: R,
      }}
    >
      <span style={{
        flex: '0 0 auto', fontFamily: NUM, fontSize: 12, fontWeight: 700,
        color: C.mute, letterSpacing: '-0.01em', whiteSpace: 'nowrap',
      }}>{date}</span>
      {bits.length > 0 && (
        <span style={{
          minWidth: 0, fontSize: 12, color: C.ink, fontWeight: 600,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {bits.map((b, i) => (
            <span key={i}>
              {i > 0 && <span style={{ color: C.faint, fontWeight: 500, margin: '0 5px' }}>·</span>}
              <span style={i === bits.length - 1 ? { color: C.mute, fontWeight: 600 } : undefined}>{b}</span>
            </span>
          ))}
        </span>
      )}
    </Link>
  );
}

function NavMenu({ mobile }: { mobile: boolean }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  // SSR·첫 클라 동일 — getRole()은 마운트 후(hydration mismatch 방지).
  const [role, setRole] = useState<Role>('agent');
  const [badges, setBadges] = useState<MenuBadgeMap>({});
  const refreshBadges = useCallback((r: Role) => {
    let alive = true;
    loadMenuBadges(r).then((m) => { if (alive) setBadges(m); }).catch(() => {});
    return () => { alive = false; };
  }, []);
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
  useEffect(() => {
    const stop = refreshBadges(role);
    const onFocus = () => refreshBadges(role);
    const onUnread = () => refreshBadges(role);
    window.addEventListener('focus', onFocus);
    window.addEventListener('fp:unread', onUnread);
    return () => { stop(); window.removeEventListener('focus', onFocus); window.removeEventListener('fp:unread', onUnread); };
  }, [role, refreshBadges]);
  useEffect(() => {
    if (open) refreshBadges(role);
  }, [open, role, refreshBadges]);
  const path = usePathname();
  const menuRole: Role = session?.role === 'admin' || session?.role === 'provider' || session?.role === 'agent'
    ? session.role
    : role;
  // 관리자는 역할 게이트를 통과한다 — 모든 메뉴가 보인다(항목마다 roles 에 admin 을 넣지 않아도 되게 여기서 규칙화).
  const seesAll = menuRole === 'admin';
  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((it) => (seesAll || !it.roles || it.roles.includes(menuRole)) && !(mobile && it.hideMobile)),
  })).filter((g) => g.items.length);
  const line = C.line, ink = C.ink, mute = C.mute, weak = C.faint;
  // 웹=좌측 드롭다운 · 모바일=풀스크린
  const panel: CSSProperties = mobile
    ? { position: 'fixed', left: 0, right: 0, top: 'var(--topbar-h)', bottom: 0, background: C.taupeBg, zIndex: 80, overflowY: 'auto', overscrollBehavior: 'contain', animation: 'menuDrop .18s ease', paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }
    : { position: 'absolute', left: 0, top: 'calc(100% + 6px)', width: 250, background: C.taupeBg, border: `1px solid ${line}`, borderRadius: 4, boxShadow: '0 12px 34px rgba(15,23,42,0.18)', zIndex: 85, overflow: 'hidden' };
  const iPad = mobile ? '15px 20px' : '9px 14px';
  const iFont = mobile ? 16 : 13;
  const iSize = mobile ? 20 : 15;
  return (
    <div style={{ position: 'relative', flex: '0 0 auto' }}>
      <button onClick={() => { haptic.tap(); setOpen((o) => !o); }} aria-label={open ? '메뉴 닫기' : '메뉴'}
        style={{
          ...(mobile
            ? { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: ctrlH(true), height: ctrlH(true), marginRight: -6, border: 'none', background: 'none', color: ink, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' } as CSSProperties
            : { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: ctrlH(false), height: ctrlH(false), boxSizing: 'border-box', border: `1px solid ${line}`, borderRadius: 4, background: open ? C.hover : C.taupeBg, color: ink, cursor: 'pointer' } as CSSProperties),
        }}>
        {/* 햄버거 아이콘엔 숫자 뱃지 없음 — 탭·메뉴행만. (숫자 중첩·99 폭주 방지) */}
        {mobile && open ? <X size={24} /> : <Menu size={mobile ? 23 : 17} />}
      </button>
      {open && (<>
        {!mobile && <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 74 }} />}
        <div style={panel}>
          {groups.map((g, gi) => (
            <div key={gi} style={{ borderTop: gi ? `1px solid ${line}` : 'none', padding: '5px 0' }}>
              {g.title && <div style={{ fontSize: mobile ? 11.5 : 10.5, color: weak, fontWeight: 700, padding: mobile ? '7px 20px 4px' : '4px 14px', letterSpacing: '0.02em' }}>{g.title}</div>}
              {g.items.map((it) => {
                if (it.soon) {
                  return (
                    <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: iPad, fontSize: iFont, color: weak, cursor: 'default' }}>
                      <it.icon size={iSize} /> <span>{it.label}</span> <span style={{ marginLeft: 'auto', fontSize: 10, color: weak }}>준비중</span>
                    </div>
                  );
                }
                const rowBadge = menuItemBadge(badges, it.href);
                return (
                <Link key={it.label} href={it.href ?? '#'} onClick={(e) => {
                  haptic.nav();
                  setOpen(false);
                  const href = it.href || '';
                  if (href && (path === href || (href !== '/' && path.startsWith(href + '/')))) {
                    e.preventDefault();
                    queueMicrotask(() => refreshCurrentPage(href));
                  }
                }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: iPad, fontSize: iFont, fontWeight: (it.href === '/' ? path === '/' : path.startsWith(it.href ?? '##')) ? 700 : 500, color: ink, textDecoration: 'none' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.hover as string)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <it.icon size={iSize} color={mute} />
                  <span style={{ flex: 1 }}>{it.label}</span>
                  {rowBadge > 0 ? <CountPill n={rowBadge} max={99} /> : null}
                </Link>
                );
              })}
            </div>
          ))}
        </div>
      </>)}
    </div>
  );
}

export default function TopBar() {
  const { back, backKind, left, actions, title } = useAppBarSlots();
  const mobile = useIsMobile();
  const path = usePathname();
  useEffect(() => {
    const el = document.querySelector('.fp-main-pad') as HTMLElement | null;
    if (!el) return;
    const apply = () => {
      document.documentElement.style.setProperty('--sbw', `${Math.max(0, el.offsetWidth - el.clientWidth)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener('resize', apply);
    return () => { ro.disconnect(); window.removeEventListener('resize', apply); };
  }, [path]);
  const line = C.line, ink = C.ink;
  if (path === '/login' || path.startsWith('/q/') || path.startsWith('/catalog') || path.startsWith('/sign/')) return null;
  const backLabel = backKind === 'list' ? '목록' : '이전';
  const backIcon = backKind === 'list'
    ? <List size={mobile ? 18 : 16} strokeWidth={2.25} />
    : <ChevronLeft size={mobile ? 18 : 16} strokeWidth={2.25} />;
  const backBtn = back ? (
    <button onClick={() => { haptic.back(); back(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: ctrlH(mobile), boxSizing: 'border-box', padding: mobile ? '0 14px 0 10px' : '0 12px 0 8px', border: `1px solid ${line}`, borderRadius: R, background: '#fff', color: ink, fontSize: ctrlFs(mobile), cursor: 'pointer' }}>{backIcon} {backLabel}</button>
  ) : null;

  // 상태창 = 앱바 title 우선(페이지가 타이포·아이콘 책임), 없으면 라우트 라벨
  const status: ReactNode = (title != null && title !== '') ? title : statusFromPath(path);
  const onStatusTap = () => {
    haptic.nav();
    refreshCurrentPage(path);
  };

  return (
    <>
      <header style={{ position: 'sticky', top: 0, zIndex: 70, height: 'var(--topbar-h)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 0 14px', background: '#fff', borderBottom: `1px solid ${line}`, boxSizing: 'border-box' }}>
        {/* 웹=메뉴 좌측 · 모바일=우측 */}
        {!mobile && <NavMenu mobile={false} />}
        {/* 좌·중앙 = 상태 — 탭하면 이 페이지 새로 온 느낌(스크롤↑·목록·시트닫기) */}
        <div style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {!mobile && backBtn}
          {left != null && <span style={{ flex: '0 0 auto' }}>{left}</span>}
          <div
            role="button"
            tabIndex={0}
            aria-label="페이지 새로고침"
            onClick={onStatusTap}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStatusTap(); } }}
            style={{
              minWidth: 0, flex: 1,
              display: 'flex', alignItems: 'center',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
              ...(typeof status === 'string' ? {
                fontSize: mobile ? 15 : 13.5, fontWeight: 800, color: ink,
                whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis',
                letterSpacing: '-0.01em',
              } : {}),
            }}
          >{status}</div>
        </div>
        {!mobile && actions != null && <span style={{ flex: '0 0 auto' }}>{actions}</span>}
        {!mobile && <WebSessionMeta />}
        {mobile && <NavMenu mobile />}
      </header>
      {mobile && (back || actions != null) && (
        <div style={{
          position: 'fixed', left: 0, right: 0,
          bottom: 'var(--fp-tabbar-h, 0px)',
          zIndex: 55, background: '#fff',
          borderTop: `1px solid ${line}`,
          boxShadow: '0 -2px 12px rgba(15,23,42,0.06)',
          paddingBottom: 'var(--fp-dock-safe, env(safe-area-inset-bottom))',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 'var(--fp-bar-h)', boxSizing: 'border-box', padding: '0 var(--fp-bar-pad-x)' }}>
            {backBtn}
            <span style={{ flex: 1 }} />
            {actions}
          </div>
        </div>
      )}
    </>
  );
}
