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

export const SHEET_ADAPTERS: Record<SheetAdapterId, SheetAdapter> = {
  generic: {
    id: 'generic',
    label: '일반(헤더 학습)',
    prepareTable: (table, opts) => sliceFromHeader(table, opts?.headerRow ?? 0),
  },
  // 오토플러스식 — 실시트 헤더≈9행(0-based 8)·데이터 11행~. 가격 12/3만·보증배율은 sheet-import.
  autoplus: {
    id: 'autoplus',
    label: '오토플러스식',
    prepareTable: (table, opts) => {
      // SheetSync 기본값 0 = 미설정 → 오토플러스 실시트 헤더 9행(0-based 8)
      const headerRow = (opts?.headerRow && opts.headerRow > 0) ? opts.headerRow : 8;
      const sliced = sliceFromHeader(table, headerRow);
      // 헤더 바로 다음 안내/빈 행 1장 스킵(v3 dataStartRowIdx = header+2)
      if (sliced.length >= 3) {
        const maybeGuide = sliced[1] || [];
        const guideBlank = !maybeGuide.some((c) => String(c || '').trim());
        const guideNoPlate = !/차량번호|차번/.test(String(maybeGuide[0] || ''))
          && !/^\d{2,3}[가-힣]/.test(String(maybeGuide[1] || maybeGuide[0] || ''));
        if (guideBlank || guideNoPlate) return [sliced[0], ...sliced.slice(2)];
      }
      return sliced;
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
