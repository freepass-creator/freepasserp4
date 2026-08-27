/**
 * **정산서 A4 — 손오공 견적서 골격 × 우리 상세페이지 규격.**
 *
 * ★사장님 2026-08-27
 *   「손오공견적서와 상품상세 콜라보」 「그냥 손오공 견적서 잘 만들었으니까 그거 최대한 활용하는거로」
 *   「헤더 남색 활용해야지」 「우리 메인컬러를 좀 적당히 써서」
 *   「그리고 차량 뱃지를 왜 넣냐??」 「뭔가 견적서 같은 느낌이 있어야지」
 *
 * ─────────────────────────────────────────────────────────────────────
 * ★★★**뼈대는 손오공 견적서 그대로다.** `C:/dev/sonogong-estimator/src/lib/build-quote-html.js`
 *   를 열어 «구조»를 그대로 옮겼다. 내가 새로 짜면 세 번 다 어긋났다 —
 *   이미 잘 만들어 둔 것이 있으면 그것을 쓴다.
 * ```
 * .hd       풀블리드 헤더 밴드 — 로고·상호 / 우측 메타 3줄
 * .tagline  헤더 아래 띠 한 줄 — 좌 문구 / 우 문구
 * .info     2칸 박스 — 수신 / 발행
 * .sec      소제목(.sec-h, 밑줄 1.5px) + 내용
 * .vcard    좌 이름 / 우 큰 금액 — 왼쪽에 4px 색 바
 * .ctab     색 머리 표 — 라운드 7 · .rl 좌측 라벨열 · tr.pay 강조행
 * .kv       칸 격자
 * .note     연한 안내 박스
 * .ft       어두운 푸터
 * ```
 * ★★**색만 바꿨다.** 손오공 teal(`#0aa2a6`) → **우리 남색 `#1B2A4A`**.
 *   글자 크기·굵기·간격은 우리 `components/ui/tokens.ts` 스케일로 맞췄다(FS 13/12/11/10).
 *
 * ★★**vcard 에는 «상대 이름»을 넣지 않는다.**
 *   견적서는 「차 이름 + 그 차 값」이라 한 칸이 자연스럽지만,
 *   정산서에서 「상대 회사명 + 청구금액」이 한 칸이면 어색하다
 *   (사장님 「손오공렌터카 이름과 청구금액이 같은칸에 있으니까 좀 그래」).
 *   ⇒ 상대는 `.info` 「수신」 칸에 두고, `.vcard` 에는 «정산월·건수 / 금액»만 둔다.
 *
 * ★★**차량번호에 뱃지를 두르지 않는다**(사장님 「차량 뱃지를 왜 넣냐」).
 *   견적서처럼 표의 한 칸이다 — `.ctab` 의 `.rl` 자리.
 *
 * ★★**두 문서는 방향이 반대라 세 가지가 뒤집힌다.**
 * ```
 *           청구서(공급사)         지급명세서(영업채널)
 * 돈        공급사 ─▶ 우리         우리 ─▶ 영업채널
 * 금액말     청구금액               지급금액
 * 계좌      우리 계좌(넣어 주세요)   상대 계좌(보냅니다)
 * ```
 *   ⚠ 계좌를 안 뒤집으면 지급명세서에 «우리 계좌»가 찍혀 나간다. 그건 문서가 아니라 사고다.
 *
 * ★★**선을 어정쩡하게 긋지 않는다** — 사장님 2026-08-27 「어정쩡한 라인같은거 긋지 말고」
 *   「아이콘이랑 텍스트 잘 활용해서 해당 박스를 잘 보여줬으면 좋겠고」.
 * ```
 * 걷어냄   소제목 밑줄(1.5px)        작은 라벨 밑에 그은 토막선 — 나누는 것도 감싸는 것도 아니다
 *         vcard 왼쪽 4px 막대        시작만 있고 끝이 없는 막대
 *         kv 칸마다 오른쪽·아래 선    바깥 테두리와 겹쳐 가장자리가 너덜해진다
 * 대신     아이콘 + 글자로 «칸의 이름»을 세우고, 박스는 «면»으로 보여 준다
 * ```
 *   ★선은 «나누는 자리»에만 긋는다 — 표의 줄 사이. 그 밖엔 면과 여백이 나눈다.
 *
 * ★★★**칸은 전부 «같은 표»다.** 사장님 2026-08-27
 *   「청구금액 요약도 어정쩡한 박스말고 표로 정갈하게」
 *   「회원사 정보 담는곳도 마찬가지고 표 형태만 보기좋게 바꿔서 같은 규격으로 만들면 좋잖아」.
 *   ⇒ `.info`(2칸 박스) · `.vcard`(그라데이션 카드) · `.kv`(격자) 를 **다 없앴다.**
 *     회원사도 청구금액도 정산내역도 같은 `.ctab` — 머리 한 줄이 남색, 왼쪽이 라벨열(`.rl`).
 *   ★같은 규격이면 눈이 한 번만 배우면 된다. 칸마다 모양이 다르면 그때마다 다시 읽어야 한다.
 *
 * ★★★**표를 셋 늘어놓지 않는다.** 사장님 2026-08-27 「다 똑같이 3개를 해버리니까 질린다」.
 *   맞다. 같은 표 셋이면 규격은 맞아도 종이가 지겹다. **표는 둘만 둔다.**
 * ```
 * 밴드      좌 우리 CI·상호  /  우 정산월·발행일        ← 누가 보냈나
 * 맺음      ★「위와 같이 청구합니다」 — **아래**에 둔다.
 *           사장님 2026-08-27 「아래와 같이 청구합니다가 아니라 하단에 위와 같이 청구합니다」.
 *           내역을 보여 준 «다음»에 맺는 것이 맞다 — 위에서 예고할 일이 아니다.
 * 첫 칸      ★좌 「영업수수료 정산서」·정산기간  /  우 회원사(상호·사업자번호·대표)
 *           사장님 2026-08-27 「정산서 텍스트가 그 띠 밑에 첫번째 메인 좌측에 들어가고
 *           그 우측에 회원사 정보 넣자고」 · 「영업수수료 정산서」
 * 금액       ★가로 요약표 — 공급가액 · 부가세 · (환수) · 청구금액. 한눈에 들어온다
 * 정산 내역   세로 표 — 이 종이의 본문이자 근거
 * 계좌       한 줄 — 마지막에 조용히
 * ```
 *   ★볼 곳이 «하나»여야 한다. 금액 요약표가 그 자리다.
 *
 * ★★★**모서리와 간격은 «한 곳»에서 정한다.** 사장님 2026-08-27
 *   「표 라운드가 어디는 각지고 섹션간격이나 이런것도 다 공통규격을 써야 하는데」.
 * ```
 * --r-box   7px   표·박스 모서리 — 네 귀퉁이 다. 표 아래쪽이 각지면 안 된다
 * --sec     10px  칸 사이 간격
 * --cell    5px 10px  표 칸 안 여백 — 위아래 칸이 같은 리듬을 갖는다
 * ```
 *   ⚠ 여기 없는 값을 그 자리에서 적지 마라. 하나 어긋나면 눈이 바로 안다.
 *
 * ★쪽 나눔은 코드가 한다 — 브라우저 자동 분할은 표를 아무 데서나 끊는다.
 * ⚠ 빈 칸은 **붉게 「모름」**. 조용히 비우면 그대로 상대에게 나간다.
 * ★★**종이에서 덜어낸 것** — 사장님 2026-08-27 「정산요약 이런글씨도 필요없고」 「문서번호 필요없고」.
 * ```
 * 뺐다   문서번호                                  받는 사람이 쓸 일이 없다
 *        직인 · 서명란                             구시대적
 * ```
 *   ★★**소제목은 뺐다가 되살렸다**(2026-08-27). 「정산 요약」처럼 «무엇인지 안 말하는»
 *     이름이 문제였지 소제목 자체가 문제가 아니었다. 밑줄 소제목(`.sec-h`)은
 *     견적서 골격의 뼈대다 — 없애면 종이가 한 덩어리로 흘러 어디가 어디인지 안 보인다.
 *     ⇒ 이름을 «그 칸이 무엇인지»로 붙인다 — 청구 금액 · 정산 내역 · 입금 계좌.
 *     ⚠ 「요약」·「안내」 같은 말은 쓰지 않는다. 그건 칸의 «성격»이지 «내용»이 아니다.
 *   ⚠ 문서번호는 **없앤 게 아니라 «종이에서만» 뺐다.** 발행 기록(`v4/settlement_invoices`)에는
 *     그대로 남고, 화면에서 조회한다. 종이에 없다고 추적을 못 하는 게 아니다.
 *   ⚠ 다시 넣고 싶어지면 «그게 없어서 곤란한 사람이 있나»를 먼저 물어라.
 *
 * ★★**문서 이름은 「정산서」다.** 사장님 2026-08-27 「정산서 가 맞는 표현이고」.
 *   「영업수수료 청구서」라고 길게 쓰지 않는다 — 청구도 지급도 «정산»의 두 방향일 뿐이다.
 *   방향은 문구 한 줄이 말한다 — 「아래와 같이 청구합니다」 / 「아래와 같이 지급합니다」.
 *   ⚠ 파일 이름(`invoiceFileName`)은 청구서·지급명세서로 갈라 둔다 — 폴더에서 섞이면 안 된다.
 *
 * ★★**CI 는 워드마크로 쓴다** — 사장님 2026-08-27 「CI 잘 활용하고」.
 *   CI 센터 규격 그대로 — **Exo 2** 로 `freepass`(600) + `mobility`(300), 국문은 아래 작게.
 *   ⚠ 상호를 굵은 고딕으로 크게 쓰는 건 CI 가 아니다. 마크와 워드마크가 CI 다.
 *
 * ★★**두 번 나오는 것은 뺐다.** 「딱 필요한거만」(사장님).
 * ```
 * 발행자 정보   info 칸에서 뺌 — 푸터에 이미 있다
 * 정산기간     tagline 에서 뺌 — info 칸으로 한 번만
 * 청구금액     kv 에서 뺌 — vcard 에 이미 크게 있다
 * ```
 */
