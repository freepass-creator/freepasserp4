/**
 * 원본 월별 장부의 검토 스냅샷.
 *
 * 새 정산원장은 앞으로의 자동 흐름을 위한 장부이고, 2026-08처럼 이미 사람이
 * 검토·표시한 월은 원본 월 탭의 상태와 예외지시가 정본이다. 이 모듈은 그 원본을
 * 읽기만 하며, 자동 청구 규칙으로 덮어쓰지 않는다.
 */
import { iso, sheetsToken, toDate } from './settlement-ledger-read';

const SOURCE_ID = '10gsCRpRZZVI9WGZK0b1JeGeti9mQFt4ojWXHqPCW-Ls';
const SOURCE_TAB = '프리패스 26/8';
const VAT = 0.1;
const S = (v: unknown) => String(v ?? '').trim();
const N = (v: unknown) => {
  const n = Number(S(v).replace(/[ ,원]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export type LegacySettlementRow = {
  sourceRow: number; status: string; note: string; supplier: string; channel: string; agent: string;
  plate: string; model: string; receivedAt: string; deliveredAt: string;
  supplierIncluded: boolean; agentIncluded: boolean;
  claim: number; claimVat: number; claimTotal: number; pay: number; payVat: number; payTotal: number;
};
export type LegacySettlementMonth = {
  month: '2026-08'; source: { spreadsheetId: string; tab: string }; candidates: number; completed: number; hold: number;
  claimRows: number; payRows: number; claim: number; claimVat: number; claimTotal: number;
  pay: number; payVat: number; payTotal: number; margin: number;
  /** 총액(부가세 포함) 차이에서 내부 배정비를 뺀 실제 프리패스 정산차액. */
  grossMargin: number; channelAdjustment: number; freepassSettlement: number; recovery: number;
  rows: LegacySettlementRow[];
};

/**
 * 8월 마감 보정값 — 원본 탭의 수기 월마감 판단을 대표가 2026-09-01 확정했다.
 * 회수 1건의 50%(844,375원)를 반영한 뒤의 공급가이며, 원본 행 산식으로 재계산하지 않는다.
 */
const AUGUST_FINAL = {
  claim: 48_739_225, claimVat: 4_873_922, claimTotal: 53_613_147,
  pay: 40_871_520, payVat: 4_087_152, payTotal: 44_958_672,
  recovery: 844_375, channelAdjustment: 3_000_000,
};

/** 수식X 수수료가 있으면 사람이 확정한 값이므로 우선한다. 부가세 포함 지시는 총액을 재가산하지 않는다. */
const money = (amount: number, gross: boolean) => {
  const raw = Math.round(amount);
  const net = gross ? Math.round(raw / (1 + VAT)) : raw;
  const vat = gross ? raw - net : Math.round(net * VAT);
  return { net, vat, total: net + vat };
};

export async function readLegacyAugust(): Promise<LegacySettlementMonth | null> {
  const token = await sheetsToken();
  if (!token) return null;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SOURCE_ID}/values/${encodeURIComponent(`'${SOURCE_TAB}'!A3:BE100`)}?valueRenderOption=UNFORMATTED_VALUE`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!res.ok) return null;
  const values = ((await res.json()) as { values?: unknown[][] }).values || [];
  const head = (values[0] || []).map(S);
  const at = (name: string) => head.indexOf(name);
  const get = (row: unknown[], name: string) => S(row[at(name)]);
  const rowMoney = (row: unknown[], manual: string, formula: string, note: string) =>
    money(N(get(row, manual)) || N(get(row, formula)), /부가세\s*포함/.test(note));

  const rows: LegacySettlementRow[] = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const status = get(row, '상태 표기');
    // 원본 8월 검토대상은 상태가 있는 줄만이며, 빈 보조 줄은 제외한다.
    if (!/계약 완료|계약진행중/.test(status)) continue;
    const note = get(row, '계약번호');
    const completed = status === '계약 완료';
    // 「공급사정산 완료」는 이미 처리 여부를 알려 주는 메모이지, 원본 월 매출 집계에서 빼라는 지시가 아니다.
    // 실제 재청구 여부는 문서 발행 직전에 그 메모를 별도로 확인한다.
    const supplierIncluded = completed && !/영업사만|공급사미청구|업무지원비/.test(note);
    const agentIncluded = completed && !/공급사만 정산/.test(note);
    const claim = supplierIncluded ? rowMoney(row, '판매 수수료\n(수식X)', '판매 수수료', note) : money(0, false);
    const pay = agentIncluded ? rowMoney(row, '출고 수수료\n(수식X)', '출고수수료', note) : money(0, false);
    rows.push({
      sourceRow: i + 3, status, note, supplier: get(row, '업체명'), channel: get(row, '에이전시'), agent: get(row, '영업자'),
      plate: get(row, '차량번호'), model: get(row, '모델명'), receivedAt: iso(toDate(row[at('접수일')])), deliveredAt: iso(toDate(row[at('인도일')])),
      supplierIncluded, agentIncluded,
      claim: claim.net, claimVat: claim.vat, claimTotal: claim.total,
      pay: pay.net, payVat: pay.vat, payTotal: pay.total,
    });
  }
  const sum = (key: keyof LegacySettlementRow) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
  const completed = rows.filter((row) => row.status === '계약 완료').length;
  const margin = AUGUST_FINAL.claim - AUGUST_FINAL.pay;
  const grossMargin = AUGUST_FINAL.claimTotal - AUGUST_FINAL.payTotal;
  return {
    month: '2026-08', source: { spreadsheetId: SOURCE_ID, tab: SOURCE_TAB }, candidates: rows.length, completed,
    hold: rows.length - completed, claimRows: rows.filter((row) => row.supplierIncluded).length,
    payRows: rows.filter((row) => row.agentIncluded).length,
    claim: AUGUST_FINAL.claim, claimVat: AUGUST_FINAL.claimVat, claimTotal: AUGUST_FINAL.claimTotal,
    pay: AUGUST_FINAL.pay, payVat: AUGUST_FINAL.payVat, payTotal: AUGUST_FINAL.payTotal,
    margin, grossMargin, channelAdjustment: AUGUST_FINAL.channelAdjustment,
    freepassSettlement: grossMargin - AUGUST_FINAL.channelAdjustment, recovery: AUGUST_FINAL.recovery, rows,
  };
}
