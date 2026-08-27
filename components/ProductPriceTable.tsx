'use client';
import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { cheapest, pricePlanList, type PricePlan } from '@/lib/domain/product';
import { won, C, R, FW, FS, DetailTable, DT, type DetailTone } from '@/components/ui';
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
 *   고른 줄은 **연한 네이비 면 + 네이비 굵은 글자**다. 세 번 갈아엎은 자리라 이유를 남긴다:
 *     ① 옅은 배경 + 좌측 3px 바 → 바가 줄을 «감싸» 인용문처럼 읽힘(사장님 「바 형태 별로」)
 *     ② 반전(네이비 면 + 흰 글자) → 섹션 머리띠가 반전으로 바뀌면서 **한 섹션에 반전이 둘**이 됨
 *        (사장님 「대여료 강조한 색깔도 좀 다르게 · 약간 연한색으로」)
 *     ③ **지금** — 머리띠가 강(반전)이면 선택 줄은 중(연한 면)이어야 위계가 선다.
 *   같은 네이비 안에서 «강→중»으로 내려가므로 색은 하나인데 층은 둘이다.
 */
export function ProductPriceTable({ p, title = '대여료조건', hint, tone }: {
  p: EntityRecord;
  title?: ReactNode;
  hint?: ReactNode;
  tone?: DetailTone;
}) {
  const plans = pricePlanList(p);
  const cheap = cheapest(p);
  const pol = (p._policy || {}) as Record<string, unknown>;
  const caption = [pol.basic_driver_age, pol.annual_mileage, pol.insurance_included].filter(Boolean).join(' · ');
  // 선택 키 = `반납:36`·`인수:36`. 갈래가 달라도 «지금 고른 조건»은 하나뿐이다.
  const [pick, setPick] = useState<string | null>(null);
  const cheapPlan = plans.filter((x) => x.standard).sort((a, b) => a.rent - b.rent)[0] || null;
  const sel = pick ?? (cheapPlan ? `${cheapPlan.m}:${cheapPlan.condition}` : null);

  /**
   * ★**한 줄 = 기간 × 조건 × 대여료 × 보증금**(사장님 2026-08-23 「기간 조건 대여료 보증금 · 조건에
   *   만 26세 이상, 연간 3만km 약정 이런 식으로 당겨와서 기간별 표시해 주면 어때? 그럼 오플 거도
   *   무난하게 담고 직관적이고」).
   *   전에는 표를 셋으로 갈랐다(표준·주행거리별·인수형). 조건을 열로 세우니 갈 이유가 없다 —
   *   같은 기간에 조건이 둘이면 **두 줄로 서면 그만**이고, 오플의 2만/3만도 저절로 담긴다.
   */
  const row = (pr: PricePlan, i: number, cheapest_: boolean) => {
    const key = `${pr.m}:${pr.condition}`;
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
        <th scope="row" style={{ ...DT.labelTh, width: undefined, color: on ? C.brand : C.ink, fontWeight: on ? FW.head : undefined }}>
          {pr.m}개월
          {cheapest_ && (
            <span style={{
              marginLeft: 5, fontSize: FS.micro, fontWeight: FW.label, borderRadius: R, padding: '1px 5px',
              color: C.taupeBg, background: C.brand,
            }}>최저</span>
          )}
        </th>
        {/* 조건이 없으면 «없다»가 아니라 «안 정해졌다» — 하이픈으로 자리만 지킨다. */}
        <td style={{ ...DT.td, color: pr.condition ? C.ink : C.faint }}>{pr.condition || '—'}</td>
        <td style={{ ...DT.tdR, fontSize: FS.title, fontWeight: on ? FW.head : FW.title, color: C.brand }}>{won(pr.rent)}</td>
        <td style={DT.tdR}>{pr.deposit > 0 ? won(pr.deposit) : '무보증'}</td>
      </tr>
    );
  };

  const colTh: CSSProperties = { ...DT.colTh, textAlign: 'right' };
  return (
    /* accent="main" — 차를 고르는 데 필요한 구간. 머리띠 색은 중요도를 말한다. */
    <DetailTable
      title={title}
      hint={hint}
      icon={typeof title === 'string' ? sectionIcon(title) : undefined}
      accent="main"
      tone={tone}
      span={4}
      label="기간별 조건과 대여료·보증금"
      widths={['20%', '30%', '26%', '24%']}
      cols={<>
        <th scope="col" style={DT.colTh}>기간</th>
        <th scope="col" style={DT.colTh}>조건</th>
        <th scope="col" style={colTh}>월대여료</th>
        <th scope="col" style={colTh}>보증금</th>
      </>}
    >
      {plans.length === 0 ? (
        <tr><td colSpan={4} style={{ ...DT.td, textAlign: 'center', color: C.faint }}>가격 문의</td></tr>
      ) : (() => {
        /*
         * ★**반납형과 인수형을 갈라 세운다**(사장님 2026-08-28 「반납형 기본하고 인수형 정보가
         *   있으면 구분해서 써주기로 했잖아 · 구분되게」).
         *
         *   전에는 기간 오름차순으로 섞여, 36개월 반납형 바로 밑에 36개월 인수형이 붙었다.
         *   금액이 비슷하니 조건 칸의 「만기인수」 넉 자를 못 보면 **같은 상품의 다른 줄**로 읽힌다.
         *   손오공 구독은 403대 중 386대가 인수형을 들고 있어, 그 오독이 그대로 견적이 된다.
         *
         *   ⚠ 탭으로 감추지 않는다 — 영업자는 둘을 **나란히 놓고** 손님에게 고르게 한다.
         *   ⚠ 인수형이 없는 차는 갈래 줄도 안 세운다. 하나뿐인 갈래에 이름표는 군더더기다.
         */
        const ret = plans.filter((x) => !x.acquisition);
        const acq = plans.filter((x) => x.acquisition);
        const split = ret.length > 0 && acq.length > 0;
        const best = (pr: PricePlan) => !!cheapPlan && pr.m === cheapPlan.m && pr.condition === cheapPlan.condition;
        if (!split) return plans.map((pr, i) => row(pr, i, best(pr)));
        const groupHead = (label: string, note: string) => (
          <tr key={`g-${label}`}>
            <th colSpan={4} scope="colgroup" style={{
              ...DT.labelTh, width: undefined, textAlign: 'left',
              background: C.sunken, color: C.ink, fontWeight: FW.head,
              borderTop: `1px solid ${C.line}`,
            }}>
              {label}
              <span style={{ marginLeft: 6, fontSize: FS.cap, fontWeight: FW.meta, color: C.mute }}>{note}</span>
            </th>
          </tr>
        );
        return [
          groupHead('반납형', '만기에 차를 반납한다'),
          ...ret.map((pr, i) => row(pr, i, best(pr))),
          groupHead('인수형', '만기에 차를 인수한다'),
          ...acq.map((pr, i) => row(pr, i, false)),
        ];
      })()}

      {caption ? (
        <tr style={DT.tr(1)}>
          <th scope="row" style={{ ...DT.labelTh, width: undefined }}>기준</th>
          <td colSpan={3} style={DT.td}>{caption}</td>
        </tr>
      ) : null}
    </DetailTable>
  );
}
