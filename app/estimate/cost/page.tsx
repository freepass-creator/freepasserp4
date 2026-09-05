'use client';
/**
 * 원가 설정 — 견적(`/estimate`)의 «짝». 여기서 한 번 정하면 견적이 그 값으로 계산한다.
 *
 * ★★얼굴은 **견적과 같다**(사장님 2026-09-06 「견적과 원가가 같은 UI여야 한다 · 견적은 UI를
 *   마무리해 놨으니 견적에 맞춰서 원가도 그렇게 하면 된다」).
 *   그래서 껍데기·머리·카드·세그·칩·숫자칸을 전부 견적 것(`estimate.css`)으로 쓰고,
 *   `cost.css` 는 견적에 «없는 조각»만 덧칠한다. 새 규격을 만들지 않는다.
 *   ⇒ 원가 목업(`프리패스-목업-원가설정.html`)은 이제 **무엇을 넣을지**(항목·문구·축)의 정본이고,
 *     **어떻게 보일지**는 견적이 정본이다. 항목을 지우거나 더할 때만 목업을 본다.
 *
 * ★값은 `lib/domain/estimate/cost-settings.ts` 한 곳이 쥔다 — 기본값은 엔진 `DEFAULT_CONFIG` 에서 꺼내
 *   화면과 엔진이 «같은 숫자»를 보게 한다. 저장은 지금 브라우저 한 대(localStorage)다.
 *
 * ⚠ 목업과 일부러 다르게 한 곳 — 되돌리기 전에 읽을 것.
 *   ① 「목표 수익률(IRR)」을 **신용축 → 채널축**으로 옮겼다. 목업은 신용등급별 IRR(1.9/4.3/8.4%)이었으나
 *      그 뒤 사장님이 「수익률 10% 공통」으로 정하셨고(설계서 §2·§10), 신용 위험은 IRR 이 아니라
 *      **손바뀜 위험원가**(계약 유지율 고신용97·중신용75·저신용30%, 2026-09-05)로 잡는 것으로 엔진이 짜여 있다.
 *      그래서 신용축 자리에는 그 «계약 유지율»을 세웠다. ⇒ 되돌리려면 엔진부터 바꿔야 한다.
 *   ② 잔존가 표를 **읽기 전용**으로 뒀다. 잔가는 차종델타 파일(`data/residual-delta.json` 235건)이
 *      원천이라 브라우저에서 못 고친다. 입력칸을 두면 「고쳤는데 안 바뀐다」가 된다.
 *      건별 조정은 견적 화면 STEP 4 에서 한다.
 *   ③ 엔진이 아직 안 쓰는 칸(탁송료·상품화비·정기검사비·간접비·대손·페이백)은 «미반영»이라 적어 뒀다.
 *      지우지 않는다 — 지우면 다음에 또 만든다. 자세한 사정은 `cost-settings.ts` 머리말.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import '@/components/estimate/estimate.css';
import '@/components/estimate/cost.css';
import { COST_DEFAULTS, loadCostSettings, saveCostSettings, type CostSettings } from '@/lib/domain/estimate/cost-settings';
import { STANDARD, residDelta } from '@/lib/domain/estimate/residual-lookup.js';
import DELTA from '@/lib/domain/estimate/data/residual-delta.json';

const CHANNELS = [{ v: 'rent', label: '렌트' }, { v: 'sub', label: '구독' }] as const;
const CREDITS = [{ v: '정상', label: '정상신용' }, { v: '중신용', label: '중신용' }, { v: '저신용', label: '저신용' }] as const;
const MASTERS = [{ v: 'new', label: '신차마스터' }, { v: 'used', label: '중고마스터' }] as const;
/** 계약 유지율 — `turnover-cost.js` 의 RETENTION 과 같은 값. 손바뀜 위험원가의 근거다. */
const RETENTION: Record<string, number> = { 정상: 97, 중신용: 75, 저신용: 30 };
const YEARS = [1, 2, 3, 4, 5];

const num = (v: string) => Number(String(v).replace(/[^\d.]/g, '')) || 0;
const comma = (n: number) => (n || 0).toLocaleString('ko-KR');
const clamp = (v: number) => Math.max(5, Math.min(98, v));
const STD = STANDARD as Record<number, number>;

