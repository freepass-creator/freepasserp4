'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, type CSSProperties } from 'react';
import { Menu, Search, MessageSquare, FileText, ScrollText, Wallet, Boxes, Settings, ChevronLeft, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAppBarSlots } from '@/lib/appbar';
import { useIsMobile } from '@/lib/use-mobile';
import { getRole, actor, ROLE_LABEL, type Role } from '@/lib/domain/deal';
import { useSession } from '@/lib/auth-context';
import { setGuest, isGuest } from '@/lib/auth-session';

// 화이트라벨 — 자사 브랜드 노출 금지. 밝은 상단바 + 햄버거(jpkerp6식 그룹 드롭다운) + 이전/액션(슬롯).
// 웹 = 상단바에 이전·액션 / 모바일 = 뎁스 깊어지면 하단 고정바에 이전·액션.
const GROUPS: { title: string; items: { href?: string; label: string; icon: LucideIcon; soon?: boolean }[] }[] = [
  { title: '', items: [{ href: '/', label: '매물 검색', icon: Search }] },
  { title: '영업', items: [{ href: '/chat', label: '소통', icon: MessageSquare }, { href: '/contract', label: '계약', icon: FileText }] },
  { title: '관리', items: [{ href: '/inventory', label: '재고관리', icon: Boxes }, { href: '/policy', label: '정책관리', icon: ScrollText }, { href: '/settlement', label: '정산', icon: Wallet }] },
  { title: '', items: [{ label: '설정', icon: Settings, soon: true }] },
];

function NavMenu({ mobile }: { mobile: boolean }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const line = 'var(--border)', ink = 'var(--text-main)', mute = 'var(--text-sub)', weak = 'var(--text-weak)';
  const panel: CSSProperties = mobile
    ? { position: 'fixed', left: 0, right: 0, top: 'var(--topbar-h)', bottom: 0, background: '#fff', zIndex: 75, overflowY: 'auto' }
    : { position: 'absolute', left: 0, top: 'calc(100% + 6px)', width: 250, background: '#fff', border: `1px solid ${line}`, borderRadius: 4, boxShadow: '0 12px 34px rgba(15,23,42,0.18)', zIndex: 75, overflow: 'hidden' };
  const iPad = mobile ? '13px 20px' : '9px 14px';
  const iFont = mobile ? 15 : 13;
  const iSize = mobile ? 18 : 15;
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen((o) => !o)} aria-label="메뉴"
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 32, boxSizing: 'border-box', border: `1px solid ${line}`, borderRadius: 4, background: open ? '#f1f5f9' : '#fff', color: ink, cursor: 'pointer' }}>
        <Menu size={mobile ? 20 : 17} />
      </button>
      {open && (<>
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 74 }} />
        <div style={panel}>
          {mobile && <div style={{ display: 'flex', alignItems: 'center', padding: '12px 18px', borderBottom: `1px solid ${line}` }}><span style={{ fontSize: 15, fontWeight: 800, color: ink }}>메뉴</span><span style={{ flex: 1 }} /><button onClick={() => setOpen(false)} aria-label="닫기" style={{ border: 'none', background: 'none', fontSize: 20, color: mute, cursor: 'pointer' }}>✕</button></div>}
          {GROUPS.map((g, gi) => (
            <div key={gi} style={{ borderTop: gi ? `1px solid ${line}` : 'none', padding: '5px 0' }}>
              {g.title && <div style={{ fontSize: mobile ? 11.5 : 10.5, color: weak, fontWeight: 700, padding: mobile ? '7px 20px 4px' : '4px 14px', letterSpacing: '0.02em' }}>{g.title}</div>}
              {g.items.map((it) => it.soon ? (
                <div key={it.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: iPad, fontSize: iFont, color: weak, cursor: 'default' }}>
                  <it.icon size={iSize} /> <span>{it.label}</span> <span style={{ marginLeft: 'auto', fontSize: 10, color: weak }}>준비중</span>
                </div>
              ) : (
                <Link key={it.label} href={it.href ?? '#'} onClick={() => setOpen(false)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: iPad, fontSize: iFont, fontWeight: (it.href === '/' ? path === '/' : path.startsWith(it.href ?? '##')) ? 700 : 500, color: ink, textDecoration: 'none' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  <it.icon size={iSize} color={mute} /> {it.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </>)}
    </div>
  );
}

export default function TopBar() {
  const { back, left, actions } = useAppBarSlots();
  const mobile = useIsMobile();
  const router = useRouter();
  const path = usePathname();
  const session = useSession();
  const [role, setRoleLocal] = useState<Role>('agent');
  useEffect(() => { setRoleLocal(getRole()); }, [session]);
  const line = 'var(--border)', ink = 'var(--text-main)';
  const doLogout = async () => {
    try { const { logout } = await import('@/lib/firebase/auth'); await logout(); } catch { /* noop */ }
    setGuest(false);
    router.replace('/login');
  };
  const who = session ? `${session.name} · ${ROLE_LABEL[session.role]}` : (isGuest() ? '둘러보기 · 비로그인' : `${actor(role).name} · ${ROLE_LABEL[role]}`);
  if (path === '/login') return null; // 로그인 화면에선 톱바 숨김
  const backBtn = back ? (
    <button onClick={back} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: 32, boxSizing: 'border-box', padding: '0 12px 0 8px', border: `1px solid ${line}`, borderRadius: 4, background: '#fff', color: ink, fontSize: 12.5, cursor: 'pointer' }}><ChevronLeft size={16} /> 이전</button>
  ) : null;

  return (
    <>
      <header style={{ position: 'sticky', top: 0, zIndex: 40, height: 'var(--topbar-h)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', background: '#fff', borderBottom: `1px solid ${line}`, boxSizing: 'border-box' }}>
        <NavMenu mobile={mobile} />
        {!mobile && backBtn}
        {left != null && <span>{left}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text-sub)', whiteSpace: 'nowrap' }}>{who}</span>
        <button onClick={doLogout} style={{ fontSize: 12, color: 'var(--text-sub)', background: 'none', cursor: 'pointer', border: `1px solid ${line}`, borderRadius: 4, padding: '4px 9px' }}>{session || isGuest() ? '로그아웃' : '로그인'}</button>
        {!mobile && actions != null && <span>{actions}</span>}
      </header>
      {mobile && (back || actions != null) && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 55, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px calc(8px + env(safe-area-inset-bottom))', background: '#fff', borderTop: `1px solid ${line}`, boxShadow: '0 -2px 12px rgba(15,23,42,0.06)' }}>
          {backBtn}
          <span style={{ flex: 1 }} />
          {actions}
        </div>
      )}
    </>
  );
}
