/**
 * **하허호 전용 상품시트(F86) «레트로 스킨»** — 옛 「프리패스 공급사 상품리스트」 「종합」 탭의 서식을 «잰 값».
 *
 * ★사장님 2026-09-15 「하허호한테 만들어졌던 그 F86 을 원래 레트로 감성인 그 폰트하고 … 동일하게 맞춰주면 돼」
 *   · 「폰트하고 규격 뭐 이런 것만 하고, 대여료 구간은 우리 기존 그거대로 그냥 똑같이」 · 「종합 시트는 안 만들어도 돼」
 * ★원본 = 문서 1BcHvwidHrdJADPUH0M3C5abaxst04fDnfxm7R9FgLDg(freepassmobility@gmail.com) 「종합」 탭, 2026-09-15 API 로 실측.
 *   맑은 고딕 9pt 기울임 · 굵은 칸 없음 · 전부 가운데 · 줄 21px · 여백 2/3 · 기간 머리 색 · 칸별 «한 색» 글자 · 분납·연령 노란 바탕.
 *   열 폭은 옛 고정값이 아니라 «값에 맞춘» 폭(사장님 「간격은 맞게」).
 *
 * ★칸(이름·차례·내용)도 옛 「종합」 43칸이다 — 아래 `RETRO_LAYOUT`. 값은 erp5 원자에서 F01 과 같은 칸 만들기로.
 * ⚠ **공용 서식기(`sales-sheet-format`)는 안 고친다** — F01 모양이 같이 바뀐다. 그 서식 요청 «뒤»에 덮어 쓴다.
 * ⚠ 값별 색(구분·배차상태·제조사·연료·색상)은 살린다 — 옛 시트에 없던 «뜻»이라. 굵기만 옛 시트처럼 뺀다.
 */
import { isMoneyColumn } from './sales-sheet-format';

type Req = Record<string, any>;

/**
 * ★★★**칸도 «옛 「종합」 그대로» — 이름·차례·내용 43칸** — 사장님 2026-09-15
 *   「이건 새로운 구현이라고 보면 돼, 과거 형태에 맞추는 거로」 · 「순서를 똑같이, 내용도 똑같이, 원자만 erp5 거 사용」.
 *   ⚠ 매뉴얼 F86 규칙 1·2(「F86 칸 = F01」)를 이 날 바꿨다 — 발행기·감사기(`audit-sheet-vs-atom`)가 «이 표 하나»를 쓴다.
 * ★각 칸의 «값»은 erp5 원자에서 — F01 과 같은 칸 만들기(`makeCell`)를 거친 값을 옛 이름 자리에 옮긴다.
 *   옛 칸이 담던 것을 실측(2026-09-15 · 252줄)해 맞는 원자 칸에 잇는다:
 *     차종분류 = 모델명(K5·그랜저) → 「모델」 · 트림 = 공급사 차명 원문(「셀토스 1.6 가솔린 트렌디 2WD」) → 「차명(원문)」
 *     옵션 → 「옵션(원문)」 · 21세·23세(추가요금) → 「21세+」·「23세+」 · 공급사코드·정책코드 → 원자 provider_company_code·policy_code
 * ★「@요금」 = 그 회사가 쓰는 요금 칸(F01 차례) — 대여료 구간은 «우리 기존 그대로»(같은 날 지시).
 * ⚠ 차량상태·입고일자는 **원자에 그 값이 없다** — 빈 칸으로 둔다(옛 시트는 「정상」·섞인 메모였다. 지어내지 않는다).
 * ⚠ 사진·차번링크는 «숨긴 채» 맨 뒤에 둔다 — 차번 셀 사진 링크의 재료다(`check-plate-photo-link`).
 */
