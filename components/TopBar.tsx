'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { isGuestSurface } from '@/lib/guest-surface';
import { useState, useEffect, useCallback, type CSSProperties, type ReactNode } from 'react';
import { Menu, X, Search, FileText, FileSignature, Settings, ChevronLeft, List, History, Users, Wrench, HelpCircle, Sparkles, RefreshCw, type LucideIcon, Share2 } from 'lucide-react';
import { useAppBarSlots } from '@/lib/appbar';
import { useIsMobile } from '@/lib/use-mobile';
import { haptic } from '@/lib/haptics';
import { getRole, actor, type Role } from '@/lib/domain/deal';
import { useSession } from '@/lib/auth-context';
import { loadMenuBadges, menuItemBadge, type MenuBadgeMap } from '@/lib/domain/menu-badges';
import { C, R, CountPill, NUM, ctrlH, ctrlFs, FW, FS, Btn, IconBtn, BottomNav, SH, ICON } from '@/components/ui';
import { NAV_ICON, NAV_LABEL } from '@/lib/tabbar';
import { refreshCurrentPage } from '@/lib/page-refresh';
import { PageStatus, statusIconFor } from '@/components/PageStatus';
import { getStore, peekList } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { VERSION, BUILD } from '@/lib/brand';
import type { EntityRecord } from '@/lib/intake/entities';
import { companyAlias } from '@/lib/domain/identity';

