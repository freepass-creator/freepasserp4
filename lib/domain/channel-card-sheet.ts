/**
 * **영업채널 카드시트 — 「상품시트」 갈래.** 영업채널(제휴 딜러)에 그대로 넘기는 한 장짜리 상품 카드.
 *
 * ★사장님 2026-08-21 — 「구글 시트 만들어서 그렇게 상품을 제공하려고 하거든? 상품취급하는곳은 웰릭스랑 손오공만이야」
 *   「탭으로 나눠서 손오공 탭이랑 웰릭스탭이랑 나눠서 저 양식이랑 글씨 크기 맞춰서」
 *   「이거도 매뉴얼 만들어서 다른시트랑 동일하게 업데이트 될수 있게끔 / 상품시트 업데이트될때 같이 하게끔 / 상품시트로 분류해서」
 *
 * ★판매시트(「프리패스 상품리스트」)와 무엇이 다른가
 *   판매시트 = 우리 영업자가 보는 **표**(41열 한 줄 = 한 대). 서식은 sales-sheet-format.ts.
 *   이 시트   = 남의 회사 영업자에게 넘기는 **카드**(7행 × 13열 = 한 대). 서식은 여기.
 *   ⚠ 둘은 서식이 다르다 — sales-sheet-format 의 buildSalesFormatRequests 를 여기에 쓰지 마라.
 *
 * ★격자·색·글자 크기는 손오공이 실제로 뿌리던 카드 이미지를 픽셀로 재서 나온 값이다
 *   (견본 `KakaoTalk_20260821_124431050.png` · 2026-08-21 실측).
 *   세로선 x = 0·117·154·207·388·441·622·675·837·890·968·1045·1122·1255 → COLUMN_WIDTHS
 *   가로선 y = 46 간격 7줄 → ROW_HEIGHT 46, 카드 한 장 7행
 *   글자 크기는 실측 글자 폭을 Malgun Gothic 메트릭으로 역산했다(「89,000 km」 92px = 15pt 등).
 *
 * ★값은 어디서 오나 — **지어내지 않는다.**
 *   재고 칸(차량번호·차명·색상·주행거리·차량가격·옵션·요금) = 공급사 제공시트 재고 탭 글자 그대로.
 *   차명 = 정제칸 「세부모델」 그대로(세대코드 LX2·NQ5 를 떼지 않는다) · 등급 = 정제칸 「세부트림」
 *          — 사장님 2026-08-21 「세부모델은 더 뉴 팰리세이드 LX2 까지겠지 / 그 밑에는 세부트림」.
 *          인승(7인)은 붙이지 않는다 — 세부모델에 안 들어가는 값이다.
 *   조건 칸(소득증빙·만21세·면허·카드결제·보증금)과 머리띠 문구 = 그 공급사 시트 「운영정책」 탭에서 뽑는다.
 *          정책이 바뀌면 다음 발행에 저절로 따라간다. 코드에 박은 것은 OVERRIDE 뿐이다.
 */

export type Rec = Record<string, any>;

/* ── 견본 실측 격자 ─────────────────────────────────────────── */
/** A 조건명 · B O/X · C 소제목 · D 값 · E 소제목 · F 값 · G 소제목 · H 값 · I 금액 · J 보증금 · K 기간 · L 월요금 · M 만기문구 */
export const COLUMN_WIDTHS = [117, 37, 53, 181, 53, 181, 53, 162, 53, 78, 77, 77, 133];
export const CARD_ROWS = 7;
export const ROW_HEIGHT = 46;
export const BANNER_HEIGHT = 30;
/** 견본은 맑은 고딕. 글자 크기를 이 폰트 폭으로 역산했으니 바꾸면 칸이 넘친다. */
export const FONT = 'Malgun Gothic';

