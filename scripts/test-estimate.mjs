// ★손오공 견적기(`C:\dev\sonogong-estimator`)에서 **무손실 이관**한 엔진의 회귀 —
//   node scripts/test-estimate.mjs  (npm run test:estimate)
//
//   견적기는 freepasserp.com 산하 페이지로 들어온다(설계서 §11, 사장님 2026-09-06).
//   엔진(lib/domain/estimate)은 프레임워크에 안 묶여 있어 «그대로» 옮겼다 —
//   그래서 옮긴 뒤에도 이 39개가 통과해야 «숫자가 안 바뀌었다»가 증명된다.
//   ⚠ 이 파일과 lib/domain/estimate/* 를 고칠 때는 원본(sonogong-estimator)과 «같이» 본다.
//     둘이 갈리면 견적 금액이 두 곳에서 달라진다 — 화면 12px 이 아니라 손님에게 나가는 값이다.
// 손오공 렌트·구독 견적기 (신버전 v1) 정확 대조 회귀 — node scripts/test-calc.mjs
//   엑셀 "손오공 렌트,구독 견적기 (version 1).xlsx" 고객 견적서 셀값 1:1
//   차량: 그랜저 2.5 / 차량가 30,000,000 / cc 2500 / 가솔린 / A군 / 선납0 / 보증금10%
//   마크업 flat +150만 → 차량가합계 31,500,000
//   대여료(VAT) = 원가소계 ÷ 개월 × (1+수익률0.2) × (1+VAT0.1) − 선납월
//   고객표기: 구독 = ROUNDUP(천원) / 렌트 = 원값
import { computeTerm } from '../lib/domain/estimate/calc.js';
import { safeComputeTerm } from '../lib/domain/estimate/safe-calc.js';
import { createQuoteInput, defaultResidualGroup } from '../lib/domain/estimate/quote-input.js';

let pass = 0, fail = 0;
const ok = (label, cond) => { console.log(`${cond ? '✓' : '✗'} ${label}`); cond ? pass++ : fail++; };
const eq = (label, got, want) => ok(`${label}: ${Math.round(got).toLocaleString()} = ${want.toLocaleString()}`, Math.round(got) === want);
const near = (label, got, want, tol = 1) => ok(`${label}: ${Math.round(got).toLocaleString()} ≈ ${want.toLocaleString()}`, Math.abs(Math.round(got) - want) <= tol);

// A군 잔존율 (엑셀 J열: 0.75/0.65/0.55/0.45)
const RES_A = { 24: { A: 0.75 }, 36: { A: 0.65 }, 48: { A: 0.55 }, 60: { A: 0.45 } };
const car = { price: 30000000, cc: 2500, group: 'A', fuel: 'gasoline', prepay: 0, residualTable: RES_A };

// ── 렌트 반납형 (ROUNDUP 천원 — 2026-06-12 팀장 요청, 구독과 동일) ──
//   원값 869,336/794,786/757,511/717,505 → 천원올림
const rentRet = { ...car, channel: 'rent', type: 'return' };
[[24, 932000], [36, 831000], [48, 781000], [60, 733000]].forEach(([t, w]) =>
  eq(`렌트 반납 ${t / 12}년`, computeTerm(t, rentRet).payVat, w));

// ── 구독 반납형 (구독견적서_고객 ROUNDUP(D35,-3)) ──
const subRet = { ...car, channel: 'sub', type: 'return' };
[[24, 912000], [36, 796000], [48, 737000], [60, 685000]].forEach(([t, w]) =>
  eq(`구독 반납 ${t / 12}년`, computeTerm(t, subRet).payVat, w));

