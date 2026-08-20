'use client';
import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { acquisitionPriceList, cheapest, priceList } from '@/lib/domain/product';
import { won, C, FW, FS, PILL_R, DetailTable, DT, type DetailTone } from '@/components/ui';
import { sectionIcon } from '@/components/section-icons';

/**
 * 기간별 대여료 표 — **가격 표기의 유일한 원자**.
 *
 * ★한 표(2026-08-20) — 예전엔 반납형 표 아래 인수형 표가 따로 서서 머리글이 두 번 나왔다.
 *   인수형은 «같은 기간의 다른 상품»이지 다른 표가 아니다(손오공·웰릭스 구독은 같은 36개월에 두 값이 있다).
 *   그래서 표는 하나로 두고 **갈래 줄** 하나로 나눈다 — 상세의 다른 섹션과 문법이 같아진다.
 *   값은 판매시트 「손오공인수형구독」 탭과 같다(2026-08-18). /m(영업자)·/q(손님) 공용.
 *
 * ★행 선택 — 상담 중 «이 조건으로 갑시다» 하고 한 줄을 짚어 둔다.
 *   기본 선택이 최저가 행이라 **누르기 전 화면은 예전과 같다**. 배경만으로는 최저와 선택이 구분되지 않으므로
 *   「최저」는 배지가, 「지금 고른 줄」은 좌측 브랜드 바가 맡는다.
 */
export function ProductPriceTable({ p, title = '대여료조건', hint, tone }: {
  p: EntityRecord;
  title?: ReactNode;
  hint?: ReactNode;
  tone?: DetailTone;
}) {
  const prices = priceList(p);
  const acquisition = acquisitionPriceList(p);
  const cheap = cheapest(p);
  const pol = (p._policy || {}) as Record<string, unknown>;
  const caption = [pol.basic_driver_age, pol.annual_mileage, pol.insurance_included].filter(Boolean).join(' · ');
  // 선택 키 = `반납:36`·`인수:36`. 갈래가 달라도 «지금 고른 조건»은 하나뿐이다.
  const [pick, setPick] = useState<string | null>(null);
  const sel = pick ?? (cheap ? `반납:${cheap.m}` : null);

  /** 선택 표시는 좌측 3px 바 — border 로 그리면 그 줄만 폭이 밀려 숫자 열이 어긋난다. */
  const row = (kind: '반납' | '인수', m: number, rent: number, deposit: number, i: number, cheapest_: boolean) => {
    const key = `${kind}:${m}`;
    const on = sel === key;
    return (
      <tr
        key={key}
        tabIndex={0}
        title="이 조건으로 선택"
        onClick={() => setPick(key)}
        onKeyDown={(e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPick(key); }
        }}
        style={{ ...DT.tr(i), background: on ? C.selected : 'transparent', cursor: 'pointer' }}
      >
        <th scope="row" style={{
          ...DT.labelTh, width: undefined, color: C.ink,
          ...(on ? { boxShadow: `inset 3px 0 0 ${C.brand}` } : {}),
        }}>
          {m}개월
          {cheapest_ && (
            <span style={{
              marginLeft: 5, fontSize: FS.micro, fontWeight: FW.label,
              color: C.taupeBg, background: C.brand, borderRadius: PILL_R, padding: '1px 5px',
            }}>최저</span>
          )}
        </th>
        <td style={{ ...DT.tdR, fontSize: FS.title, fontWeight: FW.title, color: C.brand }}>{won(rent)}</td>
        <td style={DT.tdR}>{deposit > 0 ? won(deposit) : '무보증'}</td>
      </tr>
    );
  };

  const colTh: CSSProperties = { ...DT.colTh, textAlign: 'right' };
  return (
    <DetailTable
      title={title}
      hint={hint}
      icon={typeof title === 'string' ? sectionIcon(title) : undefined}
      tone={tone}
      span={3}
      label="기간별 대여료와 보증금"
      widths={['32%', '34%', '34%']}
      cols={<>
        <th scope="col" style={DT.colTh}>기간</th>
        <th scope="col" style={colTh}>월대여료</th>
        <th scope="col" style={colTh}>보증금</th>
      </>}
    >
      {prices.length === 0 ? (
        <tr><td colSpan={3} style={{ ...DT.td, textAlign: 'center', color: C.faint }}>가격 문의</td></tr>
      ) : prices.map((pr, i) => row('반납', pr.m, pr.rent, pr.deposit, i, !!cheap && pr.m === cheap.m))}

      {acquisition.length > 0 ? (
        <>
          {/* 갈래 줄 — 표를 둘로 쪼개지 않고 여기서 나눈다. */}
          <tr>
            <th scope="colgroup" colSpan={3} style={DT.split}>
              인수형 <span style={{ fontWeight: FW.body, color: C.faint }}>만기에 차를 인수 · 같은 기간의 다른 상품</span>
            </th>
          </tr>
          {acquisition.map((pr, i) => row('인수', pr.m, pr.rent, pr.deposit, i, false))}
        </>
      ) : null}

      {caption ? (
        <tr style={DT.tr(1)}>
          <th scope="row" style={{ ...DT.labelTh, width: undefined }}>기준</th>
          <td colSpan={2} style={DT.td}>{caption}</td>
        </tr>
      ) : null}
    </DetailTable>
  );
}
