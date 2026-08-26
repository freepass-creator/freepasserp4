/**
 * **정산서 A4 — 상대 회사가 주인공인 문서.**
 *
 * ★사장님 2026-08-26
 *   「맨위에 거기를 왜이렇게 크게 하냐 허접해 졌다」
 *   「어차피 우리회사는 프리패스인거 아니까 상대방 회사를 CI활용해서」
 *   「은은하게 해야지 엑셀로 만든거 같지 않은 디자인이 들어간 정산서」
 *   「이걸 좀 라운드값 많이 빼고 / 프리패스 상세페이지 느낌나게끔 / 격식있게」
 *   「손오공렌터카 이름과 청구금액이 같은칸에 있으니까 좀 그래」
 *   「밑에 짤리면 정산서 2페이지가 되어야지」
 *   「그냥 대상에 회사명, 사업자등록번호, 대표자 정도만 있으면 돼 / 주소지 이런거 필요없다고」
 *   「1. 정산내역 이런거도 촌스러워 / 이거 엑셀로 만든게 아니라 erp로 디자인한 느낌을 뽝 줘야지」
 * ★사장님 2026-08-26 (재지시)
 *   「우리가 엑셀로 만드는것도 아닌데」
 *   「불필요한 정보는 줄 필요가 없잖아」
 *   「좀 디자인을 트렌디하게 쓰고 차량번호 뱃지같은거 억지야」
 *
 * ─────────────────────────────────────────────────────────────────────
 * 쓰는 것 — `docs/DESIGN_SPEC_2026-08-20.md` cursor-b · 계약서와 같은 문서 문법
 * ```
 * 층        면 + 1px 선. 그림자 없음. 남색은 머리 밑줄·금액 숫자만
 * 라운드    4px. 카드로 표를 감싸지 않는다
 * 뱃지      안 쓴다. 차번은 글자고, 상태 알약은 화면용이다
 * 굵기      700 이 끝. 영문 라벨·모노그램·직인 상자 없음
 * 대상      상호 · 사업자등록번호 · 대표자. 주소·전화·홈페이지는 안 싣는다
 * ```
 * 엑셀 내려받기는 따로 있다(`settlement-invoice-xlsx`). 이 파일은 **읽는 종이**다.
 */
import { CORP, CORP_COLOR } from '@/lib/domain/corporate-ci';
import type { Invoice } from '@/lib/domain/settlement-invoice';

const S = (v: unknown) => String(v ?? '').trim();
const esc = (v: unknown) => S(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c);
const num = (n: number) => Math.round(n).toLocaleString('ko-KR');
const miss = '<span class="miss">모름</span>';
const shown = (v: unknown) => (S(v) ? esc(v) : miss);
const join = (...v: unknown[]) => v.map(S).filter(Boolean).join(' · ');
const p2 = (n: number) => String(n).padStart(2, '0');
const dateKo = (d = new Date()) => `${d.getFullYear()}년 ${p2(d.getMonth() + 1)}월 ${p2(d.getDate())}일`;
const monthKo = (m: string) => {
  const x = /^(\d{4})-(\d{2})$/.exec(S(m));
  return x ? `${x[1]}년 ${Number(x[2])}월` : S(m);
};
const periodOf = (m: string) => {
  const x = /^(\d{4})-(\d{2})$/.exec(S(m));
  if (!x) return S(m);
  const y = Number(x[1]);
  const mo = Number(x[2]);
  return `${y}.${p2(mo)}.01 ~ ${y}.${p2(mo)}.${p2(new Date(y, mo, 0).getDate())}`;
};

const NAVY = CORP_COLOR.main;

const CI_SVG = '<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">'
  + `<rect width="512" height="512" rx="96" fill="${NAVY}"/>`
  + '<path d="M128 264 l80 80 L384 168" fill="none" stroke="#ffffff" stroke-width="52" '
  + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** 첫 장은 거래처·금액이, 마지막 장은 서명만 자리를 먹는다. */
const CAP_SOLO = 14;
const CAP_FIRST = 18;
const CAP_MID = 24;
const CAP_LAST = 16;

