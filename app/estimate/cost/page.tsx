'use client';
/**
 * 원가 설정 — 견적(`/estimate`)의 «짝». 여기서 한 번 정하면 견적이 그 값으로 계산한다.
 *
 * ★★화면의 정본은 **사장님이 주신 목업** `C:\Users\admin\Documents\프리패스-목업-원가설정.html` 이다.
 *   마크업·클래스·문구·차례를 그 목업에서 그대로 옮겼다. 스타일은 `components/estimate/cost.css`
 *   (목업 `<style>` 통째로 · `.cost-root` 로만 가둠).
 *
 * ★값은 `lib/domain/estimate/cost-settings.ts` 한 곳이 쥔다 — 기본값은 엔진 `DEFAULT_CONFIG` 에서 꺼내
 *   화면과 엔진이 «같은 숫자»를 보게 한다. 저장은 지금 브라우저 한 대(localStorage)다.
 *
 * ⚠ 목업과 일부러 다르게 한 곳 — 되돌리기 전에 읽을 것.
 *   ① 「목표 수익률(IRR)」을 **신용축 → 채널축**으로 옮겼다. 목업은 신용등급별 IRR(1.9/4.3/8.4%)이었으나
 *      그 뒤 사장님이 「수익률 10% 공통」으로 정하셨고(설계서 §2·§10), 신용 위험은 IRR 이 아니라
 *      **손바뀜 위험원가**(계약 유지율 고신용97·중신용75·저신용30%, 2026-09-05)로 잡는 것으로 엔진이 짜여 있다.
 *      그래서 신용축 자리에는 그 «계약 유지율»을 세웠다. ⇒ 되돌리려면 엔진부터 바꿔야 한다.
 *   ② 잔존가 표를 **읽기 전용**으로 뒀다. 목업은 칸마다 입력이었지만, 잔가는 차종델타 파일
 *      (`data/residual-delta.json` 235건)이 원천이라 브라우저에서 못 고친다. 고치는 길이 생기기 전까지
 *      입력칸을 두면 「고쳤는데 안 바뀐다」가 된다. 건별 조정은 견적 화면 STEP 4 에서 한다.
 *   ③ 엔진이 아직 안 쓰는 칸(탁송료·상품화비·정기검사비·간접비·대손·페이백)은 «미반영»이라 적어 뒀다.
 *      지우지 않는다 — 지우면 다음에 또 만든다. 자세한 사정은 `cost-settings.ts` 머리말.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import '@/components/estimate/cost.css';
import { COST_DEFAULTS, loadCostSettings, saveCostSettings, type CostSettings } from '@/lib/domain/estimate/cost-settings';
import { STANDARD, residDelta } from '@/lib/domain/estimate/residual-lookup.js';
import DELTA from '@/lib/domain/estimate/data/residual-delta.json';

const CHANNELS = [{ v: 'rent', label: '렌트' }, { v: 'sub', label: '구독' }] as const;
const CREDITS = [{ v: '정상', label: '정상신용' }, { v: '중신용', label: '중신용' }, { v: '저신용', label: '저신용' }] as const;
/** 계약 유지율 — `turnover-cost.js` 의 RETENTION 과 같은 값. 손바뀜 위험원가의 근거다. */
const RETENTION: Record<string, number> = { 정상: 97, 중신용: 75, 저신용: 30 };
const YEARS = [1, 2, 3, 4, 5];

const num = (v: string) => Number(String(v).replace(/[^\d.]/g, '')) || 0;
const comma = (n: number) => (n || 0).toLocaleString('ko-KR');

type Row = { id: string; name: string; delta: number; seg: string };
const VEHICLES: Row[] = Object.entries(DELTA as Record<string, { maker: string; model: string; seg: string; delta: number }>)
  .map(([id, v]) => ({ id, name: `${v.maker} ${v.model}`, delta: Number(v.delta) || 0, seg: v.seg }))
  .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

/** 목업 `.pin` — 숫자 한 칸. */
function Pin({ value, unit, sm, onChange, disabled }: {
  value: string | number; unit?: string; sm?: boolean; onChange?: (v: string) => void; disabled?: boolean;
}) {
  return (
    <span className={sm ? 'pin sm' : 'pin'}>
      <input value={value} disabled={disabled} onChange={(e) => onChange?.(e.target.value)} inputMode="decimal" />
      {unit ? <i>{unit}</i> : null}
    </span>
  );
}

