/**
 * **그 줄이 «얼마인가» — 청구·지급을 세는 한 함수.**
 *
 * ★★★사장님 2026-09-04 「아니야 **무보증 수수료**라는거 같은데?」 · 「아직 청구 다 안했어 이제 하면 되는거야」
 *
 * ★★**무보증 수수료가 통째로 새고 있었다.**
 *   원자에 `claimIncentive`·`payIncentive`(공급사·에이전시 인센티브) 칸이 있는데
 *   **발행기도 청구서도 그 칸을 읽지 않았다.** 정의만 있고 쓰는 곳이 0 이었다.
 * ```
 * 전례 17하3915  천설 · 스위치 · 하허호 · 보증금 0(무보증)
 *   청구 1,092,000 = 700,000 × 48 × 3.25%   ← 사다리 그대로
 *   청구인센 300,000 · 지급인센 300,000      ← 무보증 수수료가 «따로» 붙어 있는데 안 실렸다
 * ```
 *   ⇒ 무보증 건은 사다리 수수료를 «건드리지 않고» 인센티브가 따로 붙는다.
 *     그 칸을 안 더하면 그만큼이 청구서에서 사라진다.
 *
 * ★★★**여기가 «판정은 한 곳»이다.** 2026-09-04 실측 — 같은 셈을 일곱 군데가 각자 하고 있었다
 *   (정산서·월 탭·공급사시트·채널시트·검산기 셋). 한 곳만 고치면 나머지가 옛 값을 낸다.
 *   ⇒ 돈을 세는 곳은 전부 이 함수를 부른다. CLAUDE.md 「대수는 한 곳에서 센다」.
 *
 * 규칙 — 순서가 곧 규칙이다.
 * ```
 * ① 제외(settleExclude)      청구·지급 둘 다 0
 * ② 정산 대상(settleTarget)   「공급」이면 지급 0 · 「영업」이면 청구 0
 * ③ 청구보류(billHold)        청구만 0 (지급은 나간다)
 * ④ 비율(settleRatio)         분납·부러진 회차 — 사다리와 인센티브에 «똑같이» 건다
 * ⑤ 인센티브                  사다리 수수료에 «더한다» (무보증 수수료 등)
 * ```
 * ★**부가세 가르기도 «여기»다** — `invoiceMoneyOf`.
 *   ⚠ 2026-09-09 까지는 「부가세는 부르는 쪽이 나눈다」였다. 그랬더니 계산서 발행기와 사슬 검사가
 *     **같은 나눗셈을 각자** 하다가 총합이 1원 갈렸다(줄마다 반올림 vs 총액에 곱하기).
 *     한 원이라도 갈리면 「총 합이 맞아야 함」(사장님 2026-09-09)이 깨진다.
 *   ⇒ 가르는 자리를 하나로 둔다. **줄마다 가르고, 그 다음에 더한다** — 순서가 곧 값이다.
 */
import { settleTargetOf, VAT } from './settlement-stage';

const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => { const n = Number(S(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : 0; };

/** 돈을 셀 때 보는 칸들 — 원자든 시트 줄이든 이 모양이면 된다. */
export type MoneyRow = {
  claimWritten?: unknown; payWritten?: unknown;
  claimIncentive?: unknown; payIncentive?: unknown;
  settleTarget?: unknown; settleRatio?: unknown; settleExclude?: unknown; billHold?: unknown;
};

/** 공급사에서 «받을» 것. 부가세 별도(그 줄이 VAT 포함이면 부르는 쪽이 나눈다). */
export function claimOf(r: MoneyRow): number {
  if (r.settleExclude === true) return 0;
  if (settleTargetOf(r.settleTarget) === '영업') return 0;
  if (r.billHold === true) return 0;
  const ratio = N(r.settleRatio) || 1;
  return Math.round((N(r.claimWritten) + N(r.claimIncentive)) * ratio);
}

/** 영업채널에 «줄» 것. */
export function payOf(r: MoneyRow): number {
  if (r.settleExclude === true) return 0;
  if (settleTargetOf(r.settleTarget) === '공급') return 0;
  const ratio = N(r.settleRatio) || 1;
  return Math.round((N(r.payWritten) + N(r.payIncentive)) * ratio);
}

/**
 * **사다리 수수료만** — 인센티브를 뺀 값. 요율표와 맞대 볼 때 쓴다.
 * ★검산기는 이것으로 견줘야 한다 — 인센티브까지 넣고 견주면 무보증 건이 매달 「표와 다르다」로 뜬다.
 */
export const claimBaseOf = (r: MoneyRow): number => {
  if (r.settleExclude === true || settleTargetOf(r.settleTarget) === '영업' || r.billHold === true) return 0;
  return Math.round(N(r.claimWritten) * (N(r.settleRatio) || 1));
};
export const payBaseOf = (r: MoneyRow): number => {
  if (r.settleExclude === true || settleTargetOf(r.settleTarget) === '공급') return 0;
  return Math.round(N(r.payWritten) * (N(r.settleRatio) || 1));
};

/** 그 줄이 «부가세 포함»으로 적혔나까지 보는 모양 — 계산서를 끊을 때 쓴다. */
export type InvoiceRow = MoneyRow & { vatIncluded?: unknown };

/**
 * **계산서 한 줄 — 공급가액·부가세·합계.**
 *
 * ★`vatIncluded` 는 «적힌 값이 VAT 포함인가»를 말한다.
 *   포함이면 1.1 로 «나눠» 공급가액을 얻고(부가세는 뺀 나머지 — 합이 원래 값과 어긋나지 않게),
 *   아니면 적힌 값이 공급가액이고 부가세를 «붙인다».
 * ⚠ **여러 줄을 셀 때는 줄마다 이 함수를 부르고 그 결과를 더한다.**
 *   총액을 먼저 더하고 나중에 1.1 을 걸면 반올림이 한 번만 일어나 1원씩 어긋난다.
 */
export function invoiceMoneyOf(r: InvoiceRow): { net: number; vat: number; total: number } {
  const raw = claimOf(r);
  const gross = r.vatIncluded === true;
  const net = gross ? Math.round(raw / (1 + VAT)) : raw;
  const vat = gross ? raw - net : Math.round(net * VAT);
  return { net, vat, total: net + vat };
}

/** 환수 한 줄 — 계산서에서 «빼는» 몫. 공급가액으로 적힌 값에 부가세를 붙여 뺀다. */
export const clawMoneyOf = (amount: number) => ({ net: amount, vat: Math.round(amount * VAT) });

/** 그 줄에 «따로 붙은» 수수료가 있나 — 산출근거에 적어 줘야 상대가 묻지 않는다. */
export const incentiveOf = (r: MoneyRow) => ({
  claim: Math.round(N(r.claimIncentive) * (N(r.settleRatio) || 1)),
  pay: Math.round(N(r.payIncentive) * (N(r.settleRatio) || 1)),
});