const rgb = (r: number, g: number, b: number) => ({ red: r / 255, green: g / 255, blue: b / 255 });
export const COLOR = {
  머리띠: rgb(204, 255, 255),   // #CCFFFF — 카드 첫 줄
  강조: rgb(255, 255, 153),     // #FFFF99 — 「만 21세 가능」 줄 · 등급 값
  소제목: rgb(255, 230, 153),   // #FFE699 — 색상/시트/주행거리/차량가격/유종/등급/연식/옵션/금액 라벨
  흰: rgb(255, 255, 255),
  빨강: rgb(255, 0, 0),         // 소득 증빙 줄 · 차명 「더 뉴」
  파랑: rgb(68, 114, 196),      // #4472C4 — 조건 라벨 · 옵션 · 만기문구 · 주행 안내
  검정: rgb(0, 0, 0),
};
/** 실측 글자 폭에서 역산한 크기(pt). */
export const SIZE = { 조건: 12, 소제목: 11, 금액라벨: 10, 값: 14, 차량번호: 18, 차명: 17, 금액: 15, 안내: 12 };

const BORDER = { style: 'SOLID', width: 1, color: COLOR.검정 };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

export type CellOpt = {
  size?: number; bold?: boolean; color?: Rec; bg?: Rec;
  wrap?: string; runs?: Rec[] | null; halign?: string; noBorder?: boolean;
};
export function cell(text: string, o: CellOpt = {}): Rec {
  const { size = SIZE.값, bold = false, color = COLOR.검정, bg = COLOR.흰, wrap = 'WRAP', runs = null, halign = 'CENTER', noBorder = false } = o;
  const c: Rec = {
    userEnteredValue: text === '' || text == null ? {} : { stringValue: String(text) },
    userEnteredFormat: {
      backgroundColor: bg, horizontalAlignment: halign, verticalAlignment: 'MIDDLE',
      wrapStrategy: wrap, textFormat: { fontFamily: FONT, fontSize: size, bold, foregroundColor: color },
    },
  };
  if (!noBorder) c.userEnteredFormat.borders = BORDERS;
  if (runs) c.textFormatRuns = runs;
  return c;
}
const blank = (bg: Rec = COLOR.흰) => cell('', { bg });

/* ── 값 정리 ───────────────────────────────────────────────── */
export const S = (v: unknown) => String(v ?? '').trim();
export const numOf = (v: unknown) => Number(S(v).replace(/[^\d.-]/g, '')) || 0;
export const man = (v: unknown) => { const n = numOf(v); return n ? String(Math.round(n / 10000)) : ''; };
export const comma = (v: unknown) => { const n = numOf(v); return n ? n.toLocaleString('ko-KR') : ''; };

/** 최초등록일(22-08-03 · 2020-07-03 · 22-08) → 「22년 08월」 */
export function yeonsik(raw: unknown): string {
  const t = S(raw); let m;
  if ((m = t.match(/^(\d{4})[-.\/](\d{1,2})/))) return `${m[1].slice(2)}년 ${String(m[2]).padStart(2, '0')}월`;
  if ((m = t.match(/^(\d{2})[-.\/](\d{1,2})/))) return `${m[1]}년 ${String(m[2]).padStart(2, '0')}월`;
  return t;
}
/** 배기량 2199 + 디젤 → 「2.2 디젤」. 전기는 배기량을 안 쓴다. */
export function yujong(cc: unknown, fuel: unknown): string {
  const f = S(fuel), n = numOf(cc);
  if (!n || /전기/.test(f)) return f;
  return `${(Math.round(n / 100) / 10).toFixed(1)} ${f}`;
}
export const optText = (raw: unknown) => S(raw).replace(/\s*[\/,]\s*/g, ' / ').replace(/\s+/g, ' ').trim();

/* ── 요금 고르기 ───────────────────────────────────────────── */
/** ★사장님 2026-08-21 — 「꼭 48개월이 아니라 대여료 최저가 기준으로 넣는다는거네」 */
export type Money = { label: string; won: number; deposit: string };
const TERMS: [number, string, number][] = [[12, '1년', 1], [24, '2년', 2], [36, '3년', 3], [48, '4년', 4], [60, '5년', 5]];

