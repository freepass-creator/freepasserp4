/**
 * **정산서 엑셀 — 상대가 자기 장부에 붙여 넣을 수 있게.**
 *
 * ★사장님 2026-08-26 「정산서 다운로드하기랑 엑셀 다운로드 하기 있어야해」.
 *
 * ★★**엑셀은 «보는 문서»가 아니라 «쓰는 자료»다.** A4 정산서는 읽으라고 만든 것이고,
 *   이 파일은 상대가 자기 시트에 붙여 넣고 계산하라고 만든 것이다. 그래서 —
 * ```
 * 병합 없음        머리글 위에 제목 칸을 병합해 얹지 않는다. 붙여 넣으면 다 깨진다
 * 숫자는 숫자로     `8,268,062` 가 아니라 8268062. 문자로 넣으면 상대가 다시 손본다
 * 한 줄 = 한 건     환수도 같은 표에 «음수»로 선다. 표를 둘로 쪼개지 않는다
 * 표지 탭 따로     누구에게·얼마·언제는 「정산서」 탭에, 줄은 「정산내역」 탭에
 * ```
 * ⚠ 서식(색·굵기)은 넣지 않는다. `xlsx` 무료판은 셀 서식을 못 쓴다 —
 *   흉내 내려고 문자열을 꾸미면 숫자가 문자가 되어 오히려 쓸모가 준다.
 *
 * ⚠ **고객명이 들어간다.** 이 파일은 거래처에 나가는 것이고, 그 거래처가 판 계약의
 *   고객이므로 상대가 이미 아는 사람이다. 다만 «다른» 거래처에 섞여 나가면 안 된다 —
 *   부르는 쪽(`/api/settlement/invoice`)이 상대별로 걸러서 넘긴다.
 */
import * as XLSX from 'xlsx';
import { CORP } from '@/lib/domain/corporate-ci';
import { feeShow, type Invoice } from '@/lib/domain/settlement-invoice';

const S = (v: unknown) => String(v ?? '').trim();

