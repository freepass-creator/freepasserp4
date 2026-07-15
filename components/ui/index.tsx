'use client';
import React from 'react';
import type { Field, EntityRecord } from '@/lib/intake/entities';
import { useIsMobile } from '@/lib/use-mobile';
import { useAppBar } from '@/lib/appbar';
import { useRouter } from 'next/navigation';
import { companyTone, companyShort } from '@/lib/companies';
import { ChevronDown, ChevronLeft, EyeOff, GripVertical } from 'lucide-react';

/* 공용 UI 키트 — 전 페이지가 이걸 써서 통일. 기업형: 각지게(저radius)·고밀도·색 절제. */

/* 색은 jpkerp5와 "동일한" globals.css 토큰을 브릿지 — v6에서 검증한 UI를 jpkerp5에 그대로 따다 쓰기 위함. */
export const C = {
  ink: 'var(--text-main)', mute: 'var(--text-sub)', sub: 'var(--text-sub)', faint: 'var(--text-weak)',
  line: 'var(--border)', line2: 'var(--border-soft)',
  bg: 'var(--bg-page)', zebra: 'var(--bg-stripe)', head: 'var(--bg-header)', hover: 'var(--bg-hover)',
  danger: 'var(--red-text)', ok: 'var(--green-text)', warn: 'var(--orange-text)', accent: 'var(--text-link)',
  brand: 'var(--brand)', taupe: 'var(--text-sub)', taupeBg: 'var(--bg-card)', taupeLine: 'var(--border)',
};
const R = 4; // = --radius (jpkerp5 표준 4px)
const NUM = "var(--font-mono)";

// 표준 하단바 — 어디서든 이전/홈. Page 및 소통 4단 등 모든 별도 화면 공용(고정).
export function BottomNav({ actions }: { actions?: React.ReactNode }) {
  const router = useRouter();
  const navBtn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, height: 32, boxSizing: 'border-box', padding: '0 14px', border: `1px solid ${C.line}`, borderRadius: R, background: '#fff', color: C.ink, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' };
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 45, height: 49, boxSizing: 'border-box', background: '#fff', borderTop: `1px solid ${C.line}`, boxShadow: '0 -2px 12px rgba(15,23,42,0.06)' }}>
      <div style={{ maxWidth: 1480, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px' }}>
        <button onClick={() => router.back()} style={navBtn}>← 이전</button>
        <button onClick={() => router.push('/')} style={navBtn}>홈</button>
        {actions != null && <><span style={{ flex: 1 }} />{actions}</>}
      </div>
    </div>
  );
}

export function Page({ title, meta, left, right, bottomActions, children }: { title?: React.ReactNode; meta?: React.ReactNode; left?: React.ReactNode; right?: React.ReactNode; bottomActions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <main style={{ maxWidth: 1480, margin: '0 auto', padding: '16px 20px 72px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingBottom: 12, borderBottom: `1px solid ${C.line}`, minHeight: 42 }}>
          {left != null ? left : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
              {title != null && title !== '' && <h1 style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>{title}</h1>}
              {meta && <span style={{ fontSize: 12.5, color: C.faint, whiteSpace: 'nowrap' }}>{meta}</span>}
            </div>
          )}
          {right != null && <><span style={{ flex: 1 }} />{right}</>}
        </div>
        {children}
      </main>
      <BottomNav actions={bottomActions} />
    </>
  );
}

// 패널 헤더 — 다중 패널(소통 4단 등)의 머리 규격 통일: 높이 44 · 동일 타이포 · 우측 액션 슬롯.
export function PaneHead({ title, count, right }: { title: React.ReactNode; count?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 44, flex: '0 0 44px', padding: '0 14px', borderBottom: `1px solid ${C.line}`, background: '#fff', boxSizing: 'border-box' }}>
      <span style={{ fontSize: 13, fontWeight: 800, color: C.ink, whiteSpace: 'nowrap' }}>{title}</span>
      {count != null && count !== '' && <span style={{ fontSize: 11.5, color: C.faint, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{count}</span>}
      {right != null && <><span style={{ flex: 1 }} />{right}</>}
    </div>
  );
}

export function CardGrid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14, marginTop: 18 }}>{children}</div>;
}

// PillTabs — 원자(유닛)화된 탭 그룹. 각 탭은 독립 버튼: 공간 넓으면 한 줄, 좁으면 줄바꿈에 유연 대응.
// 뷰 전환용 표준(렌즈 탭 등). 활성=brand 채움 / 비활성=흰 배경.
export function PillTabs<T extends string>({ tabs, value, onChange, size = 'md' }: { tabs: { key: T; label: React.ReactNode; title?: string }[]; value: T; onChange: (k: T) => void; size?: 'sm' | 'md' }) {
  const h = size === 'sm' ? 28 : 32;
  const pad = size === 'sm' ? '0 12px' : '0 14px';
  const fs = size === 'sm' ? 12 : 13;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {tabs.map((t) => {
        const on = value === t.key;
        return (
          <button key={t.key} onClick={() => onChange(t.key)} title={t.title}
            style={{ height: h, boxSizing: 'border-box', padding: pad, fontSize: fs, fontWeight: on ? 700 : 500, cursor: 'pointer', borderRadius: R, border: `1px solid ${on ? C.brand : C.line}`, background: on ? C.brand : '#fff', color: on ? '#fff' : C.mute, whiteSpace: 'nowrap', flexShrink: 0, transition: 'background .1s, border-color .1s, color .1s' }}>{t.label}</button>
        );
      })}
    </div>
  );
}

