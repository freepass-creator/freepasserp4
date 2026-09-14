/**
 * 선택옵션 SSOT는 티카 상세 응답의 tcarPaidOptions뿐이다.
 * options[]는 기본장비이고 carDescription은 설명문이므로 여기로 들어오지 않는다.
 * 표시값에서는 괄호로 반복된 금액만 제거하고, 원문 배열은 별도로 보존한다.
 */
export function tcarPaidOptionNames(value) {
  if (!Array.isArray(value)) return '';
  const amountInParens = /\s*\(\s*[\d,]+\s*원?\s*\)\s*/g;
  return value
    .map((option) => String(option?.name ?? option?.PAID_OPT_NM ?? '')
      .replace(amountInParens, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean)
    .join(', ');
}