/** 장기렌트 — 24~60개월 중 최저가, 보증금은 「장기보증」 칸(기간과 무관하게 고정). */
export function cheapestRent(get: (n: string) => unknown): Money | null {
  const long = TERMS.filter(([m]) => m >= 24)
    .map(([m, label]) => ({ label, won: numOf(get(`${m}개월`)) })).filter((x) => x.won > 0);
  if (long.length) {
    const best = long.reduce((a, b) => (b.won < a.won ? b : a));
    return { ...best, deposit: man(get('장기보증')) || '-' };
  }
  const y1 = numOf(get('12개월'));
  if (y1 > 0) return { label: '1년', won: y1, deposit: man(get('단기보증')) || man(get('장기보증')) || '-' };
  return null;
}
/** 구독 반납형 — 12~60개월 반납형 중 최저가. 보증금 = 연수 × 대여료(손오공 규칙: 시트 보증금 칸 글자가 「연수×대여료」). */
export function cheapestSubReturn(get: (n: string) => unknown): Money | null {
  const c = TERMS.map(([m, label, yr]) => ({ label, yr, won: numOf(get(`${m}개월 반납형`)) })).filter((x) => x.won > 0);
  if (!c.length) return null;
  const best = c.reduce((a, b) => (b.won < a.won ? b : a));
  return { label: best.label, won: best.won, deposit: String(Math.round((best.yr * best.won) / 10000)) };
}
export const PRICERS = { 렌트: cheapestRent, 구독반납형: cheapestSubReturn } as const;
export type PricerName = keyof typeof PRICERS;

/* ── 운영정책 탭 → 카드 조건 칸 ─────────────────────────────── */
export type CardPolicy = {
  소득증빙: string; 만21세: string; 면허1년: string; 카드결제: string; 보증금협의: string;
  정비문구: string; 분납문구: string; 기본주행: string; 만기문구: string;
};
/** 코드에 박아 두는 것 — 정책 탭으로는 안 나오는 값만. 그 밖은 전부 정책 탭에서 뽑는다. */
export type PolicyOverride = Partial<CardPolicy>;

export function cardPolicy(pol: Record<string, string>, pricer: PricerName, over: PolicyOverride = {}): CardPolicy {
  const p = (n: string) => S(pol[n]);
  const 주행 = numOf(p('기본주행'));
  const 반환 = p('보증금 반환기한');
  const base: CardPolicy = {
    // 무심사면 소득 증빙을 안 받는다 → X
    소득증빙: /무심사/.test(p('심사조건')) ? 'X' : 'O',
    // 연령인하 「만 21세까지」면 O, 「불가」면 X
    만21세: /불가|없음/.test(p('연령인하')) ? 'X' : (/21/.test(p('연령인하')) ? 'O' : '-'),
    // 면허기간 「1년 이상」 = 1년 미만은 안 된다 → X
    면허1년: /1년\s*이상/.test(p('면허기간')) ? 'X' : (p('면허기간') ? 'O' : '-'),
    // 대여료 결제수단(보증금 카드결제와 다른 칸이다)
    카드결제: /불가|없음/.test(p('결제방식')) ? 'X' : (/카드/.test(p('결제방식')) ? 'O' : 'X'),
    보증금협의: /불가|없음/.test(p('보증금분납')) ? 'X' : 'O',
    정비문구: /별도/.test(p('보험료')) ? `${p('보험료')} · 정비 ${p('정비') || '협의'}` : `정비 ${p('정비') || '협의'}`,
    분납문구: p('보증금분납') ? `보증금 분납 ${p('보증금분납')}` : '보증금 분납 협의',
    기본주행: 주행 ? `기본 : 연 ${Math.round(주행 / 10000)}만km` : '기본 주행 협의',
    만기문구: pricer === '구독반납형'
      ? `만기 반납${반환 ? `\n보증금 ${반환}내 반환` : ''}`
      : '종료 한달전\n인수가 확인',
  };
  return { ...base, ...over };
}