type RetroSource = { kind: 'col'; name: string } | { kind: 'fee' } | { kind: 'atom'; field: string } | { kind: 'blank' };
export type RetroColumn = { head: string; src: { kind: 'col'; name: string } | { kind: 'atom'; field: string } | { kind: 'blank' } };
const col = (name: string): RetroSource => ({ kind: 'col', name });
const same = (...names: string[]) => names.map((n) => ({ head: n, src: col(n) }));
export const RETRO_LAYOUT: { head: string; src: RetroSource }[] = [
  { head: '차량상태', src: { kind: 'blank' } },
  ...same('배차상태'),
  { head: '입고일자', src: { kind: 'blank' } },
  ...same('구분', '차량번호'),
  { head: '차종분류', src: col('모델') },
  ...same('세부모델', '연료', '외장', '내장', 'Km'),
  { head: '@요금', src: { kind: 'fee' } },
  { head: '트림', src: col('차명(원문)') },
  { head: '옵션', src: col('옵션(원문)') },
  ...same('최초등록', '소비자가격', '제조사', '배기량', '차고지', '운전자범위', '연주행', '분납'),
  { head: '21세', src: col('21세+') },
  { head: '23세', src: col('23세+') },
  ...same('1만+', '대인', '대물', '자차', '자손', '무보험', '정비', '전용계좌', '비고'),
  { head: '공급사코드', src: { kind: 'atom', field: 'provider_company_code' } },
  { head: '정책코드', src: { kind: 'atom', field: 'policy_code' } },
  ...same('사진', '차번링크'),
];

const 요금칸 = (c: string) => isMoneyColumn(c) && !/가격/.test(c);
/** 옛 시트의 기간 9칸 — 차례 그대로. */
export const RETRO_PERIODS = ['단기보증', '1개월', '6개월', '12개월', '장기보증', '24개월', '36개월', '48개월', '60개월'] as const;

/**
 * ★**숫자·날짜는 «옛 형식»으로 넣는다** — 옛 시트는 요금·Km·배기량·소비자가격이 숫자(#,##0), 최초등록이 날짜(yy-m-d)였다.
 *   글자로 넣으면 「1598」·「2026-07-24」처럼 보이고 옛 모양이 안 난다. 숫자 모양이 아닌 값(「무보증」·「불가」·「-」)은 글자 그대로.
 */
