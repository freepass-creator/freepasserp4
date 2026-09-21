/**
 * **판매시트에서 «발행된 표»로 치는 탭들** — 상품리스트 · 손오공상품 · 픽업구독 · 오토플러스.
 * (사장님 2026-08-19 「탭 3개로 회귀」 → 2026-08-28 손오공 픽업이 붙어 **4탭**. 개수를 손으로 박지 말고 이 배열을 쓴다)
 *
 * ★세 탭은 같은 발행기(publish-origin-tab, --only 로 갈래만 다름)가 같은 열·같은 정본 차명으로 찍는다.
 *   손오공상품·오토플러스은 우리 공통 대여료 블록(단기보증·1개월·12개월·장기보증·24~60개월) 대신 **그 공급사의 기간별 대여료**를 그 자리에 둔다
 *   (사장님 2026-08-19 — 「우리 공통 기간별 대여료는 없애도 되고, 손오공이랑 오플은 그들의 기간별 대여료를 해 주면 됨 · 손오공 반납형은 보증금(연수×대여료)이랑
 *   기간별 대여료만 · 오플은 12개월 3만Km 이렇게」, publish-sonogong-tab).
 *   그래서 «판매시트에 실린 차 = 네 탭의 합»이고, 상품마스터 맞춤(⑤′)·돈 대조·ERP 대조가 표준 칸(12·24·36개월…)을 찾을 땐 아래 별칭으로 되찾는다.
 *   상품리스트 한 탭만 읽으면 오플 88·손오공 구독 43대가 «없는 차»로 보인다(2026-08-18 저녁 하루는 한 탭이었다).
 * ★탭 이름은 첫 탭만 「상품리스트 MM.DD HH:MM · N대」, 특수탭은 「이름 · N대」. 접두마다 한 장만 산다.
 */
import { isImportBrand } from './vehicle-origin';

/** 보이는 탭 막대 왼쪽부터 이 차례. 발행기가 `--at` 없이 찍어도 이 자리를 지킨다. */
export const SALES_PUBLISHED_TAB_PREFIXES = ['상품리스트', '손오공상품', '픽업구독', '오토플러스'] as const;
export type SalesPublishedPrefix = (typeof SALES_PUBLISHED_TAB_PREFIXES)[number];

