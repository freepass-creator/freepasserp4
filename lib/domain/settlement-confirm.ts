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
 *
 * ★★**확인은 «청구서를 보고» 한다**(사장님 2026-08-26 「영업자 청구서를 만들어서 확인하는 작업이 있어야지」
 *   「공급사 영업채널 청구서가 각각 있음」). 처음에는 건수만 보여 줬는데(「일단 금액은 적지 않을거야」),
 *   건수만으로는 「맞다」고 말하기 어렵다 — 자기가 받을 돈을 봐야 확인이 된다.
 *   ⇒ 영업채널은 «지급명세»를, 공급사는 «청구서»를 보고 확인한다.
 * ★★**각자 자기 쪽 금액만 본다.** 영업채널은 지급액, 공급사는 청구액.
 *   우리 몫(청구−지급)은 아무도 못 본다 — 한쪽만 실으면 역산이 안 된다.
 * ★★**확인 단위는 «달 × 상대»다** — 청구서가 나가는 단위와 같다. 사람이 아니라 채널이다.
 *   이름은 겹치고 바뀌지만 채널은 지급이 나가는 단위다(실측: 동명이인 3명).
 * ⚠ 확인은 **되돌릴 수 있다** — 청구가 나가기 전까지는. 나간 뒤에는 환수로 다룬다.
 */
import { nameKey } from './settlement-view';

/** 한 사람(또는 한 공급사)의 한 달 실적에 대한 답. */
export type ConfirmState = '대기' | '확인' | '이의';

export type Confirmation = {
  /** `${month}_${누구}` — 저장 열쇠. RTDB 키로 쓸 수 있게 다듬어 둔다. */
  key: string;
  month: string;
  /**
   * 확인한 주체 — **영업채널(회사)** 또는 공급사 상호.
   *
   * ★사장님 2026-08-26 「공급사 영업채널 청구서가 각각 있음」 —
   *   청구서가 「달 × 상대」로 나가니 확인도 그 단위여야 짝이 맞는다.
   * ★★사람 이름이 아니라 **채널**이다. 이름은 겹치고 바뀌지만 채널은 지급이 나가는 단위다 —
   *   실측 2026-08-26: 원장 영업담당자 56명 중 동명이인이 셋이었다.
   *   채널로 두면 그 채널 사람 누구가 확인해도 그 문서가 확인된 것이 된다.
   */
  who: string;
  /**
   * **영업채널 코드.** 사장님 2026-08-27 「원장과 코드로 해야지」.
   *
   * ★있으면 **이것으로 붙인다.** 이름은 사람이 읽는 용도로만 남는다.
   *   이름으로 붙이다 세 번 뚫렸다 — 자세한 것은 `lib/domain/sales-channel.ts`.
   * ⚠ 빈칸일 수 있다. 코드를 달기 전에 남긴 확인, 그리고 파트너 등록이 없는 채널이 그렇다.
   *   빈칸이면 옛 이름 규칙으로 붙는다 — 그래서 «있던 확인이 갑자기 안 붙는» 일은 없다.
   */
  whoCode?: string;
  role: 'agent' | 'provider';
  state: ConfirmState;
  /** 확인 시점의 건수 — 뒤에 건이 늘면 «다시 확인»을 받아야 한다 */
  lines: number;
  /**
   * 확인 시점의 금액(부가세 포함). **그때 이 금액으로 확인했다**는 증적이다.
   * ★사장님 2026-08-26 「영업자 청구서를 만들어서 확인하는 작업이 있어야지」 —
   *   건수만 맞대면 「금액이 다르다」는 말이 나왔을 때 되짚을 근거가 없다.
   * ⚠ 영업자는 «지급액», 공급사는 «청구액»이다. 자기 쪽 금액 하나뿐이다.
   */
  amount?: number;
  /** 「이건 아니다」로 짚은 차량번호 */
  disputed: string[];
  note: string;
  at: number;
  by: string;
  /**
   * ★**우리가 «대신 적은» 확인인가.** 사장님 2026-08-27
   *   「erp화면에서 일단 계정없어도 그냥 우리가 메모하는거로 쓸거라니까」
   *   「영업채널 파트너사로만 만들어두면 돼」.
   *
   *   본래 이 문은 «본인만» 열 수 있었다(관리자 POST 는 403). 그런데 영업채널 사람들이
   *   아직 계정을 안 만들었고, 그때까지 청구가 멈춰 있을 수는 없다.
   *   ⇒ **우리가 전화·카톡으로 받아서 대신 적는 길**을 연다. 단위는 «영업채널»이다.
   *
   * ⚠ **본인 확인과 «구분해서» 남긴다.** 섞어 두면 기록이 거짓말을 한다 —
   *   나중에 「이건 누가 확인한 거냐」에 답하지 못하면 이 문은 있으나 마나다.
   * ⚠ 대리로 적을 때는 **근거(`note`)를 반드시 받는다.** 근거 없는 메모는 메모가 아니다.
   * ⚠ 영업자가 나중에 로그인해서 보면 「대신 적음」이 보인다 — 틀렸으면 이의를 걸 수 있어야 한다.
   */
  proxy?: boolean;
  /** 대신 적은 사람 — `by`(uid) 말고 «읽을 수 있는 이름». 나중에 읽을 사람을 위해 둔다. */
  proxyBy?: string;
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
    /**
     * ⚠ **`disputed` 가 없을 수 있다.** RTDB 는 «빈 배열을 저장하지 않는다» —
     *   차량번호를 짚지 않고 사유만 적어 이의를 걸면 `disputed: []` 로 쓰이고,
     *   다시 읽을 때는 그 칸이 통째로 사라진 채 온다. `c.disputed.length` 로 바로 만지면
     *   공급사 청구서(`/api/settlement/invoice`)가 500 으로 죽는다 (2026-08-26 확인).
     * ★타입이 `string[]` 이라 컴파일러는 못 잡는다. 저장소 사정은 규칙이 스스로 막아야 한다.
     */
    const n = c.disputed?.length || 0;
    return { ok: false, why: `영업자가 ${n ? `${n}건에 ` : ''}이의를 걸었습니다${c.note ? ` — ${c.note}` : ''}.` };
  }
  if (nowLines > c.lines) {
    return { ok: false, why: `확인받은 뒤 ${nowLines - c.lines}건이 늘었습니다. 다시 확인을 받아야 합니다.` };
  }
  return { ok: true, why: '' };
}

