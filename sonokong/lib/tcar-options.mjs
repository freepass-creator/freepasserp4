/** T카 판매 설명에서 명시적인 「추가옵션」 구간만 보수적으로 읽는다. */
export function tcarPaidOptionsFromDescription(value) {
  const lines = String(value ?? '')
    .replace(/\\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/<[^>]+>/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const start = lines.findIndex((line) => /^(?:▶\s*)?(?:추가|선택|유료)\s*옵션\s*[:：]?$/.test(line));
  if (start < 0) return [];

  const options = [];
  for (const rawLine of lines.slice(start + 1)) {
    if (/^[▶✔◈※]/.test(rawLine) || /^(?:사고|차량\s*진단|홈서비스|금융사|결제|찾아)/.test(rawLine)) break;
    if (/^[-·ㆍ]\s*(?:구매\s*확정|T카에서는|성능점검|자사\s*오토케어)/.test(rawLine)) break;

    const numberMarker = /^(?:[1-9]\.(?=(?:\d{2}\.|[A-Za-z가-힣]))|\d+[.)]\s+)/;
    const hasMarker = /^[-+·ㆍ]\s*/.test(rawLine) || numberMarker.test(rawLine);
    const isFirstPlainCandidate = options.length === 0 && rawLine.length <= 120;
    if (!hasMarker && !isFirstPlainCandidate) continue;

    let name = rawLine
      .replace(/^[-+·ㆍ]\s*/, '')
      .replace(numberMarker, '')
      .replace(/\s*\[[\d,]+\s*만?원\].*$/, '')
      .replace(/\s+[=-]\s+.*$/, '')
      .trim();
    if (!name || /[.!?]$/.test(name) || name.length > 80) continue;

    const pieces = name.split(',').map((part) => part.trim()).filter(Boolean).filter((part) => !/^오토$/i.test(part));
    options.push(...pieces);
  }
  return [...new Set(options)];
}
