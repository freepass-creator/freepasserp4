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
import { dueDate } from '@/lib/domain/settlement-cycle';
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

/**
 * **결제일** — 날짜는 `settlement-cycle` 에서 온다. 여기서 정하지 않는다.
 *
 * ★청구서인데 「언제까지 넣으세요」가 없었다. 받는 쪽이 제일 먼저 묻는 게 그건데
 *   종이가 답을 안 했다. 금액·계좌만 있고 기한이 없으면 «언젠가»가 된다.
 * ★종이와 알림이 «같은 날짜»를 봐야 한다 — 한쪽만 고치면
 *   「10일까지」라고 보내 놓고 15일에야 독촉하게 된다.
 */
const dueDay = (m: string) => { const d = dueDate(m); return d ? day(d) : ''; };

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

/**
 * 한 장에 담기는 표 줄. 장마다 «표 밖»이 먹는 자리가 달라서 넷으로 나뉜다.
 *
 * ★짐작하지 말고 **잰 값에서 뽑는다** — scripts/check-invoice-overflow.mjs
 *   2026-08-27 에 섹션 간격을 10→18 로 넓혔더니 두 장이 꼬리를 덮었다.
 *   화면에선 안 보이고 인쇄해야 드러난다.
 *
 * ```
 * 쓸 수 있는 높이            1057.8px   (A4 297mm 에서 꼬리 위까지)
 * 표 한 줄                     44.3px
 *
 *            표 밖이 먹는 자리                     남는 줄
 * 한장        띠·제목·요약·소제목·합계·청구안내·맺음말       9
 * 첫장        띠·제목·요약·소제목                      14
 * 가운데       띠·소제목                             18
 * 끝장        띠·소제목·합계·청구안내·맺음말             13
 * ```
 * ⚠ **칸 하나 고치면 상한이 흔들린다.** 2026-08-27 하루에 세 번 흔들렸다 —
 *   섹션 간격을 넓혔고, 안내를 가로에서 세로로 눕혔고, 안내에 두 줄(기한·계산서)을 더했다.
 *   그때마다 한 장에 들어가는 줄이 줄었다. 고치고 나면 «반드시» 넘침 검사를 돌린다.
 * ⚠ 간격·글자크기를 건드리면 이 숫자가 다 흔들린다. 반드시 넘침 검사를 다시 돌린다.
 */
const CAP_SOLO = 10;
const CAP_FIRST = 14;
const CAP_MID = 18;
const CAP_LAST = 14;

/**
 * 줄을 장으로 자른다.
 *
 * ★**장수를 먼저 정하고, 그 다음에 고르게 나눈다.**
 *   앞 장부터 꽉꽉 채우면 마지막에 자투리가 남는다 — 2026-08-27 에 29줄이
 *   14 / **1** / 14 로 갈려 가운데 장에 한 줄만 덩그러니 있었다.
 *   장수는 어차피 3장으로 같은데 보기만 흉하다. 9 / 12 / 8 이 낫다.
 *
 * ⚠ 장마다 «표 밖»이 먹는 자리가 달라서 담을 수 있는 줄이 다르다.
 *   그래서 그냥 n/장수 로 나누면 안 되고, 장별 상한에 «비례»해서 나눈다.
 */
function paginate<T>(lines: T[]): T[][] {
  const n = lines.length;
  if (n <= CAP_SOLO) return [lines.slice()];

  // ① 몇 장이면 담기나 — 가장 적은 장수를 찾는다
  const capsFor = (p: number) => p === 1 ? [CAP_SOLO]
    : [CAP_FIRST, ...Array<number>(Math.max(0, p - 2)).fill(CAP_MID), CAP_LAST];
  let pages = 2;
  while (capsFor(pages).reduce((a, c) => a + c, 0) < n) pages++;
  const caps = capsFor(pages);

  // ② 상한에 비례해 나눠 담고, 남는 줄은 여유 있는 장에 하나씩
  const room = caps.reduce((a, c) => a + c, 0);
  const take = caps.map((c) => Math.floor((n * c) / room));
  let rest = n - take.reduce((a, c) => a + c, 0);
  for (let i = 0; rest > 0; i = (i + 1) % pages) {
    if (take[i] < caps[i]) { take[i]++; rest--; }
  }

  const out: T[][] = [];
  let i = 0;
  for (const t of take) { out.push(lines.slice(i, i + t)); i += t; }
  return out;
}

