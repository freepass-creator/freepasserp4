/**
 * **세부모델 이름에서 «프로젝트 코드»를 떼던 규칙 — 지금은 떼지 않는다.**
 *
 * ★08-23 아침: 손님 화면에 개발코드가 보인다고 「AI 정제」로 뗐다 (`K5 DL3`→`K5`).
 * ★08-23 오후: 사장님 「맞게해야지」(싼타페 MX5) · 「K5도 DL3 못잡아내고」.
 *   세부모델 정본은 **모델+개발코드** (`vehicle-master-lock` SUBMODEL_NAME_RULE).
 *   `디 올 뉴`만 aliases. 코드는 남긴다.
 *
 * `stripModelCode` 는 **항등**. 옛 「코드 떼기」 사전 줄을 고를 때만 `wouldStripModelCode`.
 */
const CODE = /^[0-9]?[A-Z]{1,4}[0-9]{1,4}([A-Z]{0,3})?(\/[0-9]?[A-Z]{1,3}[0-9]{1,4})?$/;
const KEEP_WORDS = new Set(['EV', 'FL', 'GT', 'AMG', 'N', 'RS', 'S', 'M', 'MX5']);
const LETTER_CODE = /^[A-Z]{2,4}$/;

/** 08-23 사전 줄을 고를 때 — 실제 정제칸에는 쓰지 않는다. */
export function wouldStripModelCode(sub: string, model: string, maker: string): string {
  const s = String(sub ?? '').trim();
  if (!s) return '';
  const modelTokens = new Set(String(model ?? '').trim().toUpperCase().split(/\s+/).filter(Boolean));
  const isCode = (t: string) => {
    const u = t.toUpperCase();
    if (modelTokens.has(u)) return false;
    if (KEEP_WORDS.has(u)) return false;
    return CODE.test(u) || LETTER_CODE.test(u);
  };
  let out = s.split(/\s+/).filter(Boolean).filter((t) => !isCode(t));
  const m = String(maker ?? '').trim();
  if (m && out.length > 1) out = out.filter((t, i) => !(t === m && i > 0));
  return out.join(' ').trim() || s;
}

/** 세부모델 정본은 모델+코드. 코드를 떼지 않는다. */
export function stripModelCode(sub: string, _model?: string, _maker?: string): string {
  return String(sub ?? '').trim();
}
