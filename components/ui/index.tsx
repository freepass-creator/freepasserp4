'use client';
import React from 'react';
import type { Field, EntityRecord } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';
import { useAppBar } from '@/lib/appbar';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronLeft, List } from 'lucide-react';
import { haptic } from '@/lib/haptics';
import { copyText } from '@/lib/clipboard';
import { C, R, NUM, FS, FW, ctrlH, ctrlFs, ctrlInputFs, ctrlChipH } from './tokens';
import { CountPill } from './badges';
import { Btn } from './buttons';

/* 공용 UI 키트 — 전 페이지가 이걸 써서 통일. 기업형: 각지게(저radius)·고밀도·색 절제. */
// 토큰(C/R/NUM)=tokens.ts SSOT. 리프 분리: 접이식섹션=sec, 데이터표=table, 상태·라벨=badges, 카드원자=objcard. 여기서 배럴 재export.
export { C, R, NUM, FS, FW, CTRL, ctrlH, ctrlFs, ctrlInputFs, ctrlChipH } from './tokens';
export type { CtrlSize } from './tokens';
export * from './sec';
export * from './table';
export * from './badges';
export * from './objcard';
export * from './detail';
export * from './ContextMenu';
export * from './feedrow';
export * from './overlays';
export * from './list';
export * from './form-controls';
export * from './buttons';
export * from './layout';

// 표준 하단바 — 이전|목록(좌) + 액션(우). 홈은 TopBar 메뉴로(하단 홈 버튼 없음).
//
// 뒤로가기 라벨 SSOT (NavBack):
//   · 목록 = 같은 페이지에서 상세 패널 닫고 목록으로 (WorkPage selected → onBack)
//   · 이전 = 라우트 이탈 · history.back() (목록 페이지·/m 상세·설정 등)
//
// maxWidth·padX = 페이지 콘텐츠 박스. 기본=Page(1480/20).
// embedded = 오버레이 안 행만(WorkPage 모바일 상세).
export function NavBack({
  kind = 'history',
  onClick,
}: {
  kind?: 'history' | 'list';
  /** list면 목록 복귀 핸들러. history면 생략 시 router.back()(히스토리 없으면 /). */
  onClick?: () => void;
}) {
  const router = useRouter();
  const mobile = useIsMobile();
  const go = () => {
    haptic.back();
    if (kind === 'list') { onClick?.(); return; }
    if (onClick) { onClick(); return; }
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push('/');
  };
  const label = kind === 'list' ? '목록' : '이전';
  const icon = kind === 'list'
    ? <List size={mobile ? 18 : 16} strokeWidth={2.25} aria-hidden />
    : <ChevronLeft size={mobile ? 18 : 16} strokeWidth={2.25} aria-hidden />;
  return (
    <Btn variant="ghost" onClick={go}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {icon}
        {label}
      </span>
    </Btn>
  );
}

export function BottomNav({
  actions, maxWidth = 1480, padX = 20,
  backKind = 'history',
  onBack,
  embedded,
  zIndex = 45,
}: {
  actions?: React.ReactNode;
  maxWidth?: number;
  padX?: number;
  /** list = 같은 페이지 목록 복귀. 기본 history = 라우트 이전. */
  backKind?: 'history' | 'list';
  onBack?: () => void;
  /** 오버레이 안 등 — fixed 껍데기 없이 행만(부모가 border·safe-area). */
  embedded?: boolean;
  zIndex?: number;
}) {
  const mobile = useIsMobile();
  React.useEffect(() => {
    if (embedded) return;
    const el = document.querySelector('.fp-main-pad') as HTMLElement | null;
    if (el) document.documentElement.style.setProperty('--sbw', `${Math.max(0, el.offsetWidth - el.clientWidth)}px`);
  }, [embedded]);
  const row: React.CSSProperties = mobile || embedded
    ? { display: 'flex', alignItems: 'center', gap: 8, height: 'var(--fp-bar-h)', boxSizing: 'border-box', padding: '0 var(--fp-bar-pad-x)', width: '100%' }
    : { maxWidth, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 8, height: 'var(--fp-bar-h)', boxSizing: 'border-box', padding: `0 ${padX}px` };
  const inner = (
    <div style={row}>
      <NavBack kind={backKind} onClick={onBack} />
      {actions != null && (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
          {actions}
        </div>
      )}
    </div>
  );
  if (embedded) return inner;
  return (
    <div style={{
      position: 'fixed', left: 0, right: 0,
      bottom: 'var(--fp-tabbar-h, 0px)',
      zIndex, boxSizing: 'border-box',
      paddingRight: 'var(--sbw, 0px)', background: C.taupeBg,
      borderTop: `1px solid ${C.line}`, boxShadow: '0 -3px 14px rgba(15,23,42,0.07)',
      paddingBottom: 'var(--fp-dock-safe, env(safe-area-inset-bottom))',
    }}>
      {inner}
    </div>
  );
}

