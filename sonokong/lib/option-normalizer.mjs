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

/** 티카 PC/모바일 상세 HTML이 공통으로 싣는 숨은 jsonData 원문을 읽는다. */
export function tcarDetailFromHtml(value) {
  const html = String(value ?? '');
  const match = html.match(/<input[^>]+id=["']jsonData["'][^>]+value=["']([\s\S]*?)["'][^>]*>/i);
  if (!match) return null;
  const decoded = match[1]
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;|&#160;/gi, ' ');
  try { return JSON.parse(decoded); } catch { return null; }
}

/** 번호판 비교용. 공백·하이픈만 제거하며 임의 문자 보정은 하지 않는다. */
export function normalizePlate(value) {
  return String(value ?? '').replace(/[\s-]+/g, '').trim();
}

export function tcarDetailMatchesPlate(detail, plate) {
  const sourcePlate = detail?.carData?.plateNumber ?? detail?.car?.plateNumber ?? detail?.plateNumber;
  return !!normalizePlate(plate) && normalizePlate(sourcePlate) === normalizePlate(plate);
}

/** 티카 검색 응답은 같은 번호판이 정확히 한 건일 때만 채택한다. */
export function uniqueTcarSaleMatch(value, plate) {
  const wanted = normalizePlate(plate);
  if (!wanted) return null;
  const rows = (value?.result?.data || []).filter((item) => normalizePlate(item?.plateNumber) === wanted);
  return rows.length === 1 && rows[0]?.carId ? rows[0] : null;
}
