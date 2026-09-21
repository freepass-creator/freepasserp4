/**
 * **하허호 F86 «발행 계획» — 발행기와 감사기가 쓰는 «한 벌»**
 *
 * ★사장님 2026-09-16 「일단 중요한 건 SSOT이고, 이걸 각각 운영에 맞춰 어떻게 뿌려줄 것인가인데,
 *   그중 하허호 시트는 제일 중요하게 관리해야 한다고」.
 *   SSOT(원자 스냅샷) 하나 → 이 계획 하나 → ① 발행기(`build-channel-supplier-sheet`)가 시트에 쓰고
 *   ② 감사기(`audit-f86-vs-atom`)가 시트를 «칸 단위»로 대조한다. 칸·줄·값·차례를 두 곳에 손으로 적지 않는다.
 *
 * 계획이 정하는 것: 실을 차(공급사명 없는 차만 뺌 · 장기 요금 없는 차는 요금 칸만 빈 채로 싣는다) · 기본 상품 탭 · 회사 탭 · 탭 차례(굳힌 표) ·
 *   줄 차례(판매시트와 같은 `compareSalesRows`) · 칸(굳힌 표 `retroTabLayout`) · 칸 값(원자 → `makeCell` → 레트로 숫자·날짜).
 * 계획이 «안» 정하는 것: 서식·색·폭(`channel-retro-skin`) · 시트 문서 id · 쓰기.
 */
import { readFileSync } from 'node:fs';
import { channelCompanyOf } from '../domain/channel-company';
import { isPlate } from '../domain/plate-registry';
import { hasInventoryPublicationViolations, inventoryCountSnapshot, isOpenInventoryAtom } from '../domain/inventory-contract';
import { loadSalesRowContext, makeCell, tabOf, TAB_ORDER, compareSalesRows } from '../domain/sales-atom-row';
import { isMoneyColumn } from '../domain/sales-sheet-format';
import { channelColumnName, salesPublishedColumns } from '../domain/sales-published-tab-columns';
import { presentationTitle } from '../domain/f01-f86-presentation';
import { RETRO_SHORT, retroCellValue, retroHasLongFee, retroHasValue, retroTabLayout, retroTabRank } from '../domain/channel-retro-skin';
import { companyAlias } from '../domain/identity';
import { canonProductType } from '../domain/product';
import { PRODUCT_TYPES } from '../intake/entities';
import type { SalesPublishSnapshot } from './sales-publish-snapshot';
import { sonokongSalesGroup } from '../domain/sonokong-product-kind';

const S = (v: unknown) => String(v ?? '').trim();

/**
 * ★★**하허호 줄 차례 = 상품구분 → 모델** (사장님 2026-09-16 「상품구분 중에 신차가 위에, 그다음에 인기차 이런 식으로
 *   모델별로 — 상품구분 > 모델 로 정렬해 주시면 됩니다」).
 *   ⚠ 판매시트 F01 은 그대로다(`compareSalesRows` — 신차 먼저 → 인기 → 모델). F86 만 «상품구분으로 먼저 묶는다».
 *   ① 상품구분 = 캐논 차례(`PRODUCT_TYPES`: 신차렌트 · 중고렌트 · 신차구독 · 중고구독 · 오플구독 · 픽업구독 · 오공구독)
 *   ② 같은 상품구분 안 = 모델을 «인기순»으로 묶는다(계약 실적 → 재고 대수 → 이름)
 *   ③ 같은 모델 안 = 판매시트와 같은 규칙(신차는 값, 중고는 연식 → 값 → 공급사 → 차번)
 */
export function compareF86Rows(
  modelSold: Map<string, number>,
  modelCount: Map<string, number>,
  tail: (a: any, b: any) => number,
) {
  const canon = PRODUCT_TYPES as readonly string[];
  const typeRank = (v: any) => {
    const t = canonProductType(v.product_type) || S(v.product_type);
    const i = canon.indexOf(t);
    return i < 0 ? canon.length : i;
  };
  const sold = (v: any) => -(modelSold.get(S(v.model)) || 0);
  const pop = (v: any) => -(modelCount.get(S(v.model)) || 0);
  return (a: any, b: any): number => (
    typeRank(a) - typeRank(b)
    || sold(a) - sold(b)
    || pop(a) - pop(b)
    || S(a.model).localeCompare(S(b.model), 'ko')
    || tail(a, b)
  );
}

