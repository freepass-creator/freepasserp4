/**
 * 외부 매물 입고 SSOT — 공급사 기본정보 → 차종마스터 틀.
 *
 * 규칙 (앞으로 고정):
 *  1. 시트/엑셀/일괄 연동 저장은 이 모듈만 경유한다.
 *  2. 차종마스터(entries) 없이 커밋 불가.
 *  3. 수집 원자(연식·연료·배기·인승·구동·등록증·옵션·OCR…)를 전부 신호로 써 snapToMaster.
 *  4. high·중 = 규격 확정(마스터 노드), 검토·미매칭 = _needs_master_review.
 *  5. soft-merge 저장은 sheet-merge.commitSheetProducts (빈칸으로 수기 덮지 않음).
 *  6. 손님·영업에 보이는 차종 = 마스터 규격. 원본은 _raw_vehicle 보존.
 *
 * UI(SheetSync)·일괄(sync-all)은 파서·저장을 직접 두지 말고 여기만 호출.
 */
import { type EntityRecord } from '@/lib/intake/entities';
import {
  importSheetTable,
  prepareMasterIngress,
  type ImportResult,
  type MappingProfile,
} from '@/lib/domain/sheet-import';
import { commitSheetProducts, type CommitSheetResult } from '@/lib/domain/sheet-merge';
import {
  snapToMaster,
  applySnap,
  type MasterEntry,
} from '@/lib/domain/vehicle-master-match';

export type MasterIngressCommit = CommitSheetResult & {
  confirmed: number;
  review: number;
};

function assertMaster(entries: MasterEntry[] | null | undefined): MasterEntry[] {
  if (!entries?.length) throw new Error('차종마스터 필수 — 외부 매물은 마스터 틀로만 입고');
  return entries;
}

/** 미변환 행이 있으면 마스터로 한 번 더 스냅(우회 입고 방어). */
function ensureSnapped(products: EntityRecord[], entries: MasterEntry[]): EntityRecord[] {
  return products.map((p) => {
    if (p._snapped && (p._snap_confidence === 'high' || p._snap_confidence === 'medium' || p._snap_confidence === 'low')) {
      return p;
    }
    const res = snapToMaster(p, entries);
    return res ? applySnap(p, res, { source: 'ingress' }) : p;
  });
}

/**
 * 이미 import·스냅된 매물 배열 → 검수 플래그 → soft-merge 저장.
 * SheetSync 단일 저장 · sync-all 공용.
 */
export async function commitSupplierProducts(
  companyId: string,
  products: EntityRecord[],
  master: MasterEntry[],
): Promise<MasterIngressCommit> {
  const entries = assertMaster(master);
  if (!products.length) {
    return { created: 0, updated: 0, unchanged: 0, duplicates: 0, backend: '', confirmed: 0, review: 0 };
  }
  const snapped = ensureSnapped(products, entries);
  const { products: gated, confirmed, review } = prepareMasterIngress(snapped);
  const r = await commitSheetProducts(companyId, gated);
  return { ...r, confirmed, review };
}

/**
 * 표 → 마스터 스냅 미리보기(쓰기 없음). 마스터 필수.
 */
export function previewSupplierTable(
  table: string[][],
  opts: { providerCode: string; master: MasterEntry[]; profile?: MappingProfile },
): ImportResult & { confirmed: number; review: number } {
  const entries = assertMaster(opts.master);
  const res = importSheetTable(table, {
    providerCode: opts.providerCode,
    entries,
    profile: opts.profile,
  });
  const { confirmed, review } = prepareMasterIngress(res.products);
  return { ...res, confirmed, review };
}
