/** 고객 이름 가리기 검사 — 남의 회사가 보는 종이에 실명이 나가면 안 된다. */
import { EMPTY_PARTY, buildInvoice, maskName } from '../lib/domain/settlement-invoice';
import { invoiceDocHtml, invoicePageHtml } from '../lib/server/settlement-invoice-html';

const INV = buildInvoice({
  axis: '공급사', month: '2026-08', party: '손오공',
  issuer: EMPTY_PARTY, receiver: { ...EMPTY_PARTY, name: '주식회사 손오공렌터카' },
  rows: [{
    plate: '161하1284', model: '스포티지', customer: '문세준', product: '장기렌트',
    term: 48, rent: 790000, supplierRate: 0.0325, agentRate: 0, price: 0,
    supplier: '손오공', channel: '하허호', agent: '', deliveredAt: Date.UTC(2026, 7, 5),
  }] as never,
  clawbacks: [],
});

let bad = 0;
const ok = (t: string, v: boolean) => { console.log(`  ${v ? '○' : '✕'} ${t}`); if (!v) bad++; };

console.log('\n■ 고객 이름 가리기\n');
ok('문세준 → 문*준', maskName('문세준') === '문*준');
ok('김수경 → 김*경', maskName('김수경') === '김*경');
ok('남궁민수 → 남**수', maskName('남궁민수') === '남**수');
ok('이철 → 이*', maskName('이철') === '이*');
ok('한 글자는 그대로', maskName('김') === '김');
ok('빈칸은 빈칸', maskName('') === '' && maskName(null) === '' && maskName(undefined) === '');
ok('앞뒤 공백은 떼고 센다', maskName('  문세준  ') === '문*준');
// ★길이가 남으면 이름 길이가 새는 것 아닌가 — 맞다. 다만 «누구인지»는 안 샌다.
//   길이까지 지우면 회원사가 같은 성 두 건을 못 가른다. 거기까지가 균형이다.
ok('가린 뒤에도 길이는 남는다', maskName('문세준').length === 3);
ok('가운데만 가린다 — 성과 끝자는 남는다', maskName('문세준')[0] === '문' && maskName('문세준')[2] === '준');


// ★★가리는 «자리»가 맞는지 — 함수만 맞고 안 부르면 소용없다.
//   ★가리는 곳은 «종이» 한 곳이다(사장님 2026-08-27 「엑셀은 가릴필요 없지 청구서에만」).
//     정산서 알맹이(Invoice)에는 온전한 이름이 담기고, HTML·PDF 에서만 가려진다.
{
  const html = invoicePageHtml('시험', invoiceDocHtml(INV));
  ok('종이에는 가려서 나온다', html.includes('문*준') && !html.includes('문세준'));
  ok('알맹이에는 온전한 이름이 남는다', INV.lines[0]?.customer === '문세준');
}

console.log(bad ? `\n✕ ${bad}건 어긋남\n` : '\n○ 다 맞음\n');
process.exit(bad ? 1 : 0);
