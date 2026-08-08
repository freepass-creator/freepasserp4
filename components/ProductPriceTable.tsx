'use client';
import { type EntityRecord } from '@/lib/intake/entities';
import { cheapest, priceList } from '@/lib/domain/product';
import { won, C, R, NUM, FW, FS } from '@/components/ui';

/**
 * 기간별 대여료 표 — **가격 표기의 유일한 원자**.
 *
 * 상세 본문(좁은 화면)과 우측 보조패널(넓은 화면)이 같은 표를 쓴다. 헤이딜러처럼
 * «본문은 차 설명, 우측은 돈과 행동»으로 가르되, 자리만 다르고 표는 하나여야 한다 —
 * 두 벌이면 최저가 표시나 무보증 문구가 곧 어긋난다(2026-08-08 결정).
 */
export function ProductPriceTable({ p }: { p: EntityRecord }) {
  const prices = priceList(p);
  const cheap = cheapest(p);
  const pol = (p._policy || {}) as Record<string, unknown>;
  const caption = [pol.basic_driver_age, pol.annual_mileage, pol.insurance_included].filter(Boolean).join(' · ');
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, overflow: 'hidden' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: FS.body, tableLayout: 'fixed' }}>
        <thead>
          <tr>
            {['기간', '월대여료', '보증금'].map((h, i) => (
              <th
                key={h}
                style={{
                  width: '33.33%', padding: '6px 10px',
                  textAlign: i === 0 ? 'left' : i === 1 ? 'center' : 'right',
                  background: C.head, borderBottom: `1px solid ${C.line}`,
                  fontSize: FS.cap, color: C.mute, fontWeight: FW.strong,
                }}
              >{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {prices.length === 0 ? (
            <tr><td colSpan={3} style={{ padding: 12, textAlign: 'center', color: C.faint }}>가격 문의</td></tr>
          ) : prices.map((pr, i) => {
            const isCheap = !!cheap && pr.m === cheap.m;
            return (
              <tr key={pr.m} style={{ borderTop: i ? `1px solid ${C.line2}` : 'none', background: isCheap ? C.selected : 'transparent' }}>
                <td style={{ padding: '6px 10px' }}>
                  {pr.m}개월
                  {isCheap && <span style={{ marginLeft: 5, fontSize: FS.micro, fontWeight: FW.label, color: C.taupeBg, background: C.brand, borderRadius: R, padding: '1px 5px', verticalAlign: 'middle' }}>최저</span>}
                </td>
                <td style={{ padding: '6px 10px', textAlign: 'center', fontWeight: FW.head, color: C.brand, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{won(pr.rent)}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{pr.deposit > 0 ? won(pr.deposit) : '무보증'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {caption && <div style={{ padding: '6px 10px', fontSize: FS.cap, color: C.faint, borderTop: `1px solid ${C.line2}` }}>* {caption} 기준</div>}
    </div>
  );
}