/* ── 카드 한 장 = 7행 × 13열 ───────────────────────────────── */
export type CardVehicle = {
  차량번호: string; 상태: string; 차명: string; 색상: string; 시트: string; 주행거리: string; 차량가격: string;
  유종: string; 등급: string; 연식: string; 옵션: string;
  보증금: string; 기간: string; 월요금: string;
  /** 요금 칸이 하나도 없었나 */
  값없음: boolean;
};

/** 재고 한 줄 → 카드 한 장의 값. get 은 머리글 이름으로 그 줄의 칸을 준다. */
export function toCardVehicle(get: (n: string) => unknown, pricer: PricerName): CardVehicle {
  const m = PRICERS[pricer](get);
  return {
    값없음: !m,
    상태: S(get('상태')),
    차량번호: S(get('차량번호')),
    차명: S(get('세부모델')) || S(get('모델명')),
    색상: S(get('외부색상')) || S(get('외장색상')) || '-',
    시트: S(get('내부색상')) || S(get('내장색상')) || '-',
    주행거리: numOf(get('주행거리')) ? `${comma(get('주행거리'))} km` : '-',
    차량가격: comma(get('차량가격')) || '-',
    유종: yujong(get('배기량'), get('연료')),
    등급: S(get('세부트림')) || '-',
    연식: yeonsik(get('최초등록일')) || S(get('연식')),
    옵션: optText(get('옵션')) || '-',
    보증금: m ? m.deposit : '-',
    기간: m ? m.label : '-',
    월요금: m ? String(Math.round(m.won / 10000)) : '-',
  };
}

/** 차량번호 칸 — 출고가능이 아닌 차는 아래 줄에 상태를 작게 적는다(계약중은 빨강). */
function plateCell(v: CardVehicle): Rec {
  const mark = statusMark(v.상태);
  if (!mark) return cell(v.차량번호, { size: SIZE.차량번호, bold: true });
  const 색 = /계약중/.test(mark) ? COLOR.빨강 : COLOR.파랑;
  return cell(`${v.차량번호}\n${mark}`, {
    size: SIZE.차량번호, bold: true,
    runs: [
      { startIndex: 0, format: { fontFamily: FONT, fontSize: SIZE.차량번호, bold: true, foregroundColor: COLOR.검정 } },
      { startIndex: v.차량번호.length + 1, format: { fontFamily: FONT, fontSize: SIZE.소제목, bold: true, foregroundColor: 색 } },
    ],
  });
}

