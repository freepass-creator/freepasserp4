/**
 * 본계약과 시점·서명자가 다른 부속문서를 한 PDF로 봉인하지 않는다.
 * 원본 HTML은 편집/검토 하네스 때문에 전체 서류를 유지하고, 발송 Snapshot을 그릴 때만 분리한다.
 */
export function stripDetachedEsignAppendices(source: string) {
  const cut = (html: string, start: string, end: string) => {
    const from = html.indexOf(start);
    if (from < 0) return html;
    const to = html.indexOf(end, from + start.length);
    return to < 0 ? html : `${html.slice(0, from)}${html.slice(to)}`;
  };
  let html = source;
  html = cut(html, '<!-- ============== 부속서류 1 · 차량 인수증', '<!-- ============== 부속서류 2');
  html = cut(html, '<!-- ============== 부속서류 7 · 자동이체(CMS)', '<!-- ============== 부속서류 8');
  html = cut(html, '<!-- ============== 부속서류 8 · 연대보증', '<script>');
  return html;
}