const 숫자칸 = (h: string) => 요금칸(h) || h === '소비자가격' || h === 'Km' || h === '배기량';
export function retroCellValue(head: string, v: string): string | number {
  const t = String(v ?? '').trim();
  if (!t) return '';
  if (숫자칸(head) && /^-?[\d,]+(\.\d+)?$/.test(t)) return Number(t.replace(/,/g, ''));
  if (head === '최초등록') {
    const m = /^(\d{2}|\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(t);
    if (m) {
      const y = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
      return Math.round((Date.UTC(y, Number(m[2]) - 1, Number(m[3])) - Date.UTC(1899, 11, 30)) / 86_400_000);
    }
  }
  return t;
}
/** 감사기용 — 시트에서 숫자·날짜로 읽힌 값을 F01 글자와 견줄 수 있게 되돌린다. */
export function retroSameValue(head: string, f01: string, sheet: string): boolean {
  const a = String(f01 ?? '').trim(); const b = String(sheet ?? '').trim();
  if (a === b) return true;
  if (숫자칸(head) && a.replace(/,/g, '') === b.replace(/,/g, '')) return true;
  if (head === '최초등록' && /^\d+(\.\d+)?$/.test(b)) return retroCellValue('최초등록', a) === Math.round(Number(b));
  return false;
}

/** 한 탭이 쓰는 F01 칸(요금은 그 회사가 쓰는 것만) → 옛 「종합」 칸 목록. */
export function retroLayout(cols: readonly string[]): RetroColumn[] {
  const out: RetroColumn[] = [];
  for (const e of RETRO_LAYOUT) {
    if (e.src.kind === 'fee') {
      /** ★옛 시트는 기간 9칸이 «늘» 있었다(안 쓰면 빈 칸) — 사장님 2026-09-15 확인. 옛 9칸에 없는 요금 칸(반납형·km…)은 그 뒤에 F01 차례로. */
      for (const k of RETRO_PERIODS) out.push(cols.includes(k) ? { head: k, src: { kind: 'col', name: k } } : { head: k, src: { kind: 'blank' } });
      for (const c of cols) if (요금칸(c) && !(RETRO_PERIODS as readonly string[]).includes(c)) out.push({ head: c, src: { kind: 'col', name: c } });
      continue;
    }
    if (e.src.kind === 'col' && !cols.includes(e.src.name)) {
      if (e.head === '사진' || e.head === '차번링크') continue;
      out.push({ head: e.head, src: { kind: 'blank' } });
      continue;
    }
    out.push(e as RetroColumn);
  }
  return out;
}
/** 옛 머리글 → F01 칸 이름(감사기가 값을 맞춰 볼 때). 모르는 머리글은 그대로. */
export const retroHeadToColumn = (head: string): string => {
  const e = RETRO_LAYOUT.find((x) => x.head === head && x.src.kind === 'col');
  return e && e.src.kind === 'col' ? e.src.name : head;
};
/** 이 F01 칸이 F86 에 «실리는가» — 안 실리는 칸은 감사기가 「누락」으로 세지 않는다. */
export const retroUsesColumn = (name: string): boolean =>
  요금칸(name) || RETRO_LAYOUT.some((x) => x.src.kind === 'col' && x.src.name === name);

export const RETRO_FONT = 'Malgun Gothic';
export const RETRO_SIZE = 9;
export const RETRO_ROW_PX = 21;

/** 기간 머리 바탕 — 단기(초록·파랑) · 장기(짙어지는 빨강). 몸 칸은 흰 바탕이다. */
const HEAD_BG: Record<string, string> = {
  단기보증: 'B7E1CD', '1개월': 'A4C2F4', '6개월': '6D9EEB', '12개월': '3C78D8',
  장기보증: 'E6B8AF', '24개월': 'DD7E6B', '36개월': 'CC4125', '48개월': 'A61C00', '60개월': '85200C',
};
/** 기간 머리 «글자»색 — 옛 시트 실측: 단기 블록 청록(#46BDC6) · 장기 블록 흰색. 검정으로 두면 짙은 빨강 머리에서 안 읽힌다. */
const HEAD_INK: Record<string, string> = {
  단기보증: '46BDC6', '1개월': '46BDC6', '6개월': '46BDC6', '12개월': '46BDC6',
  장기보증: 'FFFFFF', '24개월': 'FFFFFF', '36개월': 'FFFFFF', '48개월': 'FFFFFF', '60개월': 'FFFFFF',
};
/**
 * ★**옛 시트에 없는 요금 칸도 «옛 색»으로** — 사장님 2026-09-15 「대여료 색깔이나 이런 걸 모두 동일하게」.
 *   반납형·인수형(손오공) · 2만/3만km(오토플러스) · 18개월 · 보증금 — 기간으로 옛 칸 하나에 대어 그 칸 색을 쓴다.
 *   몇 개월 = 1 → 1개월 · ~6 → 6개월 · ~12 → 12개월 · ~24 → 24개월(18 포함) · ~36 · ~48 · 그 위 60개월.
 *   개월이 없는 보증 칸(보증금 반납형·인수형·보증금) = 장기보증(구독·장기 계약의 보증금이라서). 단기보증은 제 이름 그대로.
 * ⚠ 값·칸 이름은 그대로 — 색만 빌린다.
 */
export function retroFeeStyleOf(name: string): string {
  if (HEAD_BG[name]) return name;
  const m = /^(\d+)개월/.exec(String(name).trim());
  if (m) {
    const mo = Number(m[1]);
    return mo <= 1 ? '1개월' : mo <= 6 ? '6개월' : mo <= 12 ? '12개월' : mo <= 24 ? '24개월' : mo <= 36 ? '36개월' : mo <= 48 ? '48개월' : '60개월';
  }
  return /단기/.test(name) ? '단기보증' : '장기보증';
}
/** 몸 칸 글자색 — 옛 시트 칸별. 이름이 같은 칸에만 건다(없는 칸을 만들지 않는다). */
const BODY_INK: Record<string, string> = {
  /* ★2026-09-15 «회사 탭» 기준으로 고침 — F86 은 회사별 탭이라 옛 「종합」이 아니라 옛 회사 탭(손오공·아이언·스타·센트로·아이카 다수)을 따른다:
       구분 초록(#34A853) · 단기보증·1·6·12개월 청록(#46BDC6). 종합은 구분 자홍·단기보증 빨강이었다. */
  차량상태: '0000FF', 배차상태: '0000FF', 입고일자: '1155CC', 차량번호: '1155CC', 구분: '34A853',
  단기보증: '46BDC6', '1개월': '46BDC6', '6개월': '46BDC6', '12개월': '46BDC6',
  장기보증: '0000FF', '24개월': '0000FF', '36개월': '0000FF', '48개월': '0000FF', '60개월': '0000FF',
  차고지: '1F1F1F', 분납: 'FF0000', '21세': 'FF0000', '23세': 'FF0000', '21세+': 'FF0000', '23세+': 'FF0000',
  '1만+': 'FF0000', 전용계좌: 'FF0000', 비고: 'FF0000',
};
/** 몸 칸 바탕 — 분납·연령·주행 추가요금은 노란 바탕(옛 시트). */
const BODY_BG: Record<string, string> = { 분납: 'FFFF00', '21세': 'FFFF00', '23세': 'FFFF00', '21세+': 'FFFF00', '23세+': 'FFFF00', '1만+': 'FFFF00' };

/**
 * ★**긴 글 칸만 «값에 맞춰» 넓힌다** — 사장님 2026-09-15 「간격은 맞게」.
 *   서식기는 트림·옵션을 240 에서 자른다(판매시트 규칙). 실측 미리보기 — 트림 90% 값 ≈ 300px · 옵션 ≈ 360~1,077px 가 필요했다.
 *   ⇒ 이 두 칸만 «90% 값»으로 재되, 옛 시트 폭(트림 342 · 옵션 857)을 상한으로 둔다(옛 얼굴보다 넓어지지 않게).
 *   맑은 고딕 9pt 기준 — 한글 1자 ≈ 반각 2칸, 반각 1칸 ≈ 6.3px, 좌우 여백 12px.
 */
const LONG_TEXT_MAX: Record<string, number> = { 트림: 342, 옵션: 857 };
const 반각 = (v: string) => [...String(v ?? '')].reduce((n, ch) => n + (/[ᄀ-ᇿ　-鿿가-힯＀-｠]/.test(ch) ? 2 : 1), 0);
function fitWidth(name: string, values: string[]): number {
  const lens = values.map(반각).sort((a, b) => a - b);
  const p90 = lens.length ? lens[Math.min(lens.length - 1, Math.floor(lens.length * 0.9))] : 0;
  const px = Math.round(Math.max(p90, 반각(name) + 1) * 6.3 + 12);
  return Math.max(62, Math.min(LONG_TEXT_MAX[name], px));
}

/**
 * ★**탭 색 = 옛 시트 회사 탭 색**(2026-09-15 실측 · 「느낌도 과거 느낌」). 옛 탭 이름을 지금 회사 이름에 댄다.
 *   옛 시트에 탭 색이 없던 회사·그때 없던 회사(이안카·오토플러스·마음카)는 «색 없음».
 */
const RETRO_TAB_COLOR: Record<string, string> = {
  손오공: '0000FF', 아이카: 'FF0000', 케이에이치: 'B7E1CD', KH: 'B7E1CD', 아이언: 'FF00FF', 퍼시픽: 'E4DCD3',
  스타스카이: '3D85C6', 스타: '3D85C6', 웰릭스: '0000FF', 경진: 'FFFF00', 센트로: '0000FF', 에이스: '0000FF',
  우리캐피탈: 'FF00FF', 빌린카: 'B7E1CD', 엘씨렌트: 'B7E1CD', 스위치플랜: '0000FF', 스위치: '0000FF',
};
/** 회사 탭 색 요청 — 색이 없던 회사는 탭 색을 «지운다». */
export function retroTabColorRequest(sheetId: number, company: string): Req {
  const h = RETRO_TAB_COLOR[company];
  return h
    ? { updateSheetProperties: { properties: { sheetId, tabColor: rgb(h) }, fields: 'tabColor' } }
    : { updateSheetProperties: { properties: { sheetId }, fields: 'tabColor' } };
}

const rgb = (h: string) => ({
  red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255,
});

/**
 * 한 탭의 서식 요청(`buildSalesFormatRequests` 결과) 뒤에 레트로 겉을 덮는다.
 * @param linkReqs 차번 셀 링크 요청(값을 쓴 뒤 따로 보내는 것) — 링크 글자에도 글꼴이 박혀 있어 같이 바꾼다.
 */
export function applyRetroSkin(reqs: Req[], linkReqs: Req[], p: { gid: number; columns: string[]; headerAt?: number; body?: string[][] }): Req[] {
  const { gid, columns } = p;
  const H = p.headerAt ?? 0;

  /**
   * ① **값별 색 조건부서식은 걷는다** — 사장님 2026-09-15 「폰트랑 색깔 맞춰주고」.
   *   옛 시트는 칸마다 «한 색»이었다(배차상태 파랑 · 구분 자홍 · 나머지 검정). 값마다 색이 갈리면(계약중 회색·제조사별 색) 옛 얼굴이 아니다.
   *   ⚠ 계약중 가운데줄(색이 아닌 규칙)만 남긴다 — 「잡힌 차」 표시는 뜻이라 옛 시트에 없어도 지운다고 할 일이 아니다.
   */
  /**
   * ⚠ 2026-09-15 한 번 더 — 사장님 「딱 과거 거로만, 느낌도 과거 느낌」. 옛 시트 실측: 회사 탭 조건부서식 **0개** · 머리글 메모 **0개**.
   *   ⇒ 조건부서식은 «전부» 걷는다(계약중 가운데줄 · 미입력 회색 포함). 머리글 메모(작은 삼각형)도 안 단다.
   */
  reqs = reqs.filter((r) => !r?.addConditionalFormatRule && !(r?.repeatCell && r.repeatCell.fields === 'note'));
  for (const r of reqs) {
    const tf = r?.addConditionalFormatRule?.rule?.booleanRule?.format?.textFormat;
    if (tf && tf.bold) tf.bold = false;
  }
  // ② 차번 링크 글자 — run 에 로보토가 박혀 있으면 차번만 딴 글꼴로 선다.
  for (const r of linkReqs) {
    for (const row of r?.updateCells?.rows || []) {
      for (const v of row.values || []) {
        for (const run of v.textFormatRuns || []) {
          if (run.format) Object.assign(run.format, { fontFamily: RETRO_FONT, fontSize: RETRO_SIZE, italic: true });
        }
      }
    }
  }

  const out = [...reqs];
  // ③ 탭 전체 — 글꼴·크기·기울임·굵기 없음·가운데·여백. 글자색은 안 건드린다(앞 규칙의 색을 살린다).
  out.push({ repeatCell: {
    range: { sheetId: gid },
    cell: { userEnteredFormat: {
      textFormat: { fontFamily: RETRO_FONT, fontSize: RETRO_SIZE, italic: true, bold: false },
      horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE', padding: { top: 2, right: 3, bottom: 2, left: 3 },
      wrapStrategy: 'OVERFLOW_CELL',
    } },
    fields: [
      'userEnteredFormat.textFormat.fontFamily', 'userEnteredFormat.textFormat.fontSize',
      'userEnteredFormat.textFormat.italic', 'userEnteredFormat.textFormat.bold',
      'userEnteredFormat.horizontalAlignment', 'userEnteredFormat.verticalAlignment', 'userEnteredFormat.padding',
      'userEnteredFormat.wrapStrategy',
    ].join(','),
  } });
  // 옛 회차가 달아 둔 머리글 메모를 지운다(옛 시트는 메모가 없다).
  out.push({ repeatCell: { range: { sheetId: gid, startRowIndex: H, endRowIndex: H + 1 }, cell: {}, fields: 'note' } });
  // ④ 칸별 — 이름이 옛 시트와 같은 칸만.
  columns.forEach((name, i) => {
    const col = { sheetId: gid, startColumnIndex: i, endColumnIndex: i + 1 };
    /** 요금 칸이면 옛 칸 하나에 대어 그 색을 쓴다(`retroFeeStyleOf`) — 이름이 옛 시트와 같지 않아도. */
    const 요금 = 요금칸(name);
    const 옛 = 요금 ? retroFeeStyleOf(name) : name;
    if (HEAD_BG[옛]) {
      out.push({ repeatCell: { range: { ...col, startRowIndex: H, endRowIndex: H + 1 }, cell: { userEnteredFormat: { backgroundColor: rgb(HEAD_BG[옛]), textFormat: { foregroundColor: rgb(HEAD_INK[옛] || '000000') } } }, fields: 'userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.foregroundColor' } });
      out.push({ repeatCell: { range: { ...col, startRowIndex: H + 1 }, cell: { userEnteredFormat: { backgroundColor: rgb('FFFFFF') } }, fields: 'userEnteredFormat.backgroundColor' } });
    }
    if (요금 && BODY_INK[옛] && !BODY_INK[name]) {
      out.push({ repeatCell: { range: { ...col, startRowIndex: H + 1 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: rgb(BODY_INK[옛]) } } }, fields: 'userEnteredFormat.textFormat.foregroundColor' } });
    }
    if (BODY_BG[name]) {
      out.push({ repeatCell: { range: { ...col, startRowIndex: H + 1 }, cell: { userEnteredFormat: { backgroundColor: rgb(BODY_BG[name]) } }, fields: 'userEnteredFormat.backgroundColor' } });
    }
    if (BODY_INK[name]) {
      out.push({ repeatCell: { range: { ...col, startRowIndex: H + 1 }, cell: { userEnteredFormat: { textFormat: { foregroundColor: rgb(BODY_INK[name]) } } }, fields: 'userEnteredFormat.textFormat.foregroundColor' } });
    }
    /**
     * ⓘ **열 폭은 옛 고정값을 안 쓴다** — 사장님 2026-09-15 「간격은 맞게」.
     *   옛 폭(옵션 857 · 배차상태 143)은 옛 값에 맞춘 것이라 우리 값에선 칸이 비거나 잘린다.
     *   폭은 서식기가 «이 탭 값»으로 잰 폭(`columnWidths`)을 그대로 쓴다.
     */
  });
  // ④¼ 숫자·날짜 형식(옛 시트) — 값은 발행기가 `retroCellValue` 로 숫자·날짜로 넣는다.
  columns.forEach((name, i) => {
    const nf = name === '최초등록' ? { type: 'DATE', pattern: 'yy-m-d' } : 숫자칸(name) ? { type: 'NUMBER', pattern: '#,##0' } : null;
    if (!nf) return;
    out.push({ repeatCell: { range: { sheetId: gid, startRowIndex: H + 1, startColumnIndex: i, endColumnIndex: i + 1 }, cell: { userEnteredFormat: { numberFormat: nf } }, fields: 'userEnteredFormat.numberFormat' } });
  });
  // ④½ 긴 글 칸 폭(트림·옵션) — 위 `fitWidth`
  if (p.body) {
    columns.forEach((name, i) => {
      if (!LONG_TEXT_MAX[name]) return;
      const px = fitWidth(name, p.body!.map((r) => r[i] || ''));
      out.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
    });
  }
  // ⑤ 줄 높이
  out.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'ROWS', startIndex: 0 }, properties: { pixelSize: RETRO_ROW_PX }, fields: 'pixelSize' } });
  return out;
}
