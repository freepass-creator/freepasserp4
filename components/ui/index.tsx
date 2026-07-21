'use client';
import React from 'react';
import type { Field, EntityRecord } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';
import { useAppBar } from '@/lib/appbar';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronLeft, List, Search, X } from 'lucide-react';
import { haptic } from '@/lib/haptics';
import { C, R, NUM, ctrlH, ctrlFs, ctrlInputFs, ctrlChipH } from './tokens';
import { Badge, CountPill } from './badges';

/* 공용 UI 키트 — 전 페이지가 이걸 써서 통일. 기업형: 각지게(저radius)·고밀도·색 절제. */
// 토큰(C/R/NUM)=tokens.ts SSOT. 리프 분리: 접이식섹션=sec, 데이터표=table, 상태·라벨=badges, 카드원자=objcard. 여기서 배럴 재export.
export { C, R, NUM, FS, CTRL, ctrlH, ctrlFs, ctrlInputFs, ctrlChipH } from './tokens';
export type { CtrlSize } from './tokens';
export * from './sec';
export * from './table';
export * from './badges';
export * from './objcard';
export * from './detail';
export * from './ContextMenu';
export * from './feedrow';

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


// 패널 헤더 — CTRL.md 높이(웹32/모바일40).
export function PaneHead({ title, count, right }: { title: React.ReactNode; count?: React.ReactNode; right?: React.ReactNode }) {
  const mobile = useIsMobile();
  const h = ctrlH(mobile);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: h, flex: `0 0 ${h}px`, padding: mobile ? '0 16px' : '0 14px', borderBottom: `1px solid ${C.line}`, background: C.taupeBg, boxSizing: 'border-box' }}>
      <span style={{ fontSize: mobile ? 15 : 13, fontWeight: 800, color: C.ink, whiteSpace: 'nowrap', letterSpacing: mobile ? '-0.01em' : 0 }}>{title}</span>
      {count != null && count !== '' && <span style={{ fontSize: mobile ? 12.5 : 11.5, color: C.faint, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{count}</span>}
      {right != null && <><span style={{ flex: 1 }} />{right}</>}
    </div>
  );
}

export function CardGrid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginTop: 18 }}>{children}</div>;
}

// 위·아래 분할 패널 — 드래그로 상하 비율 조정(계약패널 밑 첨부서류 등). storageKey로 비율 유지.
export function VSplit({ top, bottom, initial = 0.6, storageKey }: { top: React.ReactNode; bottom: React.ReactNode; initial?: number; storageKey?: string }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [ratio, setRatio] = React.useState(initial);
  const dragging = React.useRef(false);
  React.useEffect(() => { if (!storageKey || typeof window === 'undefined') return; const s = localStorage.getItem(storageKey); const n = s ? Number(s) : NaN; if (n > 0.1 && n < 0.9) setRatio(n); }, [storageKey]);
  React.useEffect(() => {
    const move = (cy: number) => { if (!dragging.current || !ref.current) return; const r = ref.current.getBoundingClientRect(); setRatio(Math.min(0.85, Math.max(0.15, (cy - r.top) / r.height))); };
    const mm = (e: MouseEvent) => move(e.clientY);
    const tm = (e: TouchEvent) => { if (e.touches[0]) move(e.touches[0].clientY); };
    const up = () => { if (dragging.current && storageKey) localStorage.setItem(storageKey, String(ratio)); dragging.current = false; };
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', up); window.addEventListener('touchmove', tm); window.addEventListener('touchend', up);
    return () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', up); window.removeEventListener('touchmove', tm); window.removeEventListener('touchend', up); };
  }, [ratio, storageKey]);
  const start = (e: React.SyntheticEvent) => { dragging.current = true; e.preventDefault(); };
  const pane = (f: number): React.CSSProperties => ({ flex: `${f} 1 0`, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' });
  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={pane(ratio)}>{top}</div>
      <div onMouseDown={start} onTouchStart={start} style={{ flex: '0 0 9px', height: 9, cursor: 'row-resize', background: C.head, borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' }}>
        <div style={{ width: 34, height: 3, borderRadius: 2, background: '#c4ccd8' }} />
      </div>
      <div style={pane(1 - ratio)}>{bottom}</div>
    </div>
  );
}

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
          <button key={t.key} onClick={() => onChange(t.key)} title={t.title}
            style={{ height: h, boxSizing: 'border-box', padding: pad, fontSize: fs, fontWeight: on ? 700 : 500, cursor: 'pointer', borderRadius: R, border: `1px solid ${on ? C.brand : C.line}`, background: on ? C.brand : C.taupeBg, color: on ? '#fff' : C.mute, whiteSpace: 'nowrap', flexShrink: 0, transition: 'background .1s, border-color .1s, color .1s' }}>{t.label}</button>
        );
      })}
    </div>
  );
}

