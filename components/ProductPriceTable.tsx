'use client';
import { type EntityRecord } from '@/lib/intake/entities';
import { acquisitionPriceList, cheapest, priceList } from '@/lib/domain/product';
import { won, C, R, NUM, FW, FS } from '@/components/ui';

/**
 * 기간별 대여료 표 — **가격 표기의 유일한 원자**.
 *
 * 상세 본문(좁은 화면)과 우측 보조패널(넓은 화면)이 같은 표를 쓴다. 헤이딜러처럼
 * 기간·월대여료·보증금은 행간 비교가 핵심이므로 세 열을 한 줄에 고정한다.
 *
 * ★인수형(만기 인수) — 손오공·웰릭스 구독은 같은 기간에 «반납형»과 «인수형» 두 값이 있다. 위 표는 반납형(표준가),
 *   아래 「인수형(만기 인수)」 표는 `acquisitionPriceList`. 판매시트 「손오공인수형구독」 탭과 같은 값(2026-08-18).
 *   /m(영업자)·/q(손님) 공용 — 손님도 인수형을 본다(시트에도 있는 값).
 */
export function ProductPriceTable({ p, bare = false }: {
  p: EntityRecord;
  /** 이미 카드 안에 들어갈 때 — 자기 테두리를 그리지 않는다(테두리 두 겹 방지). */
  bare?: boolean;
}) {
  const prices = priceList(p);
  const acquisition = acquisitionPriceList(p);
  const cheap = cheapest(p);
  const pol = (p._policy || {}) as Record<string, unknown>;
  const caption = [pol.basic_driver_age, pol.annual_mileage, pol.insurance_included].filter(Boolean).join(' · ');
  return (
    <div style={bare
      ? { overflow: 'hidden' }
      : { overflow: 'hidden' }}>
      {prices.length === 0 ? (
        <div style={{ padding: 12, textAlign: 'center', color: C.faint, fontSize: FS.body }}>가격 문의</div>
      ) : (
        <table aria-label="기간별 대여료와 보증금" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: FS.body }}>
          <thead>
            <tr>
              <th scope="col" style={{ width: '28%', padding: '6px 10px', textAlign: 'left', color: C.mute, fontSize: FS.cap, fontWeight: FW.strong }}>기간</th>
              <th scope="col" style={{ width: '36%', padding: '6px 10px', textAlign: 'right', color: C.mute, fontSize: FS.cap, fontWeight: FW.strong }}>월대여료</th>
              <th scope="col" style={{ width: '36%', padding: '6px 10px', textAlign: 'right', color: C.mute, fontSize: FS.cap, fontWeight: FW.strong }}>보증금</th>
            </tr>
          </thead>
          <tbody>{prices.map((pr) => {
            const isCheap = !!cheap && pr.m === cheap.m;
            const depositLabel = pr.deposit > 0 ? won(pr.deposit) : '무보증';
            return (
              <tr
                key={pr.m}
                style={{
                  background: isCheap ? C.selected : 'transparent',
                }}
              >
                <td style={{ padding: '7px 10px', fontWeight: FW.strong, whiteSpace: 'nowrap' }}>
                  {pr.m}개월
                  {isCheap && <span style={{ marginLeft: 4, fontSize: FS.micro, fontWeight: FW.label, color: C.taupeBg, background: C.brand, borderRadius: R, padding: '1px 4px' }}>최저</span>}
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: FS.title, fontWeight: FW.title, color: C.brand, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{won(pr.rent)}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: NUM, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{depositLabel}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
      {acquisition.length > 0 && (
        <table aria-label="인수형(만기 인수) 기간별 대여료와 보증금" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: FS.body, marginTop: 8, borderTop: `1px solid ${C.line}` }}>
          <thead>
            <tr>
              <th scope="col" style={{ width: '28%', padding: '8px 10px 6px', textAlign: 'left', color: C.mute, fontSize: FS.cap, fontWeight: FW.strong, whiteSpace: 'nowrap' }}>인수형 <span style={{ fontWeight: FW.meta, color: C.faint }}>만기 인수</span></th>
              <th scope="col" style={{ width: '36%', padding: '8px 10px 6px', textAlign: 'right', color: C.mute, fontSize: FS.cap, fontWeight: FW.strong }}>월대여료</th>
              <th scope="col" style={{ width: '36%', padding: '8px 10px 6px', textAlign: 'right', color: C.mute, fontSize: FS.cap, fontWeight: FW.strong }}>보증금</th>
            </tr>
          </thead>
          <tbody>{acquisition.map((pr) => (
            <tr key={`acq-${pr.m}`}>
              <td style={{ padding: '7px 10px', fontWeight: FW.strong, whiteSpace: 'nowrap' }}>{pr.m}개월</td>
              <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: FS.title, fontWeight: FW.title, color: C.ink, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{won(pr.rent)}</td>
              <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: NUM, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{pr.deposit > 0 ? won(pr.deposit) : '무보증'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {caption && <div style={{ padding: '6px 10px 0', fontSize: FS.cap, color: C.faint }}>* {caption} 기준</div>}
    </div>
  );
}