// 상단바 = 상태창(어디·몇 건). 웹 메뉴=좌측 · 모바일 메뉴=우측.
// 웹 우측 = 오늘·소속·이름·직책. 주탭 아이콘·워딩 = NAV_ICON / NAV_LABEL SSOT.
const ALL_ROLES: Role[] = ['agent', 'provider', 'admin'];
const GROUPS: { title: string; items: { href?: string; label: string; icon: LucideIcon; soon?: boolean; roles?: Role[]; hideMobile?: boolean }[] }[] = [
  // '/' 는 공개 안내 페이지가 됐다(2026-08-15) — 내부 매물 화면은 /finder 다.
  { title: '', items: [{ href: '/finder', label: NAV_LABEL.product, icon: NAV_ICON.product, roles: ALL_ROLES }] },
  { title: '영업', items: [
    // 계약문의 하나로 간다 — 관리자에게는 이 안에서 «응대 큐»가 열린다(docs/ADMIN_DESK.md).
    { href: '/chat', label: NAV_LABEL.chat, icon: NAV_ICON.chat, roles: ALL_ROLES },
    { href: '/contract', label: NAV_LABEL.contract, icon: NAV_ICON.contract, roles: ['agent', 'provider', 'admin'] },
    // 손님에게 보낼 주소를 «화면이» 만들어 준다 — 손으로 조립하면 한 글자 틀려 담당 귀속이 날아간다.
    { href: '/share', label: '내 손님 링크', icon: Share2, roles: ['agent', 'admin'] },
    { href: '/esign', label: NAV_LABEL.esign, icon: FileSignature, roles: ['admin'] },
  ] },
  { title: '견적·구독', items: [
    { href: '/sonogong', label: '중고 픽업구독', icon: RefreshCw, roles: ALL_ROLES },
    { href: '/welrix', label: '신차렌탈 견적기', icon: Sparkles, roles: ALL_ROLES },
  ] },
  { title: '공급관리', items: [
    { href: '/inventory', label: NAV_LABEL.inventory, icon: NAV_ICON.inventory, roles: ['provider', 'admin'] },
    { href: '/members?tab=partner', label: NAV_LABEL.partners, icon: Users, roles: ['admin'] },
  ] },
  { title: '관리자', items: [
    { href: '/settlement', label: NAV_LABEL.settlement, icon: FileText, roles: ['admin'] },
    { href: '/members?tab=user', label: NAV_LABEL.members, icon: Users, roles: ['admin'] },
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
// 그룹 사이에는 구분선이 그어진다(렌더가 gi>0 이면 borderTop) — 재고관리 아래 선 하나로 «일하는 메뉴»와 «관리 메뉴»를 가른다(사장님 2026-08-19).
//   · 계약진행(/contract) = «내 계약이 어디까지 왔나» — 목록 + 5단계 진행상황(사장님 2026-08-19: 목록이랑 어디까지 진행중인지 보는 페이지).
//   · 계약서관리(/esign, 계약서 만들어 보내기·서명추적) = 관리 메뉴 맨 위(파트너사관리 위).
//   · 하단탭(lib/tabbar appTabsFor)도 같은 규칙.
const SIMPLE_GROUPS: typeof GROUPS = [{
  title: '',
  items: [
    { href: '/finder', label: '상품찾기', icon: NAV_ICON.product, roles: ALL_ROLES },
    { href: '/contract', label: '계약진행', icon: NAV_ICON.contract, roles: ALL_ROLES },
    { href: '/settlement', label: '정산확인', icon: FileText, roles: ['admin'] },
    { href: '/inventory', label: '재고관리', icon: NAV_ICON.inventory, roles: ['provider', 'admin'] },
    // 정책관리(/policy)는 메뉴에서 뺐다(사장님 2026-08-19 「이제 필요 없고, 파트너사관리에서 공급사별로 등록·수정·삭제」).
    //  /policy 는 파트너사관리 › 계약정책에서 여는 편집 화면으로만 산다(provider=코드 스코프 · return=partner). 공급사 정책 입력은 제공시트 「운영정책」 탭.
  ],
}, {
  title: '',
  items: [
    // 관리자 전용 — 페이지(/members)는 하나, 탭 쿼리로 파트너사·회원을 가른다(사장님 2026-08-19: 메뉴에 있어야 함).
    { href: '/esign', label: NAV_LABEL.esign, icon: NAV_ICON.esign, roles: ['admin'] },
    { href: '/members?tab=partner', label: NAV_LABEL.partners, icon: Users, roles: ['admin'] },
    { href: '/members?tab=user', label: NAV_LABEL.members, icon: Users, roles: ['admin'] },
  ],
}];

function statusFromPath(path: string): ReactNode {
  // WorkPage KPI 라벨과 맞춤 — 마운트 전 NAV→KPI 플래시 방지
  if (path === '/finder') return <PageStatus icon={NAV_ICON.product} label={NAV_LABEL.product} />;
  if (path.startsWith('/m/')) return <PageStatus icon={NAV_ICON.product} label="상품 상세" />;
  if (path.startsWith('/chat')) return <PageStatus icon={NAV_ICON.chat} label="문의 미확인" />;
  if (path.startsWith('/contract')) return <PageStatus icon={NAV_ICON.contract} label="계약진행" />;
  if (path.startsWith('/inventory')) return <PageStatus icon={NAV_ICON.inventory} label={NAV_LABEL.inventory} />;
  if (path.startsWith('/sonogong')) return <PageStatus icon={RefreshCw} label="중고차 렌트구독 견적기" />;
  if (path.startsWith('/welrix')) return <PageStatus icon={Sparkles} label="신차장기렌터카 견적기" />;
  if (path.startsWith('/policy')) return <PageStatus icon={statusIconFor('정책')} label={NAV_LABEL.policy} />;
  if (path.startsWith('/esign')) return <PageStatus icon={FileSignature} label={NAV_LABEL.esign} />;
  if (path.startsWith('/settlement')) return <PageStatus icon={statusIconFor('정산')} label={NAV_LABEL.settlement} />;
  if (path.startsWith('/members')) return <PageStatus icon={statusIconFor('회원')} label={NAV_LABEL.members} />;
  if (path.startsWith('/audit')) return <PageStatus icon={statusIconFor('감사')} label={NAV_LABEL.audit} />;
  if (path.startsWith('/data-check')) return <PageStatus icon={statusIconFor('데이터')} label={NAV_LABEL.dataCheck} />;
  if (path.startsWith('/settings')) return <PageStatus icon={NAV_ICON.settings} label={NAV_LABEL.settings} />;
  if (path.startsWith('/dev')) return <PageStatus icon={statusIconFor('개발')} label={NAV_LABEL.dev} />;
  // ★도면에 없는 라우트 = **아무것도 안 쓴다**. 전에는 여기서 브랜드명이 새어 나왔다
  //   (사장님 2026-08-30 「프리패스는 빼자 — 노브랜드로 아무것도 안 보여야 되는 거니까」).
  return '';
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
  // 「주식회사」·「(주)」는 법인격이지 회사 이름이 아니다 — 화면 표기는 companyAlias 로 통일.
  return companyAlias(String(p?.name || p?.partner_name || p?.company_name || code), p?.alias) || code;
}

/** 웹 우측 — 오늘 · 소속 · 이름 · 직책 (탭 → 설정). */
function WebSessionMeta() {
  const session = useSession();
  // SSR·첫 클라 렌더 동일 — getRole()/actor()는 localStorage 의존이라 서버엔 값이 없다.
  // 렌더 중에 읽으면 서버 폴백(박영업)과 클라 실제세션(박영협)이 어긋나 hydration mismatch. NavMenu와 동일하게 마운트 후에만 읽는다.
  const [mounted, setMounted] = useState(false);
  const [demoRole, setDemoRole] = useState<Role>('agent');
  useEffect(() => {
    setMounted(true);
    setDemoRole(getRole());
    const onRole = (event: Event) => setDemoRole((event as CustomEvent).detail as Role);
    const onSession = () => setDemoRole(getRole());
    window.addEventListener('fp:role', onRole);
    window.addEventListener('fp:session', onSession);
    return () => {
      window.removeEventListener('fp:role', onRole);
      window.removeEventListener('fp:session', onSession);
    };
  }, []);
  const role = session?.role ?? demoRole;
  const me = mounted ? actor(role) : null;
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
      // ★소속이 없으면 «빈칸». 예전엔 관리자에게 우리 브랜드를 찍었는데, 그게 상단바에 우리 이름이
      //   서는 마지막 자리였다(사장님 2026-08-31 「freepasserp.com 이거 또 회귀했네」).
      //   공급사·영업자가 같이 쓰는 판이라 어디에도 우리 이름이 서면 안 된다 — 노브랜드.
      setOrg('');
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
  }, [session?.company_code, role]);

  const name = session?.name || me?.name || '';
  const bits = [org, name].filter(Boolean); // 직책(역할 라벨)은 상단바에서 제외

  return (
    <Link
      className="fp-onbar"
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
        flex: '0 0 auto', fontFamily: NUM, fontVariantNumeric: 'tabular-nums', fontSize: FS.sub, fontWeight: FW.strong,
        color: C.mute, letterSpacing: '-0.01em', whiteSpace: 'nowrap',
      }}>{date}</span>
      {bits.length > 0 && (
        <span style={{
          minWidth: 0, fontSize: FS.sub, color: C.ink, fontWeight: FW.strong,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {bits.map((b, i) => (
            <span key={i}>
              {i > 0 && <span style={{ color: C.faint, fontWeight: FW.meta, margin: '0 5px' }}>·</span>}
              <span style={i === bits.length - 1 ? { color: C.mute, fontWeight: FW.strong } : undefined}>{b}</span>
            </span>
          ))}
        </span>
      )}
    </Link>
  );
}

function NavMenu({ mobile, open: openProp, setOpen: setOpenProp }: {
  mobile: boolean;
  // 상위(TopBar)에서 열림상태를 제어 → 열리면 좌측 상태를 '메뉴'로 스왑. 미지정 시 내부상태(하위호환).
  open?: boolean;
  setOpen?: (v: boolean | ((prev: boolean) => boolean)) => void;
}) {
  const session = useSession();
  const [openLocal, setOpenLocal] = useState(false);
  const open = openProp ?? openLocal;
  const setOpen = setOpenProp ?? setOpenLocal;
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
    // 앞선 요청은 취소하고 다시 — 취소자를 버리면 언마운트 뒤 늦은 응답이 setState 한다.
    let cancel = refreshBadges(role);
    const run = () => { cancel(); cancel = refreshBadges(role); };
    // 보이는 동안만 주기 갱신 — 상대가 보낸 새 문의는 이쪽에 알릴 계기가 없다(QA SYNC-1).
    //  focus 만으로는 모바일에서 앱 전환 복귀가 안 잡혀 visibilitychange 도 같이 듣는다.
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
  }, [role, refreshBadges]);
  useEffect(() => {
    if (open) refreshBadges(role);
  }, [open, role, refreshBadges]);
  const path = usePathname();
  const searchParams = useSearchParams();
  // 메뉴 href 가 쿼리(`/members?tab=partner`)를 가질 수 있다 — 경로는 pathname, 쿼리는 searchParams 로 각각 대조.
  // 파트너사관리·회원관리는 같은 /members 라 쿼리까지 봐야 하나만 켜진다.
  const isActive = (href?: string): boolean => {
    if (!href) return false;
    const [hp, hq] = href.split('?');
    if (hp === '/' ? path !== '/' : !(path === hp || path.startsWith(`${hp}/`))) return false;
    if (!hq) return true;
    for (const [k, v] of new URLSearchParams(hq)) if ((searchParams.get(k) ?? '') !== v) return false;
    return true;
  };
  const menuRole: Role = session?.role === 'admin' || session?.role === 'provider' || session?.role === 'agent'
    ? session.role
    : role;
  // 관리자는 역할 게이트를 통과한다 — 모든 메뉴가 보인다(항목마다 roles 에 admin 을 넣지 않아도 되게 여기서 규칙화).
  const seesAll = menuRole === 'admin';
  const groups = SIMPLE_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((it) => (seesAll || !it.roles || it.roles.includes(menuRole)) && !(mobile && it.hideMobile)),
  })).filter((g) => g.items.length);
  const line = C.line, ink = C.ink, mute = C.mute, weak = C.faint;
  // 웹=좌측 드롭다운 · 모바일=풀스크린
  const panel: CSSProperties = mobile
    ? { position: 'fixed', left: 0, right: 0, top: 'var(--topbar-h)', bottom: 0, background: C.taupeBg, zIndex: 80, overflowY: 'auto', overscrollBehavior: 'contain', animation: 'menuDrop .18s ease', padding: '8px 0 calc(24px + env(safe-area-inset-bottom))' }
    : { position: 'absolute', left: 0, top: 'calc(100% + 8px)', width: 272, background: C.taupeBg, border: `1px solid ${line}`, borderRadius: R, boxShadow: SH.menu, zIndex: 85, overflow: 'hidden', padding: '4px' };
  const iPad = mobile ? '14px 20px' : '10px 12px';
  const iFont = mobile ? 16 : FS.body;
  const iSize = mobile ? 20 : 15;
  return (
    <div style={{ position: 'relative', flex: '0 0 auto' }}>
      <IconBtn
        /* ★버튼«만» 띠 스코프에 넣는다 — 아래 패널은 형제라 흰 종이 그대로 남는다.
           패널까지 뒤집히면 메뉴 글자가 남색 위 남색이 된다. */
        className="fp-onbar"
        title={open ? (mobile ? '더보기 닫기' : '전체메뉴 닫기') : (mobile ? '더보기' : '전체메뉴')}
        onClick={() => { haptic.nav(); setOpen((o) => !o); }}
        style={mobile
          ? { border: 'none', background: open ? C.hover : 'transparent', color: ink }
          : { background: open ? C.hover : C.taupeBg, color: ink, border: `1px solid ${line}` }}
      >
        {open ? <X size={mobile ? ICON.xl : ICON.lg} /> : <Menu size={mobile ? ICON.xl : ICON.lg} />}
      </IconBtn>
      {open && (<>
        {!mobile && <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 74 }} />}
        <div style={panel}>
          {groups.map((g, gi) => (
            <div key={gi} style={{ borderTop: gi ? `1px solid ${line}` : 'none', padding: mobile ? '6px 0' : '5px 0' }}>
              {g.title && <div style={{ fontSize: mobile ? FS.cap : FS.micro, color: weak, fontWeight: FW.title, padding: mobile ? '7px 20px 5px' : '5px 12px', letterSpacing: '0.04em' }}>{g.title}</div>}
              {g.items.map((it) => {
                const itemLabel = menuRole === 'admin' && it.href === '/chat' ? '상담데스크' : it.label;
                if (it.soon) {
                  return (
                    <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: iPad, fontSize: iFont, color: weak, cursor: 'default' }}>
                      <it.icon size={iSize} /> <span>{itemLabel}</span> <span style={{ marginLeft: 'auto', fontSize: FS.micro, color: weak }}>준비중</span>
                    </div>
                  );
                }
                const rowBadge = menuItemBadge(badges, it.href);
                return (
                <Link key={it.label} href={it.href ?? '#'} onClick={(e) => {
                  haptic.nav();
                  setOpen(false);
                  if (isActive(it.href)) {
                    e.preventDefault();
                    queueMicrotask(() => refreshCurrentPage((it.href || '').split('?')[0]));
                  }
                }}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, padding: iPad, borderRadius: R, fontSize: iFont, fontWeight: FW.strong, color: isActive(it.href) ? C.brand : ink, background: isActive(it.href) ? C.selected : 'transparent', textDecoration: 'none' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.hover as string)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = isActive(it.href) ? C.selected as string : 'transparent')}>
                  <it.icon size={iSize} color={mute} />
                  <span style={{ flex: 1 }}>{itemLabel}</span>
                  {rowBadge > 0 ? <CountPill n={rowBadge} max={99} /> : null}
                </Link>
                );
              })}
            </div>
          ))}
          {/* 배포 버전(설정 항목 바로 아래) — 배포 확인용. lib/brand VERSION SSOT. */}
          <div style={{ borderTop: `1px solid ${line}`, padding: mobile ? '11px 20px' : '8px 12px 5px', fontSize: FS.micro, color: weak, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em' }}>
            {/* 브랜드명은 안 쓴다(노브랜드) — 배포 확인에 필요한 «판»만 남긴다. */}
            v{VERSION}{BUILD ? ` · ${BUILD}` : ''}
          </div>
        </div>
      </>)}
    </div>
  );
}