// Page = components/Page.tsx (모바일=MobilePageShell SSOT).
export { Page } from '../Page';
export { PageToolBar, type PageToolItem } from '../PageToolBar';
export { PageActions, type PageActionSpec } from '../PageActions';
export { BottomSheet, FilterSheet } from '../BottomSheet';


// PillTabs — 원자(유닛)화된 탭 그룹. 각 탭은 독립 버튼: 공간 넓으면 한 줄, 좁으면 줄바꿈에 유연 대응.
// 뷰 전환용 표준(렌즈 탭 등). 활성=brand 채움 / 비활성=흰 배경.
export function PillTabs<T extends string>({ tabs, value, onChange, size = 'md' }: { tabs: { key: T; label: React.ReactNode; title?: string }[]; value: T; onChange: (k: T) => void; size?: 'sm' | 'md' }) {
  const mobile = useIsMobile();
  const h = ctrlH(mobile, size);
  const pad = mobile ? '0 18px' : size === 'sm' ? '0 12px' : '0 14px';
  const fs = ctrlFs(mobile, size);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {tabs.map((t) => {
        const on = value === t.key;
        return (
          <button key={t.key} onClick={() => onChange(t.key)} title={t.title} className="fp-chip"
            style={{ height: h, boxSizing: 'border-box', padding: pad, fontSize: fs, fontWeight: FW.label, cursor: 'pointer', borderRadius: R, border: `1px solid ${on ? C.brand : C.line}`, background: on ? C.brand : C.taupeBg, color: on ? C.taupeBg : C.mute, whiteSpace: 'nowrap', flexShrink: 0, transition: 'background .1s, border-color .1s, color .1s' }}>{t.label}</button>
        );
      })}
    </div>
  );
}

export function Card({ title, value, note, tone = 'ink' }: { title: string; value: React.ReactNode; note?: React.ReactNode; tone?: 'ink' | 'danger' | 'ok' | 'warn' }) {
  const color = tone === 'danger' ? C.danger : tone === 'ok' ? C.ok : tone === 'warn' ? C.warn : C.ink;
  return (
    <div style={{ background: C.taupeBg, border: `1px solid ${C.line}`, borderRadius: R, padding: '16px', minHeight: 112, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 10px 28px rgba(15,23,42,0.04)' }}>
      <div style={{ fontSize: FS.sub, color: C.mute, fontWeight: FW.label, marginBottom: 10 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: FW.head, color, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {note && <div style={{ fontSize: FS.sub, color: C.faint, marginTop: 8 }}>{note}</div>}
    </div>
  );
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 18, alignItems: 'center' }}>{children}</div>;
}

export function Panel({ title, action, children }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18, border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, overflow: 'hidden', boxShadow: '0 10px 24px rgba(15,23,42,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${C.line}`, background: C.head }}>
        <div style={{ fontSize: FS.body, fontWeight: FW.title, color: C.ink }}>{title}</div>
        {action && <div>{action}</div>}
      </div>
      <div style={{ padding: '16px' }}>{children}</div>
    </div>
  );
}

export function Kpi({ label, value, tone = 'ink', href }: { label: string; value: React.ReactNode; tone?: 'ink' | 'danger' | 'ok' | 'warn'; href?: string }) {
  const color = tone === 'danger' ? C.danger : tone === 'ok' ? C.ok : tone === 'warn' ? C.warn : C.ink;
  const inner = (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: R, padding: '9px 14px', minWidth: 128, background: C.taupeBg }}>
      <div style={{ fontSize: FS.cap, color: C.mute, fontWeight: FW.strong }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: FW.head, marginTop: 2, color, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
  return href ? <a href={href} style={{ textDecoration: 'none', color: 'inherit' }}>{inner}</a> : inner;
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, marginTop: 12, marginBottom: 4, flexWrap: 'wrap' }}>{children}</div>;
}

