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
import { invoiceDocHtml, invoicePageHtml } from '../lib/server/settlement-invoice-html';
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
ok('그 우측이 회원사다', /class="titlerow">[\s\S]{0,600}회원사[\s\S]{0,300}주식회사 손오공렌터카/.test(html));
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
ok('모서리·간격이 공통 규격이다', html.includes('--r-box:7px') && html.includes('--sec:10px')
  && !/border-radius:\d/.test(boxCss.slice(boxCss.indexOf('.doc {'))));
// ★청구서의 입금계좌는 «우리 정보»라 꼬리에 있다 — 본문에 칸을 따로 두지 않는다.
//   (2026-08-27 「회사 정보에 담당자 안내랑 이메일 넣으면 계좌 정보도 넣으면 되잖아」)
ok('입금계좌가 꼬리에 있다', /class="ft">[\s\S]{0,600}입금계좌/.test(html));
ok('담당 연락처·메일이 꼬리에 있다', /class="ft">[\s\S]{0,600}담당 [\s\S]{0,80}@/.test(html));
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
