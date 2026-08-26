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
  claimWritten: 0, payWritten: 0, supplierRate: 3, agentRate: 2,
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
ok('문서번호가 박힌다', html.includes('FP-S-202608-001'));
ok('상대 정식 상호가 CI 정본에서 채워진다', html.includes('주식회사 손오공렌터카'));
ok('사업자등록번호가 채워진다', html.includes('882-87-00650'));
// ★상대 주소만 없어야 한다. 푸터의 «우리» 주소는 있는 게 맞다 —
//   손오공(1205호)과 우리(1004호)가 같은 건물이라 건물명으로 재면 헛짚는다.
ok('상대 주소는 «안» 들어간다(대상은 상호·사업자번호·대표자뿐)', !html.includes('1205호'));
ok('우리 주소는 푸터에 있다', html.includes('1004호'));
ok('제목은 영업수수료 정산서', html.includes('영업수수료 정산서'));
ok('파일 이름에 상대·달·종류가 들어간다', /2026-08 주식회사 손오공렌터카 영업수수료 청구서\.html/.test(name));
ok('차량번호는 글자다(뱃지 상자 없음)', !html.includes('class="pl"') && !html.includes('class="mono"'));
ok('영문 금액 라벨이 없다', !html.includes('Amount Claimed') && !html.includes('Net Payout'));
ok('직인생략 상자가 없다', !html.includes('직인생략'));
ok('정산 내역 섹션머리가 없다', !html.includes('정산 내역'));

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