export default function TopBar() {
  const { back, backKind, left, actions, title } = useAppBarSlots();
  const mobile = useIsMobile();
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false); // 메뉴 열림 → 좌측 상태를 '메뉴'로 스왑
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
  // /m = 모바일 미리보기(폰 프레임) → 앱 상단바 없이 전체화면. /m/[code](실제 모바일 상세)는 상단바 유지.
  // '/' = 공개 안내 페이지(상품시트 입장) — ERP 상단바가 뜨면 안 된다(2026-08-15 · ERP 개선 대기).
  // 손님 면(가게·카탈로그·상품안내·전자계약)은 `isGuestSurface` 한 곳이 정한다 —
  // 예전엔 이 명단이 여기와 AppTabBar 에 따로 적혀 있어 새 라우트에서 한 쪽을 빠뜨렸다.
  if (path === '/' || path === '/erp5' || path.startsWith('/erp5/') || path === '/login' || path === '/m'
    || isGuestSurface(path)) return null;
  const backLabel = backKind === 'list' ? '목록' : '이전';
  const backIcon = backKind === 'list'
    ? <List size={mobile ? 18 : 16} strokeWidth={2.25} />
    : <ChevronLeft size={mobile ? 18 : 16} strokeWidth={2.25} />;
  const backBtn = back ? (
    mobile ? (
      <IconBtn title={backLabel} haptic="back" onClick={() => { back(); }}>{backIcon}</IconBtn>
    ) : (
      <Btn
        variant="ghost"
        haptic="back"
        onClick={() => { back(); }}
        style={{
          gap: 3, padding: '0 12px 0 8px',
          background: C.taupeBg, color: ink, fontSize: ctrlFs(mobile),
          boxShadow: 'none',
        }}
      >{backIcon} {backLabel}</Btn>
    )
  ) : null;

  // 메뉴를 열어도 페이지 제목은 유지한다. 열림 상태는 햄버거가 닫기 아이콘으로 바뀌어 표시한다.
  const status: ReactNode = (title != null && title !== '') ? title : statusFromPath(path);
  const onStatusTap = () => {
    if (menuOpen) { setMenuOpen(false); return; } // 메뉴 열린 상태에서 상태탭 = 메뉴 닫기
    haptic.nav();
    refreshCurrentPage(path);
  };

  return (
    <>
      {/* 왼쪽 여백은 **본문 칼럼을 따라간다**(--fp-col-l, lib/content-column) — 햄버거와 하단 「이전」이
          같은 세로선에 서야 한다. 본문이 화면 중앙이 아닐 때(옆에 보조 칼럼) 화면 기준으로는 못 맞춘다.
          변수를 안 쓰는 페이지는 0 → max() 가 기본값 14 를 지킨다. 우측(로그인 정보)은 화면 끝 그대로. */}
      <header className="fp-topbar" style={{ position: 'sticky', top: 0, zIndex: 70, height: 'var(--topbar-h)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px 0 14px', paddingLeft: mobile ? undefined : 'max(14px, var(--fp-col-l, 0px))', background: C.taupeBg, borderBottom: `1px solid ${line}`, boxSizing: 'border-box', boxShadow: mobile ? 'none' : 'var(--shadow-sm)' }}>
        {/* 웹·모바일 «동일» = 네이비 띠(전자계약 머리와 같은 면) — 바탕·선은 globals.css 가 칠한다(첫 페인트 번쩍임 방지).
            사장님 2026-08-30 「웹도 상단 헤더 똑같이 남색의 반전으로 · 모바일이랑 동일하게」.
            ★띠 위에 **브랜드 표식은 없다** — 마크도 워드마크도 안 세운다(사장님 2026-08-30 「노브랜드로 아무것도
              안 보여야 되는 거니까」). 이 ERP 는 공급사·영업자가 같이 쓰는 판이라 우리 이름이 서면 안 된다.
              남는 건 «어디에 있나»(페이지 아이콘 + 이름 + 건수)뿐이다. */}
        {/* 웹=메뉴 좌측 · 모바일=우측 */}
        {!mobile && <NavMenu mobile={false} open={menuOpen} setOpen={setMenuOpen} />}
        {/* 좌·중앙 = 상태 — 탭하면 이 페이지 새로 온 느낌(스크롤↑·목록·시트닫기) */}
        <div className="fp-topbar__main fp-onbar" style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {!mobile && backBtn}
          {left != null && <span style={{ flex: '0 0 auto' }}>{left}</span>}
          <div
            className="fp-topbar__status"
            role="button"
            tabIndex={0}
            aria-label="페이지 새로고침"
            onClick={onStatusTap}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStatusTap(); } }}
            style={{
              minWidth: 0, flex: 1,
              display: 'flex', alignItems: 'center',
              height: mobile ? ctrlH(true) : undefined,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
              ...(typeof status === 'string' ? {
                fontSize: FS.title, fontWeight: FW.title, color: ink,
                whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis',
                letterSpacing: '-0.01em',
              } : {}),
            }}
          >{status}</div>
        </div>
        {/* 페이지별 우측 액션 — erp3 m-topbar-actions. 웹·모바일 공통(메뉴 왼쪽). */}
        {actions != null && (
          <span className="fp-topbar__actions fp-onbar" style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            {actions}
          </span>
        )}
        {!mobile && <WebSessionMeta />}
        {/* ★모바일 상단바 = **상태 표시만**(사장님 2026-08-30 「상단은 그냥 상태 표시만 해주는거지」).
            누르는 것은 전부 하단 홈바로 내려갔다 — 홈 · 검색 · 설정(lib/tabbar appTabsFor).
            폰에서 하는 일이 「찾아서 보내기」뿐이라 전체메뉴(햄버거)가 열 곳이 없다.
            ⚠ 그래서 **계약진행·재고관리·계약문의는 폰에서 안 열린다**(설계대로 — 데스크톱에서 한다).
            검색 슬롯(search)은 TopBar 가 아니라 AppTabBar 가 읽는다. */}
      </header>
      {/* 모바일 이전만 하단독 — 우측 액션은 상단(위)으로. 액션 중복 금지. */}
      {mobile && back && (
        <BottomNav backKind={backKind ?? 'history'} onBack={back} zIndex={55} />
      )}
    </>
  );
}