export const INVOICE_CSS = `
  /* ★손오공 견적서 CSS 골격 그대로 · 색만 우리 남색. 크기는 tokens.ts 스케일(FS 13/12/11/10). */
  :root {
    --tl:${NAVY}; --tl-d:${DEEP};
    --ink:#18181b; --mut:#52525b; --faint:#a1a1aa;
    --ln:#d5dae2; --bg:#eef2f8; --neg:#b03a2e;
    /* ★모서리·간격·칸 여백 — 여기 한 곳에서 정한다. 자리마다 다시 적지 않는다.
       ⚠ 2026-08-27 재 보니 셋이 맨숫자로 박혀 있었다(.pad 12 · .titlerow 14 · .closing 14).
         값은 맞았지만 «규격 밖»이라 한 곳을 고쳐도 안 따라온다. 이름을 붙였다.

       ★★★**소제목 «위»가 «아래»보다 넓어야 한다.**
         처음엔 위 10 · 아래 8 로 거의 같아서 소제목이 어느 표 것인지 안 붙었다.
         소제목과 그 표가 «한 덩이»로 보이려면 위가 아래의 세 배쯤 돼야 한다.
             위 --sec 18   ↔   아래 --sec-h 6
         ⚠ 간격을 늘릴 땐 «둘 다» 늘리지 마라. 늘리는 건 위뿐이다. */
    --r-box:7px;      /* 표·박스 모서리 — 네 귀퉁이 다 */
    --sec-h:6px;      /* 소제목 → «그 소제목이 이끄는» 내용 */
    --sec:18px;       /* 칸 사이 — 소제목 «위» */
    --sec-lg:24px;    /* 단락이 바뀌는 자리 — 띠 다음 첫 칸, 맺음말 앞 */
    --cell:5px 10px;  /* 표 칸 안 여백 */
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
     ★마크는 글자 «옆»에 선다. 위에 얹지 않는다 —
       사장님 2026-08-27 「체크박스 가로로 놓으라니까 왜 위에 올려놔」.
     ⚠ 마크를 크게 키우지 마라. 2줄보다 크면 마크가 글자를 누른다.
     ⚠⚠ 이 자리는 CSS 문자열 «안»이다. 백틱도, 별표+빗금도 쓰면 안 된다.
       ★2026-08-27 에 바로 이 경고문이 CSS 를 깼다 — 경고를 적으면서
       그 «별표 빗금»을 그대로 써 버렸고, 주석이 거기서 끝나
       바로 아래 display:flex 한 줄이 통째로 먹혀 마크가 위로 올라갔다.
       한 줄이 사라져도 나머지는 멀쩡히 그려져서 «왜 깨졌는지»가 안 보인다. */
  .hd .bl { display:flex; align-items:center; gap:9px; }
  .hd .bl .mk { width:32px; height:32px; border-radius:8px; background:#fff; padding:2px; flex:none; }
  .hd .bl .mk svg { width:100%; height:100%; display:block; }
  .hd .wm { display:inline-block; }

  /* ★띠 아래 첫 칸 — 좌 문서 이름 / 우 회원사. 이 종이가 «무엇이고 누구 것인지»를 한 줄에. */
  .titlerow { display:flex; justify-content:space-between; align-items:flex-end; gap:14mm;
    padding-bottom:var(--sec-h); border-bottom:2px solid var(--tl); }
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
  /* ★한글을 영문 폭에 맞춘다 — 낱자를 «직접» 나눠 놓는다.
     ⚠ text-align:justify 로 두 번 실패했다. 벌어질 자리가 띄어쓰기 한 곳뿐이라
       여백이 거기로 다 몰려 「프리패스모빌리티 ——— 주식회사」가 됐고,
       띄어쓰기를 빼니 이번엔 「프 리 패 스 …」로 낱자가 다 흩어졌다.
       text-justify:inter-character 는 크롬이 안 듣는다 — 재 보니 띄어쓰기가 28.6px,
       낱자는 8.2px 였다. **브라우저 기능에 기대지 않는다.**
     ⇒ 낱자를 각각 넣고 flex space-between 으로 고르게 나눈다.
       「주식회사」 앞 한 칸은 margin 으로 «따로» 준다 —
       그래야 균등하면서도 상호로 읽힌다
       (사장님 2026-08-27 「양쪽 균등 좋은데 그래도 주식회사 앞에 한칸은 띄어야지」). */
  .hd .ko { display:flex; justify-content:space-between; font-size:9.5px; color:#c8d7ee;
    margin-top:2px; font-weight:500; line-height:1.25; }
  .hd .ko i { font-style:normal; }
  .hd .ko i.w { margin-left:4px; }   /* 「주식회사」 앞 한 칸 */
  .hd .mt { text-align:right; font-size:10.5px; color:#a9bdda; line-height:1.75; }
  .hd .mt b { color:#fff; font-weight:700; margin-left:7px; font-variant-numeric:tabular-nums; }
  .hd .mt .miss { color:#f0a9a0; font-weight:700; }

  /* ★맺음말 — 글자 한 줄. 박스를 두르지 않는다(사장님 2026-08-27 「박스가 필요한가」).
     한 문장을 상자에 가두면 그 상자가 무슨 칸인 줄 안다. */
  .closing { margin-top:var(--sec-lg); font-size:11.5px; font-weight:700; color:var(--tl-d);
    display:flex; justify-content:space-between; align-items:baseline; }
  .closing span { color:var(--faint); font-weight:500; font-size:10.5px; }
  .pad { padding-top:var(--sec-lg); }

  .sec { margin-top:var(--sec); }
  /* ★밑줄을 긋지 않는다. 아이콘 + 글자가 칸의 이름이고, 박스는 아래 «면»이 보여 준다. */
  .sec-h { font-size:11.5px; font-weight:700; color:var(--tl-d); letter-spacing:-.1px; margin-bottom:var(--sec-h);
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
  .stab { width:100%; border-collapse:separate; border-spacing:0; }
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
  /* ★세로 표 — 라벨이 왼쪽 열, 값이 오른쪽. 사장님 2026-08-27
     「가로로 나열하지말고 세로로 쓰는게 맞을거 같거든」.
     ⇒ 맞다. 가로 표는 «같은 종류»를 늘어놓을 때 쓰는 것이다(금액 셋, 차량 여섯 줄).
       계좌·담당·연락처는 종류가 제각각이라 가로로 세우면 머리글이 서로 상관없는 말이 된다.
       세로면 «칸이 늘어도» 표가 안 깨진다 — 나중에 문의 시간이든 뭐든 한 줄 더 붙이면 그만이다. */
  /* ★가로 표를 «눕힌 것». 머리줄이 머리열이 될 뿐, 색·글자·여백은 위 표 그대로다.
     (사장님 2026-08-27 「표 규격 위에랑 좀 맞춰라」)
     ★한 줄에 «두 쌍»을 앉힌다 — 값이 짧아 한 쌍만 두면 오른쪽이 텅 빈다
     (사장님 2026-08-27 「여기 많이 남잖아」). 줄도 여섯에서 셋으로 준다. */
  .vtab { width:100%; border-collapse:separate; border-spacing:0; table-layout:fixed; }
  .vtab th, .vtab td { padding:var(--cell); text-align:left; }
  .vtab th { width:88px; background:var(--tl); color:#fff; font-size:10.5px; font-weight:700;
    white-space:nowrap; }
  .vtab td { background:#fff; color:var(--ink); font-size:12px; font-weight:600;
    border-right:1px solid var(--ln); border-bottom:1px solid #edf0f4; }
  .vtab tr:first-child th { background:var(--tl-d); }
  .vtab tr:first-child td { border-top:1px solid var(--ln); }
  .vtab tr:last-child td { border-bottom:1px solid var(--ln); }
  .vtab tr:first-child th:first-child { border-top-left-radius:var(--r-box); }
  .vtab tr:first-child td:last-child { border-top-right-radius:var(--r-box); }
  .vtab tr:last-child th:first-child { border-bottom-left-radius:var(--r-box); }
  .vtab tr:last-child td:last-child { border-bottom-right-radius:var(--r-box); }
  .vtab td.mono { font-variant-numeric:tabular-nums; letter-spacing:-.1px; }
  /* ★결제일은 이 칸에서 제일 먼저 눈에 들어와야 한다 — 받는 쪽이 제일 먼저 찾는 값이다.
     ⚠ 「기한」이라 부르지 않는다. 밀린 사람한테 쓰는 말이라 회원사에 보낼 종이엔 안 맞는다
       (사장님 2026-08-27 「입금 기한 이라고 하면 좀 그러니까」 · 「부탁조로 해야지」). */
  .vtab td.due { color:var(--tl-d); font-size:13px; font-weight:800; letter-spacing:-.2px; }
  .vtab td.due em { font-style:normal; color:var(--mut); font-size:10.5px; font-weight:500; margin-left:6px;
    letter-spacing:0; }
  /* 계산서 줄에 붙는 단서 — 꼬리에 두면 아무도 안 읽는다. */
  .vtab td em.cav { font-style:normal; color:var(--faint); font-size:10px; font-weight:500; margin-left:10px; }

  /* 한 줄 짜리 — 회원사·계좌. 표로 만들 만큼의 내용이 아니다. */
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

  /* 발송 전 확인 — 우리끼리 보는 표시. 인쇄하면 사라진다. */
  .warn { margin-top:var(--sec); font-size:10px; color:#c0392b; font-weight:600; }
  .miss { color:#c0392b; font-weight:700; }

  /* ★꼬리 = 발행자 정보. 사장님 2026-08-27 「하단에 우리회사 정보는 안주니」
     — 있기는 했는데 10px 회색이라 «안 보였다». 틀은 그대로 두고 크기·간격만 올린다. */
  .ft { position:absolute; left:0; right:0; bottom:0; padding:11px 14mm 12px; background:var(--ink);
    color:#aab4c2; font-size:10.5px; line-height:1.75;
    display:flex; justify-content:space-between; align-items:flex-end; gap:10mm; }
  .ft b { color:#e8ecf2; font-weight:700; }
  .ft .nm { font-size:12px; color:#fff; font-weight:700; letter-spacing:-.2px; }
  .ft .k { color:#7b8798; font-weight:600; margin-right:5px; }
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

  /**
   * 한글 상호를 «낱자»로 쪼갠다 — flex 가 고르게 나눠 준다.
   * 낱말이 바뀌는 첫 자에만 `w` 를 붙여 앞에 한 칸을 준다.
   */
  const koLock = CORP.name
    .split(/\s+/)
    .map((word, wi) => [...word].map((ch, ci) => `<i${wi && !ci ? ' class="w"' : ''}>${esc(ch)}</i>`).join(''))
    .join('');

  const head = (page: number) => `
  <div class="hd">
    <div class="bl">
      <div class="mk">${MARK}</div>
      <div class="wm">
        <div class="co"><b>${esc(CORP.markMain)}</b><i>${esc(CORP.markSub)}</i></div>
        <div class="ko">${koLock}</div>
      </div>
    </div>
    <div class="mt">
      사업자등록번호<b>${esc(CORP.bizNo)}</b>  대표<b>${esc(CORP.ceo)}</b><br>
      정산월<b>${esc(monthKo(inv.month))}</b>
    </div>
  </div>
