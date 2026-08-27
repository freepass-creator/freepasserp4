/**
 * **상대를 «코드»로 붙인다 — 공급사도, 영업채널도.**
 *
 * ★사장님 2026-08-27 「원장과 코드로 해야지」 「코드를 넣어서 붙이면 되잖아」
 *   「공급사랑 제대로 맞추고 정산관리 erp로 쓸수 있길 바란다」.
 *
 * 여태 원장은 상대를 «이름»으로만 들고 있었다. 붙이는 자리마다 이름 규칙
 * (`nameKey` + 앞머리 맞추기)을 돌렸는데, 그게 네 번 어긋났다 —
 * ```
 * 2026-08-26  확인 「오토」 하나로 «오토원트»·«오토디렉션»이 둘 다 열렸다      잘못 열림
 * 2026-08-26  확인 「리더스렌트카」 하나로 채널 「리더스」가 열렸다            잘못 열림
 * 2026-08-27  원장 「SMC」 ↔ 파트너사 「에스엠씨(S.M.C)」 는 아예 안 붙는다     안 붙음
 * 2026-08-27  원장 채널 「퍼시픽」이 «공급사» RP022 퍼시픽에 딱 맞는다        엉뚱한 축
 * ```
 *   ⇒ **줄에 코드를 박아 두고 코드끼리 맞춘다.** 이름은 사람이 읽는 용도로만 남는다.
 *
 * ★★★**명부를 어디서 읽나 — 축마다 다르다.** 실측 2026-08-27, 짐작이 아니다.
 * ```
 * 영업채널   v4/partners «만»            14곳. 열쇠 == partner_code. 한 회사에 한 줄
 *                                      ⚠ v3 를 섞으면 「주식회사 렌트야」가 v4 SP002 와
 *                                        v3 PT-0013 로 «둘»이 되어 어느 쪽인지 모르게 된다.
 *                                        게다가 v3 에서 SP002 는 「개인영업채널」이다 —
 *                                        코드가 남의 것을 가리킨다
 * 공급사     partners + v4 덮어쓰기       26곳. 공급사는 v3 에 RP0xx 로 있다.
 *                                      v4 에는 8곳뿐이라 v4 만 보면 오토플러스(115줄)·
 *                                        손오공(78)·웰릭스(43)가 통째로 빠진다
 * ```
 *   덮어쓰기 규칙은 집 규칙과 같다(`lib/firebase/auth.ts` `readPartnersForMatch`) —
 *   `partners` 가 바탕, `v4/partners` 를 **칸 단위로** 덮는다.
 *
 * ⚠ **축을 먼저 거른다.** 명부를 통째로 두고 이름만 맞추면 공급사가 영업채널로 붙는다.
 *   원장 채널 「퍼시픽」이 공급사 `RP022 퍼시픽`에 딱 맞았다 — 안 거르면 지급이 남의 회사로 선다.
 */

const S = (v: unknown) => String(v ?? '').trim();

/** 이름 맞추기용 열쇠 — `settlement-view` 의 `nameKey` 와 같은 규칙. 법인격·공백·기호를 뗀다. */
const key = (v: unknown) => S(v)
  .replace(/[（）]/g, (c) => (c === '（' ? '(' : ')'))
  .replace(/\(\s*(주|유|재|사|합)\s*\)|㈜|주식회사|유한회사|유한책임회사/g, '')
  .replace(/[\s()·\-_.]/g, '')
  .toLowerCase();

/** 명부 한 줄. */
export type PartnerRef = { code: string; name: string };
/** 상대의 축. 청구서가 서는 축과 같다. */
export type PartyAxis = '공급사' | '영업채널';

/**
 * **원장 이름 → 코드, 손으로 박아 둔 것.**
 *
 * ★여기 적는 것은 «이름 규칙으로는 못 붙는» 것뿐이다. 붙는 것을 또 적으면
 *   나중에 상호가 바뀌었을 때 어느 쪽이 맞는지 알 수 없게 된다.
 * ★적을 때는 **근거를 옆에 남긴다.** 「왜 이 둘이 같은 회사냐」에 답할 수 있어야 한다.
 * ⚠ 새로 적기 전에 `npx tsx scripts/backfill-party-code.mts` 를 먼저 돌린다 —
 *   무엇이 안 붙는지 표로 나온다. **짐작으로 채우지 않는다.**
 */