export function Card({ title, value, note, tone = 'ink' }: { title: string; value: React.ReactNode; note?: React.ReactNode; tone?: 'ink' | 'danger' | 'ok' | 'warn' }) {
  const color = tone === 'danger' ? C.danger : tone === 'ok' ? C.ok : tone === 'warn' ? C.warn : C.ink;
  return (
    <div style={{ background: C.taupeBg, border: `1px solid ${C.line}`, borderRadius: R, padding: '16px', minHeight: 112, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 10px 28px rgba(15,23,42,0.04)' }}>
      <div style={{ fontSize: 12.5, color: C.mute, fontWeight: 700, marginBottom: 10 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {note && <div style={{ fontSize: 12, color: C.faint, marginTop: 8 }}>{note}</div>}
    </div>
  );
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 18, alignItems: 'center' }}>{children}</div>;
}

export function Panel({ title, action, children }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18, border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, overflow: 'hidden', boxShadow: '0 10px 24px rgba(15,23,42,0.05)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${C.line}`, background: '#f8fafc' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{title}</div>
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
      <div style={{ fontSize: 11.5, color: C.mute, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, marginTop: 2, color, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
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
            <div style={{ fontSize: 10.5, color: C.mute, fontWeight: 600 }}>{it.label}</div>
            <div style={{ fontSize: 15.5, fontWeight: 700, marginTop: 1, color, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{it.value}</div>
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
            <div style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800,
              background: s.state === 'done' ? C.ok : s.state === 'current' ? C.brand : C.taupeBg,
              color: s.state === 'todo' ? C.faint : '#fff', border: `2px solid ${dotColor(s.state)}`,
              boxShadow: s.state === 'current' ? `0 0 0 3px color-mix(in srgb, ${C.brand} 18%, transparent)` : 'none' }}>
              {s.state === 'done' ? '✓' : i + 1}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, fontWeight: s.state === 'current' ? 800 : 600, color: s.state === 'todo' ? C.faint : C.ink, whiteSpace: 'nowrap' }}>{s.label}</div>
            <div style={{ fontSize: 10.5, color: C.faint, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', minHeight: 13 }}>{s.date || ''}</div>
            {s.note && <div style={{ fontSize: 10, color: C.warn, fontWeight: 700 }}>{s.note}</div>}
          </div>
          {i < steps.length - 1 && <div style={{ flex: 1, minWidth: 24, height: 2, marginTop: 10, background: steps[i + 1].state === 'todo' ? C.line2 : C.ok, borderRadius: 2 }} />}
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
        {title != null && <h1 style={{ fontSize: mobile ? 20 : 22, fontWeight: 800, letterSpacing: '-0.02em', margin: '2px 0 14px' }}>{title}</h1>}
        {children}
      </div>
    );
  }
  // 오버레이(자금 세부 등, 라우트 아님) → 자체 크롬. 닫기 = 목록(같은 화면 복귀).
  const back = onBack ? <NavBack kind="list" onClick={onBack} /> : null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--bg-page)', overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div style={{ maxWidth, margin: '0 auto', padding: mobile ? '0 12px 76px' : '0 16px 48px' }}>
        {mobile ? (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '12px 2px 4px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em' }}>{title}</span>
            {meta && <span style={{ fontSize: 12, color: C.faint }}>{meta}</span>}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', flexWrap: 'wrap', position: 'sticky', top: 0, background: 'var(--bg-page)', zIndex: 10 }}>
            {back}
            <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.02em', marginLeft: 6 }}>{title}</span>
            {meta && <span style={{ fontSize: 12.5, color: C.faint }}>{meta}</span>}
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
  return <div style={{ marginTop: 12, padding: 20, textAlign: 'center', color: C.faint, border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, fontSize: 13 }}>{children}</div>;
}

/* 로딩 = 공용 원자(SSOT). 어디서든 이거만 — 중앙 스피너 + 텍스트. 별도 로딩 div 금지.
 * min-height:100% + flex:1 = 부모(.fp-main-pad flex열·패널)를 채워 정중앙. 좁은 슬롯이면 minHeight 낮춰 전달. */
export function Loading({ label = '불러오는 중…', minHeight = '100%' }: { label?: React.ReactNode; minHeight?: string | number }) {
  return (
    <div style={{ minHeight, flex: 1, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '40px 16px', boxSizing: 'border-box' }}>
      <span aria-label="로딩" role="status" style={{ width: 26, height: 26, border: `3px solid ${C.line}`, borderTopColor: C.brand, borderRadius: '50%', animation: 'fp-spin 0.7s linear infinite' }} />
      {label != null && label !== '' && <span style={{ fontSize: 12.5, color: C.faint }}>{label}</span>}
    </div>
  );
}
/* 중앙 안내(로딩 아님) — 빈 결과·에러 등. 스피너 없이 중앙 텍스트. */
export function CenterNote({ children, minHeight = '100%' }: { children: React.ReactNode; minHeight?: string | number }) {
  return <div style={{ minHeight, flex: 1, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.faint, fontSize: 13, textAlign: 'center', padding: '40px 16px', boxSizing: 'border-box' }}>{children}</div>;
}

/* ── 낱개 입력 원자(SSOT). FormGrid=스키마폼용 / 이건 툴바·필터의 단일 select·input. 손롤 <select>/<input> 금지. ── */
export function Select({ value, onChange, options, groups, placeholder, size = 'md', width, full, disabled, style }: {
  value: string; onChange: (v: string) => void;
  options?: (string | { value: string; label: string })[];
  groups?: { label: string; options: (string | { value: string; label: string })[] }[];
  placeholder?: string; size?: 'sm' | 'md'; width?: number; full?: boolean; disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const mobile = useIsMobile();
  const optNode = (o: string | { value: string; label: string }) => {
    const v = typeof o === 'string' ? o : o.value;
    const l = typeof o === 'string' ? o : o.label;
    return <option key={v} value={v}>{l}</option>;
  };
  // 모바일 패딩=입력과 동일(14). full/고정폭 아니면 현재 표시 글자에 맞춤(긴 옵션 폭 금지).
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
      style={{
        height: ctrlH(mobile, size), boxSizing: 'border-box',
        padding: mobile ? '0 14px' : '0 8px',
        border: `1px solid ${C.line}`, borderRadius: R,
        fontSize: ctrlInputFs(mobile, size), background: C.taupeBg, color: C.ink,
        cursor: disabled ? 'default' : 'pointer',
        ...(full ? { width: '100%' } : width ? { width } : { width: 'max-content', maxWidth: '100%', fieldSizing: 'content' as const }),
        ...style,
      }}>
      {placeholder != null && <option value="">{placeholder}</option>}
      {groups
        ? groups.map((g) => <optgroup key={g.label} label={g.label}>{g.options.map(optNode)}</optgroup>)
        : (options || []).map(optNode)}
    </select>
  );
}
export function Input({ value, onChange, placeholder, size = 'md', type = 'text', inputMode, width, full, style, onEnter, onKeyDown, autoFocus, disabled }: { value: string; onChange: (v: string) => void; placeholder?: string; size?: 'sm' | 'md'; type?: string; inputMode?: 'text' | 'search' | 'numeric' | 'tel' | 'email' | 'url' | 'decimal'; width?: number; full?: boolean; style?: React.CSSProperties; onEnter?: () => void; onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void; autoFocus?: boolean; disabled?: boolean }) {
  const mobile = useIsMobile();
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type={type} inputMode={inputMode} autoFocus={autoFocus} disabled={disabled}
    onKeyDown={(e) => { onKeyDown?.(e); if (onEnter && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onEnter(); } }}
    style={{ height: ctrlH(mobile, size), boxSizing: 'border-box', padding: mobile ? '0 12px' : '0 10px', border: `1px solid ${C.line}`, borderRadius: R, fontSize: ctrlInputFs(mobile, size), background: disabled ? C.head : C.taupeBg, color: C.ink, opacity: disabled ? 0.7 : 1, cursor: disabled ? 'default' : undefined, ...(full ? { width: '100%' } : width ? { width } : {}), ...style }} />;
}
// 여러 줄 입력 SSOT — Input과 동일 규격(모바일 16px=iOS 포커스 확대 방지·테두리·배경 공유). 높이만 rows로.
//  ※ textarea는 브라우저 기본이 고정폭 폰트 → fontFamily:'inherit' 필수(손롤이 놓쳐 투박해지는 지점).
export function Textarea({ value, onChange, onBlur, placeholder, size = 'md', rows = 3, full, style, disabled, autoFocus }: { value: string; onChange: (v: string) => void; onBlur?: () => void; placeholder?: string; size?: 'sm' | 'md'; rows?: number; full?: boolean; style?: React.CSSProperties; disabled?: boolean; autoFocus?: boolean }) {
  const mobile = useIsMobile();
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder} rows={rows} disabled={disabled} autoFocus={autoFocus}
    style={{ boxSizing: 'border-box', padding: mobile ? '10px 12px' : '8px 10px', border: `1px solid ${C.line}`, borderRadius: R, fontSize: ctrlInputFs(mobile, size), lineHeight: 1.5, fontFamily: 'inherit', background: disabled ? C.head : C.taupeBg, color: C.ink, opacity: disabled ? 0.7 : 1, resize: 'vertical', ...(full ? { width: '100%' } : {}), ...style }} />;
}
// 검색창 SSOT — CTRL.md (웹32·모바일40). 입력폰트=ctrlInputFs(모바일 16=Btn·Select와 동일).
export function SearchInput({ value, onChange, placeholder = '검색', width, full, style, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; width?: number; full?: boolean; style?: React.CSSProperties; autoFocus?: boolean }) {
  const mobile = useIsMobile();
  const [focus, setFocus] = React.useState(false);
  const h = ctrlH(mobile);
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (!autoFocus) return;
    const t = window.setTimeout(() => ref.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [autoFocus]);
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', ...(full ? { flex: '1 1 auto', width: '100%' } : width ? { width } : {}), ...style }}>
      <Search size={mobile ? 16 : 14} style={{ position: 'absolute', left: mobile ? 12 : 9, color: focus ? C.accent : C.faint, pointerEvents: 'none' }} />
      <input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode="search" autoFocus={autoFocus}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{ width: '100%', height: h, boxSizing: 'border-box', padding: mobile ? '0 40px 0 36px' : '0 28px 0 28px', border: `1px solid ${focus ? C.accent : C.line}`, borderRadius: R, fontSize: ctrlInputFs(mobile), background: C.taupeBg, color: C.ink, outline: 'none', boxShadow: focus ? '0 0 0 3px rgba(37,99,235,0.15)' : 'none', transition: 'border-color .12s, box-shadow .12s' }} />
      {value && (
        <button type="button" aria-label="지우기" onMouseDown={(e) => e.preventDefault()} onClick={() => onChange('')}
          style={{ position: 'absolute', right: mobile ? 4 : 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: mobile ? 36 : 17, height: mobile ? 36 : 17, padding: 0, borderRadius: '50%', border: 'none', background: mobile ? 'transparent' : C.line2, color: C.mute, cursor: 'pointer' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: mobile ? 22 : 17, height: mobile ? 22 : 17, borderRadius: '50%', background: C.line2 }}>
            <X size={mobile ? 14 : 11} />
          </span>
        </button>
      )}
    </div>
  );
}