/**
 * **공급사 청구 한 장에 걸린 영업채널들의 확인 관문.**
 *
 * 청구서와 확인 모두 «월 × 영업채널» 단위다. 화면은 이 결과를 보여 주고,
 * 서버 발행은 같은 결과가 비어 있을 때만 기록한다. 둘이 따로 세면 경고와
 * 실제 발행 판단이 갈라진다. (코덱스, 2026-08-26)
 *
 * ★★★**여기는 «막히나»보다 «잘못 열리나»가 먼저다.**
 *   못 막히면 확인을 한 번 더 받으면 그만이지만, 잘못 열리면
 *   **확인 안 한 실적이 청구서에 실려 나간다.** 애매하면 «안 붙인다».
 *   ⚠ 2026-08-26 검증에서 실제로 뚫렸다 — 확인 「리더스렌트카」 하나로 채널 「리더스」가,
 *     확인 「오토」 하나로 「오토원트」·「오토디렉션」이 통과했다. 이름 붙이기에
 *     유일성 검사가 없어서다. 아래 `pickConfirmation` 이 그것을 막는다.
 *   ⚠ 검사는 `scripts/check-provider-gate.mts` — «잘못 열리는» 경우 4개가 들어 있다.
 *     이 함수를 고치면 **그것부터 돌린다.**
 */
export type ProviderBillGateRow = { channel?: unknown; channelCode?: unknown; agent?: unknown };
export type ProviderBillGate = { channel: string; code: string; lines: number; why: string };

export function providerBillGate(rows: ProviderBillGateRow[], confirmations: Confirmation[]): ProviderBillGate[] {
  /**
   * 채널별로 묶는다 — **코드가 있으면 코드로, 없으면 이름으로.**
   * ★같은 회사가 코드 있는 줄과 없는 줄로 나뉘어 있으면 «두 덩이»가 된다.
   *   그건 틀린 게 아니라 «아직 덜 채운» 것이다. 백필을 돌리면 하나로 합쳐진다.
   */
  const byChannel = new Map<string, { channel: string; code: string; lines: number }>();
  for (const row of rows) {
    // 확인은 채널 단위다. 담당자 이름으로 대신 붙이면 다른 채널 확인을 잘못 통과시킬 수 있다.
    const channel = S(row.channel) || '(영업채널 미기재)';
    const code = S(row.channelCode);
    const k = code || `이름:${nameKey(channel)}`;
    const got = byChannel.get(k);
    if (got) got.lines += 1;
    else byChannel.set(k, { channel, code, lines: 1 });
  }

  const gate: ProviderBillGate[] = [];
  const channels = [...byChannel.values()].map((v) => v.channel);
  for (const v of byChannel.values()) {
    const { ok, why } = canBill(pickConfirmation(v.channel, v.code, confirmations, channels), v.lines);
    if (!ok) gate.push({ channel: v.channel, code: v.code, lines: v.lines, why });
  }
  return gate;
}

