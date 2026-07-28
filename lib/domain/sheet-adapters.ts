/**
 * 공급사별 시트 어댑터 레지스트리.
 * 기본 = generic(헤더 학습). 병적 양식만 코드 어댑터 추가.
 * v3 공용 source(autoplus|general) enum 금지 — partner.adapter_id 로 지정.
 */
import { type EntityRecord } from '@/lib/intake/entities';

export type SheetAdapterId = 'generic' | 'autoplus';

export type SheetAdapter = {
  id: SheetAdapterId;
  label: string;
  /** 원본 표 → import용 표(헤더행 선택·상단 스킵). */
  prepareTable: (table: string[][], opts?: { headerRow?: number }) => string[][];
};

/** headerRow = 0-based. 그 위 행은 버림. */
function sliceFromHeader(table: string[][], headerRow = 0): string[][] {
  const i = Math.max(0, Math.min(headerRow, Math.max(0, table.length - 1)));
  return table.slice(i);
}

function findPlateHeaderRow(table: string[][]): number {
  for (let i = 0; i < Math.min(25, table.length); i++) {
    if ((table[i] || []).some((c) => /차량번호|차번/.test(String(c)))) return i;
  }
  return 0;
}

/** 무라벨 데이터 col11~14 → 개월 헤더 */
export const AUTOPLUS_PRICE_HEADERS = ['12개월', '24개월', '36개월', '48개월'] as const;

/**
 * 오토플러스 헤더 행 라벨 고정.
 * col6=최초등록 · col7=주행거리 · col11~14=12/24/36/48개월.
 */
export function labelAutoplusHeaderRow(header: string[]): string[] {
  const h = header.map((c) => String(c ?? ''));
  while (h.length < 15) h.push('');
  h[6] = '최초등록';
  h[7] = '주행거리';
  for (let i = 0; i < AUTOPLUS_PRICE_HEADERS.length; i++) {
    h[11 + i] = AUTOPLUS_PRICE_HEADERS[i];
  }
  return h;
}

export const SHEET_ADAPTERS: Record<SheetAdapterId, SheetAdapter> = {
  generic: {
    id: 'generic',
    label: '일반(헤더 학습)',
    prepareTable: (table, opts) => sliceFromHeader(table, opts?.headerRow ?? 0),
  },
  /**
   * 오토플러스식 — 판매차량리스트: 헤더 자동탐지(또는 headerRow>0).
   * 무라벨 col6/7/11~14 → 최초등록·주행·12/24/36/48개월.
   * 헤더 다음 안내/배너 1행 스킵.
   */
  autoplus: {
    id: 'autoplus',
    label: '오토플러스식',
    prepareTable: (table, opts) => {
      const headerRow = (opts?.headerRow && opts.headerRow > 0)
        ? opts.headerRow
        : findPlateHeaderRow(table);
      const sliced = sliceFromHeader(table, headerRow);
      if (!sliced.length) return sliced;
      let body = sliced.slice(1);
      if (body.length >= 1) {
        const maybeGuide = body[0] || [];
        const guideBlank = !maybeGuide.some((c) => String(c || '').trim());
        const plateCell = String(maybeGuide[1] || maybeGuide[0] || '').replace(/\s/g, '');
        const guideNoPlate = !/차량번호|차번/.test(String(maybeGuide[0] || ''))
          && !/^\d{2,3}[가-힣]/.test(plateCell);
        if (guideBlank || guideNoPlate) body = body.slice(1);
      }
      return [labelAutoplusHeaderRow(sliced[0] || []), ...body];
    },
  },
};

export const ADAPTER_OPTIONS: { value: SheetAdapterId; label: string }[] = (
  Object.values(SHEET_ADAPTERS).map((a) => ({ value: a.id, label: a.label }))
);

export function resolveAdapter(partnerOrId?: EntityRecord | string | null): SheetAdapter {
  const id = (typeof partnerOrId === 'string'
    ? partnerOrId
    : String(partnerOrId?.adapter_id || 'generic')) as SheetAdapterId;
  return SHEET_ADAPTERS[id] || SHEET_ADAPTERS.generic;
}

/** partner 레코드에서 시트 연동 옵션 추출. */
export function partnerSheetOpts(p: EntityRecord): {
  url: string;
  gid: string;
  headerRow: number;
  adapter: SheetAdapter;
  providerCode: string;
  profileRaw: unknown;
} {
  const url = String(p.sheet_url || '').trim();
  const gid = String(p.sheet_gid || p.sheet_tab || '').trim().replace(/\D/g, '') || '';
  const headerRow = Math.max(0, Number(p.header_row) || 0);
  return {
    url,
    gid,
    headerRow,
    adapter: resolveAdapter(p),
    providerCode: String(p.partner_code || p._key || ''),
    profileRaw: p.mapping_profile,
  };
}
