/**
 * **세부모델 이름에서 «프로젝트 코드»를 떼는 규칙 — 한 곳에서만 정한다.**
 *
 * ★왜(사장님 2026-08-23 「109호5391 이상하다 · 아직도 세부모델 세부트림 정제되지 않은 게 있는 거 같음」)
 *   차종마스터 세부모델명에는 제조사 개발 코드가 붙어 있다 — 「디 올 뉴 싼타페 MX5」·「그랜저 GN7」·「G80 RG3」.
 *   정제칸이 그 이름을 그대로 받아 화면 차명(세부모델 + 세부트림)이 「디 올 뉴 싼타페 MX5 익스클루시브」가 됐다.
 *   손님이 읽을 이름에 개발 코드가 낄 자리는 없다.
 *
 * ⚠ 이 함수는 **이름을 만들지 않는다** — 규칙을 「AI 정제」 치환 사전에 넣을 때 «무엇을 무엇으로» 정하는 데만 쓴다.
 *   실제 값은 언제나 사전이 정한다(사장님이 시트에서 눈으로 보고 고칠 수 있어야 하니까).
 */

/**
 * 프로젝트 코드로 볼 토큰 — 영문 대문자로 시작해 숫자가 붙는 덩어리.
 * `MX5` `CN7` `DN8` `GN7` `KA4` `RG3` `JX1` `AX1` `W205` `F66/F65` `J116/J140` `9BQC` 따위.
 */
const CODE = /^[0-9]?[A-Z]{1,4}[0-9]{1,4}([A-Z]{0,3})?(\/[0-9]?[A-Z]{1,3}[0-9]{1,4})?$/;

/**
 * 숫자가 없는 코드 — `TAM`(레이) `IG`(그랜저) `LF`(쏘나타) `UM`(쏘렌토) 처럼 **글자만으로 된 개발 코드**.
 * 모양으로는 트림 글자와 구분이 안 되므로 «뜻이 있는 것만 남기고 나머지는 뗀다»로 뒤집었다.
 * ⚠ 여기 남긴 낱말은 **손님이 읽어서 뜻이 통하는 것**만이다. 새 낱말이 생기면 여기에 적어라 —
 *   빠뜨려도 세대가 겹치면 규칙이 안 만들어지니(collision 가드) 이름이 망가지지는 않는다.
 */
const KEEP_WORDS = new Set(['EV', 'FL', 'GT', 'AMG', 'N', 'RS', 'S', 'M', 'MX5']);
const LETTER_CODE = /^[A-Z]{2,4}$/;

/**
 * 세부모델에서 코드와 «앞에 이미 나온 제조사»를 뗀다.
 *
 * - **모델 이름에 있는 토큰은 안 뗀다** — 모델이 `K8`·`G80`·`EV6`·`XM3` 인 차를 깎으면 안 된다.
 * - 제조사가 이름 가운데 끼어 있으면 뗀다 — 「더 뉴 **기아** 레이 TAM」은 화면에서 「기아 · 더 뉴 기아 레이」로 두 번 나온다.
 * - 뗀 결과가 비면 **원래 이름을 그대로 돌려준다**(이름을 없애느니 코드가 낫다).
 */
export function stripModelCode(sub: string, model: string, maker: string): string {
  const s = String(sub ?? '').trim();
  if (!s) return '';
  const modelTokens = new Set(String(model ?? '').trim().toUpperCase().split(/\s+/).filter(Boolean));
  const isCode = (t: string) => {
    const u = t.toUpperCase();
    if (modelTokens.has(u)) return false;          // 모델 이름의 일부다 — K8·G80·EV6·XM3
    if (KEEP_WORDS.has(u)) return false;           // 뜻이 있는 낱말이다 — EV·FL·GT
    return CODE.test(u) || LETTER_CODE.test(u);
  };
  let out = s.split(/\s+/).filter(Boolean).filter((t) => !isCode(t));
  const m = String(maker ?? '').trim();
  // 첫 낱말이 제조사인 것은 그대로 둔다(「기아 레이」처럼 제조사가 이름의 일부인 차가 있다) — 가운데 낀 것만 뗀다.
  if (m && out.length > 1) out = out.filter((t, i) => !(t === m && i > 0));
  const joined = out.join(' ').trim();
  return joined || s;
}
