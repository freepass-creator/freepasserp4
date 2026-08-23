import 'server-only';

import type { EntityRecord } from '@/lib/intake/entities';
import {
  DEFAULT_SALES_INVENTORY_SHEET_ID,
  DEFAULT_SALES_INVENTORY_TAB_PREFIX,
  SALES_AUTOPLUS_MAIN_TAB_PREFIX,
  SALES_SONOGONG_TAB_PREFIX,
  importSalesInventoryWorkbook,
} from '@/lib/domain/sales-inventory-sheet';
import type { PartnerSheetsFetch } from '@/lib/domain/sheet-sync-all';
import { visibleRowsFromGridResponse } from '@/lib/domain/sheet-visible-grid';
import { fetchGoogleSheetTabs, fetchVisibleGoogleSheetGrid } from '@/lib/server/google-sheet-visible';

const S = (value: unknown) => String(value ?? '').trim();

export async function fetchSalesInventorySheet(input: {
  partners: EntityRecord[];
  providerCodes?: string[];
}): Promise<PartnerSheetsFetch> {
  const spreadsheetId = S(process.env.SALES_INVENTORY_SHEET_ID || process.env.INVENTORY_EXPORT_SHEET_ID)
    || DEFAULT_SALES_INVENTORY_SHEET_ID;
  const prefix = S(process.env.SALES_INVENTORY_TAB_PREFIX) || DEFAULT_SALES_INVENTORY_TAB_PREFIX;
  const pinnedGid = S(process.env.SALES_INVENTORY_SHEET_GID);
  const tabs = await fetchGoogleSheetTabs(spreadsheetId);
  const mainCandidates = tabs.filter((tab) => !tab.hidden && tab.title.startsWith(prefix)
    && !tab.title.startsWith(`${prefix}(구버전)`));
  if (!pinnedGid && mainCandidates.length !== 1) {
    throw new Error(`영업자 상품리스트 현재 탭 후보 ${mainCandidates.length}개(${prefix}*) — 정본 탭을 하나로 확정하세요`);
  }
  const main = pinnedGid
    ? tabs.find((tab) => tab.gid === pinnedGid)
    : mainCandidates[0];
  if (!main) throw new Error(pinnedGid
    ? `영업자 상품리스트 탭 없음(gid ${pinnedGid})`
    : `영업자 상품리스트 탭 없음(${prefix}*)`);
  if (main.hidden) throw new Error(`숨김 영업자 상품리스트는 연동할 수 없습니다(${main.title})`);
  // ★판매시트 기본 세팅은 탭 3개다(상품리스트·손오공구독·오플구독).
  //   폐기된 「오플프로모션」 탭을 이름 검색으로 다시 포함하면 12개월 2만km 같은 옛 가격이
  //   살아나므로, 오플구독 한 탭만 정본으로 읽는다.
  const required = [
    { key: 'sonogong', prefix: SALES_SONOGONG_TAB_PREFIX },
    { key: 'autoplusMain', prefix: SALES_AUTOPLUS_MAIN_TAB_PREFIX },
  ] as const;
  const selected = new Map(required.map((item) => {
    const candidates = tabs.filter((tab) => !tab.hidden && tab.title.startsWith(item.prefix));
    if (candidates.length !== 1) {
      throw new Error(`영업자 상품리스트 현재 탭 후보 ${candidates.length}개(${item.prefix}*) — 정본 탭을 하나로 확정하세요`);
    }
    return [item.key, candidates[0]] as const;
  }));
  const missingTabs = required.filter((item) => !selected.get(item.key)).map((item) => item.prefix);
  if (missingTabs.length) throw new Error(`영업자 상품리스트 필수 탭 없음(${missingTabs.join(', ')})`);

  const sonogong = selected.get('sonogong')!;
  const autoplusMain = selected.get('autoplusMain')!;
  // 세 탭을 같은 Grid 스냅샷으로 읽어 갱신 도중 서로 다른 시점의 재고가 섞이지 않게 한다.
  const grid = await fetchVisibleGoogleSheetGrid(
    spreadsheetId,
    [main.gid, sonogong.gid, autoplusMain.gid],
  );
  const canonicalOptions = {
    // 상품리스트·손오공구독의 필터/행 숨김은 영업자의 조회 상태일 뿐 삭제 지시가 아니다.
    includeHiddenByFilter: true,
    includeHiddenByUser: true,
  };
  const mainSheet = visibleRowsFromGridResponse(grid, main.gid, canonicalOptions);
  const sonogongSheet = visibleRowsFromGridResponse(grid, sonogong.gid, canonicalOptions);
  // 오플 원본 복사 탭은 공급사가 숨긴 차량을 판매대상에서 제외한다.
  const autoplusMainSheet = visibleRowsFromGridResponse(grid, autoplusMain.gid);
  return importSalesInventoryWorkbook({
    main: { ...mainSheet, gid: main.gid },
    sonogong: { ...sonogongSheet, gid: sonogong.gid },
    autoplusMain: { ...autoplusMainSheet, gid: autoplusMain.gid },
    partners: input.partners,
    providerCodes: input.providerCodes,
  });
}