`;

  /**
   * 꼬리 — **회사 정보 · 홈페이지 · ERP 주소만.** 사장님 2026-08-27
   *   「하단은 그냥 회사정보, 홈피, erp주소만 있으면 되고」.
   *   계좌·담당·연락처는 «이 건을 처리할 때 쓰는 정보»라 본문 「청구 안내」에 있다.
   *   여기는 «누가 발행했나»와 «어디로 찾아오나». 쓰임이 다르니 자리도 다르다.
   * ★안내 문구(「세금계산서를 대신하지 않습니다」)도 본문으로 올렸다 —
   *   꼬리에 있으면 아무도 안 읽는다. 계산서 줄 «옆»에 붙어 있어야 뜻이 산다.
   * ⚠ 지급명세서면 본문 계좌가 «상대» 것이다. 꼬리(우리 정보)와 섞지 않는다.
   */
  const foot = (page: number) => `
  <div class="ft">
    <div>
      <span class="nm">${esc(CORP.name)}</span>  사업자등록번호 <b>${esc(CORP.bizNo)}</b>  ·  대표 <b>${esc(CORP.ceo)}</b><br>
      ${esc(CORP.addr)}<br>
      ${esc(CORP.web)}  ·  ${esc(CORP.erp)}
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
  <div class="sec">
    <div class="sec-h">${ico('계좌')}${claim ? '청구 안내' : '지급 안내'}</div>
    <table class="vtab">
      <colgroup><col style="width:82px"><col style="width:34%"><col style="width:82px"><col></colgroup>
      <tbody>
        <tr>
          <th>${claim ? '입금 요청일' : '지급 예정일'}</th>
          <td class="mono due">${esc(dueDay(inv.month))}<em>${claim ? '까지' : ''}</em></td>
          <th>${claim ? '입금 계좌' : '지급 계좌'}</th><td class="mono">${shown(accText)}</td>
        </tr>
        <tr>
          <th>담당</th><td>${esc(CORP.staff)}</td>
          <th>연락처</th><td class="mono">${esc(S(CORP.staffPhone) || CORP.phone)}</td>
        </tr>
        <tr>
          <th>이메일</th><td>${esc(CORP.email)}</td>
          <th>팩스</th><td class="mono">${shown(CORP.fax)}</td>
        </tr>
        <tr>
          <!-- ★계산서를 «누가» 끊는지 종이가 말해야 한다.
               우리가 받는 쪽(청구서)이면 용역을 준 게 우리라 우리가 끊는다.
               우리가 주는 쪽(지급명세서)이면 상대가 끊어 줘야 우리가 지급한다 —
               이 한 줄이 없으면 「계산서 언제 주냐」로 전화가 온다. -->
          <th>세금계산서</th>
          <td colspan="3">${
    claim ? '위 금액으로 별도 발행해 드립니다' : '위 금액으로 발행 부탁드립니다'
  }<em class="cav">본 정산서는 정산원장을 기준으로 산출되었으며 세금계산서를 대신하지 않습니다</em></td>
        </tr>
      </tbody>
    </table>
  </div>
  <div class="closing">
    ${claim ? '위와 같이 청구합니다' : '위와 같이 지급합니다'}
    <span>${esc(day(issued))}</span>
  </div>`;

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
    // ★앞 장들에 «실제로» 몇 줄이 갔는지 세서 번호를 잇는다.
    //   CAP_FIRST 를 그대로 더하면 안 된다 — 이제 첫 장이 상한까지 안 차기 때문이다.
    const from = pages.slice(0, page).reduce((s, c) => s + c.length, 0) + 1;
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
