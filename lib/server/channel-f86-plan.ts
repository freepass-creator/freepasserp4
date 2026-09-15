/**
 * **하허호 F86 «발행 계획» — 발행기와 감사기가 쓰는 «한 벌»**
 *
 * ★사장님 2026-09-16 「일단 중요한 건 SSOT이고, 이걸 각각 운영에 맞춰 어떻게 뿌려줄 것인가인데,
 *   그중 하허호 시트는 제일 중요하게 관리해야 한다고」.
 *   SSOT(원자 스냅샷) 하나 → 이 계획 하나 → ① 발행기(`build-channel-supplier-sheet`)가 시트에 쓰고
 *   ② 감사기(`audit-f86-vs-atom`)가 시트를 «칸 단위»로 대조한다. 칸·줄·값·차례를 두 곳에 손으로 적지 않는다.
 *
 * 계획이 정하는 것: 실을 차(공급사명 없는 차·장기 요금 없는 차 뺌) · 회사 탭 · 「종합」 탭 · 탭 차례(굳힌 표) ·
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
import { inRetroSummary, RETRO_SHORT, RETRO_SUMMARY_TAB, retroCellValue, retroHasLongFee, retroHasValue, retroTabLayout, retroTabRank } from '../domain/channel-retro-skin';
import { companyAlias } from '../domain/identity';
import type { SalesPublishSnapshot } from './sales-publish-snapshot';

const S = (v: unknown) => String(v ?? '').trim();

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
  /** 탭 이름 「회사 MM.DD HH:MM:SS · N대」 */
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
    ? `listable ${inventory.listableDrift} · status_kind ${inventory.statusKindDrift} · 원천 식별자 ${inventory.sourceIdentityViolations} · 삭제표식 ${inventory.deletedMarkerViolations} · 차량번호 ${inventory.blankPlateViolations}/${inventory.invalidPlateViolations}/${inventory.duplicatePlateViolations}`
    : '';
  const listable = docs.filter(isOpenInventoryAtom);
  /** 차번이 아니면 싣지 않는다 — F01 과 같은 가드(오플 원본 배너 줄이 «차»로 실린 적이 있다). */
  const invalidPlates = listable.filter((v) => !isPlate(S(v.car_number))).map((v) => S(v.car_number));

  const rowsAll: F86Row[] = [];
  const kindCount: Record<string, number> = {};
  for (const v of listable) {
    const kind = tabOf(v);
    const HEAD = headOf[kind]; if (!HEAD) continue;
    const cells: Record<string, string> = {};
    for (const h of HEAD) cells[channelColumnName(h)] = cell(h, v);
    rowsAll.push({ company: companyOf(cells['공급사'] || ''), kind, atom: v, cells });
    kindCount[kind] = (kindCount[kind] || 0) + 1;
  }
  const kindSummary = TAB_ORDER.map((t) => `${t} ${kindCount[t] || 0}`).join(' · ');

  /** 공급사를 모르는 차는 채널에 안 내보낸다 · 하허호는 장기 요금이 하나도 없는 차도 안 싣는다(`RETRO_SHORT`). */
  const by = new Map<string, F86Row[]>();
  const unnamed: F86Row[] = [];
  const shortOnly: F86Row[] = [];
  for (const x of rowsAll) {
    if (!x.company) { unnamed.push(x); continue; }
    if (retro && !retroHasLongFee((c) => x.cells[c], Object.keys(x.cells))) { shortOnly.push(x); continue; }
    const l = by.get(x.company) || []; l.push(x); by.set(x.company, l);
  }

  /** 줄 차례 = 판매시트와 같은 함수 · 보조축(모델 대수)은 «판매 전체»로 센다(회사 안에서 세면 시트마다 차례가 갈린다). */
  const modelSold = p.modelSold ?? loadModelSold();
  const modelCount = new Map<string, number>();
  for (const r of rowsAll) { const m = S(r.atom.model); if (m) modelCount.set(m, (modelCount.get(m) || 0) + 1); }
  const cmp = compareSalesRows(modelSold, modelCount);
  for (const list of by.values()) list.sort((a, b) => cmp(a.atom, b.atom));
  /** 탭 차례 — 하허호는 «굳힌 표»(RETRO_TAB_ORDER), 그 밖은 상품 많은 순. */
  const order = [...by.entries()].sort((a, b) => (retro ? retroTabRank(a[0]) - retroTabRank(b[0]) : 0) || b[1].length - a[1].length);
  /** 「종합」 = 손오공·오토플러스 뺀 렌트사 규격 차 한 장(공지사항 바로 뒤). */
  const summary = retro ? order.filter(([co]) => inRetroSummary(co)).flatMap(([, l]) => l).sort((a, b) => cmp(a.atom, b.atom)) : [];
  const tabList: [string, F86Row[]][] = retro ? [[RETRO_SUMMARY_TAB, summary], ...order] : order;

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
    if (retro) {
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
    tabs.push({ company, rows: list, cols, body, values, title: `${company} ${p.mark} · ${list.length}대` });
  }

  return {
    channel, retro, mark: p.mark, columns, rowsAll, kindSummary, order, tabs,
    inventoryViolation, invalidPlates, unnamed, shortOnly, layoutViolations,
    nameByProvider: nameOf, acctCount: rowCtx.acctByProvider.size,
  };
}
