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
 *   화면과 엔진이 «같은 숫자»를 보게 한다.
 * ★저장은 **회사 공용**이다(2026-09-06) — `/api/estimate/cost` · Firestore `settings/estimate_cost`.
 *   읽기는 로그인한 모두, **쓰기는 관리자만**. 비관리자에게는 저장 바를 아예 안 준다.
 *   첫 그림은 브라우저 «캐시»로 즉시 그리고 곧바로 회사 값으로 덮는다 — 캐시는 저장소가 아니라 캐시다.
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
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import EstimateGate from '@/features/estimate/EstimateGate';
import '@/components/estimate/estimate.css';
import '@/components/estimate/cost.css';
import { unsetFees, type CostSettings } from '@/lib/domain/estimate/cost-settings';
import { cachedCost, fetchSharedCost, saveSharedCost } from '@/lib/domain/estimate/cost-client';
import { STANDARD, residDelta } from '@/lib/domain/estimate/residual-lookup.js';
import DELTA from '@/lib/domain/estimate/data/residual-delta.json';

const CHANNELS = [{ v: 'rent', label: '렌트' }, { v: 'sub', label: '구독' }] as const;
const CREDITS = [{ v: '정상', label: '정상신용' }, { v: '중신용', label: '중신용' }, { v: '저신용', label: '저신용' }] as const;
const MASTERS = [{ v: 'new', label: '신차마스터' }, { v: 'used', label: '중고마스터' }] as const;
/**
 * 신용등급 → «반납률(계약 유지율)» 칸.
 * ★2026-09-06 부터 **입력값**이다(그전엔 엔진 상수를 읽기전용으로 보여 줬다).
 *   사장님 「저신용·중신용·고신용 각자 **회사마다** 그 반납률을 얼마로 할 거냐 — 다 입력할 수 있게끔」.
 */
const RET_KEY: Record<string, 'retentionNormalPct' | 'retentionMidPct' | 'retentionLowPct'> = {
  정상: 'retentionNormalPct', 중신용: 'retentionMidPct', 저신용: 'retentionLowPct',
};
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

/** ★문지기(`EstimateGate`)가 관리자·공급사만 들여보낸다 — 메뉴에서 숨기는 것만으로는 막은 게 아니다. */
export default function EstimateCostPagePage() {
  return <EstimateGate><EstimateCostPageInner /></EstimateGate>;
}

