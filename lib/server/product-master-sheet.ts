import 'server-only';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EntityRecord } from '@/lib/intake/entities';
import {
  DEFAULT_PRODUCT_MASTER_SHEET_ID,
  PRODUCT_MASTER_GID,
  PRODUCT_MASTER_MANUAL_TAB,
  PRODUCT_MASTER_TAB,
} from '@/lib/domain/product-master-sheet';
import { applyProductMasterManualGate, importProductMasterSheet } from '@/lib/domain/product-master-import';
import type { PartnerSheetsFetch } from '@/lib/domain/sheet-sync-all';
import type { VehicleTrimMasterArtifact } from '@/lib/domain/vehicle-trim-master';
import { VEHICLE_MASTER_REVIEW_ADOPTION_TAB } from '@/lib/domain/vehicle-master-review-promotion';
import { adoptedSpecByKey } from '@/lib/domain/product-vehicle-normalization';
import { loadProductVehicleReviewDecisions } from '@/lib/domain/product-vehicle-review-decisions';
import { fetchGoogleSheetTabs, fetchVisibleGoogleSheetTable } from '@/lib/server/google-sheet-visible';
import type { TrimKeyRegistry } from '@/lib/domain/vehicle-trim-key-contract';

const S = (value: unknown) => String(value ?? '').trim();

function preferMasterNamesFromRegistry(): boolean {
  try {
    const registry = JSON.parse(readFileSync(
      join(process.cwd(), 'data/vehicle-trim-key-registry.json'),
      'utf8',
    )) as TrimKeyRegistry;
    return Number(registry.schemaVersion) >= 3;
  } catch {
    return false;
  }
}

function trimMasterArtifact(): VehicleTrimMasterArtifact {
  const raw = JSON.parse(readFileSync(
    join(process.cwd(), 'public/data/vehicle-trim-master.json'),
    'utf8',
  )) as VehicleTrimMasterArtifact;
  if (!raw.records?.length) throw new Error('행 단위 차종마스터 없음');
  return raw;
}

/**
 * ERP의 유일한 판매상품 입력 스냅샷.
 *
 * 필터와 수동 숨김은 관리자의 조회 상태일 뿐이므로 데이터에서 제외하지 않는다. 행 자체를
 * 중지하려면 상품마스터의 관리상태/차량상태를 명시적으로 바꿔야 한다.
 */
export async function fetchProductMasterSheet(input: {
  partners: EntityRecord[];
  providerCodes?: string[];
  knownProviderCodes?: string[];
}): Promise<PartnerSheetsFetch> {
  const spreadsheetId = S(process.env.PRODUCT_MASTER_SHEET_ID) || DEFAULT_PRODUCT_MASTER_SHEET_ID;
  const tabName = S(process.env.PRODUCT_MASTER_TAB) || PRODUCT_MASTER_TAB;
  // ★기본은 gid 고정(2026-08-19 탭 이름 뒤바뀜 사고 2회) — 이름은 사람이 바꿔도 코드 규격 표는 gid 가 같다. env 로 다른 gid/이름을 줄 수 있다.
  const pinnedGid = S(process.env.PRODUCT_MASTER_SHEET_GID) || (S(process.env.PRODUCT_MASTER_TAB) ? '' : PRODUCT_MASTER_GID);
  const tabs = await fetchGoogleSheetTabs(spreadsheetId);
  const tab = (pinnedGid ? tabs.find((item) => item.gid === pinnedGid) : undefined) || tabs.find((item) => item.title === tabName);
  if (!tab) throw new Error(pinnedGid
    ? `상품마스터 탭 없음(gid ${pinnedGid})`
    : `상품마스터 탭 없음(${tabName})`);
  if (tab.hidden) throw new Error(`숨김 상품마스터 탭은 연동할 수 없습니다(${tab.title})`);
  const manualTab = tabs.find((item) => item.title === PRODUCT_MASTER_MANUAL_TAB);
  if (!manualTab) throw new Error(`공급사 데이터 매뉴얼 탭 없음(${PRODUCT_MASTER_MANUAL_TAB})`);
  if (manualTab.hidden) throw new Error(`숨김 공급사 데이터 매뉴얼 탭은 연동할 수 없습니다(${manualTab.title})`);
  const sheet = await fetchVisibleGoogleSheetTable(spreadsheetId, tab.gid, {
    includeHiddenByFilter: true,
    includeHiddenByUser: true,
  });
  const manualSheet = await fetchVisibleGoogleSheetTable(spreadsheetId, manualTab.gid, {
    includeHiddenByFilter: true,
    includeHiddenByUser: true,
  });
  let adopted;
  const adoptionTab = tabs.find((item) => item.title === VEHICLE_MASTER_REVIEW_ADOPTION_TAB);
  if (adoptionTab && !adoptionTab.hidden) {
    const adoptionSheet = await fetchVisibleGoogleSheetTable(spreadsheetId, adoptionTab.gid, {
      includeHiddenByFilter: true,
      includeHiddenByUser: true,
    });
    adopted = adoptedSpecByKey(adoptionSheet.rows);
  }
  let decisions;
  try {
    decisions = loadProductVehicleReviewDecisions().decisions;
  } catch {
    decisions = undefined;
  }
  const artifact = trimMasterArtifact();
  const fetched = applyProductMasterManualGate(importProductMasterSheet({
    table: sheet.rows,
    partners: input.partners,
    trimRecords: artifact.records,
    tabTitle: tab.title,
    tabGid: tab.gid,
    providerCodes: input.providerCodes,
    knownProviderCodes: input.knownProviderCodes,
    adopted,
    decisions,
    preferMasterNames: preferMasterNamesFromRegistry(),
  }), manualSheet.rows);
  return {
    ...fetched,
    lines: fetched.lines.map((line) => ({
      ...line,
      message: `${line.message} · 차종마스터 ${artifact.data_as_of}`,
    })),
  };
}