export const PARTY_ALIAS: Record<PartyAxis, Record<string, string>> = {
  영업채널: {
    // 원장은 줄여 「SMC」로 적는데 파트너사 상호는 「에스엠씨(S.M.C)」다.
    // 한글과 영문이라 이름 규칙으로는 영원히 안 붙는다. 2026-08-27 확인.
    smc: 'SP008',
  },
  공급사: {
    // 아직 없다. 안 붙는 공급사 이름들(오토셀렉션·JPK·AMR·금탑·SK·에스에이·빌림)은
    // «별칭이 아니라 등록이 없는» 것이다 — 여기 적을 일이 아니라 거래처로 등록할 일이다.
  },
};

/** 붙은 까닭 — 표로 보여 줄 때 쓴다. 「왜 이렇게 붙었냐」에 답이 있어야 한다. */
export type PartyWhy = '박아 둠' | '이름 같음' | '앞머리 하나' | '모름' | '여럿' | '이름 없음';

/**
 * **이 이름은 어느 코드인가.**
 *
 * 붙이는 차례 — 위에서 걸리면 아래는 안 본다.
 * ```
 * ① 박아 둔 표에 있으면        그것        사람이 확인한 것이 제일 세다
 * ② 이름이 딱 맞으면          그것
 * ③ 앞머리로 «하나만» 걸리면    그것        하허호 ─ 하허호무심사
 * ④ 그 밖                  빈칸        ★「모른다」로 둔다. 짐작으로 안 채운다
 * ```
 * ⚠ ②·③에서 둘 이상 걸리면 «안 붙인다». 돈이 나가는 축이라 애매하면 비우는 쪽이 옳다 —
 *   못 붙이면 사람이 한 번 채우면 그만이지만, 잘못 붙이면 남의 회사로 청구·지급이 선다.
 *   실측 2026-08-27: 「렌트존」이 `PT-0001 (주)렌트존` 과 `RP007 렌트존` 둘에 걸린다.
 *   같은 회사가 두 번 등록돼 있어서다 — 그건 사람이 정리할 일이지 기계가 고를 일이 아니다.
 */
export function partyCodeOf(name: unknown, axis: PartyAxis, refs: PartnerRef[]): { code: string; why: PartyWhy } {
  const want = key(name);
  if (!want) return { code: '', why: '이름 없음' };

  const fixed = PARTY_ALIAS[axis][want];
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

const typeOf = (p: Record<string, unknown>) => S(p.partner_type).toLowerCase().replace(/[\s-]+/g, '_');
const isAxis = (p: Record<string, unknown>, axis: PartyAxis) => (axis === '공급사'
  ? typeOf(p) === '공급사' || typeOf(p) === 'provider'
  : typeOf(p) === '영업채널' || typeOf(p) === 'sales_channel' || typeOf(p) === '채널');
const nameOf = (p: Record<string, unknown>) => S(p.name) || S(p.partner_name) || S(p.company_name);

/**
 * **명부 한 벌 — 그 축의 것만.**
 *
 * ★★축마다 «어느 노드를 보나»가 다르다. 머리말의 표가 그 근거다.
 *   여기서 한 번만 갈라 두고, 부르는 쪽은 축만 말하면 된다 —
 *   자리마다 노드를 골라 읽게 두면 어느 자리가 어느 명부를 봤는지 아무도 모르게 된다.
 *
 * @param base     `partners`      (v3 · 공급사가 여기 있다)
 * @param overlay  `v4/partners`   (v4 · 영업채널이 여기 있다)
 */
export function partnerRefsOf(
  base: Record<string, unknown>, overlay: Record<string, unknown>, axis: PartyAxis,
): PartnerRef[] {
  // ★영업채널은 v4 만 본다. 섞으면 같은 회사가 둘이 되고 v3 코드는 남의 것을 가리킨다.
  const src: Record<string, unknown> = axis === '영업채널'
    ? { ...(overlay || {}) }
    : (() => {
      // ★공급사는 집 규칙대로 — `partners` 가 바탕, `v4/partners` 를 «칸 단위»로 덮는다.
      const out: Record<string, unknown> = { ...(base || {}) };
      for (const [k, v] of Object.entries(overlay || {})) {
        if (!v || typeof v !== 'object') continue;
        out[k] = { ...((out[k] || {}) as Record<string, unknown>), ...(v as Record<string, unknown>) };
      }
      return out;
    })();

  const refs: PartnerRef[] = [];
  for (const [code, raw] of Object.entries(src)) {
    const p = (raw || {}) as Record<string, unknown>;
    if (!isAxis(p, axis)) continue;
    const name = nameOf(p);
    if (name) refs.push({ code: S(p.partner_code) || S(code), name });
  }
  return refs;
}
