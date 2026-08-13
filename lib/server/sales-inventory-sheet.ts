import 'server-only';

import type { EntityRecord } from '@/lib/intake/entities';
import type { MasterEntry } from '@/lib/domain/vehicle-master-types';
import {
  DEFAULT_SALES_INVENTORY_SHEET_ID,
  DEFAULT_SALES_INVENTORY_TAB_PREFIX,
  importSalesInventorySheet,
} from '@/lib/domain/sales-inventory-sheet';
import type { PartnerSheetsFetch } from '@/lib/domain/sheet-sync-all';
import { fetchGoogleSheetTabs, fetchVisibleGoogleSheetTable } from '@/lib/server/google-sheet-visible';

const S = (value: unknown) => String(value ?? '').trim();

export async function fetchSalesInventorySheet(input: {
  partners: EntityRecord[];
  entries: MasterEntry[];
  providerCodes?: string[];
}): Promise<PartnerSheetsFetch> {
  const spreadsheetId = S(process.env.SALES_INVENTORY_SHEET_ID || process.env.INVENTORY_EXPORT_SHEET_ID)
    || DEFAULT_SALES_INVENTORY_SHEET_ID;
  const prefix = S(process.env.SALES_INVENTORY_TAB_PREFIX) || DEFAULT_SALES_INVENTORY_TAB_PREFIX;
  const pinnedGid = S(process.env.SALES_INVENTORY_SHEET_GID);
  const tabs = await fetchGoogleSheetTabs(spreadsheetId);
  const target = pinnedGid
    ? tabs.find((tab) => tab.gid === pinnedGid)
    : tabs.find((tab) => !tab.hidden && tab.title.startsWith(prefix)
      && !tab.title.startsWith(`${prefix}(구버전)`));
  if (!target) throw new Error(pinnedGid
    ? `영업자 상품리스트 탭 없음(gid ${pinnedGid})`
    : `영업자 상품리스트 탭 없음(${prefix}*)`);
  if (target.hidden) throw new Error(`숨김 영업자 상품리스트는 연동할 수 없습니다(${target.title})`);
  const sheet = await fetchVisibleGoogleSheetTable(spreadsheetId, target.gid, {
    // 필터·행 숨김은 영업자가 보는 방법일 뿐 재고 삭제 지시가 아니다.
    includeHiddenByFilter: true,
    includeHiddenByUser: true,
  });
  return importSalesInventorySheet({
    table: sheet.rows,
    partners: input.partners,
    entries: input.entries,
    tabTitle: target.title,
    tabGid: target.gid,
    providerCodes: input.providerCodes,
  });
}
