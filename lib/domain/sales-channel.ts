/**
 * **영업채널 코드 — 이름 말고 코드로 붙인다.**
 *
 * ★사장님 2026-08-27 「원장과 코드로 해야지」 「코드를 넣어서 붙이면 되잖아」.
 *
 * 여태 원장은 영업채널을 «이름»으로만 들고 있었다. 그래서 붙이는 자리마다
 * 이름 규칙(`nameKey` + 앞머리 맞추기)을 돌렸는데, 그게 세 번 뚫렸다 —
 * ```
 * 2026-08-26  확인 「오토」 하나로 «오토원트»·«오토디렉션»이 둘 다 열렸다
 * 2026-08-26  확인 「리더스렌트카」 하나로 채널 「리더스」가 열렸다
 * 2026-08-27  원장 「SMC」 ↔ 파트너사 「에스엠씨(S.M.C)」 는 아예 안 붙는다
 * ```
 *   앞의 둘은 «잘못 열린» 것이고 마지막은 «안 열린» 것이다. 이름으로 붙이는 한 계속 난다.
 *   ⇒ **줄에 코드를 박아 두고 코드끼리 맞춘다.** 이름은 사람이 읽는 용도로만 남는다.
 *
 * ★★★**명부는 `v4/partners` 다.** v3 `partners` 를 쓰지 않는다 — 실측 2026-08-27:
 * ```
 * v4/partners   영업채널 14곳. 열쇠 == partner_code. 한 회사에 한 줄
 * partners(v3)  영업채널 16곳. 같은 회사가 PT-00xx 와 SPxxx 로 두 줄씩 있고,
 *               「주식회사 렌트야」(PT-0013)의 partner_code 가 SP002 인데
 *               v3 에서 SP002 는 「개인영업채널」이다 — 코드가 남의 것을 가리킨다
 * ```
 *   v3 를 섞으면 코드로 바꾼 보람이 없다. 코드가 유일한 곳에서만 읽는다.
 *
 * ⚠ **공급사를 영업채널로 붙이지 않는다.** 원장 채널 「퍼시픽」은 이름만 보면
 *   `RP022 퍼시픽` 에 딱 맞는데 그건 **공급사**다. 명부를 영업채널로 먼저 거르지 않으면
 *   지급이 엉뚱한 회사로 선다. 그래서 `refs` 는 «영업채널만» 담아 넘긴다.
 */

const S = (v: unknown) => String(v ?? '').trim();

/** 이름 맞추기용 열쇠 — `settlement-view` 의 것과 같은 규칙. 법인격·공백·기호를 뗀다. */
const key = (v: unknown) => S(v)
  .replace(/[（）]/g, (c) => (c === '（' ? '(' : ')'))
  .replace(/\(\s*(주|유|재|사|합)\s*\)|㈜|주식회사|유한회사|유한책임회사/g, '')
  .replace(/[\s()·\-_.]/g, '')
  .toLowerCase();

/** 명부 한 줄 — 영업채널 파트너사. */
export type ChannelRef = { code: string; name: string };

/**
 * **원장 이름 → 코드, 손으로 박아 둔 것.**
 *
 * ★여기 적는 것은 «이름 규칙으로는 못 붙는» 것뿐이다. 붙는 것을 또 적으면
 *   나중에 이름이 바뀌었을 때 어느 쪽이 맞는지 알 수 없게 된다.
 * ★적을 때는 **근거를 옆에 남긴다.** 「왜 이 둘이 같은 회사냐」에 답할 수 있어야 한다.
 * ⚠ 새로 적기 전에 `npx tsx scripts/backfill-channel-code.mts` 를 먼저 돌린다 —
 *   무엇이 안 붙는지 표로 나온다. 짐작으로 채우지 않는다.
 */
export const CHANNEL_ALIAS: Record<string, string> = {
  // 원장은 줄여 「SMC」로 적는데 파트너사 상호는 「에스엠씨(S.M.C)」다.
  // 한글과 영문이라 이름 규칙으로는 영원히 안 붙는다. 2026-08-27 확인.
  smc: 'SP008',
};

/** 붙은 까닭 — 표로 보여 줄 때 쓴다. 「왜 이렇게 붙었냐」에 답이 있어야 한다. */
export type ChannelWhy = '박아 둠' | '이름 같음' | '앞머리 하나' | '모름' | '여럿' | '채널 없음';

/**
 * **이 이름은 어느 코드인가.**
 *
 * 붙이는 차례 — 위에서 걸리면 아래는 안 본다.
 * ```
 * ① 박아 둔 표에 있으면        그것            사람이 확인한 것이 제일 세다
 * ② 이름이 딱 맞으면          그것
 * ③ 앞머리로 «하나만» 걸리면    그것            하허호 ─ 하허호무심사
 * ④ 그 밖                  빈칸            ★「모른다」로 둔다. 짐작으로 안 채운다
 * ```
 * ⚠ ③에서 둘 이상 걸리면 «안 붙인다». 돈이 나가는 축이라 애매하면 비우는 쪽이 옳다 —
 *   못 붙이면 사람이 한 번 채우면 그만이지만, 잘못 붙이면 남의 회사로 지급이 선다.
 */
export function channelCodeOf(channel: unknown, refs: ChannelRef[]): { code: string; why: ChannelWhy } {
  const want = key(channel);
  if (!want) return { code: '', why: '채널 없음' };

  const fixed = CHANNEL_ALIAS[want];
  if (fixed) return { code: fixed, why: '박아 둠' };

  const exact = refs.filter((r) => key(r.name) === want);
  if (exact.length === 1) return { code: S(exact[0].code), why: '이름 같음' };
  if (exact.length > 1) return { code: '', why: '여럿' };

  const pre = refs.filter((r) => {
    const got = key(r.name);
    return !!got && got !== want && (got.startsWith(want) || want.startsWith(got));
  });
  if (pre.length === 1) return { code: S(pre[0].code), why: '앞머리 하나' };
  return { code: '', why: pre.length > 1 ? '여럿' : '모름' };
}

/** 저장된 명부(파트너 등록)에서 **영업채널만** 골라 준다. ⚠ 공급사를 섞지 않는다. */
export function channelRefsOf(partners: Record<string, unknown>): ChannelRef[] {
  const out: ChannelRef[] = [];
  for (const [code, raw] of Object.entries(partners || {})) {
    const p = (raw || {}) as Record<string, unknown>;
    const type = S(p.partner_type).toLowerCase().replace(/[\s-]+/g, '_');
    if (type !== '영업채널' && type !== 'sales_channel' && type !== '채널') continue;
    const name = S(p.name) || S(p.partner_name) || S(p.company_name);
    if (name) out.push({ code: S(p.partner_code) || S(code), name });
  }
  return out;
}
