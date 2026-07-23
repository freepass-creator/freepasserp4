'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { C, R, NUM, FW, FS } from '@/components/ui';
import { toneText } from '@/components/ui/badges';
import type { MasterFitRow } from '@/lib/domain/vehicle-master-match';

/** 마스터 정합 집계 카드 — /dev · /data-check 공용. */
export type MasterFitSummaryData = {
  total: number;
  ok: number;
  offSpec?: number;
  autoConvert: number;
  high: number;
  medium: number;
  low: number;
  none: number;
  no_signal: number;
  needReview?: number;
  samples?: { low: MasterFitRow[]; none: MasterFitRow[]; no_signal: MasterFitRow[] };
};

export function MasterFitSummary({
  fit,
  showSamples = false,
  footer,
}: {
  fit: MasterFitSummaryData;
  showSamples?: boolean;
  footer?: ReactNode;
}) {
  const cells: { k: string; n: number; c: string }[] = [
    { k: '전체', n: fit.total, c: C.ink },
    { k: '규격OK', n: fit.ok, c: toneText('green') },
    ...(fit.offSpec != null ? [{ k: '규격외', n: fit.offSpec, c: toneText('red') }] : []),
    { k: '자동변환', n: fit.autoConvert, c: C.brand },
    { k: 'high', n: fit.high, c: C.brand },
    { k: '중', n: fit.medium, c: toneText('blue') },
    { k: '검토', n: fit.low, c: toneText('amber') },
    { k: '미매칭', n: fit.none, c: toneText('red') },
    { k: '신호없음', n: fit.no_signal, c: C.faint },
  ];

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 8, marginBottom: showSamples ? 10 : 0 }}>
        {cells.map((x) => (
          <div key={x.k} style={{ border: `1px solid ${C.line2}`, borderRadius: R, padding: '8px 10px' }}>
            <div style={{ fontSize: FS.micro, color: C.mute }}>{x.k}</div>
            <div style={{ fontSize: 16, fontWeight: FW.head, fontFamily: NUM, color: x.c }}>{x.n.toLocaleString()}</div>
          </div>
        ))}
      </div>
      {fit.needReview != null && (
        <div style={{ fontSize: FS.sub, color: C.ink, fontWeight: FW.strong, marginBottom: 4 }}>
          변환 시 예상 · 자동 {fit.autoConvert.toLocaleString()} · 검수 {fit.needReview.toLocaleString()}
        </div>
      )}
      {showSamples && fit.samples && (['low', 'none', 'no_signal'] as const).map((bucket) => {
        const label = bucket === 'low' ? '검토 샘플' : bucket === 'none' ? '미매칭 샘플' : '신호없음 샘플';
        const list = fit.samples![bucket];
        if (!list.length) return null;
        return (
          <div key={bucket} style={{ marginTop: 8 }}>
            <div style={{ fontSize: FS.cap, fontWeight: FW.strong, color: C.mute, marginBottom: 4 }}>{label}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {list.map((s) => (
                <Link key={s.key || s.car} href={`/m/${encodeURIComponent(s.key)}`} style={{ fontSize: FS.cap, color: C.ink, textDecoration: 'none', fontFamily: NUM }}>
                  {s.car}
                  <span style={{ color: C.faint, fontWeight: FW.body }}> · {s.before}{s.after ? ` → ${s.after}` : ''}{s.year ? ` · ${s.year}` : ''}</span>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
      {footer}
    </>
  );
}
