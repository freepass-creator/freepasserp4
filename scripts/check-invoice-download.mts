/**
 * **정산서 내려받기 — 실제로 파일이 나오나.** 읽기만 한다.
 *
 * ★사장님 2026-08-26 「정산서 다운로드하기랑 엑셀 다운로드 하기 있어야해」.
 *
 * ★★API 를 거치지 않고 «만드는 쪽»만 시험한다. 서버가 안 떠 있어도 돌아가야
 *   이 검사가 쓸모 있다 — 서버 죽었을 때 원인이 코드인지 서버인지 갈라야 한다.
 * ★엑셀은 «숫자가 숫자로» 들어갔는지까지 본다. 문자로 들어가면 상대가 다시 손봐야 한다.
 *
 *   npx tsx scripts/check-invoice-download.mts        → tmp/ 에 두 파일
 */
import { writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { EMPTY_PARTY, buildInvoice } from '../lib/domain/settlement-invoice';
import { INVOICE_CSS, invoiceDocHtml, invoicePageHtml } from '../lib/server/settlement-invoice-html';
import { invoiceXlsx, invoiceFileName } from '../lib/server/settlement-invoice-xlsx';
import type { SettlementRow } from '../lib/domain/settlement-stage';

const row = (plate: string, rent: number, term: number): SettlementRow => ({
  plate, supplier: '손오공', agent: '홍길동', product: '스위치플랜', model: '트랙스 크로스오버',
  customer: '김OO', term, rent, price: 0, payKind: '일시납',
  receivedAt: new Date(2026, 7, 3), deliveredAt: new Date(2026, 7, 10), clawbackAt: null,
  clawbackAmount: 0, paper: true, delivered: true, cancelled: false, clawback: false,
  // ⚠ 요율은 «비율»이다 — 3 이 아니라 0.03. 1 이상은 «건당 고정액»으로 읽힌다
  //   (실데이터 2026-08-27: 요율 299건 · 건당 고정 128건 — 둘 다 실재한다).
  claimWritten: 0, payWritten: 0, supplierRate: 0.03, agentRate: 0.02,
});

const inv = buildInvoice({
  axis: '공급사', month: '2026-08', party: '손오공',
  issuer: { ...EMPTY_PARTY, name: '프리패스모빌리티 주식회사', bizNo: '528-88-02988', ceo: '박영협' },
  receiver: { ...EMPTY_PARTY },
  rows: [row('60호1234', 550_000, 36), row('72가5678', 480_000, 48), row('11나9012', 620_000, 24)],
});

const fail: string[] = [];
const ok = (why: string, cond: boolean) => { console.log(`  ${cond ? '○' : '✕'} ${why}`); if (!cond) fail.push(why); };

console.log('\n■ 정산서 내려받기\n');

// ── HTML ──────────────────────────────────────────────────
const name = invoiceFileName(inv, 'html');
const html = invoicePageHtml(name.replace(/\.html$/, ''), invoiceDocHtml(inv, { invoiceNo: 'FP-S-202608-001', issuedAt: Date.UTC(2026, 7, 26) }));
writeFileSync('tmp/내려받기-정산서.html', html, 'utf8');
console.log('[HTML]');
ok('A4 한 장 이상 나온다', /class="doc"/.test(html));
ok('문서번호는 종이에 안 찍힌다', !html.includes('FP-S-202608-001'));
ok('상대 정식 상호가 CI 정본에서 채워진다', html.includes('주식회사 손오공렌터카'));
ok('사업자등록번호가 채워진다', html.includes('882-87-00650'));
// ★상대 주소만 없어야 한다. 푸터의 «우리» 주소는 있는 게 맞다 —
//   손오공(1205호)과 우리(1004호)가 같은 건물이라 건물명으로 재면 헛짚는다.
ok('상대 주소는 «안» 들어간다(대상은 상호·사업자번호·대표자뿐)', !html.includes('1205호'));
ok('우리 주소는 푸터에 있다', html.includes('1004호'));
// ★제목은 방향에 따라 갈린다 — 청구서 / 지급명세서(2026-08-27 「딱 필요한 정보만」).
// ★헤더 밴드에 「영업수수료 청구서 / 지급명세서」로 방향이 적힌다(견적서 .tt 자리).
// ★문서 이름은 「정산서」. 방향은 문구 한 줄이 말한다(2026-08-27 「정산서 가 맞는 표현이고」).
// ★밴드는 «우리 CI·회사명», 문서 이름은 «띠 아래 첫 칸 좌측», 그 우측이 회원사.
//   (2026-08-27 「CI랑 회사명은 맨 상단 밴드형 상단바에 원래처럼」)
ok('밴드에 우리 CI 가 선다', /class="hd">[\s\S]{0,400}class="co"><b>freepass/.test(html));
ok('문서 이름이 띠 아래 첫 칸 좌측', /class="titlerow">[\s\S]{0,200}class="ti">영업수수료 정산서/.test(html));
// ★로고가 붙으면 data URI 가 통째로 끼어들어 사이가 수만 자 벌어진다 — 태그를 걷고 본다.
{
  const tr = /<div class="tr">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/.exec(html)?.[1] ?? '';
  const txt = tr.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  ok('그 우측이 회원사다', /회원사[\s\S]{0,80}주식회사 손오공렌터카[\s\S]{0,40}귀중/.test(txt));
  // ★CI 는 상호와 사업자번호 «두 줄»을 같이 잡는다 (2026-08-27 「같이 잡아줘야지 CI가」).
  ok('CI 가 두 줄을 같이 잡는다', /<div class="lock">[\s\S]{0,200}<div>\s*<div class="nm">/.test(tr)
    || /<div class="lock">\s*<div>\s*<div class="nm">/.test(tr.replace(/<img[^>]*>/g, '')));
}
// ★맺음말은 «아래»에 둔다 — 내역을 보여 준 다음에 맺는다.
ok('맺음말이 아래에 있다', html.includes('위와 같이 청구합니다') || html.includes('위와 같이 지급합니다'));
ok('위에서 예고하지 않는다', !html.includes('아래와 같이 청구합니다'));
ok('CI 워드마크를 쓴다 — Exo 2 · freepass + mobility',
  html.includes("family=Exo+2") && /class="co"><b>freepass<\/b><i>mobility<\/i>/.test(html));
ok('파일 이름에 상대·달·종류가 들어간다', /2026-08 주식회사 손오공렌터카 영업수수료 청구서\.html/.test(name));
// ★차량번호는 첫 칸에 굵게 선다(class="pl"). 뱃지 상자·모노그램은 안 쓴다.
// ★손오공 견적서 골격 — 헤더밴드·태그라인·info·sec-h·vcard·ctab·note·ft.
//   ⚠ 차량번호는 표의 좌측 라벨열(.rl)이다. 뱃지를 두르지 않는다(사장님 「차량 뱃지를 왜 넣냐」).
// ★골격은 견적서(헤더밴드·태그라인·소제목·표·안내·어두운 푸터).
//   ⚠ info·vcard·kv 는 없앴다 — 칸을 «전부 같은 표»로 통일했다(2026-08-27).
ok('견적서 골격을 쓴다', /class="hd"/.test(html) && /class="closing"/.test(html)
  && /class="sec-h"/.test(html) && /class="ctab"/.test(html) && /class="ft"/.test(html));
ok('★칸이 전부 같은 표다 — 박스 규격이 섞이지 않는다',
  !html.includes('class="info"') && !html.includes('class="vcard"') && !html.includes('class="kv'));
// ★금액은 «가로 요약표»(.stab). 표는 둘뿐 — 요약표와 내역표(2026-08-27 「3개를 해버리니까 질린다」).
ok('금액이 가로 요약표다', /class="stab"/.test(html));
// ★모서리·간격은 한 곳에서 정한다 — 자리마다 다시 적으면 어디는 각지고 어디는 둥글어진다.
// ⚠ 마크(.mk)의 라운드는 CI 아이콘 «자체 모양»이라 표 규격을 따르지 않는다 — 세지 않는다.
const boxCss = html.replace(/\.hd \.bl \.mk \{[^}]*\}/g, '');
// ★소제목 «위»가 «아래»보다 넓어야 소제목이 그 표에 붙어 보인다 (--sec 18 ↔ --sec-h 6).
ok('모서리·간격이 공통 규격이다', html.includes('--r-box:7px')
  && html.includes('--sec:18px') && html.includes('--sec-h:6px')
  && !/border-radius:\d/.test(boxCss.slice(boxCss.indexOf('.doc {'))));