import { CORP, CORP_COLOR } from '@/lib/domain/corporate-ci';
import { feeShow, type Invoice } from '@/lib/domain/settlement-invoice';

const S = (v: unknown) => String(v ?? '').trim();
const esc = (v: unknown) => S(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c);
const num = (n: number) => Math.round(n).toLocaleString('ko-KR');
/** ★「없다」가 아니라 「모른다」 — 집 규칙. */
const miss = '<span class="miss">모름</span>';
const shown = (v: unknown) => (S(v) ? esc(v) : miss);
const join = (...v: unknown[]) => v.map(S).filter(Boolean).join(' · ');
const p2 = (n: number) => String(n).padStart(2, '0');
const day = (d: Date) => `${d.getFullYear()}. ${p2(d.getMonth() + 1)}. ${p2(d.getDate())}`;
const monthKo = (m: string) => {
  const x = /^(\d{4})-(\d{2})$/.exec(S(m));
  return x ? `${x[1]}년 ${Number(x[2])}월` : S(m);
};
const period = (m: string) => {
  const x = /^(\d{4})-(\d{2})$/.exec(S(m));
  if (!x) return S(m);
  const y = Number(x[1]); const mo = Number(x[2]);
  return `${y}. ${p2(mo)}. 01 ~ ${p2(mo)}. ${p2(new Date(y, mo, 0).getDate())}`;
};