// ── 렌트 인수형 (정상 원가 + ROUNDUP) ──
// 구 엑셀의 24/36/48개월 열은 취득세를 원가에서 다시 빼는 셀 오류가 있었다.
// 견적기는 취득세를 정상 원가로 포함하며, 60개월과 동일한 계산 구조를 사용한다.
const rentAcq = { ...car, channel: 'rent', type: 'acquire' };
[[24, 2098000], [36, 1468000], [48, 1153000], [60, 965000]].forEach(([t, w]) =>
  eq(`렌트 인수 ${t / 12}년`, computeTerm(t, rentAcq).payVat, w));

// ── 구독 인수형 (구독_인수형 ROUNDUP(D35,-3)) ──
const subAcq = { ...car, channel: 'sub', type: 'acquire' };
[[24, 2080000], [36, 1435000], [48, 1112000], [60, 919000]].forEach(([t, w]) =>
  eq(`구독 인수 ${t / 12}년`, computeTerm(t, subAcq).payVat, w));

// ── 구조 검증 ──
ok('이자 4년캡 (4년=5년 동일)', Math.round(computeTerm(48, subRet).cost.interest) === Math.round(computeTerm(60, subRet).cost.interest));
ok('이자 약정비례 (2년 = 4년 ÷ 2)', Math.abs(computeTerm(24, subRet).cost.interest - computeTerm(48, subRet).cost.interest / 2) < 2);
ok('렌트 보험·EW 반영 / 구독 미반영', computeTerm(48, rentRet).cost.insurance > 0 && computeTerm(48, rentRet).cost.ew > 0 && computeTerm(48, subRet).cost.insurance === 0 && computeTerm(48, subRet).cost.ew === 0);
ok('영업수당 = 차량가합계×4% (상한220)', Math.round(computeTerm(24, subRet).cost.salesFee) === 1260000);
const bTable = { 24: { B: 0.70 }, 36: { B: 0.60 }, 48: { B: 0.50 }, 60: { B: 0.40 } };
const customRates = { 24: 0.68, 36: 0.57, 48: 0.46, 60: 0.35 };
ok('기본 잔가표 B군 반영', computeTerm(24, { ...subRet, group: 'B', residualTable: bTable }).residualRate === 0.70);
ok('차량별 잔가율이 등급표보다 우선', computeTerm(24, { ...subRet, group: 'B', residualTable: bTable, residualRates: customRates }).residualRate === 0.68);
const customAcquire = computeTerm(24, { ...subAcq, acquireResidualRate: 0.15 });
ok('인수형 관리자 잔가율 반영', Math.abs(customAcquire.residualAmt - subAcq.price * 0.15) < 1);
const rawPriceResidual = computeTerm(24, { ...subAcq, price: 23000000, acquireResidualRate: 0.10 });
ok('잔존가는 원가·마크업과 분리해 실제 차량가격 기준', rawPriceResidual.residualAmt === 2300000 && rawPriceResidual.residualRate === 0.10);
const rawPriceReturnResidual = computeTerm(24, { ...subRet, price: 23000000, residualRates: { 24: 0.70 } });
ok('반납형 잔존가도 실제 차량가격 기준', Math.abs(rawPriceReturnResidual.residualAmt - 16100000) < 1);
const maint5 = computeTerm(24, { ...rentRet, maintMonthly: 5000 });
const maint10 = computeTerm(24, { ...rentRet, maintMonthly: 10000 });
ok('관리자 정비비가 실제 원가에 반영', Math.round(maint10.cost.maint - maint5.cost.maint) === 120000 && maint10.payVat > maint5.payVat);
// 등록비(프리패스 추가분) — 기본 0(엑셀 정합), 설정 시 원가에 1회성으로 반영. 공채(bond)와 별도.
const regOff = computeTerm(24, rentRet);
const regOn = computeTerm(24, { ...rentRet, regFee: 150000 });
ok('등록비 기본 0 (엑셀 회귀 불변)', Math.round(regOff.cost.regFee) === 0);
ok('등록비 설정 시 원가 반영·월납↑ (공채와 별도)', Math.round(regOn.cost.regFee) === 150000 && regOn.cost.bond === regOff.cost.bond && regOn.payVat > regOff.payVat);
// 손바뀜 위험원가 — 신용등급 지정 시 반납형 원가에 가산. 등급 없으면 0(엑셀 회귀 불변).
const tovNone = computeTerm(48, rentRet);
const tovMid = computeTerm(48, { ...rentRet, credit: '중신용' });
const tovLow = computeTerm(48, { ...rentRet, credit: '저신용' });
ok('신용등급 없으면 손바뀜 0 (엑셀 회귀 불변)', tovNone.turnover === 0 && tovNone.payVat === computeTerm(48, rentRet).payVat);
ok('저신용 손바뀜 > 중신용 > 0, 월납도 그 순서', tovLow.turnover > tovMid.turnover && tovMid.turnover > 0 && tovLow.payVat > tovMid.payVat && tovMid.payVat > tovNone.payVat);
ok('인수형은 손바뀜 없음(고객이 차 보유)', computeTerm(48, { ...rentAcq, credit: '저신용' }).turnover === 0);
ok('계산 가드가 월납 외 NaN도 차단', safeComputeTerm(24, { ...subRet, residualRates: { 24: Number.NaN } }).calcError === true);
const makers = [{ id: 'hyundai', origin: 'domestic' }, { id: 'bmw', origin: 'import' }];
ok('잔가 기본군 규격 — 국산 B / 수입 C', defaultResidualGroup(makers, 'hyundai', 3) === 'B' && defaultResidualGroup(makers, 'bmw', 3) === 'C');
const sharedInput = createQuoteInput({
  adminCfg: { marginRate: 0.01, interestRate: 0.08, loanRatio: 0.8, setting: { maintMonthly: 12345 } },
  channel: 'rent', type: 'return', form: { price: 30000000, cc: 2500, fuel: 'gasoline', accident: 'none' },
  conditions: { depositPct: 10, prepayPct: 0 }, residual: null, defaultGroup: 'B', nowYear: 2026,
});
ok('PC·모바일 공통 입력 규격', sharedInput.group === 'B' && sharedInput.maintMonthly === 12345 && sharedInput.interestRate === 0.08);
const conditionBase = { ...subRet, residualAdjust: true, nowYear: 2026, year: 2021, mileage: 100000,
  adjust: { baselineAge: 5, kmPerYear: 20000, mileagePer10k: 0.005, agePerYear: 0.02,
    accident: { none: 1, simple: 0.97, frame: 0.90, total: 0.70 }, maxResidualCut: 0.20 } };