/* 통계 스트립 — 상세/헤더의 "빠르게 볼 숫자"를 한 줄 테두리에 칸으로. 카드 X. */
export function StatBar({ items }: { items: { label: string; value: React.ReactNode; tone?: 'ink' | 'danger' | 'ok' | 'warn' }[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, overflow: 'hidden' }}>
      {items.map((it, i) => {
        const color = it.tone === 'danger' ? C.danger : it.tone === 'ok' ? C.ok : it.tone === 'warn' ? C.warn : C.ink;
        return (
          <div key={i} style={{ padding: '7px 15px', borderLeft: i ? `1px solid ${C.line2}` : 'none', minWidth: 96 }}>
            <div style={{ fontSize: FS.micro, color: C.mute, fontWeight: FW.strong }}>{it.label}</div>
            <div style={{ fontSize: FS.title, fontWeight: FW.head, marginTop: 1, color, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{it.value}</div>
          </div>
        );
      })}
    </div>
  );
}

/* 생애주기 스테퍼 — 자산 상태 기계를 가로로. done/current/todo. 목록에선 StatusTag로 투영. */
export type Step = { label: string; date?: string; state: 'done' | 'current' | 'todo'; note?: string };
export function Stepper({ steps }: { steps: Step[] }) {
  const dotColor = (s: Step['state']) => s === 'done' ? C.ok : s === 'current' ? C.brand : C.line;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, padding: '14px 18px', overflowX: 'auto' }}>
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 88, flex: '0 0 auto' }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: FS.cap, fontWeight: FW.head,
              background: s.state === 'done' ? C.ok : s.state === 'current' ? C.brand : C.taupeBg,
              color: s.state === 'todo' ? C.faint : C.taupeBg, border: `2px solid ${dotColor(s.state)}`,
              boxShadow: s.state === 'current' ? `0 0 0 3px color-mix(in srgb, ${C.brand} 18%, transparent)` : 'none' }}>
              {s.state === 'done' ? '✓' : i + 1}
            </div>
            <div style={{ marginTop: 6, fontSize: FS.sub, fontWeight: FW.strong, color: s.state === 'todo' ? C.faint : C.ink, whiteSpace: 'nowrap' }}>{s.label}</div>
            <div style={{ fontSize: FS.micro, color: C.faint, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', minHeight: 13 }}>{s.date || ''}</div>
            {s.note && <div style={{ fontSize: FS.micro, color: C.warn, fontWeight: FW.label }}>{s.note}</div>}
          </div>
          {i < steps.length - 1 && <div style={{ flex: 1, minWidth: 24, height: 2, marginTop: 10, background: steps[i + 1].state === 'todo' ? C.line2 : C.ok, borderRadius: 999 }} />}
        </React.Fragment>
      ))}
    </div>
  );
}

/** 세부 진입 통일 껍데기. 데스크톱=상단 sticky(이전·제목·액션) / 모바일=제목 위 + 하단 고정 액션바(이전·수정·저장).
 *  fixed=화면 전체 오버레이(자금 등 라우트 아닌 세부). 라우트 세부(차량)는 fixed 없이 사용. 모바일 연동 규격. */