const NAVY = CORP_COLOR.main;
const DEEP = CORP_COLOR.deep;

/** 우리 마크 — `public/icon.svg` 그대로. 헤더 밴드 위라 바탕을 흰색으로 뒤집는다. */
const MARK = '<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">'
  + '<rect width="512" height="512" rx="96" fill="#ffffff"/>'
  + `<path d="M128 264 l80 80 L384 168" fill="none" stroke="${NAVY}" stroke-width="52" `
  + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * 소제목 아이콘 — lucide 모양을 인라인 SVG 로. **바깥 라이브러리를 부르지 않는다**(종이라서).
 * ★색은 `currentColor` — 소제목 색을 따라간다. 여기서 색을 정하지 않는다.
 */
const ICO: Record<string, string> = {
  회원사: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01"/>',
  금액: '<circle cx="12" cy="12" r="9"/><path d="M8 9l4 6 4-6M8 12h8"/>',
  내역: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  계좌: '<path d="M3 21h18M4 10h16M5 10V8l7-4 7 4v2M7 10v11M12 10v11M17 10v11"/>',
};
const ico = (k: keyof typeof ICO | string) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICO[k] || ''}</svg>`;

/** 한 장에 담기는 표 줄. 첫 장은 헤더·요약이 자리를 먹는다. */
const CAP_SOLO = 12;
const CAP_FIRST = 17;
const CAP_MID = 28;
const CAP_LAST = 14;

/** 줄을 장으로 자른다. 마지막 장 몫을 «먼저» 떼어 둬야 꼬리가 안 잘린다. */
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
  /* ★손오공 견적서 CSS 골격 그대로 · 색만 우리 남색. 크기는 tokens.ts 스케일(FS 13/12/11/10). */
  :root {
    --tl:${NAVY}; --tl-d:${DEEP};
    --ink:#18181b; --mut:#52525b; --faint:#a1a1aa;
    --ln:#d5dae2; --bg:#eef2f8; --neg:#b03a2e;
    /* ★모서리·간격·칸 여백 — 여기 한 곳에서 정한다. 자리마다 다시 적지 않는다. */
    --r-box:7px; --sec:10px; --cell:5px 10px;
  }
  * { box-sizing:border-box; margin:0; }
  html, body { margin:0; background:#fff; }
  .doc {
    width:210mm; height:297mm; padding:0 14mm; background:#fff; color:var(--ink);
    font-family:'Pretendard Variable',Pretendard,'Malgun Gothic',sans-serif;
    font-size:11.5px; line-height:1.5; letter-spacing:-.2px;
    position:relative; overflow:hidden; break-after:page;
    -webkit-print-color-adjust:exact; print-color-adjust:exact;
  }
  .doc:last-child { break-after:auto; }
  .sec, .info, .vcard, .kv { break-inside:avoid; }
  @page { size:A4; margin:0; }
  @media screen { body { background:#e9ecf1; padding:16px 0; } .doc { box-shadow:0 1px 5px rgba(17,20,24,.15); margin:0 auto 16px; } }
  @media print { .noprint { display:none !important; } }

  /* 풀블리드 헤더 밴드 — 견적서와 같은 자리·같은 비율, 색만 남색 */
  .hd { display:flex; justify-content:space-between; align-items:center; margin:0 -14mm; padding:12px 14mm 11px;
    background:linear-gradient(120deg,${NAVY} 0%,${DEEP} 100%); color:#fff; }
  /* ★CI 락업 — 마크 + 워드마크 2줄. 사장님 2026-08-27
     「체크박스가 2줄이랑 거의 같아야 하고 영문CI 아래 한글 좌우폭이 영문CI랑 같아야 하고」
     · 마크 높이 = 워드마크(17 x 1.05) + 사이(2) + 한글(9.5 x 1.25) = 32px
     · 한글 폭  = 영문 폭 — 글자 사이를 벌려 맞춘다 (text-align-last:justify)
     ⚠ 마크를 크게 키우지 마라. 2줄보다 크면 마크가 글자를 누른다.
     ⚠ 한글에 letter-spacing 을 손으로 주지 마라 — 영문 폭이 바뀌면 다시 어긋난다.
       text-align-last 가 «남는 만큼만» 벌려 준다.
     ⚠ 이 자리는 CSS 문자열 «안»이다. JS 주석(/** */)이나 백틱을 쓰면 통째로 깨진다. */
  .hd .bl { display:flex; align-items:center; gap:9px; }
  .hd .bl .mk { width:32px; height:32px; border-radius:8px; background:#fff; padding:2px; flex:none; }
  .hd .bl .mk svg { width:100%; height:100%; display:block; }
  .hd .wm { display:inline-block; }

  /* ★띠 아래 첫 칸 — 좌 문서 이름 / 우 회원사. 이 종이가 «무엇이고 누구 것인지»를 한 줄에. */
  .titlerow { display:flex; justify-content:space-between; align-items:flex-end; gap:14mm;
    margin-top:14px; padding-bottom:10px; border-bottom:2px solid var(--tl); }
  .titlerow .ti { font-size:23px; font-weight:800; letter-spacing:-.5px; color:var(--ink); line-height:1.15; }
  .titlerow .pr { margin-top:4px; font-size:11px; color:var(--mut); font-weight:500; }
  .titlerow .tr { text-align:right; }
  .titlerow .tr .k { font-size:10px; color:var(--faint); font-weight:600;
    display:inline-flex; align-items:center; gap:4px; }
  .titlerow .tr .k .i { width:11px; height:11px; }
  .titlerow .tr .nm { margin-top:3px; font-size:15px; font-weight:700; letter-spacing:-.3px; color:var(--ink); }
  .titlerow .tr .id { margin-top:2px; font-size:10.5px; color:var(--mut); }
  /* ★CI 워드마크 — Exo 2 · freepass(600) + mobility(300). CI 센터 규격 그대로. */
  .hd .co { font-family:'Exo 2','Pretendard Variable',Pretendard,sans-serif; font-size:17px; letter-spacing:-.3px;
    line-height:1.05; white-space:nowrap; }
  .hd .co b { font-weight:600; }
  .hd .co i { font-weight:300; font-style:normal; opacity:.92; }
  /* ★한글을 영문 폭에 맞춘다 — 남는 만큼만 글자 사이가 벌어진다. */
  .hd .ko { display:block; font-size:9.5px; color:#c8d7ee; margin-top:2px; font-weight:500; letter-spacing:0;
    line-height:1.25; text-align:justify; text-align-last:justify; }
  .hd .tt { font-size:12px; color:#dbe6f5; margin-top:5px; font-weight:600; }
  .hd .mt { text-align:right; font-size:10.5px; color:#a9bdda; line-height:1.75; }
  .hd .mt b { color:#fff; font-weight:700; margin-left:7px; font-variant-numeric:tabular-nums; }
  .hd .mt .miss { color:#f0a9a0; font-weight:700; }

  /* ★맺음말 — 글자 한 줄. 박스를 두르지 않는다(사장님 2026-08-27 「박스가 필요한가」).
     한 문장을 상자에 가두면 그 상자가 무슨 칸인 줄 안다. */
  .closing { margin-top:14px; font-size:11.5px; font-weight:700; color:var(--tl-d);
    display:flex; justify-content:space-between; align-items:baseline; }
  .closing span { color:var(--faint); font-weight:500; font-size:10.5px; }
  .pad { padding-top:12px; }

  .sec { margin-top:var(--sec); }
  /* ★밑줄을 긋지 않는다. 아이콘 + 글자가 칸의 이름이고, 박스는 아래 «면»이 보여 준다. */
  .sec-h { font-size:11.5px; font-weight:700; color:var(--tl-d); letter-spacing:-.1px; margin-bottom:6px;
    display:flex; align-items:center; gap:6px; }
  .sec-h .i { width:13px; height:13px; flex:none; opacity:.85; }
  .sec-h .muted { font-weight:500; color:var(--mut); font-size:10px; margin-left:auto; }
  .ctab thead .pgn { font-weight:500; opacity:.75; margin-left:6px; }

  /* ★vcard — 좌 «정산월·건수» / 우 «금액». 상대 이름은 여기 안 넣는다(위 머리말 참고). */
  /* 표 — 견적서 .ctab 그대로. 차량번호는 좌측 라벨열(.rl)이라 뱃지가 필요 없다. */
  .ctab { width:100%; border-collapse:separate; border-spacing:0; }
  .ctab th, .ctab td { border-bottom:1px solid #edf0f4; padding:var(--cell); text-align:center; }
  .ctab thead th { background:var(--tl); color:#fff; font-weight:700; border-bottom:0; font-size:10.5px; }
  .ctab thead th:first-child, .ctab thead th.rl { background:var(--tl-d); color:#fff; border-top-left-radius:var(--r-box); text-align:left; }
  .ctab thead th:last-child { border-top-right-radius:var(--r-box); }
  /* ★아래쪽도 둥글게 — 위만 둥글면 표가 각져 보인다. */
  .ctab tbody tr:last-child th:first-child, .ctab tbody tr:last-child td:first-child { border-bottom-left-radius:var(--r-box); }
  .ctab tbody tr:last-child td:last-child { border-bottom-right-radius:var(--r-box); }
  .ctab .rl { text-align:left; background:#fafbfd; color:var(--mut); font-weight:600; white-space:nowrap; width:110px; }
  /* ★금액 가로 요약표 — 이 종이가 말하는 단 하나. 마지막 칸이 결론이다. */
  .stab { width:100%; border-collapse:separate; border-spacing:0; margin-top:2px; }
  .stab th { background:var(--tl); color:#fff; font-size:10.5px; font-weight:700; padding:5px 12px; text-align:right; }
  .stab th:first-child { background:var(--tl-d); border-top-left-radius:var(--r-box); text-align:left; }
  .stab th:last-child { border-top-right-radius:var(--r-box); }
  .stab td:first-child { border-bottom-left-radius:var(--r-box); }
  .stab td { padding:11px 12px; text-align:right; font-size:14px; font-weight:600; font-variant-numeric:tabular-nums;
    border:1px solid var(--ln); border-top:0; border-left:0; background:#fff; }
  .stab td:first-child { border-left:1px solid var(--ln); text-align:left; font-size:11.5px; font-weight:600; color:var(--mut); }
  .stab td.neg { color:var(--neg); }
  .stab td.k { background:var(--bg); color:var(--tl-d); font-size:20px; font-weight:800; letter-spacing:-.6px;
    border-bottom-right-radius:var(--r-box); }

  /* 한 줄 짜리 — 회원사·계좌. 표로 만들 만큼의 내용이 아니다. */
  .line { display:flex; align-items:baseline; gap:10px; padding:8px 12px; border:1px solid var(--ln);
    border-radius:var(--r-box); background:#fafbfd; font-size:11.5px; }
  .line .k { flex:none; color:var(--faint); font-size:10.5px; font-weight:600; display:inline-flex; align-items:center; gap:4px; }
  .line .k .i { width:12px; height:12px; }
  .line .v { color:var(--ink); font-weight:600; }
  .line .v em { font-style:normal; color:var(--mut); font-weight:500; margin-left:8px; }
  .ctab td { font-variant-numeric:tabular-nums; }
  .ctab td.l { text-align:left; }
  .ctab .sub { display:block; font-size:10px; color:var(--mut); font-weight:400; margin-top:1px; }
  /* ★수수료 산출조건 — 제 칸을 갖는다. 표가 스스로 «어떻게 나왔는지»를 말한다. */
  .ctab td.calc { font-size:10px; color:var(--mut); }
  .ctab td.calc .rt { display:block; font-size:9.5px; color:var(--faint); margin-top:1px; }
  .ctab tr.neg td.calc, .ctab tr.neg td.calc .rt { color:var(--neg); }
  .ctab tr.neg td, .ctab tr.neg th.rl { color:var(--neg); }
  .ctab tr.pay th.rl { color:var(--tl-d); font-weight:800; background:#eef2f8; }
  .ctab tr.pay td { background:#eef2f8; font-weight:700; }
  .ctab tr.pay b { color:var(--tl-d); font-size:15px; font-weight:800; }
  .ctab tbody tr:last-child th, .ctab tbody tr:last-child td { border-bottom:0; }

  /* ★아래 두 줄 — 계좌와 문의처. ★금액은 위 요약표에 이미 크게 있다(사장님 2026-08-27
     「입금계좌도 굳이 거창하게 저렇게 위에 금액있는데」). 여기선 «어디로·누구에게»만 말한다. */
  .foot2 { margin-top:6px; display:flex; justify-content:space-between; gap:10mm; font-size:11px; }
  .foot2 .k { color:var(--faint); font-weight:600; font-size:10px; margin-right:8px; }
  .foot2 > div { color:var(--ink); font-weight:600; }

  /* 발송 전 확인 — 우리끼리 보는 표시. 인쇄하면 사라진다. */
  .warn { margin-top:var(--sec); font-size:10px; color:#c0392b; font-weight:600; }
  .miss { color:#c0392b; font-weight:700; }

  .ft { position:absolute; left:0; right:0; bottom:0; padding:8px 14mm; background:var(--ink); color:#9aa4b0; font-size:10px; line-height:1.55;
    display:flex; justify-content:space-between; align-items:flex-end; gap:10mm; }
  .ft b { color:#e8ecf2; font-weight:700; }
  .ft .pg { white-space:nowrap; }
`;