const conditionNormal = computeTerm(24, conditionBase);
const conditionHighKm = computeTerm(24, { ...conditionBase, mileage: 120000 });
const conditionSimple = computeTerm(24, { ...conditionBase, accident: 'simple' });
const conditionFrame = computeTerm(24, { ...conditionBase, accident: 'frame' });
ok('5년·10만km는 잔가 보정 기준점', Math.abs(conditionNormal.residualRate - 0.75) < 1e-12);
ok('초과 주행은 잔가↓·월납↑', conditionHighKm.residualRate < conditionNormal.residualRate && conditionHighKm.payVat > conditionNormal.payVat);
ok('단순수리는 잔가↓·월납↑', conditionSimple.residualRate < conditionNormal.residualRate && conditionSimple.payVat > conditionNormal.payVat);
ok('골격손상은 단순수리보다 가중', conditionFrame.residualRate < conditionSimple.residualRate && conditionFrame.payVat > conditionSimple.payVat);
const acquireConditionBase = computeTerm(24, { ...conditionBase, type: 'acquire' });
const acquireConditionFrame = computeTerm(24, { ...conditionBase, type: 'acquire', accident: 'frame' });
ok('인수형도 상태 악화 시 위험원가·월납↑', acquireConditionFrame.cost.conditionRisk > 0 && acquireConditionFrame.payVat > acquireConditionBase.payVat);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'}  (${pass} pass, ${fail} fail)`);
process.exit(fail === 0 ? 0 : 1);