/* PaneHead와 짝 — 스크롤 본문 껍데기. pad=업무상세 SSOT(12·14 + gap12 세로스택). */
export function PaneBody({ children, pad = false }: { children: React.ReactNode; pad?: boolean }) {
  return (
    <div
      className="fp-pane-scroll"
      style={{
        flex: 1, overflowY: 'auto', minHeight: 0,
        ...(pad ? {
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxSizing: 'border-box',
        } : {}),
      }}
    >
      {children}
    </div>
  );
}

/* 다중선택 필터칩 — 높이·글자·가로패딩 = Btn/Select와 동일(모바일 40·16·18). */
export function ToggleChips<T extends string>({ selected, onToggle, options, size = 'md' }: { selected: Set<T>; onToggle: (v: T) => void; options: { key: T; label: string; count?: number }[]; size?: 'sm' | 'md' }) {
  const mobile = useIsMobile();
  const h = ctrlChipH(mobile);
  const fs = ctrlFs(mobile, size);
  const pad = mobile ? '0 18px' : (size === 'sm' ? '0 11px' : '0 12px');
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: mobile ? 8 : 6 }}>
      {options.map((o) => { const on = selected.has(o.key); return (
        <button key={o.key} onClick={() => { haptic.select(); onToggle(o.key); }} aria-pressed={on} className="fp-chip"
          style={{ display: 'inline-flex', alignItems: 'center', height: h, boxSizing: 'border-box', padding: pad, fontSize: fs, fontWeight: on ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, borderRadius: R, border: `1px solid ${on ? C.brand : C.line}`, background: on ? C.brand : C.taupeBg, color: on ? '#fff' : C.mute, lineHeight: 1 }}>
          {o.label}
        </button>
      ); })}
    </div>
  );
}