function paginate<T>(lines: T[]): T[][] {
  const n = lines.length;
  if (n <= CAP_SOLO) return [lines.slice()];
  if (n <= CAP_FIRST + CAP_LAST) {
    const first = Math.min(CAP_FIRST, n - 1);
    return [lines.slice(0, first), lines.slice(first)];
  }
  const out: T[][] = [lines.slice(0, CAP_FIRST)];
  let i = CAP_FIRST;
  while (n - i > CAP_LAST) {
    const take = Math.min(CAP_MID, n - i - CAP_LAST);
    out.push(lines.slice(i, i + take));
    i += take;
  }
  out.push(lines.slice(i));
  return out;
}

export const INVOICE_CSS = `
  @page { size:A4 portrait; margin:0; }
  :root {
    --nv:${NAVY};
    --ink:#18181b; --mut:#52525b; --weak:#8a8f98;
    --ln:#e2e5ea; --hair:#edf0f3; --th:#f7f8fa;
    --neg:#b03a2e;
  }
  * { box-sizing:border-box; }
  html, body { margin:0; padding:0; background:#fff; }
  body {
    font-family:Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;
    color:var(--ink); font-size:11px; line-height:1.45;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
    font-variant-numeric:tabular-nums;
  }
  .doc {
    width:210mm; height:297mm; padding:16mm 16mm 20mm; margin:0 auto;
    position:relative; overflow:hidden; background:#fff; break-after:page;
  }
  .doc:last-child { break-after:auto; }
  @media screen {
    body { background:#f6f7f9; padding:16px 0; }
    .doc { box-shadow:0 1px 2px rgba(15,27,53,.06); margin-bottom:16px; }
  }
  @media print { .noprint { display:none !important; } }

  .hd {
    padding-bottom:4mm; border-bottom:2px solid var(--nv);
    display:flex; justify-content:space-between; align-items:flex-end;
  }
  .hd .bl { display:flex; align-items:center; gap:8px; }
  .hd .lg { width:18px; height:18px; flex:none; }
  .hd .lg svg { width:18px; height:18px; display:block; }
  .hd .co { font-family:'Exo 2',Pretendard,sans-serif; font-size:13px; line-height:1.1; color:var(--nv); }
  .hd .co b { font-weight:600; }
  .hd .co i { font-weight:300; font-style:normal; }
  .hd .tt { font-size:9px; color:var(--weak); margin-top:2px; }
  .hd .rt { text-align:right; }
  .hd .dt { font-size:16px; font-weight:700; letter-spacing:-.3px; color:var(--ink); line-height:1.15; }
  .hd .dt small { font-size:10px; font-weight:400; color:var(--mut); margin-left:5px; letter-spacing:0; }
  .hd .kind { margin-top:2px; font-size:10px; color:var(--mut); }

  .meta {
    margin-top:2.5mm; display:flex; justify-content:flex-end; gap:7mm;
    font-size:9px; color:var(--weak);
  }
  .meta b { color:var(--mut); font-weight:600; margin-left:4px; }

  .to { margin-top:10mm; }
  .to .nm { font-size:18px; font-weight:700; letter-spacing:-.5px; line-height:1.2; }
  .to .id { margin-top:3px; font-size:10px; color:var(--mut); }
  .to .id .sep { color:var(--ln); margin:0 6px; }

  .amt {
    margin-top:8mm; padding-bottom:4mm; border-bottom:1px solid var(--ln);
    display:flex; justify-content:space-between; align-items:flex-end; gap:8mm;
  }
  .amt .k { font-size:11px; color:var(--mut); }
  .amt .k b { display:block; margin-top:2px; font-size:12px; font-weight:600; color:var(--ink); }
  .amt .v { text-align:right; }
  .amt .big { font-size:26px; font-weight:700; letter-spacing:-.8px; line-height:1; color:var(--nv); }
  .amt .big i { font-style:normal; font-size:12px; font-weight:500; margin-left:3px; letter-spacing:0; color:var(--mut); }
  .amt .sub { margin-top:4px; font-size:9px; color:var(--weak); }
  .amt .sub .neg { color:var(--neg); }

  .acc { margin-top:3mm; font-size:10px; color:var(--mut); display:flex; justify-content:space-between; gap:8mm; }
  .acc b { color:var(--ink); font-weight:600; }

  .lines { margin-top:8mm; }
  .ctab { width:100%; border-collapse:collapse; }
  .ctab thead th {
    background:var(--th); color:var(--mut); font-size:9px; font-weight:600;
    padding:2.2mm 2.5mm; text-align:left; white-space:nowrap;
    border-top:1px solid var(--ln); border-bottom:1px solid var(--ln);
  }
  .ctab thead th.n { text-align:right; }
  .ctab tbody td {
    padding:2.4mm 2.5mm; border-bottom:1px solid var(--hair);
    font-size:10.5px; vertical-align:top; word-break:keep-all;
  }
  .ctab tbody tr:last-child td { border-bottom:1px solid var(--ln); }
  .ctab td.n { text-align:right; white-space:nowrap; }
  .ctab td .m { font-weight:500; }
  .ctab td .s { display:block; margin-top:1px; font-size:9px; color:var(--weak); }
  .ctab td.plate { font-weight:600; letter-spacing:-.2px; white-space:nowrap; }
  .ctab td .won { font-weight:700; }
  .ctab tbody tr.neg td, .ctab tbody tr.neg td .m, .ctab tbody tr.neg td .won, .ctab tbody tr.neg td.plate { color:var(--neg); }
  .ctab tfoot td {
    padding:2.6mm 2.5mm; border-top:1.5px solid var(--nv);
    font-size:10.5px; font-weight:700;
  }
  .ctab tfoot td:first-child { text-align:left; color:var(--mut); font-weight:600; font-size:10px; }
  .ctab tfoot td.n { text-align:right; }

  .sign { margin-top:10mm; text-align:right; }
  .sign .txt { font-size:10px; color:var(--mut); }
  .sign .d { margin-top:6mm; font-size:11px; font-weight:600; color:var(--ink); }
  .sign .c { margin-top:2px; font-size:12px; font-weight:700; color:var(--ink); }

  .ft {
    position:absolute; left:16mm; right:16mm; bottom:9mm; padding-top:3mm;
    border-top:1px solid var(--hair); font-size:8.5px; color:var(--weak); line-height:1.55;
    display:flex; justify-content:space-between; align-items:flex-end; gap:10mm;
  }
  .ft b { color:var(--mut); font-weight:600; }
  .ft .pg { white-space:nowrap; }
  .miss { color:#c0392b; font-weight:600; }
`;

