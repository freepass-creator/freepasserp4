/**
 * 손오공 소유 차량의 carDescription 규격:
 * 첫 줄은 차종·파워트레인·트림, 둘째 줄 이후는 출고 선택옵션이다.
 * 원문 전체는 별도로 보존하고 여기서는 판매/필터용 선택옵션만 만든다.
 */
export function sonokongSelectedOptionsFromDescription(description) {
  const lines = String(description ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return '';

  return lines
    .slice(1)
    .join(', ')
    .replace(/^(?:기본형|프리미엄\s*옵션)\s*[-:：]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