export function buildCard(v: CardVehicle, P: CardPolicy): Rec[][] {
  const L = (t: string, o: CellOpt = {}) => cell(t, { size: SIZE.조건, color: COLOR.파랑, ...o });
  const lab = (t: string) => cell(t, { size: SIZE.소제목, bold: true, bg: COLOR.소제목 });
  const five = () => Array.from({ length: 5 }, () => blank());
  // 견본은 차명 앞머리 「더 뉴」만 빨강이다.
  const nameRuns = v.차명.startsWith('더 뉴')
    ? [{ startIndex: 0, format: { fontFamily: FONT, fontSize: SIZE.차명, bold: true, foregroundColor: COLOR.빨강 } },
       { startIndex: 3, format: { fontFamily: FONT, fontSize: SIZE.차명, bold: true, foregroundColor: COLOR.검정 } }]
    : null;
  return [
    [
      cell('소득 증빙', { size: SIZE.조건, color: COLOR.빨강, bg: COLOR.머리띠 }),
      cell(P.소득증빙, { size: SIZE.조건, bold: true, color: COLOR.빨강, bg: COLOR.머리띠 }),
      cell(P.정비문구, { size: SIZE.값, bold: true, bg: COLOR.머리띠 }), blank(COLOR.머리띠),
      blank(COLOR.머리띠), blank(COLOR.머리띠), blank(COLOR.머리띠), blank(COLOR.머리띠),
      cell(P.분납문구, { size: SIZE.값, bold: true, bg: COLOR.머리띠 }),
      blank(COLOR.머리띠), blank(COLOR.머리띠), blank(COLOR.머리띠), blank(COLOR.머리띠),
    ],
    [
      L('만 21세 가능', { bg: COLOR.강조 }), cell(P.만21세, { size: SIZE.조건, bold: true, color: COLOR.파랑, bg: COLOR.강조 }),
      plateCell(v), blank(),
      lab('색상'), cell(v.색상),
      lab('주행\n거리'), cell(v.주행거리),
      cell('금액', { size: SIZE.금액라벨, bold: true, bg: COLOR.소제목 }),
      cell(v.보증금, { size: SIZE.금액, bold: true }), cell(v.기간, { size: SIZE.금액, bold: true }), cell(v.월요금, { size: SIZE.금액, bold: true }),
      cell(P.만기문구, { size: SIZE.값, bold: true, color: COLOR.파랑 }),
    ],
    [
      L('면허 1년 미만'), cell(P.면허1년, { size: SIZE.조건, bold: true, color: COLOR.파랑 }),
      cell(v.차명, { size: SIZE.차명, bold: true, runs: nameRuns }), blank(),
      lab('시트'), cell(v.시트, { bold: true }),
      lab('차량\n가격'), cell(v.차량가격, { bold: true }),
      ...five(),
    ],
    [
      L('카드 결제'), cell(P.카드결제, { size: SIZE.조건, bold: true, color: COLOR.파랑 }),
      blank(), blank(),
      cell('옵션', { size: SIZE.금액라벨, bold: true, bg: COLOR.소제목 }), cell(v.옵션, { color: COLOR.파랑 }), blank(), blank(),
      ...five(),
    ],
    [
      L('보증금 협의'), cell(P.보증금협의, { size: SIZE.조건, bold: true, color: COLOR.파랑 }),
      lab('유종'), cell(v.유종),
      blank(COLOR.소제목), blank(), blank(), blank(),
      ...five(),
    ],
    [
      blank(), blank(),
      lab('등급'), cell(v.등급, { bold: true, bg: COLOR.강조 }),
      blank(COLOR.소제목), blank(), blank(), blank(),
      ...five(),
    ],
    [
      blank(), blank(),
      lab('연식'), cell(v.연식),
      blank(COLOR.소제목), cell(P.기본주행, { bold: true, color: COLOR.파랑, bg: COLOR.소제목 }),
      cell('주행거리 변경시문의', { size: SIZE.안내, color: COLOR.파랑, bg: COLOR.소제목 }), blank(COLOR.소제목),
      ...five(),
    ],
  ];
}

/** 카드 한 장의 병합 — r0 은 카드 첫 행(0-based). 견본 세로선 검출률(117=71% → 5/7행)로 확인한 배치다. */
export function cardMerges(sheetId: number, r0: number): Rec[] {
  const spans: [number, number, number, number][] = [
    [r0, r0 + 1, 2, 4], [r0, r0 + 1, 4, 8], [r0, r0 + 1, 8, 13],   // 머리띠
    [r0 + 1, r0 + 2, 2, 4],                                         // 차량번호
    [r0 + 2, r0 + 4, 2, 4],                                         // 차명(2행)
    [r0 + 3, r0 + 7, 4, 5], [r0 + 3, r0 + 6, 5, 8],                 // 옵션 라벨 · 옵션 내용
    [r0 + 6, r0 + 7, 6, 8],                                         // 주행거리 변경시문의
    [r0 + 5, r0 + 6, 0, 2], [r0 + 6, r0 + 7, 0, 2],                 // 조건칸 아래 빈 줄
    [r0 + 1, r0 + 7, 8, 9], [r0 + 1, r0 + 7, 9, 10], [r0 + 1, r0 + 7, 10, 11], [r0 + 1, r0 + 7, 11, 12], [r0 + 1, r0 + 7, 12, 13],
  ];
  return spans.map(([startRowIndex, endRowIndex, startColumnIndex, endColumnIndex]) => ({
    mergeCells: { range: { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex }, mergeType: 'MERGE_ALL' },
  }));
}