/* 접이식 필터 그룹 — 헤더 = CTRL.md. */
export function FilterGroup({ title, count = 0, onClear, defaultOpen = true, first = false, children }: { title: string; count?: number; onClear?: () => void; defaultOpen?: boolean; first?: boolean; children: React.ReactNode }) {
  const mobile = useIsMobile();
  const [open, setOpen] = React.useState(defaultOpen);
  const h = ctrlH(mobile);
  return (
    <div style={{ borderTop: first ? 'none' : `1px solid ${C.line2}` }}>
      <div style={{ display: 'flex', alignItems: 'center', minHeight: h }}>
        <button onClick={() => { haptic.tap(); setOpen((o) => !o); }} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: mobile ? '10px 0' : '8px 0', background: 'none', border: 'none', cursor: 'pointer', minHeight: h }}>
          <ChevronDown size={mobile ? 18 : 15} color={C.faint} style={{ flex: '0 0 auto', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .12s' }} />
          <span style={{ fontSize: mobile ? 15 : 13, fontWeight: 700, color: C.ink, letterSpacing: '-0.01em', lineHeight: 1.2 }}>{title}</span>
          {count > 0 && <CountPill n={count} />}
          <span style={{ flex: 1 }} />
        </button>
        {count > 0 && onClear && <button onClick={() => { haptic.select(); onClear(); }} style={{ marginLeft: 6, flex: '0 0 auto', border: 'none', background: 'none', color: C.accent, fontSize: mobile ? 13 : 12.5, fontWeight: 600, cursor: 'pointer', padding: mobile ? '8px 8px' : '6px 4px', minHeight: h }}>해제</button>}
      </div>
      {open && <div style={{ display: 'flex', flexWrap: 'wrap', gap: mobile ? 8 : 6, paddingBottom: mobile ? 14 : 12, width: '100%' }}>{children}</div>}
    </div>
  );
}

