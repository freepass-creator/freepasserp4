'use client';
import { useState } from 'react';
import { Badge, Btn, C, FS, FW, R, SectionLabel } from '@/components/ui';
import { type EntityRecord } from '@/lib/intake/entities';
import {
  isNoTrimLabel,
  snapFieldDiffs,
  vehicleIdentityLine,
  type RawVehicle,
  type SnapHistoryEntry,
} from '@/lib/domain/vehicle-master-match';

/**
 * 재고 상세 — 공급사 원본(증거) vs 마스터 규격(표준).
 * 원본 = 공급사가 준 거친 표기(_raw_vehicle). 현재 = 마스터 트리에 맞춘 표준.
 */
export function SnapTrace({ form, onRematch }: { form: EntityRecord; onRematch?: () => void }) {
  const raw = (form._raw_vehicle && typeof form._raw_vehicle === 'object') ? form._raw_vehicle as RawVehicle : null;
  const snapped = !!form._snapped || !!raw;
  const review = !!form._needs_master_review;
  const diffs = snapFieldDiffs(raw, form);
  const hist = Array.isArray(form._snap_history) ? (form._snap_history as SnapHistoryEntry[]) : [];
  const [openHist, setOpenHist] = useState(false);

  if (!snapped && !review && !hist.length && !onRematch) return null;

  const conf = String(form._snap_confidence || '');
  const confTone = conf === 'high' ? 'green' : conf === 'medium' ? 'amber' : conf === 'low' ? 'orange' : 'gray';
  const fmtAt = (ms: number) => {
    try { return new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return '—'; }
  };
  const trimNow = String(form.trim_name || '').trim();
  const noTrim = !trimNow || isNoTrimLabel(trimNow);

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: '#fff', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <SectionLabel mt={0} mb={0}>차종 변환</SectionLabel>
        {snapped && <Badge tone="blue" variant="solid">마스터 규격</Badge>}
        {review && <Badge tone="amber" variant="solid">검수 필요</Badge>}
        {conf ? <Badge tone={confTone as 'green' | 'amber' | 'orange' | 'gray'}>{conf}</Badge> : null}
        {noTrim && snapped ? <Badge tone="gray" variant="quiet">세부트림 없음</Badge> : null}
        <span style={{ flex: 1 }} />
        {onRematch ? <Btn size="sm" variant="ghost" onClick={onRematch}>다시 매칭</Btn> : null}
        {form._snap_at ? <span style={{ fontSize: FS.micro, color: C.faint }}>{fmtAt(Number(form._snap_at))}</span> : null}
      </div>

      <div style={{ fontSize: FS.cap, lineHeight: 1.55, color: C.mute }}>
        <div>
          <span style={{ color: C.faint }}>공급 원본</span>
          <span style={{ color: C.faint }}> (증거, 그대로 보존)</span>
          <div style={{ color: C.mute, marginTop: 2 }}>{vehicleIdentityLine(raw)}</div>
        </div>
        <div style={{ marginTop: 6 }}>
          <span style={{ color: C.faint }}>마스터 규격</span>
          <span style={{ color: C.faint }}> (손님·영업에 보이는 표준)</span>
          <div style={{ color: C.ink, fontWeight: FW.strong, marginTop: 2 }}>
            {vehicleIdentityLine(form)}
            {noTrim ? <span style={{ fontWeight: FW.meta, color: C.faint }}> · 세부트림 없음</span> : null}
            {String(form.trim_extra || '').trim() ? (
              <div style={{ fontWeight: FW.meta, color: C.mute, marginTop: 2 }}>
                추가표기 · {String(form.trim_extra)}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {diffs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, borderTop: `1px solid ${C.line2}`, paddingTop: 6 }}>
          <div style={{ fontSize: FS.micro, color: C.faint, marginBottom: 2 }}>바뀐 칸만</div>
          {diffs.map((d) => (
            <div key={d.key} style={{ display: 'grid', gridTemplateColumns: '64px 1fr auto 1fr', gap: 6, alignItems: 'baseline', fontSize: FS.cap }}>
              <span style={{ color: C.faint }}>{d.label}</span>
              <span style={{ color: C.mute, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.from}>{d.from}</span>
              <span style={{ color: C.faint, flex: '0 0 auto' }}>→</span>
              <span style={{ color: C.brand, fontWeight: FW.strong, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.to}>{d.to}</span>
            </div>
          ))}
        </div>
      )}

      {hist.length > 0 && (
        <div style={{ borderTop: `1px solid ${C.line2}`, paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Btn size="sm" variant="ghost" onClick={() => setOpenHist((v) => !v)}>
            {openHist ? '이력 접기' : `변환 이력 ${hist.length}건`}
          </Btn>
          {openHist && [...hist].reverse().map((h, i) => (
            <div key={`${h.at}-${i}`} style={{ fontSize: FS.cap, color: C.mute, lineHeight: 1.45, padding: '6px 8px', background: C.head, borderRadius: R }}>
              <div style={{ color: C.faint }}>{fmtAt(h.at)} · {h.confidence}{h.source ? ` · ${h.source}` : ''}</div>
              <div>{vehicleIdentityLine(h.from)} → <span style={{ color: C.ink, fontWeight: FW.strong }}>{vehicleIdentityLine(h.to)}</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
