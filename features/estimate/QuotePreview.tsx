'use client';
/**
 * 손님 견적서 — **화면에서 보고 끝나지 않게** 하는 첫 조각.
 *
 * ★사장님 2026-09-08 「다음 ㄱㄱㄱ」 — 남은 것 중 첫째가 「내보내는 길」이었다.
 *   지금까지 견적은 화면에서 보고 끝이라 **손님한테 나갈 길이 없었다.**
 *
 * ★★짜임은 원본 웰릭스 견적서(`src/lib/build-multi-quote-html.js`)의 **마크업을 그대로** 쓴다.
 *   스타일이 이미 `components/estimate/welrix.css` 에 들어와 있기 때문이다.
 *   ⚠⚠ 그래서 **클래스 이름만 베끼면 안 되고 «속 짜임»까지 같아야 한다.**
 *     2026-09-08 첫 판에서 `.qd-people__col` 안을 `<b>/<span>` 으로 짰다가
 *     「고객님고객」·「-담당자」처럼 글자가 붙어 나왔다 — CSS 는 `h4` + `.name` 을 기다리고 있었다.
 *     `.qd-vehicle__price` 도 `.label`/`.value` 를, `.qd-monthly__price` 도 `.price`/`.unit`/`.residual` 을 기다린다.
 *   ⚠ 이 조각은 **반드시 `.wx-root` 안**에서 그려야 한다. 밖에 두면 맨몸으로 선다.
 *
 * ★★**원가·손익은 한 줄도 안 나간다.** 이건 손님이 보는 문서다 —
 *   감가·이자·손바뀜·수수료·영업이익은 «우리» 숫자다. 검사(`check:estimate`)가 그것을 지킨다.
 *   ⇒ 여기 들어오는 값도 «손님이 볼 것»만 받는다(`QuoteLine` 에 원가 자리가 아예 없다).
 *
 * ★★**노브랜드** — 로고도 워드마크도 계좌도 안 싣는다(사장님 2026-08-30 「아무것도 안 보여야」).
 *   원본에 있던 회사 로고·입금계좌 푸터는 **일부러 뺐다.**
 *
 * ⚠ 아직 «보여 주기»까지다. 발송(링크·카톡)·바구니는 다음 일감이다 —
 *   ①이 없으면 ②③이 뜻이 없어서 이것부터 했다.
 */
import { useEffect } from 'react';

/** 손님에게 보이는 한 기간 — **원가 자리가 없다**(일부러). */
export type QuoteLine = {
  term: number;          // 개월
  pay: number;           // 월 대여료(부가세 포함)
  depositPct: number; deposit: number;
  prepayPct: number; prepay: number;
  buyoutPct: number; buyout: number;
};

export type QuoteDoc = {
  customer: string; staff: string; tel: string;
  brand: string; carName: string; carSub: string;
  price: number;           // 차량가
  /** ★그 차량가가 «어느 기준»인가 — 신차 「세제혜택 전(개소세 5%)」이 정본. 손님이 다른 곳에서
   *  본 값과 다를 때 «왜 다른지»를 말해 준다. 안 적으면 손님이 우리 숫자를 못 믿는다. */
  priceBasis?: string;
  /** ★판매가격 세제감면(개소세·교육세) — 0 이 아니면 견적서가 «드러낸다». */
  saleTaxCredit?: number;
  /** 감면 후 «적용가» — 보증금·선납·인수가 이 값 위에 선다. */
  netPrice?: number;
  channel: string; endType: string; credit: string;
  colorExt: string; colorInt: string;
  options: { name: string; price: number }[];
  lines: QuoteLine[];
};

const won = (n: number) => Math.round(n || 0).toLocaleString('ko-KR');
const man = (n: number) => `${Math.round((n || 0) / 10000).toLocaleString('ko-KR')}만`;
const ymd = (d: Date) => d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