export type MessageVariant = 'info' | 'success' | 'warning' | 'danger';
export function Message({ variant = 'info', children }: { variant?: MessageVariant; children: React.ReactNode }) {
  const palette: Record<MessageVariant, { bg: string; border: string; color: string }> = {
    info: { bg: '#eff6ff', border: '#bfdbfe', color: '#1d4ed8' },
    success: { bg: '#ecfdf5', border: '#86efac', color: '#15803d' },
    warning: { bg: '#fffbeb', border: '#facc15', color: '#b45309' },
    danger: { bg: '#fef2f2', border: '#fecaca', color: '#b91c1c' },
  };
  const p = palette[variant];
  return (
    <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: R, border: `1px solid ${p.border}`, background: p.bg, color: p.color, fontSize: 13, lineHeight: 1.5 }}>
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
          <button key={o.key} onClick={() => { haptic.select(); onChange(o.key); }} aria-pressed={active}
            style={{ display: 'inline-flex', alignItems: 'center', height: h, boxSizing: 'border-box', padding: mobile ? '0 18px' : '0 12px', fontSize: fs, fontWeight: active ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, lineHeight: 1,
              borderRadius: R, border: `1px solid ${active ? C.brand : C.taupeLine}`, background: active ? C.brand : C.taupeBg, color: active ? '#fff' : C.mute,
              transition: 'background .1s, border-color .1s, color .1s' }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Btn({ children, onClick, variant = 'solid', size = 'md', disabled, href, style, full, type = 'button' }: { children: React.ReactNode; onClick?: () => void; variant?: 'solid' | 'ghost' | 'danger'; size?: 'sm' | 'md'; disabled?: boolean; href?: string; style?: React.CSSProperties; full?: boolean; type?: 'button' | 'submit' }) {
  const mobile = useIsMobile();
  const h = ctrlH(mobile, size);
  const fs = ctrlFs(mobile, size);
  // 모바일=가로 패딩 넉넉(좁은 버튼 금지). 높이는 ctrlH 유지.
  const pad = mobile ? '0 18px' : (size === 'sm' ? '0 11px' : '0 14px');
  const s: React.CSSProperties = {
    height: h, boxSizing: 'border-box', padding: pad, borderRadius: R,
    fontWeight: 600, fontSize: fs, letterSpacing: '-0.01em', lineHeight: 1,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
    border: `1px solid ${disabled ? C.line : variant === 'solid' ? C.brand : variant === 'danger' ? 'var(--red-border)' : C.line}`,
    background: variant === 'solid' ? (disabled ? C.line : C.brand) : C.taupeBg,
    color: variant === 'solid' ? '#fff' : variant === 'danger' ? 'var(--red-text)' : C.ink,
    boxShadow: disabled ? 'none' : variant === 'solid' ? '0 1px 2px rgba(15,23,42,0.14)' : '0 1px 2px rgba(15,23,42,0.05)',
    textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap',
    transition: 'filter .12s ease, box-shadow .12s ease',
    pointerEvents: disabled ? 'none' : 'auto',
    ...(full ? { width: '100%' } : null),
    ...style,
  };
  return href
    ? <a href={href} data-clickable="" onClick={onClick} style={s}>{children}</a>
    : <button type={type} onClick={onClick} disabled={disabled} className="fp-press" style={s}>{children}</button>;
}

/** 정사각 아이콘 버튼 — CTRL.md. */
export function IconBtn({ children, onClick, title, active, disabled }: { children: React.ReactNode; onClick?: () => void; title?: string; active?: boolean; disabled?: boolean }) {
  const mobile = useIsMobile();
  const h = ctrlH(mobile);
  return (
    <button type="button" className="fp-press" onClick={onClick} disabled={disabled} title={title} aria-label={title} aria-pressed={active || undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        height: h, width: h, boxSizing: 'border-box', padding: 0, borderRadius: R,
        border: `1px solid ${active ? C.brand : C.line}`,
        background: active ? C.brand : C.taupeBg, color: active ? '#fff' : C.mute,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
      }}>
      {children}
    </button>
  );
}