export type F86Row = { company: string; kind: string; atom: any; cells: Record<string, string> };
export type F86TabPlan = {
  company: string;
  rows: F86Row[];
  /** 머리글(칸 이름) */
  cols: string[];
  /** 글자 값(폭 재기·서식·차번 링크용) */
  body: string[][];
  /** 시트에 넣는 값 — 하허호는 요금·Km·배기량·소비자가격 숫자 · 최초등록 날짜(`retroCellValue`) */
  values: (string | number)[][];
  /** 탭 이름 — `f86TabTitle` (하허호 회사 탭은 시각 없이 「회사 · N대」) */
  title: string;
};
export type F86Plan = {
  channel: string;
  retro: boolean;
  mark: string;
  columns: string[];
  rowsAll: F86Row[];
  kindSummary: string;
  order: [string, F86Row[]][];
  tabs: F86TabPlan[];
  inventoryViolation: string;
  invalidPlates: string[];
  unnamed: F86Row[];
  shortOnly: F86Row[];
  /** 굳힌 양식 밖(양식어긋남) — 표에 없는 회사 · 표에 없는 요금 칸에 값이 있는 차 */
  layoutViolations: string[];
  nameByProvider: Map<string, string>;
  acctCount: number;
};

/** 하허호 F86 맨 앞 네 장은 이름·차례·역할이 고정이다. */
export const F86_BASE_TABS = ['상품리스트', '손오공상품', '픽업구독', '오플구독'] as const;
export type F86BaseTab = (typeof F86_BASE_TABS)[number];

/**
 * 손오공은 ERP/API만 입력한다. F86은 그 원자를 자동 투영한다.
 * - 손오공상품 = 저신용 렌트 + 저신용 구독(RP012 기보유)
 * - 픽업구독 = 저신용 픽업구독(T카 외부재고)
 */
export function f86BaseTabOf(v: any): F86BaseTab {
  const provider = S(v?.provider_company_code);
  if (provider === 'RP012') return sonokongSalesGroup(v) || '손오공상품';
  if (provider === 'RP023') return '오플구독';
  return '상품리스트';
}

/** F01과 F86은 같은 네 상품 자리와 같은 열 계약을 쓴다. */
const salesKindOfF86Tab = (tab: string): (typeof TAB_ORDER)[number] => tab as (typeof TAB_ORDER)[number];

/**
 * 탭 이름 — **발행기·감사기가 같은 함수를 쓴다**(두 군데서 따로 지으면 감사가 제 이름을 못 알아본다).
 *
 * ★★2026-09-21 (사장님 「기본 탭명(회사) 대수가 있는게 기본인데 맨 앞쪽탭 상품리스트 탭에는
 *   업데이트 일자 시간이 있어야함」) — **하허호는 시각을 맨 앞 「상품리스트」 하나에만** 박는다.
 *   한동안 모든 탭 이름에 발행 시각을 박아, 재발행할 때마다 19개 탭 이름이 «전부» 바뀌어 보였다.
 *   같은 회차라 맨 앞 상품리스트 하나만 봐도 시각을 안다. 하허호 밖 채널 시트는 예전대로 전 탭에 시각을 박는다.
 */
export function f86TabTitle(company: string, count: number, mark: string, retro: boolean): string {
  if (retro) return presentationTitle(company, count, mark);
  return f86TabCarriesMark(company, retro) ? `${company} ${mark} · ${count}대` : `${company} · ${count}대`;
}

/** 이 탭 이름에 발행 시각을 다는가 — 발행기(`f86TabTitle`)·신선도 감사(`f86-audit-checks`)가 같은 한 줄을 쓴다. */
export function f86TabCarriesMark(company: string, retro: boolean): boolean {
  return !retro || company === '상품리스트';
}

/** 인기순(계약 실적) — 발행기·감사기가 같은 파일을 읽는다. 없으면 인기 축 없이 정렬. */
export function loadModelSold(path = 'public/data/model-popularity.json'): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const j = JSON.parse(readFileSync(path, 'utf8')) as { 순위?: Record<string, number> };
    for (const [m, n] of Object.entries(j.순위 || {})) out.set(S(m), Number(n) || 0);
  } catch { /* 파일이 없으면 빈 표 */ }
  return out;
}