function Seg2<T extends string>({ opts, cur, onPick }: {
  opts: readonly { v: T; label: string }[]; cur: T; onPick: (v: T) => void;
}) {
  return (
    <span className="seg2">
      {opts.map((o) => (
        <button key={o.v} type="button" className={o.v === cur ? 'on' : ''} onClick={() => onPick(o.v)}>{o.label}</button>
      ))}
    </span>
  );
}

export default function EstimateCostPage() {
  const [cs, setCs] = useState<CostSettings>(COST_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [polCh, setPolCh] = useState<'rent' | 'sub'>('rent');
  const [polCr, setPolCr] = useState<'정상' | '중신용' | '저신용'>('정상');
  const [vehCat, setVehCat] = useState<'new' | 'used'>('new');
  const [q, setQ] = useState('');

  // 저장값은 브라우저에만 있다 → 첫 그림(SSR)과 어긋나지 않게 그린 «뒤에» 한 번만 얹는다.
  if (!loaded && typeof window !== 'undefined') { setLoaded(true); setCs(loadCostSettings()); }

  const set = (k: keyof CostSettings, v: number) => { setCs((o) => ({ ...o, [k]: v })); setDirty(true); setSaved(false); };
  const onSave = () => { if (saveCostSettings(cs)) { setDirty(false); setSaved(true); } };

  const rows = useMemo(() => {
    const s = q.trim();
    return (s ? VEHICLES.filter((v) => v.name.includes(s) || v.seg.includes(s)) : VEHICLES).slice(0, 60);
  }, [q]);

  const isRent = polCh === 'rent';

  return (
    <div className="cost-root">
      <div className="wrap">
        <div className="top">
          <div className="wm"><span className="a">freepass</span><span className="b">mobility</span></div>
          <h1>원가 설정</h1>
          <span className="once">딱 1번 세팅 → 모든 견적에 자동 적용</span>
          <button type="button" className="save" onClick={onSave} disabled={!dirty}>
            {saved ? '저장됨' : '저장'}
          </button>
        </div>

        <div className="tabbar">
          <span className="on">원가 설정</span>
          <Link href="/estimate">견적하기</Link>
        </div>

        <p className="intro">
          렌터카 <b>원가 항목</b> — 한 번 넣어두면 견적에 자동 반영. 맨 위 <b>조건별</b>(렌트/구독은 원가가 다름) →
          가운데 <b>공통 원가</b> → 맨 아래 <b>차량별 잔가</b>. 잔가는 차량마다 달라 견적에서 건별 입력도 가능.
        </p>

        <div className="grid">
          {/* 원가 정책 — 채널 × 신용 (비공통) */}
          <section className="card wide" style={{ order: -1 }}>
            <div className="ch"><span className="bar" /><div><b>원가 정책 · 상품별</b><i>렌트/구독 × 신용등급 조합마다 다른 원가 (공통은 아래)</i></div><span className="tag law">비공통</span></div>
            <div className="polsel">
              <Seg2 opts={CHANNELS} cur={polCh} onPick={setPolCh} />
              <span className="polx">×</span>
              <Seg2 opts={CREDITS} cur={polCr} onPick={setPolCr} />
            </div>
            <div className="poltbl">
              <div className="polrow">
                <span className="pk">취득세율<em>영업용 4% · 비영업용 7%</em></span><span className="ax ch">채널</span>
                <Pin sm unit="%" value={isRent ? cs.acqTaxRentPct : cs.acqTaxSubPct}
                  onChange={(v) => set(isRent ? 'acqTaxRentPct' : 'acqTaxSubPct', num(v))} />
              </div>
              <div className="polrow">
                <span className="pk">연간 자동차보험료</span><span className="ax ch">채널</span>
                {isRent ? <Pin unit="원" value={comma(cs.insYear)} onChange={(v) => set('insYear', num(v))} />
                  : <span className="na">고객 명의</span>}
              </div>
              <div className="polrow">
                <span className="pk">자차충당금 적립율</span><span className="ax ch">채널</span>
                {isRent ? <Pin sm unit="%" value={cs.selfPct} onChange={(v) => set('selfPct', num(v))} />
                  : <span className="na">—</span>}
              </div>
              <div className="polrow">
                <span className="pk">목표 수익률<em>목업은 신용축이었다 · 지금은 «10% 공통 + 손바뀜»(설계서 §2·§10)</em></span>
                <span className="ax ch">채널</span>
                <Pin sm unit="%" value={isRent ? cs.marginRentPct : cs.marginSubPct}
                  onChange={(v) => set(isRent ? 'marginRentPct' : 'marginSubPct', num(v))} />
              </div>
              <div className="polrow">
                <span className="pk">계약 유지율<em>손바뀜 위험원가의 근거 · 엔진 고정(2026-09-05 확정)</em></span>
                <span className="ax cr">신용</span>
                <Pin sm unit="%" value={RETENTION[polCr]} disabled />
              </div>
              <div className="polrow">
                <span className="pk">영업수수료 상한<em>엔진은 «공통» 220만 — 신용별로 갈리지 않는다</em></span>
                <span className="ax cr">신용</span>
                <Pin unit="원" value="2,200,000" disabled />
              </div>
            </div>
            <div className="note">이 조합만의 원가를 편집 · <b>채널</b>=렌트/구독으로 갈림 · <b>신용</b>=신용등급으로 갈림 · 신차 전용 개별소비세는 법정 자동 · 나머지는 아래 <b>공통 원가</b></div>
          </section>

          {/* 잔존가 — 차종별 (읽기 전용) */}
          <section className="card wide" style={{ order: 9 }}>
            <div className="ch"><span className="bar" /><div><b>잔존가 · 차량별 잔가 리스트</b><i>차종마다 1~5년 잔가율이 다름 · 리스트 없으면 견적에서 건별 입력</i></div><span className="tag law">차량별</span></div>
            <div className="vfilter">
              <Seg2 opts={[{ v: 'new', label: '신차마스터' }, { v: 'used', label: '중고마스터' }] as const} cur={vehCat} onPick={setVehCat} />
              <div className="vsearch2">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
                <input placeholder="차종 검색 (제조사·모델·트림)" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
            </div>
            {vehCat === 'new' ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="rtb">
                  <thead><tr><th style={{ textAlign: 'left', paddingLeft: 10 }}>차종</th>{YEARS.map((y) => <th key={y}>{y}년</th>)}</tr></thead>
                  <tbody>
                    {rows.map((v) => {
                      const [makerId, code] = v.id.split('/');
                      const d = residDelta(makerId, code);
                      return (
                        <tr key={v.id}>
                          <td className="vn">{v.name}<span style={{ color: 'var(--ink-4)', fontWeight: 500 }}> · {v.seg}</span></td>
                          {YEARS.map((y) => (
                            <td key={y}><span className="pc">{Math.max(5, Math.min(98, (STANDARD as Record<number, number>)[y] + d))}<i>%</i></span></td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="byrow"><b>중고마스터</b>는 아직 안 붙었다 — 중고 잔가는 같은 곡선을 «현재 연식 대비»로 환산해 견적이 자동으로 낸다</div>
            )}
            <div className="byrow"><b>리스트에 없는 차량</b>은 견적 화면에서 잔존가를 건별 입력 (마스터 완성 전 기본 방식)</div>
            <div className="note">국산 <b>표준 잔가 곡선</b>({YEARS.map((y) => `${y}년 ${(STANDARD as Record<number, number>)[y]}%`).join(' · ')})에 차종별 델타(±%p)를 얹은 값 · 등록 {VEHICLES.length}건 · 보정: 주행 −2%p/만km · 사고 · 노후 · <b>여기서는 못 고친다</b> — 건별 조정은 견적 STEP 4</div>
          </section>

          {/* A. 취득 */}
          <section className="card">
            <div className="ch"><span className="bar" /><div><b>취득 원가</b><i>자본화 → 감가(매출원가) · 공통</i></div></div>
            <div className="rows">
              <div className="row"><label>차량 매입 할인 <em>견적 화면에서 건별로 고른다</em></label><Pin sm unit="%" value={0} disabled /></div>
              <div className="row"><label>개별소비세 <em>신차 5%+교육세 · 법정 자동</em></label><Pin sm unit="%" value={5} disabled /></div>
              <div className="row"><label>공채율</label><Pin sm unit="%" value={cs.bondPct} onChange={(v) => set('bondPct', num(v))} /></div>
              <div className="row"><label>등록비 <em>번호판·인지·대행</em></label><Pin unit="원" value={comma(cs.regFee)} onChange={(v) => set('regFee', num(v))} /></div>
              <div className="row"><label>1차 탁송료 <em>미반영 — 간접비로 봄(2026-09-05)</em></label><Pin unit="원" value={comma(cs.deliveryFee)} onChange={(v) => set('deliveryFee', num(v))} /></div>
              <div className="row"><label>초기 상품화비 <em>미반영 · 정비·클리닝·GPS설치</em></label><Pin unit="원" value={comma(cs.initPrepFee)} onChange={(v) => set('initPrepFee', num(v))} /></div>
            </div>
          </section>

          {/* C. 금융 */}
          <section className="card">
            <div className="ch"><span className="bar" /><div><b>금융</b><i>차 살 돈 조달</i></div></div>
            <div className="rows">
              <div className="row"><label>조달금리 <em>연</em></label><Pin sm unit="%" value={cs.interestPct} onChange={(v) => set('interestPct', num(v))} /></div>
              <div className="row"><label>대출 비율 <em>취득원가 대비</em></label><Pin sm unit="%" value={cs.loanPct} onChange={(v) => set('loanPct', num(v))} /></div>
            </div>
          </section>

          {/* D. 운영 직접비 */}
          <section className="card">
            <div className="ch"><span className="bar" /><div><b>직접 운영비</b><i>매출원가(COGS) · 기간 누적 · 공통</i></div></div>
            <div className="rows">
              <div className="row"><label>자동차세 <em>cc단가 · 법정 자동</em></label><span className="na">자동</span></div>
              <div className="row"><label>정비비</label><Pin unit="원/월" value={comma(cs.maintMonthly)} onChange={(v) => set('maintMonthly', num(v))} /></div>
              <div className="row"><label>GPS·관제</label><Pin unit="원/월" value={comma(cs.gpsMonthly)} onChange={(v) => set('gpsMonthly', num(v))} /></div>
              <div className="row"><label>주차장·관리</label><Pin unit="원/월" value={comma(cs.parkingMonthly)} onChange={(v) => set('parkingMonthly', num(v))} /></div>
              <div className="row"><label>정기검사비 <em>미반영 · 3년차~</em></label><Pin unit="원/년" value={comma(cs.inspectionFee)} onChange={(v) => set('inspectionFee', num(v))} /></div>
            </div>
          </section>

          {/* E. 판관비 */}
          <section className="card">
            <div className="ch"><span className="bar" /><div><b>판매관리비 (판관비)</b><i>SG&amp;A · 일반관리 배분 · 공통</i></div></div>
            <div className="rows">
              <div className="row"><label>일반관리·간접비 배분율 <em>미반영 — 엔진은 직접비·수수료로 다 잡는다</em></label><Pin sm unit="%" value={cs.overheadPct} onChange={(v) => set('overheadPct', num(v))} /></div>
              <div className="row"><label>대손·리스크 충당 <em>미반영 — 신용 위험은 손바뀜 원가로 잡는다</em></label><Pin sm unit="%" value={cs.badDebtPct} onChange={(v) => set('badDebtPct', num(v))} /></div>
            </div>
          </section>

          {/* 수수료 정책 */}
          <section className="card">
            <div className="ch"><span className="bar" /><div><b>수수료 정책</b><i>영업수수료율 → 페이백 (공통)</i></div></div>
            <div className="rows">
              <div className="row"><label>영업수수료율 기본값 <em>견적서 영업자가 조정</em></label><Pin sm unit="%" value={cs.salesFeePct} onChange={(v) => set('salesFeePct', num(v))} /></div>
              <div className="row"><label>페이백 테이블 <em>미반영 · 0.5% 단위 · 0%→70만 … 5%→0</em></label><span className="na">준비 중</span></div>
            </div>
          </section>
        </div>

        <div className="foot">
          법정값(개별소비세·자동차세·부가세)은 자동 계산 — 변동 불가 · 이 설정은 <b>중고·신차 공통 원가 기준</b>이며 잔존가만 마스터/건별로 갈립니다.
          <br />저장은 <b>이 브라우저</b>에만 남습니다 — 회사 공용 저장은 저장소·보안규칙을 정한 뒤에 붙입니다.
        </div>
      </div>
    </div>
  );
}