const VEHICLES = Object.entries(DELTA as Record<string, { maker: string; model: string; seg: string; delta: number }>)
  .map(([id, v]) => ({ id, name: `${v.maker} ${v.model}`, seg: v.seg }))
  .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

/** 견적 `.pin` — 숫자 한 칸. `w` = 금액용 넓은 칸. */
function Pin({ value, unit, w, onChange, disabled }: {
  value: string | number; unit?: string; w?: boolean; onChange?: (v: string) => void; disabled?: boolean;
}) {
  return (
    <span className={w ? 'pin w' : 'pin'}>
      <input value={value} disabled={disabled} inputMode="decimal" onChange={(e) => onChange?.(e.target.value)} />
      {unit ? <i>{unit}</i> : null}
    </span>
  );
}

/** 원가 한 줄 — 이름(설명) · 축 뱃지 · 값. */
function ORow({ label, hint, axis, first, children }: {
  label: string; hint?: string; axis?: 'ch' | 'cr'; first?: boolean; children: React.ReactNode;
}) {
  return (
    <div className={first ? 'orow first' : 'orow'}>
      <span className="ol">{label}{hint ? <em>{hint}</em> : null}</span>
      {axis ? <span className={`ax ${axis}`}>{axis === 'ch' ? '채널' : '신용'}</span> : null}
      {children}
    </div>
  );
}