/**
 * **이 채널의 확인을 «확실할 때만» 붙인다.**
 *
 * ★★관문은 돈이 나가는 자리다. 못 붙이면 한 번 더 확인받으면 그만이지만,
 *   잘못 붙이면 **확인 안 한 실적이 청구서에 실려 나간다.** 그래서 애매하면 «안 붙인다».
 *
 * 붙이는 규칙 — 집 규칙(`isSameCompany`)과 같다.
 * ```
 * ① 이름이 똑같으면      붙인다
 * ② 계정 이름이 원장 이름으로 «시작»하면  ─┐ 셋을 다 만족할 때만 붙인다
 *      · 그렇게 걸리는 확인이 «하나뿐»이고   │  (하허호 ─ 하허호무심사)
 *      · 그 확인이 «다른 채널»에도 걸리지 않을 때
 * ③ 그 밖                안 붙인다 → 막힌다
 * ```
 * ⚠ **반대 방향(`want.startsWith(got)`)은 쓰지 않는다.** 2026-08-26 검사에서 구멍이 났다 —
 *   「오토」로 뭉뚱그려 확인 하나를 남기면 «오토원트»와 «오토디렉션»이 둘 다 열렸다.
 * ⚠ **유일성을 안 보면** 「리더스렌트카」 확인 하나로 「리더스」까지 열렸다.
 *   앞머리가 겹치는 상대가 실제로 있다(공급사 리더스 · 리더스렌트카).
 */
function pickConfirmation(
  channel: string, code: string, confirmations: Confirmation[], allChannels: string[],
): Confirmation | null {
  /**
   * ★★**코드가 먼저다.** 사장님 2026-08-27 「원장과 코드로 해야지」.
   *   코드끼리 맞는 것이 있으면 이름은 아예 안 본다 — 이름 규칙이 뚫리던 자리가 여기다.
   * ⚠ 코드가 안 맞았다고 «막지는» 않는다. 코드를 달기 전에 남긴 확인이 있어서다.
   *   아래 이름 규칙으로 한 번 더 본다 — 그 규칙은 예전 그대로 «유일할 때만» 붙는다.
   */
  const byCode = S(code);
  if (byCode) {
    const hit = confirmations.find((c) => S(c.whoCode) === byCode);
    if (hit) return hit;
  }

  const want = nameKey(channel);
  if (!want) return null;

  const exact = confirmations.find((c) => nameKey(c.who) === want);
  if (exact) return exact;

  /**
   * 줄여 적힌 이름 붙이기 — **방향은 둘 다 있다.**
   *   · 원장 「하허호」        ↔ 계정 「하허호무심사」   (계정이 길다)
   *   · 원장 「하허호무심사」   ↔ 계정 「하허호」        (원장이 길다)
   * ⚠ 그래서 방향 하나를 막는 것으로는 못 고친다. **유일성**으로 막아야 한다.
   */
  const fits = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);
  const cands = confirmations.filter((c) => {
    const got = nameKey(c.who);
    return !!got && got !== want && fits(got, want);
  });
  // 걸리는 확인이 둘 이상이면 누구 것인지 모른다 — 안 붙인다.
  if (cands.length !== 1) return null;

  // 그 확인이 이 문서의 «다른 채널»에도 걸린다면 역시 모른다 — 안 붙인다.
  const got = nameKey(cands[0].who);
  const alsoFits = allChannels.some((other) => {
    const k = nameKey(other);
    return !!k && k !== want && fits(got, k);
  });
  return alsoFits ? null : cands[0];
}

/** 사람이 읽는 한마디 — 화면과 정산서가 같은 말을 써야 한다. */
export function confirmLabel(c: Confirmation | null, nowLines: number): string {
  if (!c || c.state === '대기') return '확인 대기';
  if (c.state === '이의') return c.proxy ? '이의 제기 · 대신 적음' : '이의 제기';
  if (nowLines > c.lines) return '재확인 필요';
  // ★대리로 적은 것은 «그렇다고 말한다». 본인이 누른 것과 같은 말을 쓰면 기록이 거짓말을 한다.
  return c.proxy ? '확인 완료 · 대신 적음' : '확인 완료';
}

export const confirmTone = (c: Confirmation | null, nowLines: number): 'gray' | 'green' | 'red' | 'amber' => {
  if (!c || c.state === '대기') return 'gray';
  if (c.state === '이의') return 'red';
  if (nowLines > c.lines) return 'amber';
  return 'green';
};
