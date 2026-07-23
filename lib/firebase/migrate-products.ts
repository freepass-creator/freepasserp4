/**
 * v3 라이브 매물(products) → v4 오버레이(v4/products) 1회 일괄복사.
 *  목적: 카탈로그 소스를 v4 전용으로 전환하기 전, v3에만 있는 매물을 v4로 옮겨 유실 방지.
 *   · v4에 이미 있는 키는 건너뜀(오버레이 편집본 보존). v3 원본을 그대로 복사(읽기 때 toV4 정규화).
 *   · RTDB 금지문자(. # $ / [ ]) 키·빈 키는 건너뜀(경로 안전). v3 내부 동일 product_code 중복도 1건만.
 *   · 배치 500건씩 멀티로케이션 update. v3 라이브(products)는 절대 변경하지 않음(쓰기 대상은 v4/ 만).
 */
import { ref, get, update } from 'firebase/database';
import { getRtdb } from './client';
import { vehicleIdentity, isRealPlate, isHiddenFromCatalog } from '@/lib/domain/product';
import { carYear } from '@/lib/domain/vehicle-master-match';

type PRec = Record<string, unknown>;

// 진단 전용 층위 판별(어댑터 SSOT 동일). 카슝=빌린카 공급사, 10년↑=노후차.
const KASHUNG = new Set(['PT-0024']); // ← 어댑터와 동일(카슝=PT-0024 구독연동. 빌린카 RP021은 포함)
const isKashung = (r: PRec) => KASHUNG.has(String(r.provider_company_code)) || KASHUNG.has(String(r.partner_code));
const isTooOld = (r: PRec) => { const y = carYear(r as Parameters<typeof carYear>[0]); return y > 0 && (new Date().getFullYear() - y) >= 10; };

export type MigrateProductsResult = {
  v3Total: number;       // v3 products 총 노드 수
  v4Before: number;      // 복사 전 v4/products 수
  copied: number;        // 복사(예정) 건수
  skippedExists: number; // v4에 이미 있어 건너뜀(편집본 보존)
  skippedUnsafe: number; // 금지문자·빈 키·비객체로 건너뜀
  v4After: number;       // 복사 후 v4/products 수(dry-run이면 v4Before)
  dryRun: boolean;
};

