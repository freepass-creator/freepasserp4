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

/**
 * 그 행이 진짜 헤더인가.
 *
 * ⚠ "차량번호를 **포함**하는 행"으로 보면 안 된다 — 오토플러스 시트는 진짜 헤더(7행) 위에
 *   `★★★ 차량번호 클릭 후 차량이미지 다운로드 가능합니다. ★★★` 배너(5행)가 있어서
 *   그 배너가 헤더로 잡히고 본탭 94대가 통째로 유실됐다.
 * 판정: 칸 하나가 **차량번호/차번 그 자체**여야 하고, 그 행에 라벨이 3칸 이상 있어야 한다
 *   (배너는 보통 한 칸짜리 문장이다). 두 조건을 같이 걸어 '차량 번호'(공백)·'차번호' 변형도 살린다.
 */
function looksLikeHeader(row: string[] | undefined): boolean {
  const cells = (row || []).map((c) => String(c ?? '').trim());
  const labeled = cells.filter(Boolean).length;
  if (labeled < 3) return false;
  return cells.some((c) => /^(차량번호|차번|차번호|등록번호)$/.test(c.replace(/\s/g, '')));
}

function findPlateHeaderRow(table: string[][]): number {
  for (let i = 0; i < Math.min(25, table.length); i++) {
    if (looksLikeHeader(table[i])) return i;
  }
  return 0;
}

/**
 * 지정 헤더행을 쓰되, 거기에 차량번호가 없으면 **찾아서 쓴다.**
 *
 * 실측(2026-07-31): 손오공·웰릭스 시트는 1행이 안내배너("구독 보증금 : 개월수 X 대여료"),
 * 2행이 빈 줄, **3행이 진짜 헤더**다. header_row 가 0이라 1행을 헤더로 읽어 매핑이 전멸했고
 * 손오공 37대·웰릭스 20대가 통째로 0대가 됐다. erp3 는 '차량번호'가 있는 행을 찾아 쓴다
 * (external-sheet.js syncFromSheet). 공급사가 상단에 안내문을 한 줄 더 넣어도 안 깨져야 한다.
 */
function resolveHeaderRow(table: string[][], headerRow?: number): number {
  const want = Math.max(0, headerRow ?? 0);
  if (looksLikeHeader(table[want])) return want;
  return findPlateHeaderRow(table);
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
    prepareTable: (table, opts) => sliceFromHeader(table, resolveHeaderRow(table, opts?.headerRow)),
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
      const headerRow = resolveHeaderRow(table, opts?.headerRow);
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

/**
 * partner 레코드에서 시트 연동 옵션 추출.
 *
 * `sheet_tab` 은 **탭을 여러 개 적을 수 있다**(`0,1718488412,1505082236`).
 * 재고를 탭으로 쪼개 두는 공급사가 실제로 있다 — 빌린카는 3탭에 45대가 나뉘어 있는데
 * 한 탭만 읽으면 21대만 올라가고 나머지 24대는 "시트에 없음" → 출고불가로 내려간다.
 */
export function partnerSheetOpts(p: EntityRecord): {
  url: string;
  gid: string;
  gids: string[];
  headerRow: number;
  adapter: SheetAdapter;
  providerCode: string;
  profileRaw: unknown;
} {
  const url = String(p.sheet_url || '').trim();
  const raw = String(p.sheet_gid || p.sheet_tab || '').trim();
  const gids = raw.split(/[,\s|]+/).map((s) => s.replace(/\D/g, '')).filter((s) => s !== '');
  const gid = gids[0] || '';
  const headerRow = Math.max(0, Number(p.header_row) || 0);
  return {
    url,
    gid,
    gids,
    headerRow,
    adapter: resolveAdapter(p),
    providerCode: String(p.partner_code || p._key || ''),
    profileRaw: p.mapping_profile,
  };
}
