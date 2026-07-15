'use client';
import { C } from '@/components/ui';

// 대여료·보증금 기간별 매트릭스 입력 — product.price 중첩맵 {"36":{rent,deposit,fee}} 편집.
// 표준 기간(12·24·36·48·60) 항상 노출 + 시트에서 온 지정기간(예 24_3만) 유지. rent>0인 행만 실제 가격(priceList).
const PERIODS = ['12', '24', '36', '48', '60'];
const num = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^\d]/g, '')); return isNaN(n) ? 0 : n; };
const fmt = (n: number) => (n ? n.toLocaleString() : '');
type Cell = { rent?: number; deposit?: number; fee?: number };

export function PriceMatrix({ price, onChange }: { price: unknown; onChange: (p: Record<string, Cell>) => void }) {
  const p: Record<string, Cell> = price && typeof price === 'object' ? { ...(price as Record<string, Cell>) } : {};
  const keys = Array.from(new Set([...PERIODS, ...Object.keys(p)])).sort((a, b) => Number(a.split('_')[0]) - Number(b.split('_')[0]));
  const setCell = (k: string, field: 'rent' | 'deposit', v: string) => { onChange({ ...p, [k]: { ...(p[k] || {}), [field]: num(v) } }); };
  const label = (k: string) => (k.includes('_') ? `${k.split('_')[0]}개월(${k.split('_')[1]})` : `${k}개월`);
  const inp = { width: '100%', height: 30, padding: '0 8px', border: `1px solid ${C.line}`, borderRadius: 4, fontSize: 12, textAlign: 'right' as const, fontFamily: 'var(--font-mono)', boxSizing: 'border-box' as const };
  const th = { padding: '5px 8px', fontSize: 11, color: C.mute, fontWeight: 700, textAlign: 'right' as const };
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 4, background: '#fff', padding: '10px 12px' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: C.ink, marginBottom: 6 }}>대여료 · 보증금 (기간별)</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={{ ...th, textAlign: 'left' }}>기간</th><th style={th}>월 대여료</th><th style={th}>보증금</th></tr></thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <td style={{ padding: '3px 8px 3px 0', fontSize: 12, color: C.ink, whiteSpace: 'nowrap' }}>{label(k)}</td>
              <td style={{ padding: '3px 4px' }}><input style={inp} inputMode="numeric" placeholder="0" value={fmt(p[k]?.rent || 0)} onChange={(e) => setCell(k, 'rent', e.target.value)} /></td>
              <td style={{ padding: '3px 0 3px 4px' }}><input style={inp} inputMode="numeric" placeholder="0" value={fmt(p[k]?.deposit || 0)} onChange={(e) => setCell(k, 'deposit', e.target.value)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 10.5, color: C.faint, marginTop: 6 }}>대여료 입력한 기간만 매물에 노출됩니다.</div>
    </div>
  );
}