/** 견적 `.seg` — 세그먼트. 견적과 같은 원자를 쓴다(치수도 같다). */
function Seg<T extends string>({ tone, opts, cur, onPick }: {
  tone: 't2' | 't3'; opts: readonly { v: T; label: string }[]; cur: T; onPick: (v: T) => void;
}) {
  return (
    <div className={`seg ${tone}`}>
      {opts.map((o) => (
        <button key={o.v} type="button" className={o.v === cur ? 'on' : ''} onClick={() => onPick(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

export default function EstimateCostPage() {
  const [cs, setCs] = useState<CostSettings>(COST_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [polCh, setPolCh] = useState<'rent' | 'sub'>('rent');
  const [polCr, setPolCr] = useState<'정상' | '중신용' | '저신용'>('정상');
  const [master, setMaster] = useState<'new' | 'used'>('new');
  const [q, setQ] = useState('');

  // 저장값은 브라우저에만 있다 → 첫 그림(SSR)과 어긋나지 않게 그린 «뒤에» 한 번만 얹는다.
  if (!loaded && typeof window !== 'undefined') { setLoaded(true); setCs(loadCostSettings()); }

  const set = (k: keyof CostSettings, v: number) => { setCs((o) => ({ ...o, [k]: v })); setDirty(true); setSaved(false); };
  const onSave = () => { if (saveCostSettings(cs)) { setDirty(false); setSaved(true); } };

  const rows = useMemo(() => {
    const s = q.trim();
    return (s ? VEHICLES.filter((v) => v.name.includes(s) || v.seg.includes(s)) : VEHICLES).slice(0, 40);
  }, [q]);

  const isRent = polCh === 'rent';

  return (
    <div className="est-root">
      <div className="phone">
        <div className="hd">
          <div className="wm"><span className="a">freepass</span><span className="b">mobility</span></div>
          <div className="modesw">
            <Link href="/estimate">견적</Link>
            <span className="on">원가</span>
          </div>
        </div>

        {/* ① 원가 정책 — 채널 × 신용 (비공통) */}
        <div className="card">
          <div className="step"><span className="no">1</span>원가 정책 · 상품별<span className="veh dim">비공통</span></div>
          <Seg tone="t2" opts={CHANNELS} cur={polCh} onPick={setPolCh} />
          <Seg tone="t3" opts={CREDITS} cur={polCr} onPick={setPolCr} />
          <div style={{ marginTop: 12 }}>
            <ORow first label="취득세율" hint="영업용 4% · 비영업용 7%" axis="ch">
              <Pin unit="%" value={isRent ? cs.acqTaxRentPct : cs.acqTaxSubPct}
                onChange={(v) => set(isRent ? 'acqTaxRentPct' : 'acqTaxSubPct', num(v))} />
            </ORow>
            <ORow label="연간 자동차보험료" axis="ch">
              {isRent ? <Pin w unit="원" value={comma(cs.insYear)} onChange={(v) => set('insYear', num(v))} />
                : <span className="na">고객 명의</span>}
            </ORow>
            <ORow label="자차충당금 적립율" axis="ch">
              {isRent ? <Pin unit="%" value={cs.selfPct} onChange={(v) => set('selfPct', num(v))} />
                : <span className="na">—</span>}
            </ORow>
            <ORow label="목표 수익률" hint="목업은 신용축이었다 · 지금은 «10% 공통 + 손바뀜»(설계서 §2·§10)" axis="ch">
              <Pin unit="%" value={isRent ? cs.marginRentPct : cs.marginSubPct}
                onChange={(v) => set(isRent ? 'marginRentPct' : 'marginSubPct', num(v))} />
            </ORow>
            <ORow label="계약 유지율" hint="손바뀜 위험원가의 근거 · 엔진 고정(2026-09-05 확정)" axis="cr">
              <Pin unit="%" value={RETENTION[polCr]} disabled />
            </ORow>
            <ORow label="영업수수료 상한" hint="엔진은 «공통» 220만 — 신용별로 갈리지 않는다" axis="cr">
              <Pin w unit="원" value="2,200,000" disabled />
            </ORow>
          </div>
          <div className="onote">이 조합만의 원가를 편집 · <b>채널</b>=렌트/구독으로 갈림 · <b>신용</b>=신용등급으로 갈림 · 신차 전용 개별소비세는 법정 자동 · 나머지는 아래 <b>공통 원가</b></div>
        </div>

        {/* ② 취득 */}
        <div className="card">
          <div className="step"><span className="no">2</span>취득 원가<span className="veh dim">자본화 → 감가</span></div>
          <ORow first label="차량 매입 할인" hint="견적 화면에서 건별로 고른다"><Pin unit="%" value={0} disabled /></ORow>
          <ORow label="개별소비세" hint="신차 5%+교육세 · 법정 자동"><Pin unit="%" value={5} disabled /></ORow>
          <ORow label="공채율"><Pin unit="%" value={cs.bondPct} onChange={(v) => set('bondPct', num(v))} /></ORow>
          <ORow label="등록비" hint="번호판·인지·대행"><Pin w unit="원" value={comma(cs.regFee)} onChange={(v) => set('regFee', num(v))} /></ORow>
          <ORow label="1차 탁송료" hint="미반영 — 간접비로 봄(2026-09-05)"><Pin w unit="원" value={comma(cs.deliveryFee)} onChange={(v) => set('deliveryFee', num(v))} /></ORow>
          <ORow label="초기 상품화비" hint="미반영 · 정비·클리닝·GPS설치"><Pin w unit="원" value={comma(cs.initPrepFee)} onChange={(v) => set('initPrepFee', num(v))} /></ORow>
        </div>

        {/* ③ 금융 */}
        <div className="card">
          <div className="step"><span className="no">3</span>금융<span className="veh dim">차 살 돈 조달</span></div>
          <ORow first label="조달금리" hint="연"><Pin unit="%" value={cs.interestPct} onChange={(v) => set('interestPct', num(v))} /></ORow>
          <ORow label="대출 비율" hint="취득원가 대비"><Pin unit="%" value={cs.loanPct} onChange={(v) => set('loanPct', num(v))} /></ORow>
        </div>

        {/* ④ 직접 운영비 */}
        <div className="card">
          <div className="step"><span className="no">4</span>직접 운영비<span className="veh dim">매출원가 · 기간 누적</span></div>
          <ORow first label="자동차세" hint="cc단가 · 법정 자동"><span className="na">자동</span></ORow>
          <ORow label="정비비"><Pin w unit="원/월" value={comma(cs.maintMonthly)} onChange={(v) => set('maintMonthly', num(v))} /></ORow>
          <ORow label="GPS·관제"><Pin w unit="원/월" value={comma(cs.gpsMonthly)} onChange={(v) => set('gpsMonthly', num(v))} /></ORow>
          <ORow label="주차장·관리"><Pin w unit="원/월" value={comma(cs.parkingMonthly)} onChange={(v) => set('parkingMonthly', num(v))} /></ORow>
          <ORow label="정기검사비" hint="미반영 · 3년차~"><Pin w unit="원/년" value={comma(cs.inspectionFee)} onChange={(v) => set('inspectionFee', num(v))} /></ORow>
        </div>

        {/* ⑤ 판관비·수수료 */}
        <div className="card">
          <div className="step"><span className="no">5</span>판매관리비 · 수수료<span className="veh dim">SG&amp;A · 공통</span></div>
          <ORow first label="영업수수료율 기본값" hint="견적서 영업자가 조정"><Pin unit="%" value={cs.salesFeePct} onChange={(v) => set('salesFeePct', num(v))} /></ORow>
          <ORow label="일반관리·간접비 배분율" hint="미반영 — 엔진은 직접비·수수료로 다 잡는다"><Pin unit="%" value={cs.overheadPct} onChange={(v) => set('overheadPct', num(v))} /></ORow>
          <ORow label="대손·리스크 충당" hint="미반영 — 신용 위험은 손바뀜 원가로 잡는다"><Pin unit="%" value={cs.badDebtPct} onChange={(v) => set('badDebtPct', num(v))} /></ORow>
          <ORow label="페이백 테이블" hint="미반영 · 0.5% 단위 · 0%→70만 … 5%→0"><span className="na">준비 중</span></ORow>
        </div>

        {/* ⑥ 잔존가 — 차종별 (읽기 전용) */}
        <div className="card">
          <div className="step"><span className="no">6</span>잔존가 · 차종별<span className="veh dim">차량별</span></div>
          <Seg tone="t3" opts={MASTERS} cur={master} onPick={setMaster} />
          <div className="vsearch">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
            <input placeholder="차종 검색 (제조사·모델)" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {master === 'new' ? (
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table className="rtb">
                <thead><tr><th style={{ textAlign: 'left', paddingLeft: 9 }}>차종</th>{YEARS.map((y) => <th key={y}>{y}년</th>)}</tr></thead>
                <tbody>
                  {rows.map((v) => {
                    const [makerId, code] = v.id.split('/');
                    const d = residDelta(makerId, code);
                    return (
                      <tr key={v.id}>
                        <td className="vn">{v.name}<span> · {v.seg}</span></td>
                        {YEARS.map((y) => <td key={y}>{clamp(STD[y] + d)}<i>%</i></td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="byrow"><b>중고마스터</b>는 아직 안 붙었다 — 중고 잔가는 같은 곡선을 «현재 연식 대비»로 환산해 견적이 자동으로 낸다</div>
          )}
          <div className="byrow"><b>리스트에 없는 차량</b>은 견적 화면 STEP 4 에서 잔존가를 건별 입력</div>
          <div className="onote">국산 <b>표준 잔가 곡선</b>({YEARS.map((y) => `${y}년 ${STD[y]}%`).join(' · ')})에 차종별 델타(±%p)를 얹은 값 · 등록 {VEHICLES.length}건 · 보정: 주행 −2%p/만km · 사고 · 노후 · <b>여기서는 못 고친다</b></div>
        </div>

        <div className="basis">
          <span className="bi">원가 기준</span>
          <span className="bt">
            여기서 정한 값이 <b>견적 화면에 그대로</b> 들어간다 · 법정값(개별소비세·자동차세·부가세)은 자동 계산이라 못 고친다 ·
            잔존가만 마스터/건별로 갈린다
          </span>
        </div>

        <div className="savebar">
          <button type="button" onClick={onSave} disabled={!dirty}>{saved ? '저장됨' : '저장'}</button>
        </div>

        <div className="foot">
          딱 한 번 세팅하면 <b>모든 견적에 자동 적용</b>된다.
          저장은 <b>이 브라우저</b>에만 남는다 — 회사 공용 저장은 저장소·보안규칙을 정한 뒤에 붙인다.
        </div>
      </div>
    </div>
  );
}