export default function QuotePreview({ doc, onClose }: { doc: QuoteDoc; onClose: () => void }) {
  // 열려 있는 동안 Esc 로 닫는다 — 모달의 기본 예의.
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  /** 제일 싼 달이 「BEST」 — 원본과 같은 표시. 한 줄뿐이면 안 붙인다(비교가 없으니 뜻이 없다). */
  const best = doc.lines.length > 1
    ? doc.lines.reduce((b, l) => (l.pay && l.pay < b.pay ? l : b), doc.lines[0])
    : null;

  const now = new Date();
  const due = new Date(now.getTime() + 7 * 864e5);
  const optSum = doc.options.reduce((s, o) => s + (o.price || 0), 0);

  return (
    <div className="quote-modal-backdrop open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="quote-modal">
        <div className="quote-modal__head">
          <span>손님 견적서</span>
          <div className="actions">
            {/* 인쇄는 브라우저에 맡긴다 — PDF 저장도 같은 창에서 된다. */}
            <button type="button" className="outline" onClick={() => window.print()}>인쇄 · PDF</button>
            <button type="button" className="close" onClick={onClose} aria-label="닫기">✕</button>
          </div>
        </div>

        <div className="quote-modal__body">
          <div className="quote-doc" id="quote-doc-print">
            <div className="qd-hero">
              <div className="qd-hero__title">장기렌터카 견적서</div>
              <div className="qd-hero__meta">
                <span><b>발행일</b> {ymd(now)}</span>
                <span><b>유효기간</b> {ymd(due)}까지</span>
              </div>
            </div>

            <div className="qd-section">
              <div className="qd-people">
                <div className="qd-people__col">
                  <h4>고객</h4>
                  <div className="name">{doc.customer ? `${doc.customer} 님` : '-'}</div>
                </div>
                <div className="qd-people__col">
                  <h4>담당자</h4>
                  <div className="name">{doc.staff || '-'}</div>
                  {doc.tel ? <div className="tel">{doc.tel}</div> : null}
                </div>
              </div>
            </div>

            <div className="qd-section">
              <div className="qd-section__label">Condition</div>
              <div className="qd-info-grid">
                <div className="qd-info-card">
                  <h5>견적 조건</h5>
                  <div className="kv"><span className="k">상품</span><span className="v">{doc.channel}</span></div>
                  <div className="kv"><span className="k">만기</span><span className="v">{doc.endType}</span></div>
                  <div className="kv"><span className="k">심사</span><span className="v">{doc.credit}</span></div>
                  <div className="kv"><span className="k">차량가</span><span className="v">{man(doc.price)}원</span></div>
                </div>
                {/* ⚠ 없는 값을 지어내지 않는다 — 넷 다 대여료 «원가에 실제로 반영»되는 항목이다. */}
                <div className="qd-info-card">
                  <h5>대여료 포함</h5>
                  <div className="kv"><span className="k">자동차보험</span><span className="v">포함</span></div>
                  <div className="kv"><span className="k">정비</span><span className="v">포함</span></div>
                  <div className="kv"><span className="k">자동차세</span><span className="v">포함</span></div>
                  <div className="kv"><span className="k">부가세</span><span className="v">포함</span></div>
                </div>
              </div>
            </div>

            <div className="qd-section qd-section--card">
              <div className="qd-section__label">Vehicle</div>
              <div className="qd-vehicle">
                <div className="qd-vehicle__top">
                  <div>
                    {doc.brand ? <div className="qd-vehicle__title">{doc.brand}</div> : null}
                    <div className="qd-vehicle__name">{doc.carName}</div>
                    {doc.carSub ? <div className="qd-vehicle__sub">{doc.carSub}</div> : null}
                  </div>
                  <div className="qd-vehicle__price">
                    <div className="label">Total</div>
                    <div className="value">{man(doc.price)}원</div>
                  </div>
                </div>
                {/* ★기준은 «원본이 가진 줄»(.qd-vehicle__row)에 적는다 — `.label`/`.value` 를 건드리면
                    웰릭스 CSS 짜임이 깨진다(check:estimate 가 잡는다). */}
                {doc.colorExt || doc.colorInt || doc.priceBasis || doc.saleTaxCredit ? (
                  <div className="qd-vehicle__rows">
                    <div className="qd-vehicle__row"><span className="k">외장</span><span className="v">{doc.colorExt || '-'}</span></div>
                    <div className="qd-vehicle__row"><span className="k">내장</span><span className="v">{doc.colorInt || '-'}</span></div>
                    {doc.priceBasis
                      ? <div className="qd-vehicle__row"><span className="k">가격기준</span><span className="v">{doc.priceBasis}</span></div>
                      : null}
                    {/* ★감면을 «숨기지» 않는다 — 차량가와 보증금·인수의 기준이 갈려 보이면
                        손님이 손으로 두드렸을 때 안 맞는다. 그 사이를 이 두 줄이 잇는다. */}
                    {doc.saleTaxCredit
                      ? <>
                        <div className="qd-vehicle__row"><span className="k">세제혜택</span><span className="v">−{man(doc.saleTaxCredit)}원</span></div>
                        <div className="qd-vehicle__row"><span className="k">적용가</span><span className="v">{man(doc.netPrice ?? 0)}원</span></div>
                      </>
                      : null}
                  </div>
                ) : null}
                {doc.options.length ? (
                  <div className="qd-vehicle__opts">
                    <div className="qd-vehicle__opts-label">옵션 {doc.options.length}개 · {man(optSum)}원</div>
                    {/* ⚠ 같은 이름이 두 줄인 트림이 있다 — key 는 «자리»로 준다. */}
                    {doc.options.map((o, i) => <span className="opt-chip" key={`${i}|${o.name}`}>{o.name}</span>)}
                  </div>
                ) : null}
              </div>

              <div className="qd-monthly" style={{ marginTop: 14 }}>
                {doc.lines.map((l) => (
                  <div className={`qd-monthly__row${best && l.term === best.term ? ' best' : ''}`} key={l.term}>
                    {best && l.term === best.term ? <span className="qd-monthly__badge">BEST</span> : null}
                    <div className="qd-monthly__term">{l.term}<em>개월</em></div>
                    <div className="qd-monthly__cond">
                      보증금 <b>{l.depositPct}%</b> · {man(l.deposit)}원<br />
                      선납금 <b>{l.prepayPct}%</b> · {man(l.prepay)}원
                    </div>
                    <div className="qd-monthly__price">
                      <span className="price">{won(l.pay)}</span><span className="unit">원</span>
                      <div className="residual">만기인수 {l.buyoutPct}% · {man(l.buyout)}원</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="qd-section">
              <div className="qd-section__label">Notes</div>
              <ul className="qd-notes">
                <li>월 대여료는 부가세 포함 금액이며, 자동차보험·정비·자동차세가 포함됩니다.</li>
                <li>만기인수 금액은 예상값입니다 — 계약 시점과 차량 상태에 따라 달라질 수 있습니다.</li>
                <li>심사 결과에 따라 보증금·선납금 등 조건이 달라질 수 있습니다.</li>
                <li>중도해지 시 수수료가 발생합니다(기간별 상이 · 약정서 참고).</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
