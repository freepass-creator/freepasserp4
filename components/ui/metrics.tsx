'use client';

import React from 'react';
import { Check } from 'lucide-react';
import { C, FS, FW, NUM, R } from './tokens';

type Tone = 'ink' | 'danger' | 'ok' | 'warn';

function toneColor(tone: Tone): string {
  if (tone === 'danger') return C.danger;
  if (tone === 'ok') return C.ok;
  if (tone === 'warn') return C.warn;
  return C.ink;
}

export function Card({
  title,
  value,
  note,
  tone = 'ink',
}: {
  title: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <div style={{
      background: C.taupeBg,
      border: `1px solid ${C.line}`,
      borderRadius: R,
      padding: '16px',
      minHeight: 112,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      boxShadow: '0 10px 28px rgba(15,23,42,0.04)',
    }}>
      <div style={{ fontSize: FS.sub, color: C.mute, fontWeight: FW.label, marginBottom: 10 }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: FW.head, color: toneColor(tone), fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {note && <div style={{ fontSize: FS.sub, color: C.faint, marginTop: 8 }}>{note}</div>}
    </div>
  );
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 18, alignItems: 'center' }}>{children}</div>;
}

export function Panel({
  title,
  action,
  children,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      marginTop: 18,
      border: `1px solid ${C.line}`,
      borderRadius: R,
      background: C.taupeBg,
      overflow: 'hidden',
      boxShadow: '0 10px 24px rgba(15,23,42,0.05)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${C.line}`, background: C.head }}>
        <div style={{ fontSize: FS.body, fontWeight: FW.title, color: C.ink }}>{title}</div>
        {action && <div>{action}</div>}
      </div>
      <div style={{ padding: '16px' }}>{children}</div>
    </div>
  );
}

export function Kpi({
  label,
  value,
  tone = 'ink',
  href,
}: {
  label: string;
  value: React.ReactNode;
  tone?: Tone;
  href?: string;
}) {
  const inner = (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: R, padding: '9px 14px', minWidth: 128, background: C.taupeBg }}>
      <div style={{ fontSize: FS.cap, color: C.mute, fontWeight: FW.strong }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: FW.head, marginTop: 2, color: toneColor(tone), fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
  return href ? <a href={href} style={{ textDecoration: 'none', color: 'inherit' }}>{inner}</a> : inner;
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, marginTop: 12, marginBottom: 4, flexWrap: 'wrap' }}>{children}</div>;
}

export function StatBar({
  items,
}: {
  items: { label: string; value: React.ReactNode; tone?: Tone }[];
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, overflow: 'hidden' }}>
      {items.map((item, index) => (
        <div key={index} style={{ padding: '7px 15px', borderLeft: index ? `1px solid ${C.line2}` : 'none', minWidth: 96 }}>
          <div style={{ fontSize: FS.micro, color: C.mute, fontWeight: FW.strong }}>{item.label}</div>
          <div style={{ fontSize: FS.title, fontWeight: FW.head, marginTop: 1, color: toneColor(item.tone || 'ink'), fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

export type Step = {
  label: string;
  date?: string;
  state: 'done' | 'current' | 'todo';
  note?: string;
};

export function Stepper({ steps }: { steps: Step[] }) {
  const dotColor = (state: Step['state']) => state === 'done' ? C.ok : state === 'current' ? C.brand : C.line;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, padding: '14px 18px', overflowX: 'auto' }}>
      {steps.map((step, index) => (
        <React.Fragment key={index}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 88, flex: '0 0 auto' }}>
            <div style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: FS.cap,
              fontWeight: FW.head,
              background: step.state === 'done' ? C.ok : step.state === 'current' ? C.brand : C.taupeBg,
              color: step.state === 'todo' ? C.faint : C.taupeBg,
              border: `2px solid ${dotColor(step.state)}`,
              boxShadow: step.state === 'current' ? `0 0 0 3px color-mix(in srgb, ${C.brand} 18%, transparent)` : 'none',
            }}>
              {step.state === 'done' ? <Check size={14} aria-hidden /> : index + 1}
            </div>
            <div style={{ marginTop: 6, fontSize: FS.sub, fontWeight: FW.strong, color: step.state === 'todo' ? C.faint : C.ink, whiteSpace: 'nowrap' }}>{step.label}</div>
            <div style={{ fontSize: FS.micro, color: C.faint, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', minHeight: 13 }}>{step.date || ''}</div>
            {step.note && <div style={{ fontSize: FS.micro, color: C.warn, fontWeight: FW.label }}>{step.note}</div>}
          </div>
          {index < steps.length - 1 && (
            <div style={{ flex: 1, minWidth: 24, height: 2, marginTop: 10, background: steps[index + 1].state === 'todo' ? C.line2 : C.ok, borderRadius: 999 }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