/* ── 채널 명부 ─────────────────────────────────────────────── */
export type CardBlock = {
  /** 탭 안의 블록 이름(구독/렌트처럼 상품 종류가 다르면 블록이 갈린다) */
  갈래: string;
  /** 공급사 제공시트 */
  공급사: string; sheetId: string; tab: string;
  pricer: PricerName;
  /** 운영정책 탭에서 이 정책코드 줄을 읽는다(재고 줄의 정책코드와 다르면 발행기가 경고한다) */
  정책코드: string;
  override?: PolicyOverride;
};
export type CardTab = { title: string; sheetId: number; blocks: CardBlock[] };
export type Channel = { 이름: string; 문서: string; tabs: CardTab[] };

const 손오공시트 = '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA';
const 웰릭스시트 = '1T9az8BfEpM-QUllo5Sr2VxOcJBy3UvXPAvkuGy4C6hI';

/**
 * 실을 상태 — **판매시트와 똑같이 「출고불가」만 뺀다**(정본 scripts/publish-origin-tab.mts · 사장님 2026-08-18 「출고불가 빼고 해줘야지」).
 * ⚠ 2026-08-21 한때 「출고가능만」으로 좁혔다가 손오공 구독이 43 → 20대로 줄었다
 *   (사장님 「손오공 반납형 구독이 대수가 더 될건데」). 출고협의는 «일정만 맞추면 되는 팔 수 있는 차»다.
 * 출고가능이 아닌 차는 카드 차량번호 아래에 상태를 같이 적는다 — 계약중을 표시 없이 내보내면 사고.
 */
export const CARD_EXCLUDE = /출고불가/;
export const statusMark = (상태: string) => (상태 && 상태 !== '출고가능' ? 상태 : '');
/** 대여료가 한 칸도 없는 차는 카드가 「보증금 - / 기간 - / 월 -」로 빈다 → 기본은 빼고 수를 남긴다(--keep-no-price 로 실을 수 있다). */
export const NO_PRICE_NOTE = '대여료가 한 칸도 없는 차';

export const CHANNELS: Channel[] = [
  {
    이름: '천이컴퍼니',
    문서: '1Rnhecsmma_cvLCUNTHn5TPkXBRoZJpYgkP5ZJxALug0',
    tabs: [
      { title: '손오공', sheetId: 100, blocks: [
        { 갈래: '장기렌트', 공급사: '손오공', sheetId: 손오공시트, tab: '렌트재고', pricer: '렌트', 정책코드: 'POL-0046',
          // 견본 카드(손오공이 실제로 뿌리던 것)에 있던 문구 — 정책 탭 「정비: 협의」로는 안 나온다.
          override: { 정비문구: '연1회 [ 엔진오일 ] 서비스', 분납문구: '보증금 분납 2~3회' } },
        { 갈래: '구독(반납형)', 공급사: '손오공', sheetId: 손오공시트, tab: '구독재고', pricer: '구독반납형', 정책코드: 'POL-0020',
          // 사장님 2026-08-21 「손오공 보증금 2~3회로 해줘」
          override: { 분납문구: '보증금 분납 2~3회' } },
      ] },
      { title: '웰릭스', sheetId: 200, blocks: [
        { 갈래: '장기렌트·구독', 공급사: '웰릭스', sheetId: 웰릭스시트, tab: '재고', pricer: '렌트', 정책코드: 'POL-0023' },
      ] },
    ],
  },
];

/** 「0821 천이컴퍼니 상품카드 [영업채널] [연동중]」 — 제공시트 이름 규칙과 같은 꼴. */
export const channelDocTitle = (이름: string, mmdd: string) => `${mmdd} ${이름} 상품카드 [영업채널] [연동중]`;

