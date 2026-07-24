'use client';
import React from 'react';
import type { EntityRecord } from '@/lib/intake/entities';
import { ChevronDown } from 'lucide-react';
import { C, R, ctrlH, ctrlInputFs, FW, FS } from './tokens';
import { useIsMobile } from '@/lib/use-mobile';

/* 상세 — 섹션/그리드/행 */
export function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <h2 style={{ fontSize: FS.cap, fontWeight: FW.strong, color: C.mute, marginBottom: 6 }}>{title}</h2>
      <div style={{ border: `1px solid ${C.line}`, borderRadius: R, overflow: 'hidden', background: C.taupeBg }}>{children}</div>
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
          <div key={i} style={{ display: 'flex', padding: '6px 12px', fontSize: FS.body, borderTop: i ? `1px solid ${C.line2}` : 'none' }}>
            <span style={{ width: 116, color: C.mute, flex: '0 0 116px' }}>{k}</span>
            <span style={{ color: filled ? C.ink : C.faint, fontVariantNumeric: 'tabular-nums' }}>{node}</span>
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
        <div style={{ fontSize: FS.body, fontWeight: FW.strong }}>{main}</div>
        <div style={{ fontSize: FS.cap, color: C.faint }}>{sub}</div>
      </div>
      {right != null && <div style={{ fontSize: FS.body, fontWeight: FW.strong, color: rightColor, fontVariantNumeric: 'tabular-nums' }}>{right}</div>}
    </div>
  );
}
export function DetailEmpty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 14, fontSize: FS.body, color: C.faint }}>{children}</div>;
}
/* 섹션 소제목(테두리 없음) — 상세·폼 내부. Section(박스형)과 별개. 손롤 secTitle 금지. */
export function SectionLabel({ children, mt = 2, mb = 5 }: { children: React.ReactNode; mt?: number; mb?: number }) {
  return <div style={{ fontSize: FS.sub, fontWeight: FW.title, color: C.ink, margin: `${mt}px 0 ${mb}px` }}>{children}</div>;
}

/** 폼 구역 카드 — SectionLabel + 테두리·패딩. 재고·정책·회원 편집 SSOT. */
export function FormCard({ title, hint, children }: { title?: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      {title != null && title !== '' ? <SectionLabel mt={0}>{title}</SectionLabel> : null}
      {hint ? <div style={{ fontSize: FS.cap, color: C.faint, margin: title != null ? '-2px 0 8px' : '0 0 8px', lineHeight: 1.4 }}>{hint}</div> : null}
      <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, padding: '10px 12px' }}>
        {children}
      </div>
    </div>
  );
}
/* 빈값 폴백 대시 — 인라인 '—' 통일. */
export function Dash() { return <span style={{ color: C.faint }}>—</span>; }

/* 접이식 항목 — 제목 줄만 보이고 눌러야 펼쳐진다(QnA·도움말).
 * Sec(페이지 섹션: 숨김·드래그 정렬 포함)과 별개. 이건 목록 안 한 줄짜리.
 * 여러 개를 세로로 쌓으면 위아래 선이 붙어 하나의 목록으로 보인다. */
export function Disclosure({ title, defaultOpen = false, children }: { title: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  const mobile = useIsMobile();
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div style={{ borderBottom: `1px solid ${C.line}` }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          minHeight: ctrlH(mobile), padding: mobile ? '10px 2px' : '8px 2px',
          border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <ChevronDown
          size={mobile ? 16 : 14}
          color={open ? C.ink : C.faint}
          style={{ flex: '0 0 auto', transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }}
        />
        <span style={{ flex: 1, minWidth: 0, fontSize: mobile ? FS.title : FS.body, fontWeight: open ? FW.head : FW.meta, color: C.ink, lineHeight: 1.45 }}>{title}</span>
      </button>
      {open && <div style={{ padding: '0 0 12px 24px' }}>{children}</div>}
    </div>
  );
}

/* 라벨|값 표(인라인 편집) — 세부(360)·InfoDoc 공용 SSOT.
 * editing이면 값 칸만 그 자리에서 입력칸으로(화면 그대로, 폼 스왑 X). key=null이면 읽기전용.
 * 편집 모드는 테두리·배경(accent)으로 시각 구분. */
export type KVRow = [label: string, key: string | null, value: React.ReactNode];
export function KV({ rows, editing, form, onChange }: { rows: KVRow[]; editing?: boolean; form?: EntityRecord; onChange?: (k: string, v: string) => void }) {
  const mobile = useIsMobile();
  return (
    <div style={{ border: `1px solid ${editing ? C.accent : C.line}`, borderRadius: 'var(--radius)', background: editing ? 'var(--bg-card)' : C.taupeBg, boxShadow: editing ? '0 0 0 3px rgba(37,99,235,0.10)' : '0 1px 2px rgba(15,23,42,0.05)', transition: 'box-shadow .15s, border-color .15s' }}>
      {rows.map(([k, key, val], i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', minHeight: ctrlH(mobile), padding: mobile ? '0 14px' : '0 12px', fontSize: mobile ? FS.title : FS.body, borderTop: i ? `1px solid var(--border-soft)` : 'none' }}>
          <span style={{ width: mobile ? 104 : 96, flex: `0 0 ${mobile ? 104 : 96}px`, color: C.mute }}>{k}</span>
          {editing && key
            ? <input value={String(form?.[key] ?? '')} onChange={(e) => onChange?.(key, e.target.value)}
                style={{ flex: 1, minWidth: 0, height: ctrlH(mobile, mobile ? 'md' : 'sm'), boxSizing: 'border-box', padding: mobile ? '0 10px' : '0 7px', border: `1px solid ${C.line}`, borderRadius: R, fontSize: ctrlInputFs(mobile), background: C.taupeBg, color: C.ink, fontFamily: 'inherit' }} />
            : <span style={{ minWidth: 0, fontVariantNumeric: 'tabular-nums' }}>{(val === '' || val == null) ? <span style={{ color: C.faint }}>—</span> : val}</span>}
        </div>
      ))}
    </div>
  );
}