export async function buildF86Plan(p: {
  snapshot: Pick<SalesPublishSnapshot, 'products' | 'policies' | 'partners'>;
  mark: string;
  channel?: string;
  modelSold?: Map<string, number>;
}): Promise<F86Plan> {
  const channel = p.channel || '하허호';
  const retro = channel === '하허호';
  const rowCtx = await loadSalesRowContext({ policies: p.snapshot.policies, partners: p.snapshot.partners, companyAlias });
  const cell = makeCell(rowCtx);
  const nameOf = rowCtx.nameByProvider;
  const companyOf = (v: string) => channelCompanyOf(v, nameOf);

  /** 열 = 판매시트 머리글의 합집합(채널 표기로 한 벌) — 픽업구독 「반납형보증금」 ↔ 「보증금 반납형」 같은 두 벌을 막는다. */
  const columns: string[] = [];
  const headOf: Record<string, string[]> = {};
  for (const prefix of TAB_ORDER) {
    headOf[prefix] = salesPublishedColumns(prefix);
    for (const h of headOf[prefix]) { const n = channelColumnName(h); if (n && !columns.includes(n)) columns.push(n); }
  }

  const docs = p.snapshot.products as any[];
  const inventory = inventoryCountSnapshot(docs);
  const inventoryViolation = hasInventoryPublicationViolations(inventory)
    ? `listable ${inventory.listableDrift} · status_kind ${inventory.statusKindDrift} · 원천 식별자 ${inventory.sourceIdentityViolations} · 삭제표식 ${inventory.deletedMarkerViolations} · 차량번호 ${inventory.blankPlateViolations}/${inventory.invalidPlateViolations}/${inventory.duplicatePlateViolations} · 보증금규칙 ${inventory.depositRuleViolations}`
    : '';
  const listable = docs.filter(isOpenInventoryAtom);
  /** 차번이 아니면 싣지 않는다 — F01 과 같은 가드(오플 원본 배너 줄이 «차»로 실린 적이 있다). */
  const invalidPlates = listable.filter((v) => !isPlate(S(v.car_number))).map((v) => S(v.car_number));

  const rowsAll: F86Row[] = [];
  const kindCount: Record<string, number> = {};
  for (const v of listable) {
    const kind = retro ? f86BaseTabOf(v) : tabOf(v);
    const HEAD = headOf[kind]; if (!HEAD) continue;
    const cells: Record<string, string> = {};
    for (const h of HEAD) cells[channelColumnName(h)] = cell(h, v);
    rowsAll.push({ company: companyOf(cells['공급사'] || ''), kind, atom: v, cells });
    kindCount[kind] = (kindCount[kind] || 0) + 1;
  }
  const kindSummary = (retro ? F86_BASE_TABS : TAB_ORDER).map((t) => `${t} ${kindCount[t] || 0}`).join(' · ');

  /**
   * 공급사를 모르는 차는 채널에 안 내보낸다.
   * ★장기 요금이 없는 차(24개월 이후 대여료 없음)도 «싣는다» — 요금 칸만 빈 채로(사장님 2026-09-16
   *   「24개월 이후로 대여료가 없으면 그냥 거기는 대여료 없이 그냥 두자, 그래야 총 상품 숫자를 맞출 수 있다」).
   *   ⚠ 9/15~16 「안 싣는다」 규칙은 폐기 — `shortOnly` 는 몇 대가 요금 빈 채인지 «알림»에만 쓴다.
   */
  const by = new Map<string, F86Row[]>();
  const unnamed: F86Row[] = [];
  const shortOnly: F86Row[] = [];
  for (const x of rowsAll) {
    if (!x.company) { unnamed.push(x); continue; }
    if (retro && !retroHasLongFee((c) => x.cells[c], Object.keys(x.cells))) shortOnly.push(x);
    /** 기본 네 장 뒤의 공급사별 탭에는 일반 상품리스트 차량만 다시 싣는다. */
    if (!retro || x.kind === '상품리스트') {
      const l = by.get(x.company) || []; l.push(x); by.set(x.company, l);
    }
  }

  /** 줄 차례 = 판매시트와 같은 함수 · 보조축(모델 대수)은 «판매 전체»로 센다(회사 안에서 세면 시트마다 차례가 갈린다). */
  const modelSold = p.modelSold ?? loadModelSold();
  const modelCount = new Map<string, number>();
  for (const r of rowsAll) { const m = S(r.atom.model); if (m) modelCount.set(m, (modelCount.get(m) || 0) + 1); }
  /** 하허호는 «상품구분 → 모델» 차례(`compareF86Rows`), 그 밖 채널은 판매시트와 같은 차례. */
  const base = compareSalesRows(modelSold, modelCount);
  const cmp = retro ? compareF86Rows(modelSold, modelCount, base) : base;
  for (const list of by.values()) list.sort((a, b) => cmp(a.atom, b.atom));
  /** 탭 차례 — 하허호 공급사 탭은 «굳힌 표», 그 밖은 상품 많은 순. */
  const order = [...by.entries()].sort((a, b) => (retro ? retroTabRank(a[0]) - retroTabRank(b[0]) : 0) || b[1].length - a[1].length);
  const baseTabs: [string, F86Row[]][] = retro
    ? F86_BASE_TABS.map((tab) => [tab, rowsAll.filter((x) => x.kind === tab).sort((a, b) => cmp(a.atom, b.atom))])
    : [];
  const tabList: [string, F86Row[]][] = retro ? [...baseTabs, ...order] : order;

  /** 굳힌 양식 문지기(양식어긋남) — 표 밖 회사 · 표 밖 요금 칸에 «값이 있는» 차. 칸을 몰래 늘리지도 요금을 감추지도 않는다. */
  const layoutViolations: string[] = [];
  if (retro) {
    for (const [co, list] of order) {
      const lay = retroTabLayout(co);
      if (!lay) { layoutViolations.push(`표에 없는 회사 「${co}」 ${list.length}대 — RETRO_TAB_ORDER·RETRO_TAB_FEES 에 한 줄 넣어야 한다`); continue; }
      const heads = new Set(lay.map((c) => c.head));
      const 칸들 = new Set(list.flatMap((x) => Object.keys(x.cells)));
      for (const c of 칸들) {
        if (!isMoneyColumn(c) || /가격/.test(c) || RETRO_SHORT.includes(c) || heads.has(c)) continue;
        const n = list.filter((x) => retroHasValue(x.cells[c])).length;
        if (n) layoutViolations.push(`「${co}」 표에 없는 요금 칸 「${c}」에 값 ${n}대 — RETRO_TAB_FEES 에 넣어야 채널에 보인다`);
      }
    }
  }

  const tabs: F86TabPlan[] = [];
  for (const [company, list] of tabList) {
    let cols: string[];
    let body: string[][];
    const base = retro && (F86_BASE_TABS as readonly string[]).includes(company);
    if (base) {
      cols = headOf[salesKindOfF86Tab(company)];
      body = list.map((x) => cols.map((c) => S(x.cells[channelColumnName(c)])));
    } else if (retro) {
      const lay = retroTabLayout(company);
      if (!lay) continue; // 표 밖 회사 — 위 layoutViolations 가 이미 말했다(발행기가 멈춘다)
      cols = lay.map((c) => c.head);
      body = list.map((x) => lay.map((c) => (
        c.src.kind === 'col' ? S(x.cells[c.src.name])
          : c.src.kind === 'atom' ? S(x.atom?.[c.src.field])
            : c.src.kind === 'company' ? S(x.company)
              : '')));
    } else {
      /** 하허호 밖 채널 — 그 회사가 «쓰는» 요금 칸만, 판매시트 열 차례 그대로. */
      const used = (c: string) => list.some((x) => { const v = S(x.cells[c]); return !!v && v !== '-'; });
      cols = columns.filter((c) => ((isMoneyColumn(c) && !/가격/.test(c)) ? used(c) : true));
      body = list.map((x) => cols.map((c) => S(x.cells[c])));
    }
    const values = retro ? body.map((r) => r.map((v, k) => retroCellValue(cols[k], v))) : body;
    tabs.push({ company, rows: list, cols, body, values, title: f86TabTitle(company, list.length, p.mark, retro) });
  }

  return {
    channel, retro, mark: p.mark, columns, rowsAll, kindSummary, order, tabs,
    inventoryViolation, invalidPlates, unnamed, shortOnly, layoutViolations,
    nameByProvider: nameOf, acctCount: rowCtx.acctByProvider.size,
  };
}