/** 시트 안 「이 시트는」 탭 — [항목, 내용, 링크] 세 칸. 판매시트·제공시트의 같은 이름 탭과 같은 꼴이다. */
export function channelIdentityRows(ch: Channel, counts: Record<string, number>, at: string): [string, string, string][] {
  const url = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;
  const R: [string, string, string][] = [];
  const row = (a: string, b: string, c = '') => R.push([a, b, c]);
  row(`이 시트는 — ${ch.이름} 상품카드`, `정본 lib/domain/channel-card-sheet.ts · 이 문서는 기계가 통째로 다시 찍는다(손으로 고치면 다음 발행에 지워진다) · 갱신 ${at} KST`, 'npx tsx scripts/publish-channel-cards.mts --apply');
  row('분류', '상품시트 — 판매시트(프리패스 상품리스트)와 같은 재고에서 나오는 갈래. 우리 영업자용 «표»가 아니라 영업채널에 넘기는 «카드»다.', '');
  row('상태', '연동중 — 「일일 반영」(run-daily) 이 상품리스트를 찍을 때 같이 찍는다.', '');
  for (const t of ch.tabs) {
    for (const b of t.blocks) {
      row(`구성(탭) ${t.title}`, `${b.갈래} ${counts[`${t.title}/${b.갈래}`] ?? 0}대 — 카드 한 장 = 7행 × 13열 · 요금은 그 차의 최저 대여료와 그 기간`, '');
      row('바라보는 곳(입력)', `${b.공급사} 제공시트 「${b.tab}」 탭(출고불가만 빼고 전부 · 판매시트와 같은 기준) · 조건 칸은 같은 시트 「운영정책」 ${b.정책코드}`, url(b.sheetId));
    }
  }
  row('주는 곳(출력)', `${ch.이름} — 이 문서를 그대로 본다. 이 카드 문서가 ERP 입력은 아니며, 같은 정제/제공시트에서 ERP·공급사 상품시트·이 카드가 각각 병렬로 나간다.`, '');
  row('주기', '공급사가 시트를 고치면 → 「일일 반영」(npx tsx scripts/run-daily.mts --apply) ④″ 단계에서 다시 찍힌다.', '');
  row('틀리면 어디를 고치나', '차량 값(차명·요금·색상·옵션)은 공급사 제공시트 재고 탭에서 · 조건 칸과 머리띠 문구는 그 시트 「운영정책」 탭에서 · 격자와 글자 크기는 lib/domain/channel-card-sheet.ts 에서.', '');
  row('하지 말 것', '이 문서를 손으로 고치지 마라(다음 발행에 지워진다) · 카드에 우리가 모르는 문구를 넣지 마라(견본의 「#전면썬팅」 줄을 뺀 이유) · 판매시트 서식(sales-sheet-format)을 여기에 씌우지 마라.', '');
  row('더 보기', '매뉴얼 docs/영업채널-카드시트-매뉴얼.md · 판매시트 매뉴얼 docs/영업자시트-매뉴얼.md · 이 문서 「AI 운영 매뉴얼」 탭', '');
  return R;
}