/** 아이콘 세그먼트 — CTRL.md. */
export function IconSeg<T extends string>({ value, onChange, options }: { value: T; onChange: (k: T) => void; options: { key: T; label: string; icon: React.ReactNode }[] }) {
  const mobile = useIsMobile();
  const h = ctrlH(mobile);
  return (
    <div style={{ display: 'flex', border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden' }}>
      {options.map((o, i) => {
        const on = value === o.key;
        return (
          <button key={o.key} type="button" className="fp-press" onClick={() => onChange(o.key)} title={o.label} aria-label={o.label} aria-pressed={on}
            style={{
              height: h, width: h, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', border: 'none', borderLeft: i ? `1px solid ${C.line}` : 'none',
              background: on ? C.brand : C.taupeBg, color: on ? '#fff' : C.mute, padding: 0,
            }}>
            {o.icon}
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
          <label key={f.key} style={{ fontSize: 11.5, color: C.mute, ...span }}>
            {f.label}{f.required && <span style={{ color: C.danger }}> *</span>}{f.manual && !disabled && <span style={{ color: '#9a3412' }}> ·직접</span>}
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
                  // 레거시 값도 칩으로 유지(표준 목록에 없어도 표시·해제 가능)
                  const opts = [...(f.options || [])];
                  for (const s of selected) if (!opts.includes(s)) opts.push(s);
                  return (
                    <ToggleChips
                      size="sm"
                      selected={selected}
                      options={opts.map((o) => ({ key: o, label: o }))}
                      onToggle={(k) => {
                        if (disabled) return;
                        const next = new Set(selected);
                        if (next.has(k)) next.delete(k);
                        else {
                          if (f.max != null && next.size >= f.max) return; // 최대 개수 초과 시 무시
                          next.add(k);
                        }
                        onChange(f.key, [...next].join(','));
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

/* 링크·선택형 리스트 행 — WorkPage 목록 SSOT. selected = C.selected. */
/* 업무 목록행 = FeedListRow(ui/feedrow) + list-rows 도메인행. 이 2줄 ListRow는 보조/단순용. */
export function ListRow({ badge, badgeTone = 'gray', main, sub, right, href, onClick, selected }: {
  badge?: React.ReactNode; badgeTone?: 'gray' | 'green' | 'red' | 'amber' | 'blue';
  main: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode;
  href?: string; onClick?: () => void; selected?: boolean;
}) {
  const inner = (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
      borderBottom: `1px solid ${C.line2}`, background: selected ? C.selected : 'transparent',
      textDecoration: 'none', color: 'inherit', cursor: href || onClick ? 'pointer' : 'default',
    }}>
      {badge != null && <Badge tone={badgeTone}>{badge}</Badge>}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, minWidth: 0, overflow: 'hidden' }}>{main}</div>
        {sub != null && <div style={{ fontSize: 11.5, color: C.mute, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
  return href ? <a href={href} style={{ textDecoration: 'none', color: 'inherit' }}>{inner}</a> : inner;
}
export function ListBox({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 10, border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden', background: C.taupeBg }}>{children}</div>;
}

/* 공통 상세 드로어 — 모든 목록 상세가 이 하나 재사용. ↑↓ 이동 · URL 동기화 · ↗전체화면. */
export function Drawer({ title, meta, onClose, children, footer, width = 560, onPrev, onNext, expandHref }: { title: React.ReactNode; meta?: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number; onPrev?: () => void; onNext?: () => void; expandHref?: string }) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown' && onNext) { e.preventDefault(); onNext(); }
      else if (e.key === 'ArrowUp' && onPrev) { e.preventDefault(); onPrev(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);
  const navBtn: React.CSSProperties = { border: `1px solid ${C.line}`, background: C.taupeBg, borderRadius: R, width: 26, height: 26, cursor: 'pointer', color: C.mute, fontSize: 13, lineHeight: 1 };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.32)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: width, height: '100vh', background: C.taupeBg, boxShadow: '-10px 0 32px rgba(0,0,0,0.16)', display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${C.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', borderBottom: `1px solid ${C.line}`, background: C.head }}>
          <div style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h2>
            {meta && <span style={{ fontSize: 12, color: C.mute }}>{meta}</span>}
          </div>
          <span style={{ flex: 1 }} />
          {(onPrev || onNext) && <div style={{ display: 'flex', gap: 4 }} title="↑/↓ 이전·다음">
            <button onClick={onPrev} disabled={!onPrev} style={navBtn}>↑</button>
            <button onClick={onNext} disabled={!onNext} style={navBtn}>↓</button>
          </div>}
          {expandHref && <a href={expandHref} title="전체화면" style={{ ...navBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}>↗</a>}
          <button onClick={onClose} style={{ ...navBtn, fontSize: 18, border: 'none', background: 'none' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>{children}</div>
        {footer && <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '11px 16px', borderTop: `1px solid ${C.line}`, background: C.bg, flexWrap: 'wrap' }}>{footer}</div>}
      </div>
    </div>
  );
}

/* 중앙 모달 — 확인/경고/단일 액션용. */
export function Modal({ title, meta, onClose, children, footer, width = 720 }: { title: React.ReactNode; meta?: React.ReactNode; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number }) {
  const mobile = useIsMobile(); // 모바일=풀스크린 시트(중앙 카드 아님)
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', zIndex: 50, display: 'flex', alignItems: mobile ? 'stretch' : 'flex-start', justifyContent: 'center', padding: mobile ? 0 : '6vh 16px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: mobile ? '100%' : width, minHeight: mobile ? '100dvh' : undefined, background: C.taupeBg, borderRadius: mobile ? 0 : R, boxShadow: mobile ? 'none' : '0 16px 48px rgba(0,0,0,0.22)', overflow: 'hidden', border: mobile ? 'none' : `1px solid ${C.line}`, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '13px 18px', borderBottom: `1px solid ${C.line}`, background: C.head, position: mobile ? 'sticky' : undefined, top: 0, zIndex: 1 }}>
          <h2 style={{ fontSize: 14.5, fontWeight: 700 }}>{title}</h2>
          {meta && <span style={{ fontSize: 12, color: C.mute }}>{meta}</span>}
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 19, cursor: 'pointer', color: C.faint, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '16px 18px', flex: mobile ? 1 : undefined, overflowY: mobile ? 'auto' : undefined }}>{children}</div>
        {footer && <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 18px', borderTop: `1px solid ${C.line}`, background: C.bg, flexWrap: 'wrap', position: mobile ? 'sticky' : undefined, bottom: 0 }}>{footer}</div>}
      </div>
    </div>
  );
}

/* 복사용 텍스트 블록 — 양식처럼 그대로 긁어 쓰는 내용. 눌러서 클립보드로.
 * 페이지에서 <pre>+손롤 버튼 조합 금지(규격). 복사 대상 문자열만 넘긴다. */
export function CopyBlock({ text, label = '양식 복사' }: { text: string; label?: string }) {
  const mobile = useIsMobile();
  const [done, setDone] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 비보안 컨텍스트·구브라우저 폴백
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
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
        fontFamily: 'inherit', fontSize: mobile ? 13 : 12.5, lineHeight: 1.75,
        color: C.ink, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>{text}</pre>
    </div>
  );
}