export function DetailShell({ title, meta, onBack, actions, fixed, maxWidth = 1000, children }: { title?: React.ReactNode; meta?: React.ReactNode; onBack?: () => void; actions?: React.ReactNode; fixed?: boolean; maxWidth?: number; children: React.ReactNode }) {
  const mobile = useIsMobile();
  // 라우트 세부 → TopBar에 제목(페이지 소개). 이전·액션은 하단/웹 상단.
  useAppBar(fixed ? null : { back: onBack, backKind: 'history', title, actions }, [fixed, mobile, onBack, actions, title]);
  if (!fixed) {
    return (
      <div style={{ maxWidth, margin: '0 auto', padding: mobile ? '10px 12px 80px' : '14px 16px 48px' }}>
        {title != null && <h1 style={{ fontSize: FS.page, fontWeight: FW.title, letterSpacing: '-0.02em', margin: '2px 0 14px' }}>{title}</h1>}
        {children}
      </div>
    );
  }
  // 오버레이(자금 세부 등, 라우트 아님) → 자체 크롬. 닫기 = 목록(같은 화면 복귀).
  const back = onBack ? <NavBack kind="list" onClick={onBack} /> : null;
  return (
    <div style={{ position: 'fixed', top: 'var(--topbar-h)', left: 0, right: 0, bottom: 0, zIndex: 60, background: 'var(--bg-page)', overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div style={{ maxWidth, margin: '0 auto', padding: mobile ? '0 12px 76px' : '0 16px 48px' }}>
        {mobile ? (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '12px 2px 4px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: FS.page, fontWeight: FW.title, letterSpacing: '-0.02em' }}>{title}</span>
            {meta && <span style={{ fontSize: FS.sub, color: C.faint }}>{meta}</span>}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', flexWrap: 'wrap', position: 'sticky', top: 0, background: 'var(--bg-page)', zIndex: 10 }}>
            {back}
            <span style={{ fontSize: FS.page, fontWeight: FW.title, letterSpacing: '-0.02em', marginLeft: 6 }}>{title}</span>
            {meta && <span style={{ fontSize: FS.sub, color: C.faint }}>{meta}</span>}
            <span style={{ flex: 1 }} />
            {actions}
          </div>
        )}
        {children}
      </div>
      {mobile && onBack && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 70, background: C.taupeBg,
          borderTop: `1px solid ${C.line}`, boxShadow: '0 -2px 12px rgba(15,23,42,0.06)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          <BottomNav embedded backKind="list" onBack={onBack} actions={actions} />
        </div>
      )}
    </div>
  );
}
export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 12, padding: 20, textAlign: 'center', color: C.faint, border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, fontSize: FS.body }}>{children}</div>;
}

/* 로딩 = 공용 원자(SSOT). 어디서든 이거만 — 중앙 스피너 + 텍스트. 별도 로딩 div 금지.
 * min-height:100% + flex:1 = 부모(.fp-main-pad flex열·패널)를 채워 정중앙. 좁은 슬롯이면 minHeight 낮춰 전달. */
export function Loading({ label = '불러오는 중…', minHeight = '100%' }: { label?: React.ReactNode; minHeight?: string | number }) {
  return (
    <div style={{ minHeight, flex: 1, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '40px 16px', boxSizing: 'border-box' }}>
      <span aria-label="로딩" role="status" style={{ width: 26, height: 26, border: `3px solid ${C.line}`, borderTopColor: C.brand, borderRadius: '50%', animation: 'fp-spin 0.7s linear infinite' }} />
      {label != null && label !== '' && <span style={{ fontSize: FS.sub, color: C.faint }}>{label}</span>}
    </div>
  );
}
/* 중앙 안내(로딩 아님) — 빈 결과·에러 등. 스피너 없이 중앙 텍스트. */
export function CenterNote({ children, minHeight = '100%' }: { children: React.ReactNode; minHeight?: string | number }) {
  return <div style={{ minHeight, flex: 1, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.faint, fontSize: FS.body, textAlign: 'center', padding: '40px 16px', boxSizing: 'border-box' }}>{children}</div>;
}