/**
 * 정산서 한 벌. 줄이 많으면 **여러 장**이 된다.
 *
 * @param inv   `buildInvoice` 가 만든 정산서
 * @param opts  문서번호·발행시각. 없으면 「발행 전」·오늘
 */
export function invoiceDocHtml(inv: Invoice, opts?: { invoiceNo?: string; issuedAt?: number }): string {
  const claim = inv.kind === '청구서';
  const money = claim ? '청구금액' : '지급금액';
  const no = S(opts?.invoiceNo);
  const issued = opts?.issuedAt ? new Date(opts.issuedAt) : new Date();
  /** ★계좌는 방향을 따라 뒤집힌다. 청구서면 «우리 계좌», 지급명세서면 «상대 계좌». */
  const acc = claim ? inv.issuer : inv.receiver;
  const accText = join(acc.bank, acc.account, acc.holder);

  const page0 = true;   // 첫 칸은 1쪽에만 선다 — 아래 map 에서 갈린다
  const plus = inv.lines.filter((l) => !l.minus);
  const pages = paginate(inv.lines);

  const head = (page: number) => `
  <div class="hd">
    <div class="bl">
      <div class="mk">${MARK}</div>
      <div class="wm">
        <div class="co"><b>${esc(CORP.markMain)}</b><i>${esc(CORP.markSub)}</i></div>
        <div class="ko">${esc(CORP.name)}</div>
      </div>
    </div>
    <div class="mt">
      사업자등록번호<b>${esc(CORP.bizNo)}</b>  대표<b>${esc(CORP.ceo)}</b><br>
      정산월<b>${esc(monthKo(inv.month))}</b>  발행<b>${day(issued)}</b>
    </div>
  </div>
`;

  /**
   * 꼬리 — **회사 · 담당 · 계좌를 한 곳에.** 사장님 2026-08-27
   *   「우리 회사 정보에 담당자 안내랑 이메일 같은거 넣으면 계좌 정보도 넣으면 되잖아」.
   *   ⇒ 본문에 계좌 칸을 따로 두지 않는다. 어차피 «우리 정보»라 여기가 제자리다.
   * ⚠ 지급명세서면 계좌가 «상대» 것이라 여기 두면 안 된다 — 그때만 본문에 세운다.
   */
  const foot = (page: number) => `
  <div class="ft">
    <div>
      <b>${esc(CORP.name)}</b>  ·  사업자등록번호 ${esc(CORP.bizNo)}  ·  대표 ${esc(CORP.ceo)}<br>
      ${esc(CORP.addr)}<br>
      담당 ${esc(CORP.phone)}  ·  ${esc(CORP.email)}${
    claim ? `　|　입금계좌 <b>${shown(accText)}</b>` : ''
  }
    </div>
    <div class="pg">${pages.length > 1 ? `${page + 1} / ${pages.length}` : ''}</div>
  </div>`;

  /**
   * 첫 칸 — **좌 문서 이름 / 우 회원사.**
   * ★사장님 2026-08-27 「정산서 텍스트가 그 띠 밑에 첫번째 메인 좌측에 들어가고
   *   그 우측에 회원사 정보 넣자고」 · 「영업수수료 정산서」.
   *   ⇒ 문서 이름은 밴드가 아니라 «본문 첫 줄»에 선다. 밴드는 «누가 보냈나»만 말한다.
   */
  const info = `
  <div class="titlerow">
    <div class="tl">
      <div class="ti">영업수수료 정산서${page0 ? '' : ''}</div>
      <div class="pr">${esc(monthKo(inv.month))}  ·  ${esc(period(inv.month))}</div>
    </div>
    <div class="tr">
      <div class="k">${ico('회원사')}회원사</div>
      <div class="nm">${shown(inv.receiver.name)}</div>
      <div class="id">${inv.receiver.bizNo ? esc(inv.receiver.bizNo) : miss}${
    S(inv.receiver.ceo) ? ` · 대표 ${esc(inv.receiver.ceo)}` : ''
  }</div>
    </div>
  </div>`;

  /**
   * 금액 — **가로 요약표.** 왼쪽에서 오른쪽으로 읽으면 결론이 나온다.
   * ★사장님 2026-08-27 「금액 요약표로 정리해서 보기 좋게」. 마지막 칸이 이 종이의 결론이다.
   */
  const summary = `
  <div class="sec">
    <div class="sec-h">${ico('금액')}${claim ? '청구 금액' : '지급 금액'}<span class="muted">${plus.length}건 · 단위 원</span></div>
    <table class="stab">
      <thead><tr>
        <th>구분</th><th>공급가액</th><th>부가세</th>${inv.clawback ? '<th>환수</th>' : ''}
        <th>${claim ? '청구 금액' : '지급 금액'}</th>
      </tr></thead>
      <tbody><tr>
        <td>${esc(monthKo(inv.month))} 정산</td>
        <td>${num(inv.supply)}</td>
        <td>${num(inv.vat)}</td>
        ${inv.clawback ? `<td class="neg">−${num(inv.clawback)}</td>` : ''}
        <td class="k">${num(inv.total)}</td>
      </tr></tbody>
    </table>
  </div>`;

  /** 표 한 줄 — 차량번호가 좌측 라벨열이라 뱃지가 필요 없다. */
  const row = (l: Invoice['lines'][number]) => `
    <tr${l.minus ? ' class="neg"' : ''}>
      <th class="rl">${esc(l.plate)}</th>
      <td class="l">${shown(l.model)}<span class="sub">${
    // 계약조건 — 누구에게·무슨 상품·몇 개월
    esc(join(l.customer, l.product, l.term ? `${l.term}개월` : '')) || '&nbsp;'
  }</span></td>
      <td class="l calc">${
    // ★산출조건 — 이 수수료가 «어떻게 나왔는지». 칸으로 세워야 표가 스스로 설명한다.
    //   사장님 2026-08-27 「정산내역에 수수료산출조건 이런거 하나 더 있어서」
    l.minus ? esc(join('환수', l.reason)) : esc(l.base)
  }<span class="rt">${l.minus ? '' : esc(feeShow(l.rate))}</span></td>
      <td>${num(l.amount)}</td>
      <td>${num(l.vat)}</td>
      <td><b>${num(l.total)}</b></td>
    </tr>`;

  /**
   * 맺음 + 계좌 — **위 표와 같은 규격.** 사장님 2026-08-27
   *   「하단에 위와 같이 청구합니다」 「아래쪽에도 입금계좌나 보조설명같은거도 위 양식 제대로 맞춰봐」.
   * ★방향에 따라 우리 계좌 / 상대 계좌로 뒤집힌다.
   */
  const payKv = `
  <div class="closing">
    ${claim ? '위와 같이 청구합니다' : '위와 같이 지급합니다'}
    <span>${esc(day(issued))}</span>
  </div>
  ${claim ? '' : `<div class="foot2">
    <div><span class="k">지급 계좌</span>${shown(accText)}</div>
  </div>`}`;

  /**
   * ★**안내 박스를 두지 않는다.** 사장님 2026-08-27 「하단에 이런표도 의미없어」.
   *   산출 방식은 표의 「수수료 산출조건」 칸이 줄마다 이미 말한다 —
   *   같은 말을 아래에 또 적으면 종이만 길어지고 아무도 안 읽는다.
   *   ⚠ 다시 넣고 싶어지면 «그 문장이 없어서 곤란한 사람이 있나»를 먼저 물어라.
   *
   * ★남긴 것은 «발송 전 확인» 한 줄뿐이다. 그건 상대에게 보이는 글이 아니라
   *   **우리끼리 보는 표시**라 `noprint` 다 — 인쇄하면 사라진다.
   */
  const note = inv.missing.length
    ? `<div class="warn noprint">발송 전 확인 — ${esc(inv.missing.join(' / '))}</div>`
    : '';

  return pages.map((chunk, page) => {
    const last = page === pages.length - 1;
    const from = (page === 0 ? 0 : CAP_FIRST + pages.slice(1, page).reduce((s, c) => s + c.length, 0)) + 1;
    return `<div class="doc">
  ${head(page)}
  <div class="pad"></div>
  ${page === 0 ? info + summary : ''}
  <div class="sec">
    <div class="sec-h">${ico('내역')}정산 내역<span class="muted">${
      pages.length > 1 ? `${from}–${from + chunk.length - 1} / ${inv.lines.length}건` : `${plus.length}건`
    } · 단위 원</span></div>
    <table class="ctab">
      <colgroup><col style="width:13%"><col><col style="width:23%"><col style="width:12%"><col style="width:10%"><col style="width:13%"></colgroup>
      <thead><tr><th class="rl">차량번호</th><th>차량 · 계약조건</th><th>수수료 산출조건</th><th>공급가액</th><th>부가세</th><th>합계</th></tr></thead>
      <tbody>
        ${chunk.map(row).join('')}
        ${last ? `<tr class="pay"><th class="rl">합계</th><td class="l" colspan="2">${plus.length}건</td><td>${num(inv.supply)}</td><td>${num(inv.vat)}</td><td><b>${num(inv.total)}</b></td></tr>` : ''}
      </tbody>
    </table>
  </div>
  ${last ? payKv + note : ''}
  ${foot(page)}
</div>`;
  }).join('');
}

/** 문서 여러 장을 한 파일로. 인쇄하면 그대로 A4 다. */
export const invoicePageHtml = (title: string, docs: string) =>
  `<!doctype html><html lang="ko"><head><meta charset="utf-8">`
  + `<meta name="viewport" content="width=device-width,initial-scale=1">`
  + `<title>${esc(title)}</title>`
  + `<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">`
  // ★워드마크 전용 — CI 센터가 쓰는 그 서체다. 본문에는 안 쓴다.
  + `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`
  + `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Exo+2:wght@300;600&display=swap">`
  + `<style>${INVOICE_CSS}</style></head><body>${docs}</body></html>`;