function EstimateCostPageInner() {
  const [cs, setCs] = useState<CostSettings>(() => cachedCost());
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  /** 회사 값을 받았나 · 내가 고칠 수 있나(관리자만) · 언제 정해졌나. */
  const [shared, setShared] = useState<{ fromServer: boolean; canEdit: boolean; updatedAt?: string | null }>({ fromServer: false, canEdit: false });
  const [msg, setMsg] = useState<string | null>(null);
  const [polCh, setPolCh] = useState<'rent' | 'sub'>('rent');
  const [polCr, setPolCr] = useState<'정상' | '중신용' | '저신용'>('정상');
  const [master, setMaster] = useState<'new' | 'used'>('new');
  const [q, setQ] = useState('');

  // 회사 값을 받아 덮는다. 첫 그림은 캐시로 이미 서 있다.
  useEffect(() => {
    let alive = true;
    fetchSharedCost().then((r) => {
      if (!alive) return;
      setCs(r.cost);
      setShared({ fromServer: r.fromServer, canEdit: !!r.canEdit, updatedAt: r.updatedAt });
      if (r.stale?.length) setMsg(`저장된 값 중 규격을 벗어난 칸이 있어 기본값으로 보여 줍니다 — ${r.stale.join(', ')}`);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const set = (k: keyof CostSettings, v: number) => { setCs((o) => ({ ...o, [k]: v })); setDirty(true); setSaved(false); setMsg(null); };
  const onSave = async () => {
    const r = await saveSharedCost(cs);
    if (r.ok) { setDirty(false); setSaved(true); setShared((x) => ({ ...x, fromServer: true, updatedAt: r.updatedAt })); setMsg(null); return; }
    // 실패를 «저장됨»으로 삼키지 않는다 — 안 저장됐는데 저장된 줄 알면 다음 견적이 옛 원가로 나간다.
    setMsg(r.reason === 'forbidden' ? '원가는 관리자만 저장할 수 있습니다.'
      : r.reason === 'range' ? `값이 범위를 벗어났습니다 — ${(r.fields ?? []).join(', ')}`
        : '저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
  };

  const rows = useMemo(() => {
    const s = q.trim();
    return (s ? VEHICLES.filter((v) => v.name.includes(s) || v.seg.includes(s)) : VEHICLES).slice(0, 40);
  }, [q]);

  const isRent = polCh === 'rent';
  /** 값이 0 이라 원가에 안 잡히는 실비 — 화면이 「아직 안 정했다」고 말한다. */
  const missing = useMemo(() => unsetFees(cs), [cs]);

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

        {/* ★비어 있는 실비를 «말한다» — 0 이라 원가에 안 잡히는 칸이 있으면 그 견적은 표준이 아니다.
            사장님 2026-09-06 「공통으로 들어가는 부분 중 얼마인지 모르는 부분들을 쭉 만들어 놓고
            표준 비용을 넣어서 표준 견적을 제시해 주는 거야」. */}
        {missing.length > 0 ? (
          <div className="byrow" style={{ margin: '10px 12px 0' }}>
            <b>아직 안 정한 실비 {missing.length}개</b> — {missing.map((f) => f.label).join(' · ')}
            <br />값이 0 이라 원가에 안 잡힌다. 채워야 «표준 견적»이 된다.
          </div>
        ) : null}

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
            <ORow label="연간 자동차보험료" hint="대인·대물·자손 · 구독은 보통 고객 명의라 0" axis="ch">
              <Pin w unit="원" value={comma(isRent ? cs.insRentYear : cs.insSubYear)}
                onChange={(v) => set(isRent ? 'insRentYear' : 'insSubYear', num(v))} />
            </ORow>
            {/* 자차는 길이 둘이다 — 자체 충당(차량가 ×%/년)과 자차보험 가입(정액 원/년). 둘 다 넣으면 더해진다. */}
            <ORow label="자차 · 자체 충당" hint="차량가 대비 연 % · 실무 1~2%(보험사 자차요율과 비슷한 자리)" axis="ch">
              <Pin unit="%" value={isRent ? cs.selfRentPct : cs.selfSubPct}
                onChange={(v) => set(isRent ? 'selfRentPct' : 'selfSubPct', num(v))} />
            </ORow>
            <ORow label="자차 · 보험 가입" hint="자차를 보험으로 드는 경우 · 연 정액 · 0 이면 안 드는 것" axis="ch">
              <Pin w unit="원" value={comma(isRent ? cs.selfInsRentYear : cs.selfInsSubYear)}
                onChange={(v) => set(isRent ? 'selfInsRentYear' : 'selfInsSubYear', num(v))} />
            </ORow>
            <ORow label="목표 수익률" hint="목업은 신용축이었다 · 지금은 «10% 공통 + 손바뀜»(설계서 §2·§10)" axis="ch">
              <Pin unit="%" value={isRent ? cs.marginRentPct : cs.marginSubPct}
                onChange={(v) => set(isRent ? 'marginRentPct' : 'marginSubPct', num(v))} />
            </ORow>

            <ORow label="반납률 (계약 유지율)" hint="낮을수록 손바뀜이 잦아 위험원가가 커진다 · 회사마다 다르다" axis="cr">
              <Pin unit="%" value={RET_KEY[polCr] === 'retentionNormalPct' ? cs.retentionNormalPct
                : RET_KEY[polCr] === 'retentionMidPct' ? cs.retentionMidPct : cs.retentionLowPct}
                onChange={(v) => set(RET_KEY[polCr], num(v))} />
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
          <ORow label="차량가 업금액 · 중고" hint="매입가에 얹어 «취득원가»를 만든다 — 감가·이자·수수료가 다 이 값 위에서 돈다">
            <Pin unit="%" value={cs.markupUsedPct} onChange={(v) => set('markupUsedPct', num(v))} />
          </ORow>
          <ORow label="차량가 업금액 · 신차" hint="출고가(제조사 공표가)라 기본 0 — 얹을 자리가 없다">
            <Pin unit="%" value={cs.markupNewPct} onChange={(v) => set('markupNewPct', num(v))} />
          </ORow>
          <ORow label="공채율"><Pin unit="%" value={cs.bondPct} onChange={(v) => set('bondPct', num(v))} /></ORow>
          <ORow label="등록비" hint="번호판·인지·대행"><Pin w unit="원" value={comma(cs.regFee)} onChange={(v) => set('regFee', num(v))} /></ORow>
          <ORow label="1차 탁송료" hint="넣으면 원가에 그대로 더해진다 · 0 이면 없던 것"><Pin w unit="원" value={comma(cs.deliveryFee)} onChange={(v) => set('deliveryFee', num(v))} /></ORow>
          <ORow label="초기 상품화비" hint="정비·클리닝·GPS설치 · 0 이면 없던 것"><Pin w unit="원" value={comma(cs.initPrepFee)} onChange={(v) => set('initPrepFee', num(v))} /></ORow>
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
          <ORow label="정기검사비" hint="3년차부터 해마다 · 0 이면 없던 것"><Pin w unit="원/년" value={comma(cs.inspectionFee)} onChange={(v) => set('inspectionFee', num(v))} /></ORow>
          <ORow label="EW 연장보증" hint="렌트 반납형만"><Pin w unit="원/년" value={comma(cs.ewYear)} onChange={(v) => set('ewYear', num(v))} /></ORow>
        </div>

        {/* ⑤ 판관비·수수료 */}
        <div className="card">
          <div className="step"><span className="no">5</span>판매관리비 · 수수료<span className="veh dim">SG&amp;A · 공통</span></div>
          <ORow first label="영업수수료율 기본값" hint="견적서 영업자가 조정"><Pin unit="%" value={cs.salesFeePct} onChange={(v) => set('salesFeePct', num(v))} /></ORow>
          <ORow label="일반관리·간접비 배분율" hint="직접원가에 비율로 얹는다 · 0 이면 안 넣는 것"><Pin unit="%" value={cs.overheadPct} onChange={(v) => set('overheadPct', num(v))} /></ORow>
          <ORow label="대손·리스크 충당" hint="직접원가에 비율로 얹는다 · 신용 위험은 아래 손바뀜에서 따로 잡는다"><Pin unit="%" value={cs.badDebtPct} onChange={(v) => set('badDebtPct', num(v))} /></ORow>
        </div>

        {/* ⑥ 손바뀜 회당 비용 — 반납률과 짝이다. 반납률이 «몇 번»이고 여기가 «한 번에 얼마»다. */}
        <div className="card">
          <div className="step"><span className="no">6</span>손바뀜 회당 비용<span className="veh dim">반납률과 짝</span></div>
          <ORow first label="상품화비" hint="회수 뒤 재정비·클리닝"><Pin w unit="원" value={comma(cs.turnoverPrepFee)} onChange={(v) => set('turnoverPrepFee', num(v))} /></ORow>
          <ORow label="왕복 탁송료" hint="회수 + 재배치"><Pin w unit="원" value={comma(cs.turnoverDeliveryFee)} onChange={(v) => set('turnoverDeliveryFee', num(v))} /></ORow>
          <ORow label="영업수수료 재지급" hint="손바뀜마다 다시 나간다 · 총 대여료 대비"><Pin unit="%" value={cs.turnoverFeePct} onChange={(v) => set('turnoverFeePct', num(v))} /></ORow>
          <ORow label="휴차 공실" hint="재계약까지 비는 기간"><Pin unit="개월" value={cs.turnoverVacancyMonths} onChange={(v) => set('turnoverVacancyMonths', num(v))} /></ORow>
          <div className="onote">
            손바뀜 횟수 = <b>1 ÷ 반납률 − 1</b>. 반납률 30%면 4년에 약 2.33회, 75%면 0.33회다.
            회당 비용 × 횟수가 원가에 들어간다 — <b>마진이 아니라 원가</b>다.
          </div>
        </div>

        {/* ⑥ 잔존가 — 차종별 (읽기 전용) */}
        <div className="card">
          <div className="step"><span className="no">7</span>잔존가 · 차종별<span className="veh dim">차량별</span></div>
          <ORow first label="잔가 가감" hint="곡선 전체를 올리거나 내린다 — 「이익률 말고 잔가로 조정」하는 손잡이">
            <Pin unit="%p" value={cs.residualAdjustPct} onChange={(v) => set('residualAdjustPct', num(v) * (String(v).trim().startsWith('-') ? -1 : 1))} />
          </ORow>
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

        {msg ? <div className="byrow" style={{ margin: '12px 12px 0' }}>{msg}</div> : null}

        {shared.canEdit ? (
          <div className="savebar">
            <button type="button" onClick={onSave} disabled={!dirty}>{saved ? '저장됨' : '회사 원가로 저장'}</button>
          </div>
        ) : null}

        <div className="foot">
          딱 한 번 세팅하면 <b>모든 견적에 자동 적용</b>된다.
          {shared.canEdit
            ? <> 저장하면 <b>회사 전체</b>가 이 값으로 견적한다.</>
            : <> 원가는 <b>관리자만</b> 정한다 — 여기서는 지금 값이 무엇인지 보기만 한다.</>}
          <br />
          {shared.fromServer
            ? <>지금 보이는 값 = <b>회사 원가</b>{shared.updatedAt ? ` · ${shared.updatedAt.slice(0, 10)} 갱신` : ''}</>
            : <>아직 <b>회사 원가가 정해지지 않았다</b> — 지금은 엔진 기본값이다.</>}
        </div>
      </div>
    </div>
  );
}
