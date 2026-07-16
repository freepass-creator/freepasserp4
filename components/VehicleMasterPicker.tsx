'use client';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { C } from '@/components/ui';

// 차종 마스터 5단계 picker — 제조사→모델→세부모델→파워트레인→세부트림. 선택 시 스펙 자동채움(쉽게 등록).
// 소스 = /data/vehicle-master.json (엔카 1805 세부모델, vehicle-master/dist/match-index.json 번들).
type Variant = { label: string; fuel: string; displacement_l: number | null; turbo: boolean; drivetrain: string | null; seat: number | null; battery_kwh: number | null; trims: string[] };
type Entry = { id: string; maker: string; model: string; sub_model: string; gen_code: string; origin: string; year_start: string; year_end: string; variants: Variant[] };
export type VehiclePick = { maker: string; model: string; sub_model: string; gen_code: string; variant: string; fuel: string; engine_cc: string; seats: string; drive_type: string; trim_name: string };

const sel: CSSProperties = { height: 30, padding: '0 6px', border: `1px solid ${C.line}`, borderRadius: 4, fontSize: 12, background: '#fff', minWidth: 0 };

export function VehicleMasterPicker({ onPick }: { onPick: (v: VehiclePick) => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [maker, setMaker] = useState(''); const [model, setModel] = useState(''); const [smId, setSmId] = useState(''); const [vIdx, setVIdx] = useState(-1); const [trim, setTrim] = useState('');
  useEffect(() => { fetch('/data/vehicle-master.json').then((r) => r.json()).then((d) => setEntries(d.entries as Entry[])).catch(() => setEntries([])); }, []);

  // 제조사 = 국산/수입 구분(마스터 origin). 국산 먼저. 같은 제조사 혼재 시 국산 우선.
  const makerGroups = useMemo(() => {
    if (!entries) return [] as { origin: string; makers: string[] }[];
    const isDom = new Map<string, boolean>();
    for (const e of entries) isDom.set(e.maker, (isDom.get(e.maker) || false) || e.origin === '국산');
    const dom: string[] = [], imp: string[] = [];
    for (const [m, d] of isDom) (d ? dom : imp).push(m);
    return [{ origin: '국산', makers: dom }, { origin: '수입', makers: imp }];
  }, [entries]);
  const models = useMemo(() => (entries && maker ? Array.from(new Set(entries.filter((e) => e.maker === maker).map((e) => e.model))) : []), [entries, maker]);
  const subs = useMemo(() => (entries && maker && model ? entries.filter((e) => e.maker === maker && e.model === model) : []), [entries, maker, model]);
  const sub = subs.find((e) => e.id === smId) || null;
  const variants = sub ? sub.variants : [];
  const variant = vIdx >= 0 ? variants[vIdx] : null;
  const trims = variant ? variant.trims : [];

  const commit = (t: string) => {
    setTrim(t);
    if (!sub || !variant) return;
    onPick({
      maker, model, sub_model: sub.sub_model, gen_code: sub.gen_code, variant: variant.label,
      fuel: variant.fuel || '', engine_cc: variant.displacement_l ? String(Math.round(variant.displacement_l * 1000)) : '',
      seats: variant.seat ? String(variant.seat) : '', drive_type: variant.drivetrain || '', trim_name: t,
    });
  };

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 4, background: '#f8fbff', padding: '10px 12px' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: C.brand, marginBottom: 7 }}>차종 마스터에서 채우기 {entries === null && <span style={{ color: C.faint, fontWeight: 400 }}>· 불러오는 중…</span>}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))', gap: 6 }}>
        <select style={sel} value={maker} onChange={(e) => { setMaker(e.target.value); setModel(''); setSmId(''); setVIdx(-1); setTrim(''); }}>
          <option value="">제조사</option>{makerGroups.map((g) => g.makers.length ? <optgroup key={g.origin} label={`── ${g.origin} ──`}>{g.makers.map((m) => <option key={m} value={m}>{m}</option>)}</optgroup> : null)}
        </select>
        <select style={sel} value={model} disabled={!maker} onChange={(e) => { setModel(e.target.value); setSmId(''); setVIdx(-1); setTrim(''); }}>
          <option value="">모델</option>{models.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select style={sel} value={smId} disabled={!model} onChange={(e) => { setSmId(e.target.value); setVIdx(-1); setTrim(''); }}>
          <option value="">세부모델</option>{subs.map((s) => <option key={s.id} value={s.id}>{s.sub_model}{s.year_start ? ` (${s.year_start}~${s.year_end})` : ''}</option>)}
        </select>
        <select style={sel} value={vIdx} disabled={!sub} onChange={(e) => { setVIdx(Number(e.target.value)); setTrim(''); }}>
          <option value={-1}>파워트레인</option>{variants.map((v, i) => <option key={i} value={i}>{v.label}</option>)}
        </select>
        <select style={sel} value={trim} disabled={!variant} onChange={(e) => commit(e.target.value)}>
          <option value="">세부트림</option>{trims.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
    </div>
  );
}
