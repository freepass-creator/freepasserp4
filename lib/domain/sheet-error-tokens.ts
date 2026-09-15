/**
 * **구글시트 수식 오류 토큰 — 값처럼 보이지만 값이 아니다.** SSOT 한 곳.
 *
 * 실측 2026-09-08 — 빌린카 `08주6722`의 상품구분(분류) 칸이 「#REF!」였다. 이걸 값으로 받으면
 * 시트·ERP에 「#REF!」가 상품구분처럼 뜬다. 그래서 `canonProductType`(정본 매핑)과
 * `ingest-supplier-to-firestore.mts`(원자화)는 이 토큰을 «빈칸»으로 거른다.
 *
 * ⚠ 2026-09-15 실측 — `scripts/audit-stock-gaps.mts`는 「빈칸」(빈 문자열)만 찾는다. `#REF!`는
 * «빈 문자열이 아니므로» 이 감사를 그냥 통과해 08주6722가 일주일 넘게 안 잡혔다(사람이 실측해
 * 발견). 「빈칸인지」를 검사하는 자리는 전부 이 함수로 «오류 토큰도 빈칸으로» 봐야 한다.
 */
const SHEET_ERROR_PATTERN = /^#(REF|VALUE|N\/A|NAME|DIV\/0|NUM|ERROR|GETTING_DATA|NULL)[!?]?$/i;

export function isSheetErrorToken(v: unknown): boolean {
  return SHEET_ERROR_PATTERN.test(String(v ?? '').trim());
}

/** 오류 토큰이면 빈 문자열로, 아니면 그대로(트림만). */
export function cleanSheetErrorToken(v: unknown): string {
  const s = String(v ?? '').trim();
  return isSheetErrorToken(s) ? '' : s;
}

/** 「빈칸인지」 판정 — 진짜 빈 문자열이거나 오류 토큰이면 빈칸으로 본다. */
export function isBlankOrSheetError(v: unknown): boolean {
  const s = String(v ?? '').trim();
  return !s || isSheetErrorToken(s);
}
