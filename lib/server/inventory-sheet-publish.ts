/**
 * 재고 → 영업자용 구글시트 **반영 SSOT**.
 *
 * 관리자 버튼(`/api/inventory/sheet-export`)과 일일 동기화(`sheet-daily-sync`)가
 * **이 함수 하나**를 쓴다. 두 경로가 각자 올리면 언젠가 서로 다른 표가 나가고,
 * 그때 영업자는 어느 쪽이 «지금»인지 알 수 없다.
 *
 * 표 정의(열·서식)는 한 층 더 아래 `lib/domain/inventory-sheet-export.ts` 가 정본이다.
 * 여기는 «무엇을 읽어 어디에 쓰는가»만 정한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'firebase-admin/database';
import { SheetsClient } from '@/lib/server/google-sheets-writer';
import {
  attachPolicy, buildInventorySheet, dedupeForSales, exportTabName, policyMap, resnapForSales, sortForSales,
} from '@/lib/domain/inventory-sheet-export';
import { isListableProduct } from '@/lib/domain/product';
// 구버전 41열 종합표 — 직원이 손으로 붙여넣던 v3 규격. 새 표 옆 탭으로 같이 올린다.
import { buildJonghapValues } from '@/lib/domain/jonghap';
import { jonghapFormatRequests } from '@/lib/domain/jonghap-format';
import { companyAlias } from '@/lib/domain/identity';
import type { MasterEntry } from '@/lib/domain/vehicle-master-types';
import type { EntityRecord } from '@/lib/intake/entities';

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();
const dead = (p: Rec) => p._deleted === true || !!p.deletedAt || S(p.status) === 'deleted';

/** 영업자가 늘 보는 고정 탭. 이름을 바꾸면 영업자 즐겨찾기가 끊긴다. */
export const AGENT_SHEET_TAB = '상품리스트';

/**
 * 탭 이름이 «언제 것인지·몇 대인지»를 말해야 한다.
 * 탭을 열지 않고도 최신인지 알 수 있고, 영업자가 어제 것을 붙들고 팔지 않는다.
 * 앞말은 늘 `상품리스트` 라서 이름이 바뀌어도 같은 탭을 다시 찾는다.
 */
export function agentTabName(count: number): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
  return `${AGENT_SHEET_TAB} ${kst.slice(5, 10).replace('-', '.')} ${kst.slice(11, 16)} · ${count}대`;
}

/**
 * 구버전 종합표가 서는 탭.
 *
 * 41열 v3 규격(`lib/domain/jonghap.ts`)이다. 직원이 손으로 붙여넣던 그 표인데,
 * 오래 보던 사람은 이 배치로 읽는 게 빠르다. 새 표와 **나란히** 둔다 —
 * 갈아치우면 익숙한 눈이 갈 곳을 잃고, 남겨 두면 각자 편한 탭을 본다.
 *
 * ⚠ 열 순서는 시트 헤더와 1:1이다. 임의로 바꾸면 옛 수식·필터가 통째로 어긋난다.
 */
export const JONGHAP_SHEET_TAB = '종합표';

export function jonghapTabName(count: number): string {
  const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
  return `${JONGHAP_SHEET_TAB} ${kst.slice(5, 10).replace('-', '.')} ${kst.slice(11, 16)} · ${count}대`;
}

export type PublishResult = {
  count: number; tab: string; gid: number; url: string;
  /** 구버전 종합표 탭 — 못 올렸으면 사유. */
  jonghap?: string;
};