/* 다중선택 필터칩 — 높이·글자·가로패딩 = Btn/Select와 동일(모바일 40·16·18). */
export function ToggleChips<T extends string>({ selected, onToggle, options, size = 'md' }: {
  selected: Set<T>; onToggle: (v: T) => void; options: { key: T; label: string; count?: number; disabled?: boolean }[]; size?: 'sm' | 'md';
}) {
  const mobile = useIsMobile();
  const h = ctrlChipH(mobile);
  const fs = ctrlFs(mobile, size);
  const pad = mobile ? '0 18px' : (size === 'sm' ? '0 11px' : '0 12px');
  const chip = (on: boolean, locked: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', height: h, boxSizing: 'border-box', padding: pad, fontSize: fs, fontWeight: FW.label, cursor: locked ? 'default' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0, borderRadius: R,
    border: `1px solid ${on ? C.brand : C.line}`, background: on ? C.brand : C.taupeBg, color: on ? C.taupeBg : C.mute, lineHeight: 1,
    opacity: locked ? 0.55 : 1,
    transition: 'background .1s, border-color .1s, color .1s',
  });
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: mobile ? 8 : 6 }}>
      {options.map((o) => {
        const on = selected.has(o.key);
        const locked = !!o.disabled;
        return (
          <button key={o.key} type="button" disabled={locked} onClick={() => { if (locked) return; haptic.select(); onToggle(o.key); }} aria-pressed={on} aria-disabled={locked || undefined} className="fp-chip" style={chip(on, locked)} title={locked ? '운영예정' : undefined}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* 접이식 필터 그룹 — 헤더 = CTRL.md.
 * actions = 우측 슬롯(해제 자리). 있으면 onClear「해제」대신 렌더(최근·관심 비우기↔해제 등). */
export function FilterGroup({ title, count = 0, onClear, actions, defaultOpen = true, first = false, children }: {
  title: React.ReactNode; count?: number; onClear?: () => void; actions?: React.ReactNode;
  defaultOpen?: boolean; first?: boolean; children: React.ReactNode;
}) {
  const mobile = useIsMobile();
  const [open, setOpen] = React.useState(defaultOpen);
  const h = ctrlH(mobile);
  const clearStyle: React.CSSProperties = {
    marginLeft: 6, flex: '0 0 auto', color: C.accent,
    fontSize: mobile ? FS.sub : FS.cap, fontWeight: FW.strong,
    minHeight: h, minWidth: 40, padding: mobile ? '0 10px' : '0 6px',
    visibility: count > 0 ? 'visible' : 'hidden',
    pointerEvents: count > 0 ? 'auto' : 'none',
  };
  return (
    <div style={{ borderTop: first ? 'none' : `1px solid ${C.line2}` }}>
      <div style={{ display: 'flex', alignItems: 'center', minHeight: h }}>
        <button onClick={() => { haptic.tap(); setOpen((o) => !o); }} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: mobile ? '10px 0' : '8px 0', background: 'none', border: 'none', cursor: 'pointer', minHeight: h, minWidth: 0 }}>
          <ChevronDown size={mobile ? 18 : 15} color={C.faint} style={{ flex: '0 0 auto', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .12s' }} />
          <span style={{ fontSize: mobile ? FS.title : FS.body, fontWeight: FW.title, color: C.ink, letterSpacing: '-0.01em', lineHeight: 1.2 }}>{title}</span>
          <span style={{
            display: 'inline-flex', visibility: count > 0 ? 'visible' : 'hidden',
            pointerEvents: 'none', minWidth: 22,
          }}>
            <CountPill n={count > 0 ? count : 1} tone="accent" />
          </span>
          <span style={{ flex: 1 }} />
        </button>
        {actions != null ? (
          <div style={{ display: 'flex', alignItems: 'center', flex: '0 0 auto', marginLeft: 2 }}>{actions}</div>
        ) : onClear ? (
          <Btn
            variant="bare"
            disabled={count <= 0}
            onClick={() => { if (count <= 0) return; haptic.select(); onClear(); }}
            style={clearStyle}
          >해제</Btn>
        ) : null}
      </div>
      {open && <div style={{ display: 'flex', flexWrap: 'wrap', gap: mobile ? 8 : 6, paddingBottom: mobile ? 14 : 12, width: '100%' }}>{children}</div>}
    </div>
  );
}

export type MessageVariant = 'info' | 'success' | 'warning' | 'danger';
export function Message({ variant = 'info', children }: { variant?: MessageVariant; children: React.ReactNode }) {
  const palette: Record<MessageVariant, { bg: string; border: string; color: string }> = {
    info: { bg: 'var(--blue-bg)', border: 'var(--blue-border)', color: 'var(--blue-text)' },
    success: { bg: 'var(--green-bg)', border: 'var(--green-border)', color: 'var(--green-text)' },
    warning: { bg: 'var(--orange-bg)', border: 'var(--orange-border)', color: 'var(--orange-text)' },
    danger: { bg: 'var(--red-bg)', border: 'var(--red-border)', color: 'var(--red-text)' },
  };
  const p = palette[variant];
  return (
    <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: R, border: `1px solid ${p.border}`, background: p.bg, color: p.color, fontSize: FS.body, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

/* 퀵필터 — 세그먼트 툴바(각진 버튼군). count 내장 = 요약. */
export type ChipOpt<T extends string> = { key: T; label: string; count?: number };
export function FilterChips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: ChipOpt<T>[] }) {
  const mobile = useIsMobile();
  const h = ctrlChipH(mobile);
  const fs = ctrlFs(mobile);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: mobile ? 8 : 6, marginTop: 0 }}>
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button key={o.key} onClick={() => { haptic.select(); onChange(o.key); }} aria-pressed={active} className="fp-chip"
            style={{ display: 'inline-flex', alignItems: 'center', height: h, boxSizing: 'border-box', padding: mobile ? '0 18px' : '0 12px', fontSize: fs, fontWeight: FW.label, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, lineHeight: 1,
              borderRadius: R, border: `1px solid ${active ? C.brand : C.taupeLine}`, background: active ? C.brand : C.taupeBg, color: active ? C.taupeBg : C.mute,
              transition: 'background .1s, border-color .1s, color .1s' }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function won(n: unknown): string { const x = Number(n); return isNaN(x) ? '—' : x.toLocaleString(); }

/* 공용 입력 폼 — 직접입력·상세수정 공용. 숫자=콤마 서식, 연락처=전화 자동서식(편한 입력). */
const fmtNum = (v: unknown) => { const s = String(v ?? ''); if (s === '') return ''; const n = Number(s.replace(/,/g, '')); return isNaN(n) ? s : n.toLocaleString(); };
export const fmtPhone = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, '').slice(0, 11); if (d.length < 4) return d; if (d.length < 7) return `${d.slice(0, 3)}-${d.slice(3)}`; if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`; return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`; };
export function FormGrid({ fields, form, onChange, cols = 2, disabled }: { fields: Field[]; form: EntityRecord; onChange: (key: string, val: string) => void; cols?: number; disabled?: boolean }) {
  const mobile = useIsMobile();
  const c = mobile ? 1 : cols; // 모바일=1열(칸 눌림 방지)
  const inp: React.CSSProperties = {
    display: 'block', width: '100%', marginTop: 3, boxSizing: 'border-box',
    height: ctrlH(mobile), padding: mobile ? '0 11px' : '0 9px',
    border: `1px solid ${C.line}`, borderRadius: R, fontSize: ctrlInputFs(mobile),
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${c},1fr)`, gap: 9 }}>
      {fields.map((f) => {
        const val = (form[f.key] as string) ?? '';
        const empty = val === '' || val == null;
        // 빈 칸 = 입력 자리 표시. 직접/필수 빈칸은 앰버, 그 외 빈칸은 연한 head. 읽기전용=head.
        const bg = disabled ? C.head : empty ? (f.manual || f.required ? C.warnBg : C.head) : C.taupeBg;
        const isNum = f.type === 'number';
        const isPhone = /phone|연락처|전화/.test(f.key);
        const span = f.type === 'chips' ? { gridColumn: '1 / -1' as const } : undefined;
        return (
          <label key={f.key} style={{ fontSize: FS.cap, color: C.mute, ...span }}>
            {f.label}{f.required && <span style={{ color: C.danger }}> *</span>}{f.manual && !disabled && <span style={{ color: C.warn }}> ·직접</span>}
            {f.max ? <span style={{ color: C.faint }}> ·최대 {f.max}</span> : null}
            {f.type === 'select' ? (
              <select value={val} disabled={disabled} onChange={(e) => onChange(f.key, e.target.value)} style={{ ...inp, background: bg, cursor: disabled ? 'default' : undefined, opacity: disabled ? 0.85 : 1 }}>
                <option value="">—</option>
                {/* 현재값이 표준 옵션에 없으면(자동채움·레거시) 그 값도 유지 — 데이터 소실 방지 */}
                {[...(val && !(f.options || []).includes(val) ? [val] : []), ...(f.options || [])].map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === 'chips' ? (
              <div style={{ marginTop: 5, pointerEvents: disabled ? 'none' : undefined, opacity: disabled ? 0.85 : 1 }}>
                {(() => {
                  const selected = new Set(val.split(/[,/#|]/).map((s) => s.trim()).filter(Boolean));
                  const locked = new Set(f.disabledOptions || []);
                  // 레거시 값도 칩으로 유지(표준 목록에 없어도 표시·해제 가능). 운영예정은 선택 불가.
                  const opts = [...(f.options || [])];
                  for (const s of selected) if (!opts.includes(s)) opts.push(s);
                  return (
                    <ToggleChips
                      size="sm"
                      selected={selected}
                      options={opts.map((o) => ({
                        key: o,
                        label: locked.has(o) ? `${o} ·운영예정` : o,
                        disabled: locked.has(o),
                      }))}
                      onToggle={(k) => {
                        if (disabled || locked.has(k)) return;
                        const next = new Set(selected);
                        if (next.has(k)) next.delete(k);
                        else {
                          if (f.max != null && next.size >= f.max) return; // 최대 개수 초과 시 무시
                          next.add(k);
                        }
                        onChange(f.key, [...next].filter((x) => !locked.has(x)).join(','));
                      }}
                    />
                  );
                })()}
              </div>
            ) : (
              <input type={f.type === 'date' ? 'date' : 'text'} inputMode={isNum ? 'numeric' : isPhone ? 'tel' : undefined}
                value={isNum ? fmtNum(val) : isPhone ? fmtPhone(val) : val}
                disabled={disabled}
                onChange={(e) => onChange(f.key, isNum ? e.target.value.replace(/[^\d.]/g, '') : isPhone ? fmtPhone(e.target.value) : e.target.value)}
                style={{ ...inp, background: bg, cursor: disabled ? 'default' : undefined, opacity: disabled ? 0.85 : 1 }} />
            )}
          </label>
        );
      })}
    </div>
  );
}

/* 복사용 텍스트 블록 — 양식처럼 그대로 긁어 쓰는 내용. 눌러서 클립보드로.
 * 페이지에서 <pre>+손롤 버튼 조합 금지(규격). 복사 대상 문자열만 넘긴다. */
export function CopyBlock({ text, label = '양식 복사' }: { text: string; label?: string }) {
  const mobile = useIsMobile();
  const [done, setDone] = React.useState(false);
  const copy = async () => {
    if (!await copyText(text)) return;
    haptic.success();
    setDone(true);
    window.setTimeout(() => setDone(false), 1600);
  };
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ flex: 1 }} />
        <Btn size="sm" variant={done ? 'solid' : 'ghost'} onClick={copy}>{done ? '복사됨' : label}</Btn>
      </div>
      <pre style={{
        margin: 0, padding: mobile ? '12px 13px' : '11px 12px',
        border: `1px dashed ${C.line}`, borderRadius: R, background: C.taupeBg,
        fontFamily: 'inherit', fontSize: mobile ? FS.body : FS.sub, lineHeight: 1.75,
        color: C.ink, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>{text}</pre>
    </div>
  );
}
