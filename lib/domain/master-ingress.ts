/**
 * 외부 매물 입고 SSOT — 공급사 기본정보 → 차종마스터 틀.
 *
 * 규칙 (앞으로 고정):
 *  1. 시트/엑셀/일괄 연동 저장은 이 모듈만 경유한다.
 *  2. 차종마스터는 **선택**이다 — 붙일 수 있는 차만 붙이고, 못 붙은 차도 원문 그대로 입고한다
 *     (2026-08-06 사장님 결정). 마스터가 비면 스냅을 건너뛸 뿐 입고를 막지 않는다.
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
  type DepositRule,
  type MappingHeaderSignature,
  type MappingProfile,
} from '@/lib/domain/sheet-import';
import { commitSheetProducts, type CommitSheetResult } from '@/lib/domain/sheet-merge';
import {
  snapToMaster,
  applySnap,
  type MasterEntry,
} from '@/lib/domain/vehicle-master-match';
import { applyColors } from '@/lib/domain/color-master';

export type MasterIngressCommit = CommitSheetResult & {
  confirmed: number;
  review: number;
};

/**
 * 차종마스터는 선택이다 — 없으면 «스냅 없이» 간다.
 *
 * 예전엔 여기서 던져 입고를 통째로 막았다. 그러면 마스터 로드가 한 번 실패했다는 이유로
 * 공급사 시트가 하나도 안 들어온다. 차종을 못 붙이는 건 우리 데이터가 덜 정리된 것이지
 * 그 차가 없다는 뜻이 아니다 — 원문(제조사·차명)은 그대로 저장되고 검수 표시만 붙는다.
 */
function optionalMaster(entries: MasterEntry[] | null | undefined): MasterEntry[] {
  return entries?.length ? entries : [];
}

/**
 * 미변환 행이 있으면 마스터·색상 규격으로 한 번 더 스냅(우회 입고 방어).
 *
 * ★`low` 는 «스냅 완료»가 아니다 — 다시 시도한다.
 *   규칙 4가 정한 확정선은 high·medium 이고, low 는 검수 대상(`_needs_master_review`)이다.
 *   그런데 여기서 low 까지 «이미 스냅됨»으로 건너뛰면, 옛 매처나 마스터 없던 시점에 low 로
 *   굳은 레코드가 영원히 복구되지 않는다. 실측(2026-08-06): 검토대기 396대를 지금 매처에
 *   다시 물리자 363대(92%)가 high·medium 으로 확정됐다 — 데이터가 아니라 이 가드가 막고 있었다.
 *   재스냅은 `_raw_vehicle` 원본을 우선하므로 이미 맞은 값을 망치지 않는다.
 */
function ensureSnapped(products: EntityRecord[], entries: MasterEntry[]): EntityRecord[] {
  return products.map((p) => {
    if (p._snapped && (p._snap_confidence === 'high' || p._snap_confidence === 'medium')) {
      return applyColors(p);
    }
    const res = snapToMaster(p, entries);
    return applyColors(res ? applySnap(p, res, { source: 'ingress' }) : p);
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
  const entries = optionalMaster(master);
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
  opts: {
    providerCode: string;
    master: MasterEntry[];
    profile?: MappingProfile;
    profileHeaders?: MappingHeaderSignature;
    depositRule?: DepositRule;
  },
): ImportResult & { confirmed: number; review: number } {
  const entries = optionalMaster(opts.master);
  const res = importSheetTable(table, {
    providerCode: opts.providerCode,
    entries,
    profile: opts.profile,
    profileHeaders: opts.profileHeaders,
    depositRule: opts.depositRule,
  });
  const { confirmed, review } = prepareMasterIngress(res.products);
  return { ...res, confirmed, review };
}
