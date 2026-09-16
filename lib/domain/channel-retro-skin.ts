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
type RetroSource = { kind: 'col'; name: string } | { kind: 'fee' } | { kind: 'atom'; field: string } | { kind: 'company' } | { kind: 'blank' };
export type RetroColumn = { head: string; src: { kind: 'col'; name: string } | { kind: 'atom'; field: string } | { kind: 'company' } | { kind: 'blank' } };
const col = (name: string): RetroSource => ({ kind: 'col', name });
const same = (...names: string[]) => names.map((n) => ({ head: n, src: col(n) }));
export const RETRO_LAYOUT: { head: string; src: RetroSource }[] = [
  /** ★맨 앞 = 공급사명(코드 아님) — 사장님 2026-09-15 「레트로시트에 맨앞에 공급사명, 코드 말고 공급사명」. 값 = 탭 이름과 같은 채널 회사명. */
  { head: '공급사명', src: { kind: 'company' } },
  /* 차량상태 — 사장님 2026-09-15 「차량상태가 배차상태야」. 같은 뜻의 칸이라 늘 비던 차량상태를 빼고 배차상태 하나만 둔다. */
  ...same('배차상태'),
  /* 입고일자 — 사장님 2026-09-15 「입고 일자는 빼도 된다」(원자에 값이 없어 늘 빈 칸이었다). */
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
 * ★★**하허호는 단기 칸을 안 싣는다** — 사장님 2026-09-15 「하허호는 단기칸 빼」 · 12개월까지(옛 시트 단기 묶음 = 단기보증·1·6·12개월).
 *   ⚠ 이름이 «정확히» 이 넷인 칸만 뺀다 — 「12개월 반납형」·「12개월 2만km」 같은 공급사 고유 요금은 단기 칸이 아니라 남긴다.
 *   ★장기 요금이 하나도 없는 차(단기 요금만 있는 차)도 F86 에 «싣는다», 장기 요금 칸만 빈 채로 둔다
 *     (사장님 2026-09-16 「안싣는다기보다도 그냥 대여료가 없이 두는거로 하자」 — 9/15 「안 싣는다」에서 정정).
 *     이 함수는 여전히 그 여부(있다/없다)만 판정한다 — 뺄지 말지는 발행기가 더는 여기로 안 정한다.
 */
export const RETRO_SHORT: readonly string[] = ['단기보증', '1개월', '6개월', '12개월'];
export function retroHasLongFee(cellOf: (column: string) => unknown, columns: readonly string[]): boolean {
  return columns.some((c) => /\d+개월/.test(c) && !RETRO_SHORT.includes(c) && isMoneyColumn(c) && (() => { const v = String(cellOf(c) ?? '').trim(); return !!v && v !== '-'; })());
}

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
/**
 * @param opt.모든기간 공통 기간 9칸을 «안 써도» 빈 칸으로 세우는가.
 *   ★사장님 2026-09-15 「자기 시트는 자기 고유 대여료만, 근데 느낌이 레트로 시트로」 — 회사 탭 = 그 회사가 «쓰는» 요금 칸만(기본).
 *   「종합」 탭만 렌트사 규격 9칸을 늘 세운다(`모든기간: true`). 색은 어느 쪽이든 레트로(공통 옛 색 · 커스텀 보라).
 */
export function retroLayout(cols: readonly string[], opt: { 모든기간?: boolean } = {}): RetroColumn[] {
  const out: RetroColumn[] = [];
  for (const e of RETRO_LAYOUT) {
    if (e.src.kind === 'fee') {
      /** ★옛 시트는 기간 9칸이 «늘» 있었다(안 쓰면 빈 칸) — 사장님 2026-09-15 확인. 옛 9칸에 없는 요금 칸(반납형·km…)은 그 뒤에 F01 차례로. */
      for (const k of RETRO_PERIODS) {
        if (RETRO_SHORT.includes(k)) continue;
        if (cols.includes(k)) out.push({ head: k, src: { kind: 'col', name: k } });
        else if (opt.모든기간) out.push({ head: k, src: { kind: 'blank' } });
      }
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
  (요금칸(name) && !RETRO_SHORT.includes(name)) || RETRO_LAYOUT.some((x) => x.src.kind === 'col' && x.src.name === name);

/**
 * ★★**「종합」 탭 = 렌트사 규격 차만 한 장에** — 사장님 2026-09-15 「종합탭은 거기에 맞춰서 해보자」
 *   (앞서 같은 날 「종합 시트에는 손오공 오플은 빼고, 종합 시트는 그냥 렌트사 규격으로만 들어가는 거지 · 손오공 오플은 그냥 있는 거고」).
 *   ⇒ 손오공·오토플러스(자기 요금 규격 = 커스텀 대여료)는 빼고, 나머지 회사 차를 같은 레트로 칸(`retroLayout`)으로 모은다.
 *   맨 앞 「공급사명」이 줄마다 회사를 말한다. 두 회사는 제 탭에 그대로 있다. 탭 자리 = 공지사항 바로 뒤.
 */
export const RETRO_SUMMARY_TAB = '종합';
export const RETRO_SUMMARY_EXCLUDE: readonly string[] = ['손오공', '오토플러스'];
export const inRetroSummary = (company: string): boolean => !!company && !RETRO_SUMMARY_EXCLUDE.includes(company);

/**
 * ★★★**«굳힌 양식» — 매 회차 같다** (사장님 2026-09-16 「하허호 시트 양식을 굳히라고 … 또 매번 달라지지 말고」).
 *   그때까지 세 가지가 «데이터 따라» 회차마다 달라졌다(실측 2026-09-16 운영 F86):
 *     ① 회사 탭 요금 칸 = 그 회차에 값이 있는 칸 → 한 대만 새 기간을 받아도 칸이 늘고 줄었다
 *     ② 칸 폭 = 그 회차 값 길이 → 같은 「세부모델」 칸이 75~180, 「옵션」이 62~857 로 탭·회차마다 달랐다
 *     ③ 탭 차례 = 대수 많은 순 → 차가 오가면 탭 자리가 바뀌었다
 *   ⇒ 셋 다 «표»로 굳힌다. 표에 없는 회사 · 표에 없는 요금 칸에 값이 오면 발행기가 «멈춘다»
 *     (칸을 몰래 늘리지도, 요금을 감추지도 않는다) — 사장님께 여쭙고 이 표에 한 줄 넣는다(PROVIDER_SALES_TAB 과 같은 방식).
 *   표 값 = 2026-09-16 운영 F86 실측 — 요금 칸은 그날 칸 그대로 · 폭은 탭들 중 가장 넓은 값.
 */
export const RETRO_TAB_ORDER: readonly string[] = [
  '종합', '손오공', '이안카', '아이카', '오토플러스', '빌린카', '아이언', '우리캐피탈', '케이에이치',
  '에스에이', '스타스카이', '제이앤제이', '웰릭스', '에코', '경진', '리더스', '마음카', '센트로', '렌트존',
];
export const retroTabRank = (tab: string): number => { const i = RETRO_TAB_ORDER.indexOf(tab); return i < 0 ? 999 : i; };
const 장기5: readonly string[] = ['장기보증', '24개월', '36개월', '48개월', '60개월'];
export const RETRO_TAB_FEES: Record<string, readonly string[]> = {
  종합: 장기5,
  손오공: ['보증금 반납형', '12개월 반납형', '24개월 반납형', '36개월 반납형', '48개월 반납형', '60개월 반납형', '보증금 인수형', '36개월 인수형', '48개월 인수형', '60개월 인수형', '12개월 인수형', '24개월 인수형'],
  이안카: 장기5,
  아이카: ['장기보증', '36개월', '48개월'],
  오토플러스: ['보증금', '12개월 2만km', '12개월 3만km', '18개월 2만km', '18개월 3만km', '24개월 2만km', '24개월 3만km', '36개월 2만km', '36개월 3만km'],
  빌린카: 장기5,
  아이언: ['장기보증', '36개월', '48개월', '60개월'],
  우리캐피탈: ['장기보증', '36개월', '48개월', '60개월'],
  케이에이치: 장기5,
  에스에이: ['장기보증', '24개월', '36개월', '48개월'],
  스타스카이: 장기5,
  제이앤제이: 장기5,
  웰릭스: ['장기보증', '24개월', '36개월', '48개월'],
  에코: ['장기보증', '24개월', '36개월', '48개월'],
  경진: ['장기보증', '24개월', '36개월', '48개월'],
  리더스: ['장기보증', '24개월', '36개월'],
  마음카: ['24개월', '36개월', '48개월'],
  센트로: ['장기보증', '48개월'],
  렌트존: ['장기보증', '48개월', '60개월'],
};
/** 탭 하나의 칸 목록 — «굳힌 표»에서만 만든다(데이터를 보지 않는다). 표에 없는 탭이면 null → 발행기가 멈춘다. */
export function retroTabLayout(tab: string): RetroColumn[] | null {
  const fees = RETRO_TAB_FEES[tab];
  if (!fees) return null;
  const out: RetroColumn[] = [];
  for (const e of RETRO_LAYOUT) {
    if (e.src.kind === 'fee') { for (const f of fees) out.push({ head: f, src: { kind: 'col', name: f } }); continue; }
    out.push(e as RetroColumn);
  }
  return out;
}
/** 칸 폭(px) — «굳힌 표». 값 길이로 재지 않는다. */
export const RETRO_WIDTH: Record<string, number> = {
  공급사명: 82, 배차상태: 75, 구분: 69, 차량번호: 75, 차종분류: 101, 세부모델: 180, 연료: 82, 외장: 62, 내장: 62, Km: 62,
  장기보증: 75, '24개월': 75, '36개월': 75, '48개월': 75, '60개월': 75, '보증금 반납형': 233, '보증금 인수형': 233, 보증금: 239,
  트림: 342, 옵션: 857, 최초등록: 95, 소비자가격: 88, 제조사: 82, 배기량: 62, 차고지: 62, 운전자범위: 88, 연주행: 69, 분납: 62,
  '21세': 82, '23세': 82, '1만+': 88, 대인: 101, 대물: 141, 자차: 154, 자손: 207, 무보험: 95, 정비: 266, 전용계좌: 292, 비고: 62,
  공급사코드: 88, 정책코드: 101, 사진: 62, 차번링크: 75,
};
export function retroWidthOf(name: string): number {
  if (RETRO_WIDTH[name]) return RETRO_WIDTH[name];
  if (/km$/i.test(name)) return 101;
  if (/반납형|인수형/.test(name)) return 108;
  return 75;
}

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
/**
 * ★★**공통 대여료 vs 커스텀 대여료를 «색 계열»로 가른다** — 사장님 2026-09-15 「대여료를 공통과 커스텀을 잘 구분해봐」.
 *   공통 = 옛 기간 9칸(`RETRO_PERIODS`) — 옛 색 그대로(단기 초록·파랑 / 장기 빨강).
 *   커스텀 = 그 공급사만 쓰는 요금 칸(손오공 반납형·인수형 · 오토플러스 2만/3만km · 보증금 규칙) — **보라 계열**.
 *   ⚠⚠ **같은 날 늦게 «되돌림»** — 사장님 「좋은데, 컬러 느낌은 동일하게 대여료 구간」. 회사 탭이 자기 요금 칸만 갖게 되자
 *   보라 구분이 필요 없어져, 커스텀 칸도 기간으로 옛 칸 색을 빌린다(`retroFeeStyleOf`). 보라를 다시 켜려면 먼저 여쭙는다.
 *   공통/커스텀 «판정»만 남겨 둔다(`isRetroCustomFee`).
 */
export const isRetroCustomFee = (name: string): boolean => 요금칸(name) && !(RETRO_PERIODS as readonly string[]).includes(name);

/** 몸 칸 글자색 — 옛 시트 칸별. 이름이 같은 칸에만 건다(없는 칸을 만들지 않는다). */
const BODY_INK: Record<string, string> = {
  /* ★2026-09-15 «회사 탭» 기준으로 고침 — F86 은 회사별 탭이라 옛 「종합」이 아니라 옛 회사 탭(손오공·아이언·스타·센트로·아이카 다수)을 따른다:
       구분 초록(#34A853) · 단기보증·1·6·12개월 청록(#46BDC6). 종합은 구분 자홍·단기보증 빨강이었다.
     ★2026-09-16 정정 — 사장님 「구조는 다르지만 상품에 대한 색상이나 텍스트 색깔 이런건 같아야 하는데」·
       「배차상태 상품구분 텍스트 색깔을 f01이랑 색깔을 맞춰서 반영해야지」.
       「구분」·「배차상태」는 여기서 뺐다 — F01 과 같은 값별 표(`GUBUN_INK`·`STATE_INK`)를 그대로 살린다
       (아래 applyRetroSkin ①). 글꼴·크기·기울임 같은 «레트로 감성»만 유지하고, 상품 갈래·배차상태 색은
       F01/F86 이 하나로 같이 간다. */
  차량상태: '0000FF', 입고일자: '1155CC', 차량번호: '1155CC',
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
  종합: '00FFFF',
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
  /**
   * ★2026-09-16 정정 — 사장님 「구조는 다르지만 상품에 대한 색상이나 텍스트 색깔 이런건 같아야 하는데」·
   *   「ㅇㅇ 글꼴이랑 이런거만 레트로 감성 유지하고」·「배차상태 상품구분 텍스트 색깔을 f01이랑 색깔을
   *   맞춰서 반영해야지」. **「구분」·「배차상태」 두 칸의 값별 색(GUBUN_INK·STATE_INK)만 예외로 살린다** —
   *   F01·F86 이 같은 상품 갈래(신차렌트·중고렌트·신차구독·중고구독·픽업구독…)·같은 배차상태
   *   (즉시출고·출고가능=파랑 · 상품화중·출고협의=주황 · 계약중·출고불가=회색)를 항상 같은 색으로 보여줘야
   *   구조(탭·칸 배치)가 달라도 «뜻»은 하나로 읽힌다. 그 밖(제조사·연료·계약중 가운데줄 등)은 여전히 다 걷는다 —
   *   레트로는 글꼴·굵기·정렬 같은 «겉»만 남기고, 색은 이 두 칸만 공용 표를 그대로 쓴다.
   */
  const 값별색유지 = new Set([columns.indexOf('구분'), columns.indexOf('배차상태')].filter((i) => i >= 0));
  reqs = reqs.filter((r) => {
    const cf = r?.addConditionalFormatRule;
    if (cf) {
      const rng = cf.rule?.ranges?.[0];
      return rng && rng.endColumnIndex === (rng.startColumnIndex ?? -999) + 1 && 값별색유지.has(rng.startColumnIndex);
    }
    return !(r?.repeatCell && r.repeatCell.fields === 'note');
  });
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
    /**
     * ⚠ 2026-09-15 늦게 되돌림 — 사장님 「좋은데, 컬러 느낌은 동일하게 대여료 구간」.
     *   회사 탭이 «자기 요금 칸만» 갖게 되자 보라 구분이 필요 없어졌다 → 커스텀 칸도 기간으로 옛 칸 색을 빌린다(`retroFeeStyleOf`).
     *   보라 계열(`customFeeHead`)은 쓰지 않는다 — 다시 켜려면 사장님께 여쭙는다.
     */
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
  // ④½ 칸 폭 — «굳힌 표»(RETRO_WIDTH) 그대로, 모든 칸. 값 길이로 재지 않는다(2026-09-16 「매번 달라지지 말고」).
  //   (옛 `fitWidth`·`LONG_TEXT_MAX` 는 이제 안 쓴다 — 그 값이 회차마다 폭을 흔들었다.)
  columns.forEach((name, i) => {
    out.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: retroWidthOf(name) }, fields: 'pixelSize' } });
  });
  // ⑤ 줄 높이
  out.push({ updateDimensionProperties: { range: { sheetId: gid, dimension: 'ROWS', startIndex: 0 }, properties: { pixelSize: RETRO_ROW_PX }, fields: 'pixelSize' } });
  return out;
}