/** `2026-08` → `2026.08.01 ~ 2026.08.31` */
const periodOf = (m: string) => {
  const x = /^(\d{4})-(\d{2})$/.exec(S(m));
  if (!x) return S(m);
  const y = Number(x[1]);
  const mo = Number(x[2]);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${y}.${p2(mo)}.01 ~ ${y}.${p2(mo)}.${p2(new Date(y, mo, 0).getDate())}`;
};

/**
 * 정산서 한 벌을 xlsx 바이트로.
 *
 * @param inv   `buildInvoice` 가 만든 정산서
 * @param opts  문서번호·발행시각. 없으면 「발행 전」·오늘
 */
export function invoiceXlsx(inv: Invoice, opts?: { invoiceNo?: string; issuedAt?: number }): Buffer {
  const claim = inv.kind === '청구서';
  const money = claim ? '청구금액' : '지급금액';
  const acc = claim ? inv.issuer : inv.receiver;
  const issued = opts?.issuedAt ? new Date(opts.issuedAt) : new Date();
  const day = `${issued.getFullYear()}-${String(issued.getMonth() + 1).padStart(2, '0')}-${String(issued.getDate()).padStart(2, '0')}`;

  /** 표지 — 「누가·누구에게·얼마」. 두 칸짜리 세로 표라 붙여 넣어도 안 깨진다. */
  const cover: (string | number)[][] = [
    ['항목', '내용'],
    ['문서', `영업수수료 ${inv.kind}`],
    ['문서번호', S(opts?.invoiceNo) || '(발행 전)'],
    ['정산월', inv.month],
    ['정산대상기간', periodOf(inv.month)],
    ['발행일자', day],
    ['', ''],
    [claim ? '청구처' : '지급처', S(inv.receiver.name) || inv.party],
    ['사업자등록번호', S(inv.receiver.bizNo)],
    ['대표자', S(inv.receiver.ceo)],
    ['', ''],
    ['발행자', CORP.name],
    ['사업자등록번호', CORP.bizNo],
    ['대표자', CORP.ceo],
    ['', ''],
    ['정산 건수', inv.lines.filter((l) => !l.minus).length],
    ['공급가액', inv.supply],
    ['부가세', inv.vat],
    ...(inv.clawback ? [['환수 차감', -Math.abs(inv.clawback)] as (string | number)[]] : []),
    [money, inv.total],
    [claim ? '입금계좌' : '지급계좌', [acc.bank, acc.account, acc.holder].map(S).filter(Boolean).join(' ')],
  ];

  /** 내역 — 한 줄이 한 건. 환수는 음수로 같은 표에 선다. */
  /**
   * ★★**엑셀이 «백데이터»다 — 산출식은 여기에 디테일하게 적는다.**
   *   사장님 2026-09-03 「딱 정해진 규격에 필요한 정보만 보면 되고 산출식은 … 줄마다 필요없을거 같음」
   *                 「엑셀로 만드는 정산서 백데이터에 디테일하게 적자 … 첨부에 산출식 엑셀파일 같이 메일로」
   *                 「청구서 + 세부내역 엑셀을 같이 주는거지」
   *   ⇒ 종이(PDF)는 규격만, 엑셀은 «어떻게 나왔는지»까지. 둘을 같이 보낸다.
   *   ★번호를 맨 앞에 둔다 — 종이의 No. 와 같은 번호라 둘을 나란히 놓고 짚을 수 있다.
   */
  const head = ['No.', '접수일', '차량번호', '모델명', '고객', '상품', '계약기간(개월)',
    '산정 기준', '적용 요율', '구분', '공급가액', '부가세', '합계'];
  const body = inv.lines.map((l, i) => [
    i + 1, S(l.receivedAt), S(l.plate), S(l.model), S(l.customer), S(l.product),
    Number(l.term) || 0, l.minus ? S(l.reason) : S(l.base), l.minus ? '' : feeShow(l.rate),
    l.minus ? '환수' : '정산',
    l.amount, l.vat, l.total,
  ]);
  const foot = ['', '', '합계', '', '', '', '', '', '', '', inv.supply, inv.vat, inv.total];

  const wb = XLSX.utils.book_new();

  const s1 = XLSX.utils.aoa_to_sheet(cover);
  s1['!cols'] = [{ wch: 18 }, { wch: 46 }];
  XLSX.utils.book_append_sheet(wb, s1, '정산서');

  const s2 = XLSX.utils.aoa_to_sheet([head, ...body, foot]);
  s2['!cols'] = [{ wch: 5 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 14 }, { wch: 13 },
    { wch: 28 }, { wch: 15 }, { wch: 7 }, { wch: 13 }, { wch: 11 }, { wch: 13 }];
  // 머리글 한 줄 고정 — 줄이 많으면 스크롤할 때 무슨 칸인지 잃는다
  s2['!freeze'] = { xSplit: '0', ySplit: '1' } as unknown as XLSX.WorkSheet['!freeze'];
  XLSX.utils.book_append_sheet(wb, s2, '정산내역');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * 내려받을 때 붙는 파일 이름.
 * ★상대·달·종류가 다 들어가야 상대 쪽 폴더에서 섞이지 않는다.
 * ★파일 이름에 못 쓰는 글자는 털어낸다 — 윈도 탐색기가 거부한다.
 */
export const invoiceFileName = (inv: Invoice, ext: 'xlsx' | 'html' | 'pdf'): string => {
  /** ★파일 이름에도 「주식회사」를 안 쓴다 — 메일에 붙는 이름이라 종이와 같아야 한다(사장님 2026-09-03). */
  const who = (S(inv.receiver.name) || S(inv.party))
    .replace(/(주식회사|유한회사|유한책임회사|\(주\)|\(유\)|㈜)/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${inv.month} ${who} 영업수수료 ${inv.kind}.${ext}`;
};
