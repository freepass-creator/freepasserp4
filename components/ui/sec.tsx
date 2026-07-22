'use client';
import React from 'react';
import { ChevronDown, EyeOff, GripVertical } from 'lucide-react';
import { C, NUM, FW, FS } from './tokens';

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
          <span style={{ fontSize: FS.title, fontWeight: FW.title, letterSpacing: '-0.01em', color: C.ink }}>{title}</span>
          {n != null && <span style={{ fontSize: FS.body, fontWeight: FW.strong, color: nc, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{n}</span>}
          {tone === 'danger' && n != null && n > 0 && <span className="attn-dot" style={{ marginLeft: 4 }} title="처리 필요" />}
        </button>
        {desc ? <span style={{ fontSize: FS.cap, color: C.faint, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{desc}</span> : <span style={{ flex: 1 }} />}
        {over && <span style={{ fontSize: FS.cap, fontWeight: FW.strong, color: C.accent, flexShrink: 0 }}>↓ 여기로</span>}
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
      <span style={{ fontSize: FS.cap, color: C.faint }}>숨긴 섹션</span>
      {items.map(([hid, htitle]) => <button key={hid} onClick={() => window.dispatchEvent(new CustomEvent('fp:sec-show', { detail: hid }))} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', border: `1px dashed ${C.line}`, borderRadius: 999, background: '#fff', cursor: 'pointer', fontSize: FS.cap, color: C.mute }}><EyeOff size={12} /> {htitle} · 표시</button>)}
    </div>
  );
}
