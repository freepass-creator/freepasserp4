/**
 * **한 계약이 지나온 길 — 접수 → 실적 → 청구.** 순수 함수.
 *
 * ★사장님 2026-08-26 「접수된거를 계속 물고 가야지 / 접수된거에서 실적이 되고 그 실적이 청구가 되는건데」.
 *
 * ```
 * 접수 ──▶ 계약서 ──▶ 인도 ──▶ 청구 ──▶ (분납이면) 완납
 *                              └▶ 환수      깨지면
 * ```
 * ★★**한 계약은 한 줄이다.** 시트는 탭 사이로 «줄을 옮겨» 왔지만 그건 시트 사정이지 업무가 아니다.
 *   옮기면 그 줄이 지나온 길이 끊긴다 — 어디서 왔는지 모르는 줄이 청구액을 들고 있게 된다.
 * ★★**상태는 저장하지 않고 계산한다. 대신 «언제 그렇게 됐는지»는 저장한다.**
 *   상태를 저장하면 계산값과 갈리고, 시각을 안 남기면 틀렸을 때 되짚을 근거가 없다.
 *   실측 2026-08-26 — 지금 원장에는 접수일·인도일·환수일뿐이라
 *   「계약서를 언제 켰나」·「청구서를 언제 보냈나」를 아무도 모른다.
 */

/** 길 위의 한 걸음. **지나온 것만 적는다** — 예정은 걸음이 아니다. */
export type Step = {
  key: '접수' | '계약서' | '인도' | '청구' | '완납' | '환수' | '취소';
  /** 그날. 모르면 빈 문자열 — **「없다」가 아니라 「모른다」다.** */
  at: string;
  done: boolean;
  /** 사람이 읽는 한마디 */
  note: string;
};

export type TimelineInput = {
  receivedAt: string;
  paper: boolean;
  delivered: boolean;
  deliveredAt: string;
  cancelled: boolean;
  clawback: boolean;
  clawbackAt: string;
  billingMonth: string | null;
  payKind: string;
  nextRound: string;
  /** 청구서가 실제로 나갔나(발행 기록). 날짜가 지났다고 나간 게 아니다. */
  invoiced: boolean;
  invoicedAt?: string;
  invoiceNo?: string;
};

const S = (v: unknown) => String(v ?? '').trim();
const rounds = (payKind: string) => {
  const m = /(\d)\s*회/.exec(S(payKind));
  const n = m ? Number(m[1]) : 1;
  return n >= 2 ? n : 1;
};

/**
 * 지나온 길을 한 줄로 편다.
 * ★취소는 «걸음»이 아니라 «끝»이다 — 뒤에 붙이지 않고 그 자리에서 길을 닫는다.
 */
export function timelineOf(r: TimelineInput): Step[] {
  const steps: Step[] = [
    { key: '접수', at: S(r.receivedAt), done: !!S(r.receivedAt), note: '계약금이 들어왔다' },
    { key: '계약서', at: '', done: !!r.paper, note: r.paper ? '계약서를 썼다' : '계약서 대기' },
    {
      key: '인도',
      at: S(r.deliveredAt),
      done: !!r.delivered,
      note: r.delivered ? '인도했다 — 여기서 청구월이 선다' : '인도 대기 — 청구가 아직 못 선다',
    },
    {
      key: '청구',
      at: S(r.invoicedAt),
      done: !!r.invoiced,
      note: r.invoiced
        ? `청구서를 보냈다${r.invoiceNo ? ` (${r.invoiceNo})` : ''}`
        : r.billingMonth ? `${r.billingMonth} 청구 예정 — 아직 안 보냈다` : '인도해야 청구가 선다',
    },
  ];

  // 분납이면 «완납»이 한 걸음 더 있다. 일시납은 청구가 곧 끝이다.
  if (rounds(r.payKind) >= 2) {
    const left = S(r.nextRound);
    steps.push({
      key: '완납',
      at: '',
      done: !left,
      note: left ? `다음 회차 ${left} — 부러지면 환수` : '분납이 다 들어왔다',
    });
  }

  if (r.clawback) {
    steps.push({ key: '환수', at: S(r.clawbackAt), done: true, note: '깨졌다 — 그 달에 마이너스로 선다' });
  }
  if (r.cancelled) {
    // 취소는 길을 닫는다. 뒤에 붙이지 않고 «여기서 끝났다»고 말한다.
    return [...steps.filter((s) => s.done), { key: '취소', at: '', done: true, note: '계약이 취소됐다' }];
  }
  return steps;
}

/** 지금 어디까지 왔나 — 가장 멀리 간 걸음. 화면 한 줄로 쓴다. */
export function reachedOf(steps: Step[]): Step {
  const done = steps.filter((s) => s.done);
  return done[done.length - 1] || steps[0];
}

/** 다음에 할 일. **없으면 빈 문자열** — 지어내지 않는다. */
export function nextTodoOf(steps: Step[]): string {
  if (steps.some((s) => s.key === '취소' && s.done)) return '';
  const first = steps.find((s) => !s.done);
  if (!first) return '';
  return ({
    접수: '접수일을 넣어야 합니다',
    계약서: '계약서를 받아야 합니다',
    인도: '인도해야 청구월이 섭니다',
    청구: '청구서를 보내야 합니다',
    완납: '남은 회차를 기다립니다',
    환수: '',
    취소: '',
  })[first.key] || '';
}