export function Card({ title, value, note, tone = 'ink' }: { title: string; value: React.ReactNode; note?: React.ReactNode; tone?: 'ink' | 'danger' | 'ok' | 'warn' }) {
  const color = tone === 'danger' ? C.danger : tone === 'ok' ? C.ok : tone === 'warn' ? C.warn : C.ink;
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.line}`, borderRadius: R, padding: '16px', minHeight: 112, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxShadow: '0 10px 28px rgba(15,23,42,0.04)' }}>
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
    <div style={{ marginTop: 18, border: `1px solid ${C.line}`, borderRadius: R, background: '#fff', overflow: 'hidden', boxShadow: '0 10px 24px rgba(15,23,42,0.05)' }}>
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
    <div style={{ border: `1px solid ${C.line}`, borderRadius: R, padding: '9px 14px', minWidth: 128, background: '#fff' }}>
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
    <div style={{ display: 'flex', flexWrap: 'wrap', border: `1px solid ${C.line}`, borderRadius: R, background: '#fff', overflow: 'hidden' }}>
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
  const dotColor = (s: Step['state']) => s === 'done' ? 'var(--green-text)' : s === 'current' ? C.brand : '#cbd5e1';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', border: `1px solid ${C.line}`, borderRadius: R, background: '#fff', padding: '14px 18px', overflowX: 'auto' }}>
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 88, flex: '0 0 auto' }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800,
              background: s.state === 'done' ? 'var(--green-text)' : s.state === 'current' ? C.brand : '#fff',
              color: s.state === 'todo' ? '#cbd5e1' : '#fff', border: `2px solid ${dotColor(s.state)}`,
              boxShadow: s.state === 'current' ? `0 0 0 3px color-mix(in srgb, ${C.brand} 18%, transparent)` : 'none' }}>
              {s.state === 'done' ? '✓' : i + 1}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, fontWeight: s.state === 'current' ? 800 : 600, color: s.state === 'todo' ? C.faint : C.ink, whiteSpace: 'nowrap' }}>{s.label}</div>
            <div style={{ fontSize: 10.5, color: C.faint, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', minHeight: 13 }}>{s.date || ''}</div>
            {s.note && <div style={{ fontSize: 10, color: '#c2410c', fontWeight: 700 }}>{s.note}</div>}
          </div>
          {i < steps.length - 1 && <div style={{ flex: 1, minWidth: 24, height: 2, marginTop: 10, background: steps[i + 1].state === 'todo' ? '#e4e4e7' : 'var(--green-text)', borderRadius: 2 }} />}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ── 카드 우선 레이아웃 — 박스 그룹 대신 "섹션 텍스트 + 카드들". 모든 데이터=카드 객체. ── */
// 섹션 = 박스 없는 텍스트 타이틀 + 카드 흐름
// 숨긴 섹션 레지스트리 — 숨기면 맨 아래 HiddenSecs 바에 모임(인라인 X)
const hiddenReg = new Map<string, React.ReactNode>();
const emitSec = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('fp:sec-change')); };
let dragSecId: string | null = null; // 드래그 중인 섹션 id(접힘 상태에서 순서변경)
export function Sec({ id, title, n, desc, tone, right, hideable = true, onReorder, onMove, children }: { id?: string; title: React.ReactNode; n?: number; desc?: React.ReactNode; tone?: 'ink' | 'danger' | 'ok' | 'warn'; right?: React.ReactNode; hideable?: boolean; onReorder?: (fromId: string, toId: string) => void; onMove?: (id: string, dir: -1 | 1) => void; children: React.ReactNode }) {
  const key = id ? `fp:sec:${id}` : '';
  const [state, setState] = React.useState<'open' | 'collapsed' | 'hidden'>('open');
  const [dragging, setDragging] = React.useState(false); // 이 섹션을 집어 든 상태
  const [over, setOver] = React.useState(false);          // 다른 섹션이 이 위로 올라온 상태(드롭 대상)
  React.useEffect(() => {
    if (!key || !id) return;
    const sid = id;
    const s = localStorage.getItem(key);
    if (s === 'collapsed') setState('collapsed');
    else if (s === 'hidden') { setState('hidden'); hiddenReg.set(sid, title); emitSec(); }
    function onShow(e: Event) { if ((e as CustomEvent).detail === sid) { setState('open'); localStorage.setItem(key, 'open'); hiddenReg.delete(sid); emitSec(); } }
    window.addEventListener('fp:sec-show', onShow);
    return () => { window.removeEventListener('fp:sec-show', onShow); hiddenReg.delete(sid); emitSec(); };
  }, [key, id]);
  const set = (s: 'open' | 'collapsed' | 'hidden') => { setState(s); if (key) localStorage.setItem(key, s); if (id) { if (s === 'hidden') hiddenReg.set(id, title); else hiddenReg.delete(id); emitSec(); } };
  const nc = tone === 'danger' ? C.danger : tone === 'ok' ? C.ok : tone === 'warn' ? C.warn : C.sub;
  if (state === 'hidden') return null;
  const dropOn = !!(onReorder && id); // 드래그 중이면 열림·접힘 상관없이 어떤 섹션이든 드롭 대상
  return (
    <section id={id}
      onDragOver={dropOn ? (e) => { e.preventDefault(); if (dragSecId && dragSecId !== id) setOver(true); } : undefined}
      onDragLeave={dropOn ? () => setOver(false) : undefined}
      onDrop={dropOn ? () => { if (dragSecId && id && dragSecId !== id) onReorder!(dragSecId, id); dragSecId = null; setOver(false); } : undefined}
      style={{ marginTop: 22, scrollMarginTop: 62, transition: 'opacity .12s, box-shadow .12s',
        opacity: dragging ? 0.45 : 1,
        boxShadow: over ? `inset 0 2px 0 0 ${C.accent}` : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, flexWrap: 'wrap' }}>
        <button onClick={() => set(state === 'open' ? 'collapsed' : 'open')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}>
          <ChevronDown size={15} color={C.sub} style={{ transform: state === 'open' ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }} />
          <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '-0.01em', color: C.ink }}>{title}</span>
          {n != null && <span style={{ fontSize: 13, fontWeight: 800, color: nc, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{n}</span>}
          {tone === 'danger' && n != null && n > 0 && <span className="attn-dot" style={{ marginLeft: 4 }} title="처리 필요" />}
        </button>
        {desc ? <span style={{ fontSize: 11.5, color: C.faint, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{desc}</span> : <span style={{ flex: 1 }} />}
        {over && <span style={{ fontSize: 11.5, fontWeight: 800, color: C.accent, flexShrink: 0 }}>↓ 여기로</span>}
        {state !== 'collapsed' && right}
        {id && onReorder && (
          <span draggable onDragStart={() => { dragSecId = id; setDragging(true); }} onDragEnd={() => { dragSecId = null; setDragging(false); setOver(false); }} title="드래그해서 순서 변경"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, flexShrink: 0, cursor: dragging ? 'grabbing' : 'grab', color: dragging ? C.accent : C.sub }}><GripVertical size={14} /></span>
        )}
        {hideable && id && <button onClick={() => set('hidden')} title="이 섹션 숨기기(맨 아래로)" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, border: 'none', background: 'none', cursor: 'pointer', color: C.faint }}><EyeOff size={13} /></button>}
      </div>
      {state === 'open' && children}
    </section>
  );
}
// 숨긴 섹션 복원 바 — 페이지 맨 아래
export function HiddenSecs() {
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => { const on = () => force(); window.addEventListener('fp:sec-change', on); return () => window.removeEventListener('fp:sec-change', on); }, []);
  const items = Array.from(hiddenReg.entries());
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 30, paddingTop: 14, borderTop: `1px solid ${C.line}`, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: 11.5, color: C.faint }}>숨긴 섹션</span>
      {items.map(([hid, htitle]) => <button key={hid} onClick={() => window.dispatchEvent(new CustomEvent('fp:sec-show', { detail: hid }))} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', border: `1px dashed ${C.line}`, borderRadius: 999, background: '#fff', cursor: 'pointer', fontSize: 11.5, color: C.mute }}><EyeOff size={12} /> {htitle} · 표시</button>)}
    </div>
  );
}

/** 세부 진입 통일 껍데기. 데스크톱=상단 sticky(이전·제목·액션) / 모바일=제목 위 + 하단 고정 액션바(이전·수정·저장).
 *  fixed=화면 전체 오버레이(자금 등 라우트 아닌 세부). 라우트 세부(차량)는 fixed 없이 사용. 모바일 연동 규격. */
export function DetailShell({ title, meta, onBack, actions, fixed, maxWidth = 1000, children }: { title?: React.ReactNode; meta?: React.ReactNode; onBack?: () => void; actions?: React.ReactNode; fixed?: boolean; maxWidth?: number; children: React.ReactNode }) {
  const mobile = useIsMobile();
  // 라우트 세부 → 상단바엔 이전·수정(액션)만. 제목(차량번호)은 상단바 아래 콘텐츠 헤딩으로.
  useAppBar(fixed ? null : { back: onBack, actions }, [fixed, mobile]);
  if (!fixed) {
    return (
      <div style={{ maxWidth, margin: '0 auto', padding: mobile ? '10px 12px 80px' : '14px 16px 48px' }}>
        {title != null && <h1 style={{ fontSize: mobile ? 20 : 22, fontWeight: 800, letterSpacing: '-0.02em', margin: '2px 0 14px' }}>{title}</h1>}
        {children}
      </div>
    );
  }
  // 오버레이(자금 세부 등, 라우트 아님) → 자체 크롬
  const back = onBack ? <button onClick={onBack} title="이전" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 12px', border: `1px solid ${C.line}`, borderRadius: R, background: '#fff', cursor: 'pointer', fontSize: 12.5, color: C.ink }}><ChevronLeft size={15} /> 이전</button> : null;
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
      {mobile && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 70, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fff', borderTop: `1px solid ${C.line}`, boxShadow: '0 -2px 12px rgba(15,23,42,0.06)' }}>
          {back}
          <span style={{ flex: 1 }} />
          {actions}
        </div>
      )}
    </div>
  );
}
// 반응형 카드 그리드 — 폭에 맞춰 자동(auto-fit). 카드 높이는 내용(원자 수)에 맞게, 짧은 카드는 안 늘림(align start).
export function Cards({ min = 240, fit, children }: { min?: number; fit?: boolean; children: React.ReactNode }) {
  // fit = flex-wrap → 각 카드가 내용폭에 맞게(넓은 값은 더 넓게, 좁은 값은 좁게) 늘어나고 줄바꿈. 내용 잘림 없음. 지표(Metric) 행 전용.
  if (fit) return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' }}>{children}</div>;
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${min}px), 1fr))`, gap: 8, alignItems: 'start' }}>{children}</div>;
}
// 카드 공통 — 살짝 뜬 그림자 + 자연스러운 통일 호버(떠오름). 절제(눈 안 아프게).
const REST_SH = '0 1px 2px rgba(15,23,42,0.05)';
const HOVER_SH = '0 4px 12px rgba(15,23,42,0.10)';
function useHover() { const [h, setH] = React.useState(false); return { h, on: { onMouseEnter: () => setH(true), onMouseLeave: () => setH(false) } }; }
function cardStyle(h: boolean, click: boolean): React.CSSProperties {
  return { border: `1px solid ${h && click ? '#cfd3da' : C.line}`, borderRadius: 'var(--radius)', background: '#fff', boxShadow: h && click ? HOVER_SH : REST_SH, transform: h && click ? 'translateY(-1px)' : 'none', transition: 'box-shadow .15s ease, border-color .15s ease, transform .15s ease', cursor: click ? 'pointer' : 'default' };
}
// 지표 카드 (가동률·미수 등) — 라벨 + 숫자. 색은 숫자에만.
export function Metric({ label, value, tone, onClick }: { label: React.ReactNode; value: React.ReactNode; tone?: 'ink' | 'danger' | 'ok' | 'warn'; onClick?: () => void }) {
  const color = tone === 'danger' ? C.danger : tone === 'ok' ? C.ok : tone === 'warn' ? C.warn : C.ink;
  const { h, on } = useHover();
  return (
    <div onClick={onClick} {...on} style={{ ...cardStyle(h, !!onClick), padding: '9px 13px', flex: '0 0 auto', minHeight: 54, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div style={{ fontSize: 11, color: C.mute, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', marginTop: 2, whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
}
// 객체 카드 = 목록의 단일 원자(2행 신원카드). 높이 통일 56px, 폭은 그리드 자유.
//  1행 신원: [회사][상태배지][차량번호(모노·무잘림) 또는 이름][차종(축소가능)] …[우측 핵심수치]
//  2행 원자: fields(라벨-값, 우선순위 상위 3 + ＋n) 또는 sub(자유문). 좌측 2px 레일=위험 신호.
//  호출부는 "필요한 원자만" 넘긴다. 차번=plate, 비차량 주체(자금 상대방·고객)=name, 부가식별=carType.
export type RailTone = 'none' | 'danger' | 'warn' | 'ok' | 'mute';
const RAIL: Record<RailTone, { c: string; o: number }> = {
  none: { c: C.faint, o: 0.28 }, mute: { c: C.faint, o: 0.5 },
  danger: { c: C.danger, o: 1 }, warn: { c: C.warn, o: 1 }, ok: { c: C.ok, o: 1 },
};
const ATOM_CAP = 3; // 2행 원자 표시 상한 — 넘으면 ＋n(우선순위 상위만 생존, 픽셀측정 대신 count-cap)
export function ObjCard({ badge, badgeTone = 'gray', co, rail = 'none', plate, name, carType, title, sub, right, fields, onClick }: {
  badge?: React.ReactNode; badgeTone?: BadgeTone; co?: string; rail?: RailTone;
  plate?: string; name?: React.ReactNode; carType?: React.ReactNode; title?: React.ReactNode;
  sub?: React.ReactNode; right?: React.ReactNode; fields?: [React.ReactNode, React.ReactNode][]; onClick?: () => void;
}) {
  const { h, on } = useHover();
  const rl = RAIL[rail];
  // 2행: 원자 상위 ATOM_CAP개 + ＋n, 없으면 sub 문자열
  const shown = fields ? fields.slice(0, ATOM_CAP) : [];
  const moreN = fields ? fields.length - shown.length : 0;
  const row2: React.ReactNode = fields && fields.length > 0
    ? <>{shown.map(([l, v], i) => <span key={i} style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}>{l != null && <span style={{ color: C.mute }}>{l} </span>}<span style={{ color: C.ink, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{v}</span>{i < shown.length - 1 && <span style={{ color: C.faint, margin: '0 5px' }}>·</span>}</span>)}{moreN > 0 && <span style={{ flex: '0 0 auto', color: C.faint, marginLeft: 6 }}>＋{moreN}</span>}</>
    : sub;
  // 앵커 = 차번(모노·flexShrink0·자를 수단 없음) → 이름(비모노·축소가능) → legacy title(축소가능)
  const anchor = plate != null
    ? <span style={{ flex: '0 0 auto', whiteSpace: 'nowrap', fontFamily: NUM, fontSize: 13.5, fontWeight: 700, letterSpacing: '-0.01em', color: C.ink }}>{plate}</span>
    : name != null
      ? <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 700, color: C.ink }}>{name}</span>
      : <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, fontWeight: 600, color: C.ink }}>{title}</span>;
  return (
    <div onClick={onClick} {...on} style={{ ...cardStyle(h, !!onClick), position: 'relative', overflow: 'hidden', height: 56, padding: '0 12px 0 14px', display: 'flex', alignItems: 'center', minWidth: 0 }}>
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: rl.c, opacity: rl.o }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {/* 1행 = 자산 신원: 회사·상태·차번(무잘림)·차종 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, overflow: 'hidden' }}>
          {co ? <span style={{ flex: '0 0 auto' }}><CompanyBadge co={co} /></span> : null}
          {badge != null && <span style={{ flex: '0 0 auto' }}><Badge tone={badgeTone}>{badge}</Badge></span>}
          {anchor}
          {carType != null && <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: C.mute }}>{carType}</span>}
        </div>
        {/* 2행 = 내용(원자·왼쪽 축소) + 핵심 수치(오른쪽 고정·무잘림) */}
        {(row2 != null || right != null) && <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', display: 'flex', alignItems: 'baseline', fontSize: 11.5, color: C.faint }}>{row2}</div>
          {right != null && <div style={{ flex: '0 0 auto', fontSize: 13, fontWeight: 700, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: C.ink }}>{right}</div>}
        </div>}
      </div>
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 12, padding: 20, textAlign: 'center', color: C.faint, border: `1px solid ${C.line}`, borderRadius: R, background: '#fff', fontSize: 13 }}>{children}</div>;
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
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
      {options.map((o) => {
        const active = value === o.key;
        return (
          <button key={o.key} onClick={() => onChange(o.key)} aria-pressed={active}
            style={{ display: 'inline-flex', alignItems: 'center', height: 28, boxSizing: 'border-box', padding: '0 12px', fontSize: 12, fontWeight: active ? 700 : 500, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              borderRadius: R, border: `1px solid ${active ? C.brand : C.taupeLine}`, background: active ? C.brand : '#fff', color: active ? '#fff' : C.mute,
              transition: 'background .1s, border-color .1s, color .1s' }}>
            {o.label}{o.count != null && <span style={{ marginLeft: 7, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', opacity: active ? 0.85 : 0.55, fontWeight: 700 }}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* 상태/라벨 — 각진 플랫 태그. 이슈 종류별로 구분되게 8색(기업톤, 알록달록 아님). */
export type BadgeTone = 'gray' | 'green' | 'red' | 'amber' | 'blue' | 'orange' | 'purple' | 'teal';
const BADGE: Record<BadgeTone, [string, string, string]> = {
  gray: ['#475569', '#eef1f5', '#d5dbe4'], green: ['#15803d', '#d9f3e1', '#a3dab4'],
  red: ['#c02418', '#fdd7d1', '#f3aba3'], amber: ['#9a5b00', '#fbebc4', '#eecb8f'],
  blue: ['#1d4ed8', '#dbe7fd', '#aec6f5'], orange: ['#c2410c', '#fde0cf', '#f4b892'],
  purple: ['#7c3aed', '#eadffd', '#cfb6f5'], teal: ['#0e7490', '#d0eef5', '#93cfdf'],
};
export function Badge({ children, tone = 'gray' }: { children: React.ReactNode; tone?: BadgeTone }) {
  const m = BADGE[tone] || BADGE.gray;
  return <span style={{ display: 'inline-flex', alignItems: 'center', height: 18, boxSizing: 'border-box', fontSize: 10.5, fontWeight: 700, padding: '0 6px', borderRadius: R, color: m[0], background: m[1], border: `1px solid ${m[2]}`, whiteSpace: 'nowrap', letterSpacing: '.01em', lineHeight: 1 }}>{children}</span>;
}
// 회사(법인) 뱃지 = 아웃라인 + 색점. 상태 뱃지(채움형)와 스타일로 확실히 구분 — 색이 겹쳐도 정체성 vs 상태 안 헷갈림.
export function CompanyBadge({ co }: { co: string }) {
  const m = BADGE[companyTone(co)] || BADGE.gray;
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 18, boxSizing: 'border-box', padding: '0 6px 0 5px', borderRadius: R, border: `1px solid ${m[2]}`, background: '#fff', color: m[0], fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap', lineHeight: 1 }}>
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: m[0], flex: '0 0 auto' }} />{companyShort(co)}
  </span>;
}

/* 상태 = 점(dot) + 텍스트. pill 남발 대신 절제된 기업형 상태표시. */
type Tone = 'gray' | 'green' | 'red' | 'amber' | 'blue';
export function Status({ label, tone = 'gray' }: { label: React.ReactNode; tone?: Tone }) {
  const dot = { gray: '#9aa3af', green: '#16a34a', red: '#c0392b', amber: '#d97706', blue: '#2563eb' }[tone];
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.ink, whiteSpace: 'nowrap' }}>
    <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flex: '0 0 7px' }} />{label}
  </span>;
}

/* ── 상태·이슈 어휘 SSOT — 전 페이지가 같은 색·라벨을 쓴다(통일) ── */
export const STATUS_TONE: Record<string, Tone> = {
  운행: 'green', 대기: 'blue', 반납: 'gray', 해지: 'gray', 채권: 'red',
  구매대기: 'gray', 등록대기: 'gray', 상품화: 'blue', 상품대기: 'blue',
  연장대기: 'amber', 종료대기: 'amber', 휴차: 'gray', 정비: 'amber', 사고: 'amber',
  매각대기: 'gray', 매각: 'gray', 말소: 'gray',
};
/** 계약/차량 상태 — 어디서나 동일한 점+색. */
export function StatusTag({ value }: { value: unknown }) {
  const s = String(value || '');
  return s ? <Status label={s} tone={STATUS_TONE[s] || 'gray'} /> : <span style={{ color: C.faint }}>—</span>;
}

export const RISK_TONE: Record<string, Tone> = {
  미수: 'red', 보험불일치: 'red', 반납지남: 'amber', 필수누락: 'red',
  보험만료: 'red', 보험임박: 'amber', 검사만료: 'red', 검사임박: 'amber',
  plate고아: 'amber', 날짜역전: 'red', 위반: 'amber', 사고: 'red',
};
/** 리스크/이슈 구분 — 어디서나 동일한 뱃지 색. */
export function RiskTag({ kind }: { kind: string }) {
  return <Badge tone={RISK_TONE[kind] || 'gray'}>{kind}</Badge>;
}
/** 위험도(위험/주의). */
export function SevTag({ high }: { high: boolean }) {
  return <Badge tone={high ? 'red' : 'amber'}>{high ? '위험' : '주의'}</Badge>;
}

export function Btn({ children, onClick, variant = 'solid', size = 'md', disabled, href }: { children: React.ReactNode; onClick?: () => void; variant?: 'solid' | 'ghost' | 'danger'; size?: 'sm' | 'md'; disabled?: boolean; href?: string }) {
  const sm = size === 'sm';
  const s: React.CSSProperties = {
    height: sm ? 28 : 32, boxSizing: 'border-box', padding: sm ? '0 11px' : '0 14px', borderRadius: R,
    fontWeight: 600, fontSize: sm ? 12 : 12.5, letterSpacing: '-0.01em', lineHeight: 1,
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
    border: `1px solid ${disabled ? C.line : variant === 'solid' ? C.brand : variant === 'danger' ? 'var(--red-border)' : C.line}`,
    background: variant === 'solid' ? (disabled ? C.line : C.brand) : '#fff',
    color: variant === 'solid' ? '#fff' : variant === 'danger' ? 'var(--red-text)' : C.ink,
    boxShadow: disabled ? 'none' : variant === 'solid' ? '0 1px 2px rgba(15,23,42,0.14)' : '0 1px 2px rgba(15,23,42,0.05)',
    textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap',
    transition: 'filter .12s ease, box-shadow .12s ease',
    pointerEvents: disabled ? 'none' : 'auto',
  };
  return href ? <a href={href} data-clickable="" style={s}>{children}</a> : <button onClick={onClick} disabled={disabled} style={s}>{children}</button>;
}

/* 표 — 기업형 데이터 그리드. 헤더 sticky · 세로 격자라인 · 숫자 모노. */
export const th: React.CSSProperties = { padding: '6px 10px', textAlign: 'left', fontSize: 11.5, color: '#33415a', fontWeight: 700, background: C.head, borderBottom: `2px solid #c4ccd8`, borderRight: `1px solid ${C.line}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, zIndex: 1 };
export const thR: React.CSSProperties = { ...th, textAlign: 'right' };
export const td: React.CSSProperties = { padding: '5px 10px', fontSize: 12, whiteSpace: 'nowrap', color: C.ink, borderRight: `1px solid ${C.line2}` };
export const tdR: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontFamily: NUM, fontWeight: 600 };

export type Col<T> = { key: string; label: string; align?: 'l' | 'r'; render: (row: T) => React.ReactNode };
/* 데이터 그리드 — 단일클릭=행 선택, 더블클릭=상세(onRow). 엑셀/ERP 관례. */
export function DataTable<T>({ cols, rows, onRow }: { cols: Col<T>[]; rows: T[]; onRow?: (row: T) => void }) {
  const [sel, setSel] = React.useState(-1);
  const mobile = useIsMobile();
  const bgOf = (i: number) => (sel === i ? '#d9e4f5' : i % 2 ? C.zebra : '#fff');
  // 좁은 화면 = 같은 객체를 카드로(엑셀 표 대신). 필드 정의(cols)는 동일 SSOT.
  if (mobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        {rows.map((r, i) => (
          <div key={i} onClick={() => onRow && onRow(r)} tabIndex={onRow ? 0 : -1}
            onKeyDown={(e) => { if (onRow && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onRow(r); } }}
            style={{ border: `1px solid ${C.line}`, borderRadius: 'var(--radius)', background: '#fff', padding: '10px 12px', cursor: onRow ? 'pointer' : 'default', outline: 'none' }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{cols[0]?.render(r)}</div>
            {cols.slice(1).map((c) => (
              <div key={c.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '3px 0', fontSize: 12, borderTop: `1px solid ${C.line2}`, marginTop: 3 }}>
                <span style={{ color: C.mute, flex: '0 0 auto' }}>{c.label}</span>
                <span style={{ textAlign: 'right', minWidth: 0, overflow: 'hidden' }}>{c.render(r)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ overflowX: 'auto', marginTop: 10, border: `1px solid ${C.line}`, borderRadius: R, background: '#fff' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 12.5, width: '100%' }}>
        <thead><tr>{cols.map((c) => <th key={c.key} style={c.align === 'r' ? thR : th}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}
              onClick={() => { setSel(i); if (onRow) onRow(r); }}
              onKeyDown={(e) => { if (onRow && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onRow(r); } }}
              tabIndex={onRow ? 0 : -1} role={onRow ? 'button' : undefined}
              style={{ borderTop: `1px solid ${C.line2}`, cursor: onRow ? 'pointer' : 'default', background: bgOf(i), userSelect: 'none', outline: 'none' }}
              onMouseEnter={(e) => { if (sel !== i) e.currentTarget.style.background = C.hover; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = bgOf(i); }}>
              {cols.map((c) => <td key={c.key} style={c.align === 'r' ? tdR : td}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function won(n: unknown): string { const x = Number(n); return isNaN(x) ? '—' : x.toLocaleString(); }

/* 상세 — 섹션/그리드/행 */
export function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: 12, fontWeight: 700, color: C.mute, marginBottom: 6 }}>{title}</h2>
      <div style={{ border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden', background: '#fff' }}>{children}</div>
    </div>
  );
}
export function DetailGrid({ rows }: { rows: [string, unknown][] }) {
  return (
    <div>
      {rows.map(([k, val], i) => {
        const filled = val != null && val !== '';
        const node = (typeof val === 'object' ? val : filled ? String(val) : '—') as React.ReactNode;
        return (
          <div key={i} style={{ display: 'flex', padding: '6px 12px', fontSize: 12.5, borderTop: i ? `1px solid ${C.line2}` : 'none' }}>
            <span style={{ width: 116, color: C.mute, flex: '0 0 116px' }}>{k}</span>
            <span style={{ color: filled ? C.ink : '#cbd5e1', fontVariantNumeric: 'tabular-nums' }}>{node}</span>
          </div>
        );
      })}
    </div>
  );
}
export function DetailRow({ main, sub, right, rightColor = C.mute }: { main: React.ReactNode; sub: React.ReactNode; right?: React.ReactNode; rightColor?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderTop: `1px solid ${C.line2}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{main}</div>
        <div style={{ fontSize: 11, color: C.faint }}>{sub}</div>
      </div>
      {right != null && <div style={{ fontSize: 12.5, fontWeight: 700, color: rightColor, fontVariantNumeric: 'tabular-nums' }}>{right}</div>}
    </div>
  );
}
export function DetailEmpty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 14, fontSize: 12.5, color: '#cbd5e1' }}>{children}</div>;
}

