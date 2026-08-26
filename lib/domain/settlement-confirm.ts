/**
 * **실적 확인 — 청구 앞에 놓인 문 하나.** 순수 함수.
 *
 * ★사장님 2026-08-26
 *   「그 청구금액이 받아서 주는구조이니까 영업자한테 실적 먼저 확인하고
 *    그게 ㅇㅋ 되면 공급사에 청구 거기서 한번 걸러지는구조야」
 *
 * 돈이 이렇게 흐른다 —
 * ```
 * 공급사 ──청구──▶ 우리 ──지급──▶ 영업채널
 *              ↑
 *        받아서 준다. 그래서 «잘못 청구»는 우리 돈이 아니라 남의 돈을 잘못 만진 것이다.
 * ```
 * 그래서 순서가 이렇다 —
 * ```
 * ① 접수 → 인도완료          여기까지는 사실
 * ② 영업자 «실적 확인»        ★내 실적이 이게 맞나. **금액은 안 본다 — 건이 맞는지만 본다**
 * ③ 확인되면 공급사에 청구     ②를 통과한 것만 나간다
 * ④ 입금 → 영업채널 지급
 * ```
 *
 * ★★**②가 «걸러지는» 자리다.** 여기서 걸러야 공급사에 틀린 청구가 안 나간다.
 *   공급사에 잘못 청구하고 나중에 되돌리는 것은 돈보다 신용이 깎인다.
 * ★★**확인은 금액 확인이 아니라 «건» 확인이다.** 영업자 화면에는 금액이 안 간다(설계).
 *   물어보는 것은 「이 차들이 네가 판 게 맞나」뿐이다.
 * ⚠ 확인은 **되돌릴 수 있다** — 청구가 나가기 전까지는. 나간 뒤에는 환수로 다룬다.
 */

/** 한 사람(또는 한 공급사)의 한 달 실적에 대한 답. */
export type ConfirmState = '대기' | '확인' | '이의';

export type Confirmation = {
  /** `${month}_${누구}` — 저장 열쇠. RTDB 키로 쓸 수 있게 다듬어 둔다. */
  key: string;
  month: string;
  /** 확인한 주체 — 영업담당자 이름 또는 공급사 상호 */
  who: string;
  role: 'agent' | 'provider';
  state: ConfirmState;
  /** 확인 시점의 건수 — 뒤에 건이 늘면 «다시 확인»을 받아야 한다 */
  lines: number;
  /** 「이건 아니다」로 짚은 차량번호 */
  disputed: string[];
  note: string;
  at: number;
  by: string;
};

const S = (v: unknown) => String(v ?? '').trim();

/**
 * 저장 열쇠. RTDB 키에 못 쓰는 글자(`. $ # [ ] /`)를 뺀다.
 * ⚠ 이름이 바뀌면 열쇠도 바뀐다 — 그래서 열쇠는 «찾는 용도»고 안에 who 를 그대로 또 담는다.
 */
export const confirmKey = (month: string, who: string) =>
  `${S(month)}_${S(who).replace(/[.$#[\]/\s]/g, '')}`;

/**
 * **이 달, 이 사람의 실적을 청구로 보내도 되나.**
 *
 * 세 가지에 다 걸린다 —
 *   · 확인을 안 했다        → 아직 못 보낸다
 *   · 이의를 걸었다          → 못 보낸다. 사람이 풀어야 한다
 *   · 확인 뒤 건이 늘었다     → **다시 확인**을 받아야 한다
 *     ★이게 없으면 「확인받은 3건」에 몰래 2건이 붙어 5건이 청구된다.
 */
export function canBill(c: Confirmation | null, nowLines: number): { ok: boolean; why: string } {
  if (!c || c.state === '대기') return { ok: false, why: '영업자 실적 확인을 아직 안 받았습니다.' };
  if (c.state === '이의') {
    return { ok: false, why: `영업자가 ${c.disputed.length || ''}건에 이의를 걸었습니다${c.note ? ` — ${c.note}` : ''}.` };
  }
  if (nowLines > c.lines) {
    return { ok: false, why: `확인받은 뒤 ${nowLines - c.lines}건이 늘었습니다. 다시 확인을 받아야 합니다.` };
  }
  return { ok: true, why: '' };
}

/** 사람이 읽는 한마디 — 화면과 정산서가 같은 말을 써야 한다. */
export function confirmLabel(c: Confirmation | null, nowLines: number): string {
  if (!c || c.state === '대기') return '확인 대기';
  if (c.state === '이의') return '이의 제기';
  if (nowLines > c.lines) return '재확인 필요';
  return '확인 완료';
}

export const confirmTone = (c: Confirmation | null, nowLines: number): 'gray' | 'green' | 'red' | 'amber' => {
  if (!c || c.state === '대기') return 'gray';
  if (c.state === '이의') return 'red';
  if (nowLines > c.lines) return 'amber';
  return 'green';
};