const FORBIDDEN_KEY = /[.#$/[\]]/; // RTDB 경로 금지문자

export async function migrateV3ProductsToV4(dryRun = false): Promise<MigrateProductsResult> {
  const db = getRtdb();
  if (!db) throw new Error('DB가 설정되지 않았습니다');
  const [v3snap, v4snap] = await Promise.all([
    get(ref(db, 'products')),
    get(ref(db, 'v4/products')),
  ]);
  const v3 = (v3snap.val() as Record<string, Record<string, unknown>> | null) || {};
  const v4 = (v4snap.val() as Record<string, unknown> | null) || {};
  const v4Before = Object.keys(v4).length;
  const v3Total = Object.keys(v3).length;
  const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

  const updates: Record<string, unknown> = {};
  let copied = 0, skippedExists = 0, skippedUnsafe = 0;
  for (const [childKey, rec] of Object.entries(v3)) {
    if (!rec || typeof rec !== 'object') { skippedUnsafe++; continue; }
    const key = String((rec as Record<string, unknown>).product_code || childKey).trim();
    if (!key || FORBIDDEN_KEY.test(key)) { skippedUnsafe++; continue; }
    const path = 'v4/products/' + key;
    if (has(v4, key) || has(updates, path)) { skippedExists++; continue; } // v4 편집본·v3 내부중복 보존
    updates[path] = rec; // v3 원본 그대로
    copied++;
  }

  if (!dryRun && copied > 0) {
    const entries = Object.entries(updates);
    const BATCH = 500;
    for (let i = 0; i < entries.length; i += BATCH) {
      await update(ref(db), Object.fromEntries(entries.slice(i, i + BATCH)));
    }
  }

  return {
    v3Total, v4Before, copied, skippedExists, skippedUnsafe,
    v4After: dryRun ? v4Before : v4Before + copied,
    dryRun,
  };
}

// ── 매물 중복 진단 ────────────────────────────────────────────────────────────
export type DedupDiag = {
  v3: number; v4: number; merged: number;           // 원천 개수·병합(product_code) 후
  realPlateRows: number; vinOnlyRows: number;       // 실번호판 / (번호판X·VIN만) 행수
  placeholderRows: number; blankRows: number;       // 번호판 placeholder / 완전 공백 행수
  uniqueByNewIdentity: number;                       // 새 dedup 결과(실번호판·VIN 유일 + placeholder·blank 개별)
  uniqueByRawCarNumber: number;                      // 옛 dedup(원문 car_number) 결과 — placeholder 오합침
  placeholderValues: { value: string; count: number }[]; // 비-실번호판 non-blank 값 상위(오합침 원인)
  dupIdentities: { id: string; count: number }[];    // 실신원 중복(v3/v4 더블) 상위
  // deduped(재고, 모든 상태) 기준 층위 분해 — "374가 어느 수인지" 규명
  statusCounts: { status: string; count: number }[]; // 상태별 구성(내림차순)
  kashung: number; tooOld: number; hiddenFromCatalog: number; // 파인더가 빼는 것들
  finderVisible: number;                             // = 재고 − 카슝 − 10년 − 출고불가 (파인더 카탈로그)
  providerCounts: { code: string; name: string; count: number }[]; // 공급사별 재고 구성(상위) — 카슝·빌린카·오플 식별용
  v3ActiveUnique: number; v4ActiveUnique: number;    // v3만 / v4만 활성(비삭제) 유일대수 — erp3 374 대조
  v4NotInV3: number; v3NotInV4: number;              // 교집합 밖 — v4 stale 잔여 / v3에만 있는 것
  statusDeleted: number;                             // 재고 중 status==='deleted'(erp3가 거르는 소프트삭제)
  erp3Inventory: number; erp3InvExOld: number;       // erp3 정합 재고(=374 목표) / 노후 뺀 값
};

/** v3∪v4 병합 후 실데이터로 중복 구조를 진단 — 355 vs 374 같은 대수 차이 원인 규명용(쓰기 없음). */
export async function diagnoseProductDedup(): Promise<DedupDiag> {
  const db = getRtdb();
  if (!db) throw new Error('DB가 설정되지 않았습니다');
  const [v3snap, v4snap, pSnap] = await Promise.all([
    get(ref(db, 'products')), get(ref(db, 'v4/products')), get(ref(db, 'partners')),
  ]);
  const v3 = (v3snap.val() as Record<string, PRec> | null) || {};
  const v4 = (v4snap.val() as Record<string, PRec> | null) || {};
  // 공급사코드 → 이름(카슝·빌린카·빌림 식별용)
  const partners = (pSnap.val() as Record<string, PRec> | null) || {};
  const nameByCode = new Map<string, string>();
  for (const [k, p] of Object.entries(partners)) {
    if (!p || typeof p !== 'object') continue;
    const code = String((p as PRec).partner_code || k);
    if (code) nameByCode.set(code, String((p as PRec).name || (p as PRec).company_name || ''));
  }

  // 어댑터 merged 동일: product_code(없으면 노드키)로 병합, v4 필드 우선.
  const merged = new Map<string, PRec>();
  const put = (obj: Record<string, PRec>, win: boolean) => {
    for (const [k, r] of Object.entries(obj)) {
      if (!r || typeof r !== 'object') continue;
      const key = String((r as PRec).product_code || k);
      merged.set(key, win ? { ...(merged.get(key) || {}), ...r } : r);
    }
  };
  put(v3, false); put(v4, true);
  const rows = [...merged.values()].filter((r) => !(r as PRec)._deleted && !(r as PRec).deletedAt);

  const norm = (v: unknown) => String(v ?? '').replace(/\s/g, '').toUpperCase();
  let realPlateRows = 0, vinOnlyRows = 0, placeholderRows = 0, blankRows = 0;
  let noIdRows = 0;                        // 신원 불명 = 개별 유지
  const rawCarNums = new Set<string>();   // 옛 dedup 재현(원문 car_number)
  let rawBlank = 0;
  const placeholderCount = new Map<string, number>();
  const idCount = new Map<string, number>();
  // deduped(재고) 구성: 신원별 1건 + 신원불명 개별 — 최신·product_code 있는 것 우선
  const byId = new Map<string, PRec>();
  const noId: PRec[] = [];
  const ts = (p: PRec) => Number(p.updatedAt ?? p.updated_at ?? p.created_at ?? 0);

  for (const r of rows) {
    const cn = norm((r as PRec).car_number);
    const id = vehicleIdentity(r as PRec);
    if (id) {
      idCount.set(id, (idCount.get(id) || 0) + 1);
      const prev = byId.get(id);
      if (!prev) byId.set(id, r);
      else { const score = (Number(!!r.product_code) - Number(!!prev.product_code)) || (ts(r) - ts(prev)); if (score > 0) byId.set(id, r); }
    } else { noIdRows++; noId.push(r); }
    // 카테고리
    if (isRealPlate((r as PRec).car_number)) realPlateRows++;
    else if (norm((r as PRec).vin).length >= 11) vinOnlyRows++;
    else if (cn) { placeholderRows++; placeholderCount.set(cn, (placeholderCount.get(cn) || 0) + 1); }
    else blankRows++;
    // 옛 dedup: 원문 car_number 유일 + 공백은 개별
    if (cn) rawCarNums.add(cn); else rawBlank++;
  }

  // deduped(재고, 모든 상태) 기준 층위 분해
  const deduped = [...byId.values(), ...noId];
  const statusMap = new Map<string, number>();
  const provMap = new Map<string, number>();
  let kashung = 0, tooOld = 0, hiddenFromCatalog = 0, finderVisible = 0;
  let statusDeleted = 0, erp3Inventory = 0, erp3InvExOld = 0;
  for (const r of deduped) {
    statusMap.set(String(r.vehicle_status || '(없음)'), (statusMap.get(String(r.vehicle_status || '(없음)')) || 0) + 1);
    const pc = String(r.provider_company_code || r.partner_code || '(미지정)');
    provMap.set(pc, (provMap.get(pc) || 0) + 1);
    const k = isKashung(r), o = isTooOld(r), h = isHiddenFromCatalog(r);
    if (k) kashung++;
    if (o) tooOld++;
    if (h) hiddenFromCatalog++;
    if (!k && !o && !h) finderVisible++;
    // erp3 정합: status==='deleted'(소프트삭제) 제외 = 재고 374 목표. 노후 뺀 값도 함께.
    if (String(r.status) === 'deleted') statusDeleted++;
    else { erp3Inventory++; if (!o) erp3InvExOld++; }
  }

  // v3만 / v4만 활성(비삭제) 유일대수 — erp3(v3) 기준 374가 어디서 나오는지 대조
  const activeIds = (obj: Record<string, PRec>) => {
    const ids = new Set<string>(); let noId2 = 0;
    for (const r of Object.values(obj)) {
      if (!r || typeof r !== 'object' || (r as PRec)._deleted || (r as PRec).deletedAt) continue;
      const id = vehicleIdentity(r as PRec);
      if (id) ids.add(id); else noId2++;
    }
    return { ids, unique: ids.size + noId2 };
  };
  const A3 = activeIds(v3), A4 = activeIds(v4);
  const v4NotInV3 = [...A4.ids].filter((id) => !A3.ids.has(id)).length;
  const v3NotInV4 = [...A3.ids].filter((id) => !A4.ids.has(id)).length;

  const top = (m: Map<string, number>, n: number) =>
    [...m.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, n);

  return {
    v3: Object.keys(v3).length, v4: Object.keys(v4).length, merged: rows.length,
    realPlateRows, vinOnlyRows, placeholderRows, blankRows,
    uniqueByNewIdentity: deduped.length,
    uniqueByRawCarNumber: rawCarNums.size + rawBlank,
    placeholderValues: top(placeholderCount, 10).map(([value, count]) => ({ value, count })),
    dupIdentities: top(idCount, 10).map(([id, count]) => ({ id, count })),
    statusCounts: [...statusMap.entries()].sort((a, b) => b[1] - a[1]).map(([status, count]) => ({ status, count })),
    kashung, tooOld, hiddenFromCatalog, finderVisible,
    providerCounts: [...provMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([code, count]) => ({ code, name: nameByCode.get(code) || '', count })),
    v3ActiveUnique: A3.unique, v4ActiveUnique: A4.unique, v4NotInV3, v3NotInV4,
    statusDeleted, erp3Inventory, erp3InvExOld,
  };
}
