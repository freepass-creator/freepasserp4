/**
 * **A4 문서 규격 — 우리 집 문서는 다 이 모양이다.**
 *
 * ★사장님 2026-08-26 「손오공 견적기 있잖아 / 거기 보면 견적서 양식있는데 그거보다도 못한걸 주다니」
 *   「A4세로로 줘야지」.
 *   ⇒ 문서를 새로 «지어내지» 않는다. 집에 이미 규격이 있으면 그것을 꺼내 쓴다.
 *
 * ★★이 CSS 는 `lib/server/rental-fact-certificate.ts`(임대차 계약 사실확인서)가 쓰던 것이다.
 *   거기서 굳은 규격이라 그대로 옮겨 «한 곳»에 둔다 — 문서가 늘 때마다 새 CSS 를 쓰면
 *   회사 문서가 저마다 다르게 생기게 된다.
 *
 * 규격 —
 * ```
 * 종이     A4 세로 · 여백 0(문서가 직접 16mm/15mm 를 준다)
 * 글자     Pretendard · 10.5pt · 줄간 1.45
 * 색       머리·구역제목 남색 #1B2A4A · 표머리 회색 #f1f3f6 · 선 #e2e5ea
 * 뼈대     .page > .head / .section(h2 + .kv 또는 .table) / .sign / .foot
 * ```
 * ⚠ 문서마다 색·크기를 바꾸지 않는다. 바꿔야 하면 여기를 바꾼다.
 */

/** 남색 — 회사 문서의 머리 색. */
export const A4_NAVY = '#1B2A4A';

/** A4 세로 한 장짜리 문서의 CSS. `<style>` 안에 그대로 넣는다. */
export const A4_CSS = `@page{size:A4;margin:0}*{box-sizing:border-box}
body{margin:0;background:#fff;color:#18181b;font-family:Pretendard,Arial,sans-serif;font-size:10.5pt;line-height:1.45}
.page{min-height:297mm;padding:16mm 15mm 14mm;position:relative;break-after:page}
.page:last-child{break-after:auto}
.head{border-bottom:2px solid ${A4_NAVY};padding-bottom:5mm;display:flex;justify-content:space-between;align-items:flex-end}
.title{font-size:20pt;font-weight:700;letter-spacing:-.04em;margin:0}
.kind{font-size:9.5pt;color:#52525b;font-weight:600}
.notice{margin:7mm 0 6mm;padding:3.5mm 4mm;border:1px solid #d8dde5;border-left:3px solid ${A4_NAVY};background:#f7f8fa;color:#3f3f46;font-size:9.5pt}
.section{margin-top:5mm;border:1px solid #d8dde5;border-radius:4px;overflow:hidden}
.section h2{margin:0;padding:2.5mm 3.5mm;background:${A4_NAVY};color:#fff;font-size:11pt;font-weight:700}
.kv{display:grid;grid-template-columns:28mm 1fr 28mm 1fr}
.k,.v{min-height:9mm;padding:2.2mm 3mm;border-top:1px solid #e2e5ea}
.k{background:#f1f3f6;color:#52525b;font-size:9.5pt;font-weight:600}
.v{font-weight:500}
.table{width:100%;border-collapse:collapse;table-layout:fixed}
.table th,.table td{padding:2.5mm;border-top:1px solid #e2e5ea;text-align:left;vertical-align:middle;word-break:break-word}
.table th{background:#f1f3f6;color:#52525b;font-size:9.5pt;font-weight:600}
.strong{font-weight:700}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.sign{margin-top:11mm;text-align:right}
.sign .date{margin-bottom:8mm;font-variant-numeric:tabular-nums}
.sign .company{font-size:11pt;font-weight:700}
.sign .meta{margin-top:1mm;color:#52525b;font-size:9.5pt}
.foot{position:absolute;left:15mm;right:15mm;bottom:8mm;padding-top:3mm;border-top:1px solid #e2e5ea;color:#71717a;font-size:9pt;display:flex;justify-content:space-between}
@media print{body{background:#fff}.noprint{display:none!important}}
@media screen{body{background:#eee}.page{width:210mm;margin:6mm auto;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.18)}}`;

/** 값이 비면 «비었다»고 말한다. 조용히 빈칸으로 두면 그 상태로 나간다. */
export const A4_MISSING = '<span style="color:#c0392b">— 비어 있음</span>';

export const a4Escape = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 값 또는 「비어 있음」. */
export const a4Shown = (v: unknown) => (String(v ?? '').trim() ? a4Escape(v) : A4_MISSING);

/** 문서 한 벌을 감싸는 껍데기. */
export const a4Html = (title: string, pages: string, extraCss = '') =>
  `<!doctype html><html lang="ko"><head><meta charset="utf-8">`
  + `<meta name="viewport" content="width=device-width,initial-scale=1">`
  + `<title>${a4Escape(title)}</title><style>${A4_CSS}${extraCss}</style></head><body>${pages}</body></html>`;