/* 라벨|값 표(인라인 편집) — 세부(360)·InfoDoc 공용 SSOT.
 * editing이면 값 칸만 그 자리에서 입력칸으로(화면 그대로, 폼 스왑 X). key=null이면 읽기전용.
 * 편집 모드는 테두리·배경(accent)으로 시각 구분. */
export type KVRow = [label: string, key: string | null, value: React.ReactNode];
export function KV({ rows, editing, form, onChange }: { rows: KVRow[]; editing?: boolean; form?: EntityRecord; onChange?: (k: string, v: string) => void }) {
  return (
    <div style={{ border: `1px solid ${editing ? C.accent : C.line}`, borderRadius: 'var(--radius)', background: editing ? 'var(--bg-card)' : '#fff', boxShadow: editing ? '0 0 0 3px rgba(37,99,235,0.10)' : '0 1px 2px rgba(15,23,42,0.05)', transition: 'box-shadow .15s, border-color .15s' }}>
      {rows.map(([k, key, val], i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', minHeight: 34, padding: '0 12px', fontSize: 12.5, borderTop: i ? `1px solid var(--border-soft)` : 'none' }}>
          <span style={{ width: 96, flex: '0 0 96px', color: C.mute }}>{k}</span>
          {editing && key
            ? <input value={String(form?.[key] ?? '')} onChange={(e) => onChange?.(key, e.target.value)}
                style={{ flex: 1, minWidth: 0, height: 24, boxSizing: 'border-box', padding: '0 7px', border: `1px solid ${C.line}`, borderRadius: 4, fontSize: 12.5, background: '#fff', color: C.ink, fontFamily: 'inherit' }} />
            : <span style={{ minWidth: 0, fontVariantNumeric: 'tabular-nums' }}>{(val === '' || val == null) ? <span style={{ color: '#cbd5e1' }}>—</span> : val}</span>}
        </div>
      ))}
    </div>
  );
}