/** 이전 탭명은 읽기 별칭으로만 허용하고 새 발행은 확정 명칭으로 통일한다. */
export function canonicalSalesTabName(value: string): string {
  return String(value ?? '').trim()
    .replace(/^(?:오공구독|손오공구독)(?=\s|$|[·(])/, '손오공상품')
    .replace(/^오플구독(?=\s|$|[·(])/, '오토플러스');
}

export function salesTabMatches(title: string, prefix: string): boolean {
  return canonicalSalesTabName(title).startsWith(canonicalSalesTabName(prefix));
}

/** F01 탭 제목 규격: 첫 상품리스트만 갱신시각+대수, 나머지 특수탭은 대수만 표시한다. */
export function salesPublishedTabTitle(prefix: SalesPublishedPrefix, count: number, mark: string): string {
  return prefix === '상품리스트' ? `${prefix} ${mark} · ${count}대` : `${prefix} · ${count}대`;
}

export function salesPublishedTabIndex(prefix: string): number {
  const at = (SALES_PUBLISHED_TAB_PREFIXES as readonly string[]).indexOf(canonicalSalesTabName(prefix));
  return at >= 0 ? at : 0;
}

/** 탭 이름 목록에서 접두마다 발행 탭 하나씩(숨김 제외는 호출자가). 없는 접두는 뺀다. */
export function pickPublishedSalesTabs(titles: string[]): { prefix: SalesPublishedPrefix; title: string }[] {
  const out: { prefix: SalesPublishedPrefix; title: string }[] = [];
  for (const prefix of SALES_PUBLISHED_TAB_PREFIXES) {
    const candidates = titles.filter((t) => salesTabMatches(t, prefix));
    if (candidates.length > 1) throw new Error(`판매 탭 중복: ${prefix}`);
    const title = candidates[0];
    if (title) out.push({ prefix, title });
  }
  return out;
}

/** 우리 공통 대여료 블록(상품리스트 표준 칸). 갈래 탭에서는 이 자리에 공급사 기간별 대여료가 선다. */
export const STANDARD_MONEY_COLUMNS = ['단기보증', '1개월', '12개월', '장기보증', '24개월', '36개월', '48개월', '60개월'] as const;

/** 갈래 탭에 두는 공급사 원본 요금 블록(원본 시트 머리글 그대로) — publish-sonogong-tab 기본값. */
export type NativeLeadColumn = { name: string; valueOf: (row: Record<string, string>) => string };
export const NATIVE_MONEY_BLOCK: Record<Exclude<SalesPublishedPrefix, '상품리스트'>, { src: string; srcTab: string; block: string[]; lead?: NativeLeadColumn }> = {
  손오공상품: {
    src: '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA', srcTab: '구독재고',
    // 손오공상품은 RP012 전체(렌트/구독/픽업)를 담는다. 픽업까지 함께 표현할 수 있는 기간축의 합집합을 쓴다.
    block: ['보증금 반납형', '12개월 반납형', '24개월 반납형', '36개월 반납형', '48개월 반납형', '60개월 반납형', '보증금 인수형', '12개월 인수형', '24개월 인수형', '36개월 인수형', '48개월 인수형', '60개월 인수형'],
  },
  픽업구독: {
    // T카(TCAR_EXTERNAL) — 손오공 재고시트 「픽업재고」. 인수형도 반납형과 같은 12~60 전 기간(사장님 2026-08-27 「인수형도 반납형이랑 같아」 — T카는 상세 estimates에 인수형 12·24가 있다).
    src: '1WIFn5ObK_nCVGLTjj6rO96i6vxub1QzJmiVW0BpJLcA', srcTab: '픽업재고',
    block: ['보증금 반납형', '12개월 반납형', '24개월 반납형', '36개월 반납형', '48개월 반납형', '60개월 반납형', '보증금 인수형', '12개월 인수형', '24개월 인수형', '36개월 인수형', '48개월 인수형', '60개월 인수형'],
  },
  오토플러스: {
    src: '1Tvd5IioF5y_yu3L1BQMRP4J1R8hcZHwkgl3vl-TsgY0', srcTab: '재고',
    // 오플 정제시트 장기보증은 100대 전부 빈칸(2026-08-19 실측). 사장님 「오플에는 보증금 칸이 없는데 그 보증금 칸에 대여료 산출방식을 코멘트로 달아 줘야지」
    //   → 「보증금」 칸을 앞에 두고 값은 산출 규칙 글자(국산/수입에 따라), 머리글 메모(SALES_NOTES.보증금)에 오플 공지사항 보증금표를 적는다. 숫자를 계산해 넣지 않는다.
    block: ['12개월2만', '12개월3만', '18개월2만', '18개월3만', '24개월2만', '24개월3만', '36개월2만', '36개월3만'],
    lead: { name: '보증금', valueOf: (row) => autoplusDepositRuleText(row['제조사'] || row['제조사(정제)'] || '') },
  },
};

/** 오토플러스 보증금 산출 규칙(오플 공지사항 보증금표 — 국산 ×2 · 수입 12개월 ×3 / 18개월↑ ×6). 금액을 계산하지 않고 규칙만 글자로 둔다. */
export function autoplusDepositRuleText(maker: string): string {
  return isImportBrand(String(maker ?? '')) ? '수입: 12개월 대여료×3 · 18개월↑ ×6' : '국산: 월 대여료×2';
}

/** 원본 머리글 → 영업자 표에 보이는 이름(사장님 「12개월 3만Km 이렇게」). 그 밖은 그대로. */
export const nativeMoneyLabel = (h: string): string => {
  const m = /^(\d+)개월\s*(\d)만\s*(km)?$/i.exec(String(h ?? '').trim());
  return m ? `${m[1]}개월 ${m[2]}만km` : String(h ?? '').trim();
};

const normHead = (h: unknown) => String(h ?? '').replace(/\s+/g, '').replace(/km$/i, '').replace(/[()（）]/g, '');

/**
 * 갈래 탭에서 표준 칸을 되찾는 별칭 — 상품마스터 맞춤(⑤′)·돈 대조·ERP 대조가 쓴다.
 * 손오공상품: 12~60개월 ← N개월 반납형 · 장기보증 ← 보증금 반납형(글자면 계산값 유지 규칙은 ⑤′ 그대로).
 * 오토플러스: 12개월 ← 12개월 3만km · 24개월 ← 24개월 2만km · 36개월 ← 36개월 2만km (상품리스트 @매핑 별칭과 같은 구간).
 * 단기보증·1개월은 두 갈래 다 없다(그 기간을 안 판다).
 */
export const SALES_TAB_MONEY_ALIASES: Record<SalesPublishedPrefix, Partial<Record<(typeof STANDARD_MONEY_COLUMNS)[number], string[]>>> = {
  상품리스트: {},
  손오공상품: {
    장기보증: ['보증금 반납형'],
    '12개월': ['12개월 반납형'], '24개월': ['24개월 반납형'], '36개월': ['36개월 반납형'], '48개월': ['48개월 반납형'], '60개월': ['60개월 반납형'],
  },
  픽업구독: {
    장기보증: ['보증금 반납형'],
    '12개월': ['12개월 반납형'], '24개월': ['24개월 반납형'], '36개월': ['36개월 반납형'], '48개월': ['48개월 반납형'], '60개월': ['60개월 반납형'],
  },
  오토플러스: {
    '12개월': ['12개월3만', '12개월 3만km'], '24개월': ['24개월2만', '24개월 2만km'], '36개월': ['36개월2만', '36개월 2만km'],
  },
};

/** 발행 탭 머리행에서 표준 칸의 열 번호(없으면 -1) — 이름이 그대로 있으면 그것, 없으면 별칭. */
export function standardMoneyIndex(prefix: SalesPublishedPrefix, header: string[], name: string): number {
  const direct = header.findIndex((h) => normHead(h) === normHead(name));
  if (direct >= 0) return direct;
  const aliases = (SALES_TAB_MONEY_ALIASES[prefix] as Record<string, string[] | undefined>)[name] || [];
  for (const a of aliases) { const i = header.findIndex((h) => normHead(h) === normHead(a)); if (i >= 0) return i; }
  return -1;
}

/**
 * 「AI 인계」 @매핑의 기본 열을 갈래 탭의 최종 열로 바꾼다.
 * publish-sonogong-tab 기본 동작과 감사기가 공유하는 스키마 계약이다.
 */
export function publishedSalesColumns(prefix: SalesPublishedPrefix, baseColumns: string[]): string[] {
  if (prefix === '상품리스트') return [...baseColumns];
  const native = NATIVE_MONEY_BLOCK[prefix];
  const labels = native.block.map(nativeMoneyLabel);
  const norm = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, '').replace(/km$/i, '').replace(/[()（）]/g, '');
  const nativeNames = [...native.block, ...labels, ...(native.lead ? [native.lead.name] : [])];
  // 갈래 탭(손오공상품·픽업구독·오토플러스)엔 그 공급사가 안 쓰는 빈 칸을 빼둔다 — 상품리스트에만 남긴다(사장님 2026-08-27 「6개월 어정쩡하게 붙은 거 날려줘」).
  const 갈래제외 = ['6개월'];
  const removed = (header: string) =>
    nativeNames.some((name) => norm(name) === norm(header))
    || (STANDARD_MONEY_COLUMNS as readonly string[]).some((name) => norm(name) === norm(header))
    || 갈래제외.some((name) => norm(name) === norm(header));
  const kept = baseColumns.filter((header) => !removed(header));
  const classIndex = kept.findIndex((header) => norm(header) === norm('차종구분'));
  const kmIndex = kept.findIndex((header) => /^(km|주행거리)$/i.test(norm(header)));
  const anchorIndex = classIndex >= 0 ? classIndex : kmIndex;
  const insertAt = anchorIndex >= 0 ? anchorIndex + 1 : kept.length;
  const block = [...(native.lead ? [native.lead.name] : []), ...labels];
  return [...kept.slice(0, insertAt), ...block, ...kept.slice(insertAt)];
}

/**
 * ★★**손오공 보증금은 «숫자»가 아니라 «규칙 글자»다.**
 *
 * 사장님 2026-08-28 「손오공 규칙」 = 보증금 = 월 대여료 × 약정연수, **최대 3개월**(5년도 3개월치만).
 * 사장님 2026-09-17 「손오공 보증금 ssot에 제대로 반영 안된거 같음」 · 「규칙 글자로」 —
 *   그 셈을 «원자에 숫자로 박지 않고» 이 글자로 싣는다(`deposit_note`). `price[기간].deposit` 은 0 이다.
 *
 * ★왜 글자인가 — 계산값을 박으면 원천 대여료가 바뀔 때 보증금만 따로 늙는다. 그리고 「최대 3개월」 같은
 *   캡은 금액만 봐서는 알 수 없다(48·60개월이 왜 같은 금액인지 영업자가 묻게 된다).
 * ⚠ 실측 2026-09-17 — 258대 전부 이 글자가 들어 있었는데 `deposit` 숫자도 남아 있어서 글자가 «한 번도»
 *   안 보였다(판매시트는 보증금 칸이 빈 때만 이 글자를 쓴다). 규칙이 두 번 바뀌며 절반만 반영된 자리였다.
 * ★글자는 여기 한 곳 — 인제스터·치유 도구·시트가 같은 문장을 쓴다(따로 적으면 문장이 갈린다).
 */
export const sonokongDepositRuleText = (): string => '월 대여료 × 약정연수 (최대 3개월)';