// ★계좌·담당은 «이 건을 처리할 때 쓰는 정보»라 본문 섹션에 있고,
//   꼬리는 «누가 발행했나»만 말한다 (2026-08-27 「하단은 그냥 회사 정보인거고」).
// ★이름은 「청구 안내 / 지급 안내」 — 위 「청구 금액 / 지급 금액」과 말이 짝을 이룬다.
//   계좌 말고 담당·연락처가 더 들어가도 이름이 안 틀린다.
ok('청구 안내 섹션이 선다', /청구 안내[\s\S]{0,400}class="vtab"/.test(html));
// ★세로 표다 — 종류가 제각각인 값을 가로로 세우면 머리글이 서로 상관없는 말이 된다.
//   (2026-08-27 「가로로 나열하지말고 세로로 쓰는게 맞을거 같거든」)
ok('세로 표다', /class="vtab"[\s\S]{0,700}<th>담당<\/th>[\s\S]{0,200}<th>연락처<\/th>/.test(html));
ok('담당·연락처·메일이 그 표에 있다', /class="vtab"[\s\S]{0,1400}@/.test(html));
// ★날짜와 계좌는 한 줄을 다 쓴다 — 옆에 뭘 붙이면 좁아진다 (2026-08-27 「입금계좌를 한줄 다 주면」).
ok('날짜·계좌가 한 줄을 다 쓴다', /<td class="mono due" colspan="3"/.test(html)
  && /<td class="mono" colspan="3"/.test(html));