export function invoiceDocHtml(inv: Invoice, opts?: { invoiceNo?: string; issuedAt?: number }): string {
  const claim = inv.kind === '청구서';
  const money = claim ? '청구금액' : '지급금액';
  const no = S(opts?.invoiceNo);
  const issued = opts?.issuedAt ? new Date(opts.issuedAt) : new Date();
  const acc = claim ? inv.issuer : inv.receiver;
  const accText = join(acc.bank, acc.account, acc.holder);
  const plus = inv.lines.filter((l) => !l.minus);
  const minus = inv.lines.filter((l) => l.minus);
  const pages = paginate([...plus, ...minus]);
  const sum = (ls: Invoice['lines'], k: 'amount' | 'vat' | 'total') => ls.reduce((a, l) => a + l[k], 0);
  const sep = '<span class="sep">·</span>';

  const head = (page: number) => `
  <header class="hd">
    <div class="bl">
      <div class="lg">${CI_SVG}</div>
      <div>
        <div class="co"><b>${esc(CORP.markMain)}</b><i>${esc(CORP.markSub)}</i></div>
        <div class="tt">${esc(CORP.name)}</div>
      </div>
    </div>
    <div class="rt">
      <div class="dt">영업수수료 정산서${page > 0 ? '<small>(계속)</small>' : ''}</div>
      <div class="kind">${esc(inv.kind)} · ${esc(monthKo(inv.month))}</div>
    </div>
  </header>
  <div class="meta">
    <span>문서번호<b>${no ? esc(no) : '<span class="miss">발행 전</span>'}</b></span>
    <span>정산기간<b>${esc(periodOf(inv.month))}</b></span>
    <span>발행<b>${dateKo(issued)}</b></span>
  </div>`;

  const foot = (page: number) => `
  <footer class="ft">
    <div>
      <b>${esc(CORP.name)}</b> · 사업자등록번호 ${esc(CORP.bizNo)} · 대표 ${esc(CORP.ceo)}<br>
      ${esc(CORP.addr)} · ${esc(CORP.phone)} · ${esc(CORP.web)}
    </div>
    <div class="pg">${pages.length > 1 ? `${page + 1} / ${pages.length}` : ''}</div>
  </footer>`;

  const partyBlock = `
  <section class="to">
    <div class="nm">${shown(inv.receiver.name)}</div>
    <div class="id">사업자등록번호 ${
    inv.receiver.bizNo ? esc(inv.receiver.bizNo) : miss
  }${sep}대표자 ${shown(inv.receiver.ceo)}</div>
  </section>`;

  const amount = `
  <section class="amt">
    <div class="k">${esc(monthKo(inv.month))} 정산<b>${esc(money)}</b></div>
    <div class="v">
      <div class="big">${num(inv.total)}<i>원</i></div>
      <div class="sub">공급가액 ${num(inv.supply)} · 부가세 ${num(inv.vat)}${
    inv.clawback ? ` · 환수 <span class="neg">−${num(inv.clawback)}</span>` : ''
  }</div>
    </div>
  </section>
  <div class="acc">
    <span>${claim ? '입금계좌' : '지급계좌'}</span>
    <b>${shown(accText)}</b>
  </div>`;

  const lineRow = (l: Invoice['lines'][number]) => {
    const what = join(l.product, l.term ? `${l.term}개월` : '');
    const why = l.minus ? join('환수', l.reason) : '';
    return `
    <tr${l.minus ? ' class="neg"' : ''}>
      <td class="plate">${esc(l.plate)}</td>
      <td>
        <span class="m">${shown(l.model)}</span>
        ${S(l.customer) ? `<span class="s">${esc(l.customer)}</span>` : ''}
      </td>
      <td>
        <span class="m">${esc(what) || '—'}</span>
        ${why ? `<span class="s">${esc(why)}</span>` : ''}
      </td>
      <td class="n">${num(l.amount)}</td>
      <td class="n">${num(l.vat)}</td>
      <td class="n"><span class="won">${num(l.total)}</span></td>
    </tr>`;
  };

  const COLS = `<colgroup><col style="width:16%"><col style="width:28%"><col style="width:22%">
      <col style="width:12%"><col style="width:10%"><col style="width:12%"></colgroup>`;
  const HEAD = `<thead><tr>
      <th>차량번호</th><th>차량</th><th>상품</th>
      <th class="n">공급가액</th><th class="n">부가세</th><th class="n">합계</th>
    </tr></thead>`;

  const sign = `
  <section class="sign">
    <div class="txt">위 내역을 확인하여 발행합니다.</div>
    <div class="d">${dateKo(issued)}</div>
    <div class="c">${esc(CORP.name)}  대표이사 ${esc(CORP.ceo)}</div>
  </section>`;

  return pages.map((chunk, page) => {
    const last = page === pages.length - 1;
    return `<section class="doc">
  ${head(page)}
  ${page === 0 ? partyBlock + amount : ''}
  <section class="lines">
    <table class="ctab">
      ${COLS}${HEAD}
      <tbody>${chunk.map(lineRow).join('')}</tbody>
      ${last ? `<tfoot><tr>
        <td colspan="3">${money}</td>
        <td class="n">${num(inv.supply)}</td><td class="n">${num(inv.vat)}</td><td class="n">${num(inv.total)}</td>
      </tr></tfoot>` : ''}
    </table>
  </section>
  ${last ? sign : ''}
  ${foot(page)}
</section>`;
  }).join('');
}

export const invoicePageHtml = (title: string, docs: string) =>
  `<!doctype html><html lang="ko"><head><meta charset="utf-8">`
  + `<meta name="viewport" content="width=device-width,initial-scale=1">`
  + `<title>${esc(title)}</title>`
  + `<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">`
  + `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`
  + `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Exo+2:wght@300;400;600;700&display=swap">`
  + `<style>${INVOICE_CSS}</style></head><body>${docs}</body></html>`;