/* 공용 입력 폼 — 직접입력·상세수정 공용. 숫자=콤마 서식, 연락처=전화 자동서식(편한 입력). */
const fmtNum = (v: unknown) => { const s = String(v ?? ''); if (s === '') return ''; const n = Number(s.replace(/,/g, '')); return isNaN(n) ? s : n.toLocaleString(); };
const fmtPhone = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, '').slice(0, 11); if (d.length < 4) return d; if (d.length < 7) return `${d.slice(0, 3)}-${d.slice(3)}`; if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`; return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`; };
export function FormGrid({ fields, form, onChange, cols = 2 }: { fields: Field[]; form: EntityRecord; onChange: (key: string, val: string) => void; cols?: number }) {
  const mobile = useIsMobile();
  const c = mobile ? 1 : cols; // 모바일=1열(칸 눌림 방지)
  const inp: React.CSSProperties = { display: 'block', width: '100%', marginTop: 3, padding: mobile ? '9px 10px' : '6px 9px', border: `1px solid ${C.line}`, borderRadius: R, fontSize: mobile ? 15 : 12.5 };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${c},1fr)`, gap: 9 }}>
      {fields.map((f) => {
        const val = (form[f.key] as string) ?? '';
        const empty = val === '' || val == null;
        const bg = f.manual && empty ? '#fff7ed' : '#fff';
        const isNum = f.type === 'number';
        const isPhone = /phone|연락처|전화/.test(f.key);
        return (
          <label key={f.key} style={{ fontSize: 11.5, color: C.mute }}>
            {f.label}{f.required && <span style={{ color: C.danger }}> *</span>}{f.manual && <span style={{ color: '#9a3412' }}> ·직접</span>}
            {f.type === 'select' ? (
              <select value={val} onChange={(e) => onChange(f.key, e.target.value)} style={{ ...inp, background: bg }}>
                <option value="">—</option>
                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input type={f.type === 'date' ? 'date' : 'text'} inputMode={isNum ? 'numeric' : isPhone ? 'tel' : undefined}
                value={isNum ? fmtNum(val) : isPhone ? fmtPhone(val) : val}
                onChange={(e) => onChange(f.key, isNum ? e.target.value.replace(/[^\d.]/g, '') : isPhone ? fmtPhone(e.target.value) : e.target.value)}
                style={{ ...inp, background: bg }} />
            )}
          </label>
        );
      })}
    </div>
  );
}

/* 링크형 리스트 행/박스 — 검색·휴지통·리스크 등. */
export function ListRow({ badge, badgeTone = 'gray', main, sub, right, href, onClick }: { badge?: React.ReactNode; badgeTone?: 'gray' | 'green' | 'red' | 'amber' | 'blue'; main: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; href?: string; onClick?: () => void }) {
  const inner = (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderTop: `1px solid ${C.line2}`, textDecoration: 'none', color: 'inherit', cursor: href || onClick ? 'pointer' : 'default' }}>
      {badge != null && <Badge tone={badgeTone}>{badge}</Badge>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{main}</div>
        {sub != null && <div style={{ fontSize: 11, color: C.faint }}>{sub}</div>}
      </div>
      {right}
    </div>
  );
  return href ? <a href={href} style={{ textDecoration: 'none', color: 'inherit' }}>{inner}</a> : inner;
}
export function ListBox({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 10, border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden', background: '#fff' }}>{children}</div>;
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
  const navBtn: React.CSSProperties = { border: `1px solid ${C.line}`, background: '#fff', borderRadius: R, width: 26, height: 26, cursor: 'pointer', color: C.mute, fontSize: 13, lineHeight: 1 };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.32)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: width, height: '100vh', background: '#fff', boxShadow: '-10px 0 32px rgba(0,0,0,0.16)', display: 'flex', flexDirection: 'column', borderLeft: `1px solid ${C.line}` }}>
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
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: mobile ? '100%' : width, minHeight: mobile ? '100dvh' : undefined, background: '#fff', borderRadius: mobile ? 0 : R, boxShadow: mobile ? 'none' : '0 16px 48px rgba(0,0,0,0.22)', overflow: 'hidden', border: mobile ? 'none' : `1px solid ${C.line}`, display: 'flex', flexDirection: 'column' }}>
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
