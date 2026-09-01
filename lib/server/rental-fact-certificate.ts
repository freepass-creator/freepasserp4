/**
 * 기관 제출용 임대차 계약 사실확인서.
 *
 * 본계약의 봉인 PDF와 의도적으로 분리한다. 본계약은 언제나 1계약·1차량이고,
 * 이 문서는 발급 시점에 선택한 확정 계약들을 한 임차인 기준으로 묶어 보여준다.
 */
export type RentalFactCertificateRow = {
  contractCode: string;
  carNumber: string;
  vehicleName: string;
  contractStart: string;
  contractEnd: string;
};

export type RentalFactCertificate = {
  issuedAt: string;
  companyName: string;
  companyCeoTitle: string;
  companyCeo: string;
  companyBizNo: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  rows: RentalFactCertificateRow[];
};

const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const shown = (value: unknown) => escapeHtml(String(value ?? '').trim() || '—');

/** A4 한 장에서 1~N대 사실확인을 발급하는 전용 문서. */
export function buildRentalFactCertificateHtml(document: RentalFactCertificate): string {
  const pages = Array.from({ length: Math.ceil(document.rows.length / 8) }, (_, pageIndex) => document.rows.slice(pageIndex * 8, (pageIndex + 1) * 8));
  const issuedAt = shown(document.issuedAt);
  const pageHtml = pages.map((chunk, pageIndex) => {
    const rows = chunk.map((row, index) => `
    <tr>
      <td class="num">${pageIndex * 8 + index + 1}</td>
      <td>${shown(row.contractCode)}</td>
      <td class="strong">${shown(row.carNumber)}</td>
      <td>${shown(row.vehicleName)}</td>
      <td class="period">${shown(row.contractStart)} ~ ${shown(row.contractEnd)}</td>
    </tr>`).join('');
    const isFirst = pageIndex === 0;
    const isLast = pageIndex === pages.length - 1;
    return `<main class="page">
    <header class="head"><div><div class="kind">발급용 부속서류 · 전자계약 완료 기록 기준</div><h1 class="title">임대차 계약 사실확인서${isFirst ? '' : ' (계속)'}</h1></div><div class="kind">선택 차량 ${document.rows.length}대 · ${pageIndex + 1}/${pages.length}쪽</div></header>
    ${isFirst ? `<p class="notice">본 확인서는 과태료·범칙금 부과 대상자 변경 및 임대차 사실 확인을 위하여 관련 기관에 제출할 목적으로 발급됩니다. 아래 차량별 임대차 기간은 전자계약 완료 후 확정된 인도 기록을 기준으로 합니다.</p>
    <section class="section"><h2>임차인</h2><div class="kv"><div class="k">성명</div><div class="v strong">${shown(document.customerName)}</div><div class="k">연락처</div><div class="v">${shown(document.customerPhone)}</div><div class="k">주소</div><div class="v" style="grid-column:span 3">${shown(document.customerAddress)}</div></div></section>` : ''}
    <section class="section"><h2>임대차 차량 · 기간</h2><table class="table"><thead><tr><th>순번</th><th>계약번호</th><th>차량번호</th><th>차명</th><th>임대차 기간</th></tr></thead><tbody>${rows}</tbody></table></section>
    ${isLast ? `<p class="statement">위 차량은 <b>임대인(회사)</b> 소유이며, 위 <b>임차인</b>이 각 차량별 임대차 기간 동안 임차하여 사용하고 있음을 확인합니다. 따라서 각 기간 중 발생한 과태료·범칙금의 부과 대상자는 <b>임차인</b>입니다.</p>
    <div class="sign"><div class="date">${issuedAt}</div><div class="company">${shown(document.companyName)} (직인)</div><div class="meta">${shown(document.companyCeoTitle)} ${shown(document.companyCeo)} · 사업자등록번호 ${shown(document.companyBizNo)}</div></div>` : ''}
    <footer class="foot"><span>${shown(document.companyName)}</span><span>임대차 계약 사실확인서 · 발급용</span></footer>
  </main>`;
  }).join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>임대차 계약 사실확인서</title>
  <style>
    @page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;background:#fff;color:#18181b;font-family:Pretendard,Arial,sans-serif;font-size:10.5pt;line-height:1.45}.page{min-height:297mm;padding:16mm 15mm 14mm;position:relative;break-after:page}.page:last-child{break-after:auto}.head{border-bottom:2px solid #1B2A4A;padding-bottom:5mm;display:flex;justify-content:space-between;align-items:flex-end}.title{font-size:20pt;font-weight:700;letter-spacing:-.04em}.kind{font-size:9.5pt;color:#52525b;font-weight:600}.notice{margin:7mm 0 6mm;padding:3.5mm 4mm;border:1px solid #d8dde5;border-left:3px solid #1B2A4A;background:#f7f8fa;color:#3f3f46;font-size:9.5pt}.section{margin-top:5mm;border:1px solid #d8dde5;border-radius:4px;overflow:hidden}.section h2{margin:0;padding:2.5mm 3.5mm;background:#1B2A4A;color:#fff;font-size:11pt;font-weight:700}.kv{display:grid;grid-template-columns:28mm 1fr 28mm 1fr}.k,.v{min-height:9mm;padding:2.2mm 3mm;border-top:1px solid #e2e5ea}.k{background:#f1f3f6;color:#52525b;font-size:9.5pt;font-weight:600}.v{font-weight:500}.table{width:100%;border-collapse:collapse;table-layout:fixed}.table th,.table td{padding:2.5mm 2.5mm;border-top:1px solid #e2e5ea;text-align:left;vertical-align:middle;word-break:break-word}.table th{background:#f1f3f6;color:#52525b;font-size:9.5pt;font-weight:600}.table .num{width:8%;text-align:center}.table th:nth-child(2){width:18%}.table th:nth-child(3){width:17%}.table th:nth-child(4){width:27%}.table .period{font-variant-numeric:tabular-nums}.strong{font-weight:700}.statement{margin:7mm 0 0;line-height:1.62}.sign{margin-top:11mm;text-align:right}.sign .date{margin-bottom:8mm;font-variant-numeric:tabular-nums}.sign .company{font-size:11pt;font-weight:700}.sign .meta{margin-top:1mm;color:#52525b;font-size:9.5pt}.foot{position:absolute;left:15mm;right:15mm;bottom:8mm;padding-top:3mm;border-top:1px solid #e2e5ea;color:#71717a;font-size:9pt;display:flex;justify-content:space-between}@media print{body{background:#fff}}
  </style></head><body>${pageHtml}</body></html>`;
}