/** 숨김 탭 「AI 운영 매뉴얼」 — 이 문서가 어디서 값을 «가져오는지»와 다시 찍는 법. 새 사람·새 AI 는 여기부터 읽는다. */
export function channelManualRows(ch: Channel): [string, string][] {
  const url = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;
  const R: [string, string][] = [];
  const row = (a: string, b = '') => R.push([a, b]);
  row(`AI 운영 매뉴얼 — ${ch.이름} 상품카드`, '이 탭은 기계가 다시 찍는다. 고칠 것은 리포에서: lib/domain/channel-card-sheet.ts');
  row('', '');
  row('1. 이 문서가 무엇인가', `${ch.이름}(영업채널)에 그대로 넘기는 상품 카드. 분류는 「상품시트」 — 판매시트 「프리패스 상품리스트」와 같은 재고에서 나오는 갈래다.`);
  row('', '우리 영업자용 «표»(열은 판매시트 「AI 인계」 @매핑·한 줄 = 한 대)가 아니라, 남의 회사 영업자가 보는 «카드»(7행 × 13열 = 한 대)다. 서식이 서로 다르니 섞지 마라.');
  row('', '★셀 규격을 섞지 않는다 — 공급사 파일 「상품시트」는 차량 1대=1행이고 기간별 금액을 모두 보존한다. 천이시트는 차량 1대=7행×13열이며 J:L에는 최저가 한 벌(보증금·기간·월대여료)만 표시한다. 셀 주소를 복사하지 말고 머리글 이름→buildCard 매핑을 쓴다.');
  row('', '');
  row('2. 값을 어디서 가져오나', '차량 값과 조건 문구는 전부 공급사 제공시트에서 온다. 이 문서에는 원본이 없다.');
  for (const t of ch.tabs) {
    for (const b of t.blocks) {
      row(`  · ${t.title} 탭 / ${b.갈래}`, `${b.공급사} 제공시트 「${b.tab}」 탭 → ${url(b.sheetId)}`);
      row('     ↳ 재고 칸', '차량번호·색상·주행거리·차량가격·옵션·기간별 대여료 = 그 줄 글자 그대로. 해석하지 않는다.');
      row('     ↳ 차명 · 등급', '정제칸 「세부모델」·「세부트림」 그대로. 세대코드(LX2·NQ5)를 떼지 않고, 인승도 붙이지 않는다.');
      row('     ↳ 조건 칸 · 머리띠', `같은 시트 「운영정책」 탭의 ${b.정책코드} 줄(심사조건·연령인하·면허기간·결제방식·보증금분납·기본주행·보험료).`);
      if (b.override) row('     ↳ 코드에 박은 문구', Object.entries(b.override).map(([k, v]) => `${k} = ${String(v).replace(/\n/g, ' ')}`).join(' · '));
      row('     ↳ 금액', `보증금 · 기간 · 월대여료 = 그 차의 «최저 대여료»와 그 기간. ${b.pricer === '구독반납형' ? '구독 반납형은 보증금 = 연수 × 대여료.' : '렌트는 보증금이 「장기보증」 칸 고정.'}`);
    }
  }
  row('', '');
  row('3. 어떤 차가 실리나', '출고불가만 뺀다(판매시트와 같은 기준). 출고협의·상품화중·계약중은 실리고, 차량번호 아래에 그 상태가 적힌다.');
  row('', '대여료가 한 칸도 없는 차는 카드가 비어 보여서 뺀다. 실으려면 --keep-no-price.');
  row('', '');
  row('4. 다시 찍는 법', '공급사가 시트를 고치면 「일일 반영」이 상품리스트를 찍을 때 이 문서도 같이 찍힌다.');
  row('  · 한 줄', 'npx tsx scripts/run-daily.mts --apply     (자동은 sheet-sync.yml 매일 09:10)');
  row('  · 이 문서만', 'npx tsx scripts/publish-channel-cards.mts --apply');
  row('  · 미리보기', 'npx tsx scripts/publish-channel-cards.mts        (--apply 없으면 아무것도 안 바뀐다)');
  row('  · 세 갈래 읽기 전용 대조', 'npx tsx scripts/audit-pipeline-destinations.mts     (ERP 대조는 audit-sheet-erp-parity 와 합쳐 본다)');
  row('', '');
  row('5. 하지 말 것', '이 문서를 손으로 고치지 마라 — 다음 발행에 통째로 다시 찍힌다. 고칠 값은 공급사 제공시트에서 고친다.');
  row('', '카드에 우리가 모르는 문구를 넣지 마라. 견본에 있던 「#전면썬팅 #측.후면 썬팅 #블랙박스」 줄은 근거가 없어 뺐다.');
  row('', '판매시트 서식(lib/domain/sales-sheet-format.ts)을 이 카드에 씌우지 마라. 격자·색·글자 크기는 손오공 견본 카드를 픽셀로 잰 값이다.');
  return R;
}