// ★세금계산서는 «줄을 따로 주지 않는다» — 날짜 뒤에 한마디로 붙는다.
//   (2026-08-27 「입금 요청일 까지 로 해놓고 그뒤에 세금계산서 내용을 써주면 되잖아」)
ok('계산서 한마디가 날짜 뒤에 붙는다', /class="mono due"[^>]*>[\s\S]{0,200}?class="cav">세금계산서/.test(html));
ok('계산서에 줄을 따로 주지 않는다', !/<th>세금계산서<\/th>/.test(html));
// ★비고는 맨 아래 한 줄을 다 쓴다. ⚠ 비어 있는 게 맞다 — 지어서 채우면 모두에게 같은 말이 간다.
ok('비고가 맨 아래 한 줄이다', /<th>비고<\/th><td class="memo" colspan="3">/.test(html));
// ★칸이 쪼개지면 소제목만 앞 장에 남는다 (2026-08-27 「청구안내칸 페이지 바꿔서 잘 넘어가게」).
ok('칸은 쪽 사이에서 안 쪼개진다', /\.sec \{[^}]*break-inside:avoid/.test(html)
  && /\.vtab, \.stab \{[^}]*break-inside:avoid/.test(html));
// ★꼬리에는 «발행인 신원»만. 계좌·담당·연락처는 본문 「청구 안내」가 맡는다.
ok('꼬리는 회사 정보만이다', /class="ft">[\s\S]{0,600}?class="site"/.test(html)
  && !/class="ft">[\s\S]{0,600}?(?:@|입금계좌|담당)/.test(html));
// ★홈페이지·ERP 는 오른쪽 아래 — 왼쪽만 길면 한쪽으로 쏠린다 (2026-08-27 「밸런스 맞춰줘」).
ok('홈페이지·ERP 가 오른쪽 아래에 선다',
  /class="site">[\s\S]{0,120}freepassmobility\.com[\s\S]{0,60}freepasserp\.com/.test(html));
// ★회원사 «대표명»은 안 찍는다 (2026-08-27 「회원사 대표명은 빼자」).
//   대표는 바뀌는데 종이는 안 바뀐다. 발행인(우리) 대표는 꼬리에 남는다.
ok('회원사 대표명이 없다', !/class="id">[^<]*대표/.test(html));
ok('우리 대표는 꼬리에 남는다', /class="ft">[\s\S]{0,300}대표 <b>박영협/.test(html));
// ★★★CSS 문자열 안의 주석 짝이 맞아야 한다.
//   2026-08-27 에 주석 «안»에 별표+빗금을 써서 주석이 거기서 끝났고,
//   바로 아래 display:flex 한 줄이 통째로 먹혀 CI 마크가 위로 올라갔다.
//   나머지는 멀쩡히 그려져서 «왜 깨졌는지»가 안 보였다. 그래서 여기서 잡는다.
{
  let depth = 0;
  let broken = 0;
  for (let i = 0; i < INVOICE_CSS.length - 1; i++) {
    const two = INVOICE_CSS.slice(i, i + 2);
    if (two === '/*' && !depth) { depth = 1; i++; }
    else if (two === '*/') { if (depth) depth = 0; else broken++; i++; }
  }
  ok('CSS 주석 짝이 맞는다', broken === 0 && depth === 0);
}