export async function publishInventorySheet(
  db: Database,
  opts: { origin?: string; snapshot?: boolean } = {},
): Promise<PublishResult> {
  const spreadsheetId = S(process.env.INVENTORY_EXPORT_SHEET_ID);
  if (!spreadsheetId) throw new Error('내보낼 구글시트가 설정되지 않았습니다(INVENTORY_EXPORT_SHEET_ID).');

  // 정책(연령·보험·심사)은 별도 노드다 — 같이 읽어 조인하지 않으면 그 열이 통째로 빈다.
  const [productsSnap, v3Partners, v4Partners, v3Policies, v4Policies] = await Promise.all([
    db.ref('v4/products').get(),
    db.ref('partners').get(),
    db.ref('v4/partners').get(),
    db.ref('policies').get(),
    db.ref('v4/policies').get(),
  ]);
  const policies = policyMap(v3Policies.val() || {}, v4Policies.val() || {});

  const partners: Record<string, Rec> = {};
  for (const raw of [v3Partners.val() || {}, v4Partners.val() || {}] as Record<string, Rec>[]) {
    for (const [key, row] of Object.entries(raw)) {
      if (row && typeof row === 'object') partners[key] = { ...(partners[key] || {}), ...row, _key: key };
    }
  }
  // ★대상이 공급사 원본 시트면 중단한다 — 덮어쓰면 재고 정본이 사라진다.
  const idOf = (url: string) => (url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || [])[1] || '';
  for (const partner of Object.values(partners)) {
    if (S(partner.sheet_url) && idOf(S(partner.sheet_url)) === spreadsheetId) {
      throw new Error('중단 — 내보내기 대상이 공급사 원본 시트입니다. 설정을 확인하세요.');
    }
  }
  // 코드가 비면 «아무 공급사나» 걸리므로 먼저 끊는다.
  const nameOf = (code: string) => {
    if (!code) return '';
    const hit = Object.values(partners).find((p) => S(p.partner_code) === code || S(p._key) === code);
    // 「주식회사」·「(주)」는 법인격이지 회사 이름이 아니다 — 표기는 companyAlias 하나로 통일한다.
    return companyAlias(S(hit?.partner_name || hit?.company_name), hit?.alias);
  };

  const products = Object.entries((productsSnap.val() || {}) as Record<string, Rec>)
    .filter(([, p]) => p && typeof p === 'object' && !dead(p))
    .map(([key, p]) => ({ ...p, _key: key, product_code: p.product_code || key } as EntityRecord))
    .filter((p) => isListableProduct(p));

  const masterRaw = JSON.parse(readFileSync(join(process.cwd(), 'public/data/vehicle-master.json'), 'utf8')) as {
    entries?: MasterEntry[];
  } | MasterEntry[];
  const master = (Array.isArray(masterRaw) ? masterRaw : masterRaw.entries) || [];
  if (!master.length) throw new Error('차종마스터가 비어 있어 영업자 시트 반영을 중단합니다.');

  const rows = sortForSales(resnapForSales(dedupeForSales(products), master))
    .map((p) => attachPolicy(p, policies));

  const client = await SheetsClient.open(spreadsheetId);
  /**
   * 영업자가 보는 것은 **한 장**이어야 한다.
   * 고정 탭 하나를 늘 최신으로 덮어쓴다 — 탭이 쌓이면 어느 것이 «지금»인지 매번 골라야 한다.
   * 이력이 필요할 때만 `snapshot` 으로 날짜 탭을 따로 만든다.
   */
  const meta = await client.meta();
  const { gid, title } = opts.snapshot
    ? await client.addLeftmostTab(exportTabName(rows.length), meta.sheets.map((s) => s.properties.title))
    : await client.openOrCreateTab(agentTabName(rows.length), AGENT_SHEET_TAB);

  const built = buildInventorySheet(
    gid, rows, nameOf, { bandedRangeIds: [], conditionalCount: 0, merges: 0 }, S(opts.origin),
  );
  await client.write(title, built.values);
  await client.batchUpdate(built.requests);

  /**
   * ★구버전 종합표를 **같은 시트의 다른 탭**에 같이 올린다(2026-08-10 사장님 지시).
   *
   * 오래 보던 사람은 41열 배치로 읽는 게 빠르다. 새 표로 갈아치우면 익숙한 눈이 갈 곳을 잃는다.
   * 두 탭을 나란히 두고 각자 편한 쪽을 보게 한다.
   *
   * ⚠ 실패해도 본 표는 이미 올라갔으므로 통째로 되돌리지 않는다 — 사유만 남긴다.
   */
  let jonghap: string | undefined;
  try {
    const { values, count } = buildJonghapValues(rows, Object.values(policies), { origin: S(opts.origin) });
    const jt = await client.openOrCreateTab(jonghapTabName(count), JONGHAP_SHEET_TAB);
    await client.write(jt.title, values);
    await client.batchUpdate(jonghapFormatRequests(jt.gid, count));
    jonghap = jt.title;
  } catch (error) {
    jonghap = `실패 — ${String((error as Error)?.message || error)}`;
  }

  return {
    count: rows.length,
    tab: title,
    gid,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${gid}`,
    jonghap,
  };
}