// ★CI 한글 상호는 낱자로 나눠 flex 가 고르게 벌린다 — justify 로 두 번 실패했다.
ok('한글 상호가 낱자로 나뉜다', /class="ko">(?:<i[^>]*>[^<]<\/i>){12}<\/div>/.test(html));
ok('「주식회사」 앞에 한 칸이 있다', /class="ko">[\s\S]{0,300}?<i class="w">주<\/i>/.test(html));
ok('본문에 계좌 칸을 두지 않는다', !/class="sec-h">(?:<svg[^>]*>[\s\S]*?<\/svg>)?입금 계좌/.test(html));
ok('차량번호는 표 좌측 라벨열 — 뱃지 아님', /<th class="rl">60호1234<\/th>/.test(html) && !html.includes('class="plate"'));
ok('헤더에 남색을 쓴다', html.includes('linear-gradient(120deg,#1B2A4A'));
ok('영문 금액 라벨이 없다', !html.includes('Amount Claimed') && !html.includes('Net Payout'));
ok('직인생략 상자가 없다', !html.includes('직인생략'));
// ★상세페이지 규격에서는 「정산 내역」이 카드 «밖» 캡션으로 선다(GroupHeader).
//   ⚠ 예전엔 「없어야 한다」고 걸어 뒀다 — 그때는 섹션머리를 뺀 디자인이었다(2026-08-27 바뀜).
// ★소제목은 «그 칸이 무엇인지»로 붙인다. 「요약」·「안내」 같은 성격어는 안 쓴다.
// ★소제목은 «아이콘 + 그 칸이 무엇인지». 밑줄은 긋지 않는다.
const secTitles = [...html.matchAll(/class="sec-h">(?:<svg[^>]*>.*?<\/svg>)?([^<]+)/g)].map((m) => m[1].trim());
ok('소제목이 내용을 말한다', ['청구 금액', '정산 내역'].every((t) => secTitles.includes(t)));
// ★아래에 안내 박스를 두지 않는다(2026-08-27 「하단에 이런표도 의미없어」).
ok('하단 안내 박스가 없다', !html.includes('class="note"'));
// ★맺음말은 글자 한 줄 — 박스를 두르지 않는다(2026-08-27 「박스가 필요한가」).
ok('맺음말에 박스가 없다', !/\.closing \{[^}]*border:/.test(html));
ok('소제목에 아이콘이 붙는다', /class="sec-h"><svg class="i"/.test(html));
// ★각 수수료가 «어떻게 나왔는지»가 보조글씨로 붙는다(2026-08-27).
// ★산출조건은 제 «칸»을 갖는다(2026-08-27) — 보조글씨가 아니라 표의 한 열이다.
ok('수수료 산출조건이 칸으로 선다', /<th>수수료 산출조건<\/th>/.test(html)
  && /class="l calc">대여료 [\d,]+ × 36개월<span class="rt">3%/.test(html));
// ★1 이상은 요율이 아니라 건당 고정액이다 — 「300%」로 찍히면 종이가 거짓말을 한다.
ok('건당 고정액을 %로 안 찍는다', !/class="calc">[^<]*300%/.test(html));
ok('상대를 「회원사」로 부른다', html.includes('회원사') && !html.includes('청구처'));
ok('성격어를 안 쓴다', !html.includes('정산 요약') && !html.includes('입금 안내'));
// ★문서번호도 «종이에서» 뺐다. 발행 기록에는 남는다.
ok('종이에 문서번호가 없다', !html.includes('문서번호'));

// ── XLSX ──────────────────────────────────────────────────
const buf = invoiceXlsx(inv, { invoiceNo: 'FP-S-202608-001', issuedAt: Date.UTC(2026, 7, 26) });
writeFileSync('tmp/내려받기-정산서.xlsx', buf);
const wb = XLSX.read(buf, { type: 'buffer' });
const lines = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['정산내역']);
const cover = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['정산서']);
console.log('\n[엑셀]');
ok('탭이 둘 — 정산서 · 정산내역', wb.SheetNames.join('·') === '정산서·정산내역');
ok('내역 줄 수가 맞는다(합계 줄 포함)', lines.length === inv.lines.length + 1);
ok('★공급가액이 «숫자»로 들어간다', typeof lines[0]?.['공급가액'] === 'number');
ok('★합계도 숫자', typeof lines[0]?.['합계'] === 'number');
ok('계약기간도 숫자', typeof lines[0]?.['계약기간(개월)'] === 'number');
ok('표지에 청구금액이 숫자로 있다', cover.some((r) => Object.values(r).includes(inv.total)));
ok('머리글이 1행이다(병합 제목 없음)', String(Object.keys(lines[0] || {})[0]) === '차량번호');

const sum = lines.slice(0, -1).reduce((a, r) => a + Number(r['합계'] || 0), 0);
ok('내역 합 = 정산서 합계', Math.round(sum) === Math.round(inv.total));

console.log(`\n  tmp/내려받기-정산서.html · tmp/내려받기-정산서.xlsx`);
console.log(fail.length ? `\n✕ ${fail.length}건 어긋남\n` : '\n○ 다 맞음\n');
process.exit(fail.length ? 1 : 0);
