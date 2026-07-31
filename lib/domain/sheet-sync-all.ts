/**
 * 관리자 전체 시트 연동 — 공급사별 sheet_url 순회 → 취합 → master-ingress 커밋.
 * UI는 SheetSync. 저장은 commitSupplierProducts만 (마스터 틀 SSOT).
 * 오토플러스 = main+프로모션 2탭 병합(sheet-autoplus).
 * fetch 성공·가드 통과 공급사만 부재→출고불가(삭제 없음).
 */
import { type EntityRecord } from '@/lib/intake/entities';
import { getStore } from '@/lib/store';
import { type MasterEntry } from '@/lib/domain/vehicle-master-match';
import { fetchSheetTable, importSheetTable, type MappingProfile } from '@/lib/domain/sheet-import';
import { commitSupplierProducts, type MasterIngressCommit } from '@/lib/domain/master-ingress';
import { partnerSheetOpts } from '@/lib/domain/sheet-adapters';
import {
  applyAbsentBlocked,
  shouldReconcileAbsent,
} from '@/lib/domain/sheet-merge';
import {
  importAutoplusMerged,
  isAutoplusPartner,
} from '@/lib/domain/sheet-autoplus';

function safeProfile(v: unknown): MappingProfile | undefined {
  try {
    const o = typeof v === 'string' ? JSON.parse(v) : v;
    return o && typeof o === 'object' ? (o as MappingProfile) : undefined;
  } catch { return undefined; }
}

export type PartnerSheetRow = {
  code: string;
  name: string;
  url: string;
  adapter: string;
  lastSyncedAt: number | null;
};

/**
 * 시트가 지정된 공급사만 (영업채널 제외).
 *
 * ⚠ partner_type 은 실데이터에 **한글·영문이 섞여 있다**(`공급사` / `provider` / `영업채널` / `sales_channel`).
 * 예전엔 한글 '공급사'만 통과시켜서 `provider` 로 저장된 공급사가 전부 목록에서 빠졌다
 * (2026-07-31 실측: 시트 등록 16곳 중 2곳만 보였다). 그래서 **영업채널만 걸러내는 방식**으로 뒤집는다 —
 * 새 표기가 생겨도 공급사가 조용히 사라지지 않는다.
 */
export async function listSheetPartners(companyId: string): Promise<PartnerSheetRow[]> {
  const rows = await getStore().list('partner', companyId);
  return rows
    .filter((p) => {
      if (!String(p.sheet_url || '').trim()) return false;
      if (p._deleted === true || String(p.status || '') === 'deleted') return false;
      return !/영업|sales/i.test(String(p.partner_type || ''));
    })
    .map((p) => ({
      code: String(p.partner_code || p._key || ''),
      name: String(p.name || p.partner_name || p.partner_code || ''),
      url: String(p.sheet_url || '').trim(),
      adapter: String(p.adapter_id || 'generic'),
      lastSyncedAt: p.last_synced_at != null ? Number(p.last_synced_at) : null,
    }))
    .filter((r) => r.code)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}

export type PartnerFetchLine = {
  code: string;
  label: string;
  ok: boolean;
  imported: number;
  excludedCount: number;   // 시트에 '출고불가'로 적혀 있어 안 올린 대수
  noPriceCount: number;    // 대여료가 없어 안 올린 대수 — 값 없는 매물은 게시하지 않는다
  message: string;
  products: EntityRecord[];
};

export type AbsentSyncSummary = {
  blocked: number;
  skipped_locked: number;
  skipped_guard: number;
  notes: string[];
};

export type PartnerSheetsFetch = {
  lines: PartnerFetchLine[];
  products: EntityRecord[];
  partnerCount: number;
};

const CONCURRENCY = 4;

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

/** 공급사별 시트만 당겨 취합(쓰기 없음). 마스터 필수. */
export async function fetchAllPartnerSheets(
  companyId: string,
  master: MasterEntry[],
): Promise<PartnerSheetsFetch> {
  if (!master?.length) throw new Error('차종마스터 없음');
  // 대상 선정은 listSheetPartners 하나로 — 여기 따로 filter 를 두면 목록과 어긋난다.
  //  실제로 그랬다: 화면 목록엔 16곳이 나오는데 여기서 한글 '공급사'만 통과시켜 2곳만 가져왔다.
  const roster = await listSheetPartners(companyId);
  const codes = new Set(roster.map((r) => r.code));
  const partners = (await getStore().list('partner', companyId))
    .filter((p) => codes.has(String(p.partner_code || p._key || '')));
  const lines = await mapPool(partners, CONCURRENCY, async (p): Promise<PartnerFetchLine> => {
    const label = String(p.name || p.partner_name || p.partner_code);
    const code = String(p.partner_code || p._key || '');
    try {
      const o = partnerSheetOpts(p);
      const profile = safeProfile(o.profileRaw);
      if (isAutoplusPartner(p) || o.adapter.id === 'autoplus') {
        const res = await importAutoplusMerged({
          url: o.url,
          providerCode: o.providerCode,
          entries: master,
          profile,
          fetchTable: fetchSheetTable,
          headerRow: o.headerRow,
        });
        return {
          code, label, ok: true, imported: res.imported, excludedCount: res.excludedCount, noPriceCount: res.noPriceCount,
          message: `✓ ${label} [autoplus 2탭] — ${res.imported}매물 (본 ${res.mainN}+프로모 ${res.promoOnlyN} · 재고 ${res.stock} · 확정 ${res.snap.high + res.snap.medium}·검수 ${res.snap.low + res.snap.none}${res.excludedCount ? ` · 출고불가 제외 ${res.excludedCount}` : ''})`,
          products: res.products,
        };
      }
      // 탭이 여러 개면 전부 읽어 합친다. 한 탭만 읽으면 나머지 탭 차량이 「시트에 없음」으로 잡혀
      //  멀쩡한 매물이 부재처리로 출고불가가 된다 — 조용히 일어나서 더 위험하다.
      const tabs = o.gids.length ? o.gids : [''];
      const products: EntityRecord[] = [];
      const seen = new Set<string>();
      let imported = 0, excluded = 0, noPrice = 0, high = 0, low = 0;
      const tabNotes: string[] = [];
      for (const g of tabs) {
        const raw = await fetchSheetTable(o.url, g || undefined);
        const t = o.adapter.prepareTable(raw, { headerRow: o.headerRow });
        if (t.length < 2) { tabNotes.push(`gid ${g || '기본'}: 데이터 없음`); continue; }
        const r = importSheetTable(t, { providerCode: o.providerCode, entries: master, profile, depositRule: o.depositRule });
        excluded += r.excludedCount;
        noPrice += r.noPriceCount;
        high += r.snap.high + r.snap.medium;
        low += r.snap.low + r.snap.none;
        for (const rec of r.products) {
          // 같은 차가 두 탭에 있으면 먼저 읽은 탭이 이긴다(탭 순서 = 사용자가 적은 순서).
          const k = String(rec.product_code || rec._key || '');
          if (k && seen.has(k)) continue;
          if (k) seen.add(k);
          products.push(rec);
          imported++;
        }
      }
      if (!products.length && excluded === 0) throw new Error(tabNotes.join(' · ') || '헤더+데이터 없음');
      return {
        code, label, ok: true, imported, excludedCount: excluded, noPriceCount: noPrice,
        message: `✓ ${label} [${o.adapter.id}${tabs.length > 1 ? ` ${tabs.length}탭` : ''}] — ${imported}매물 (확정 ${high}·검수 ${low}${excluded ? ` · 출고불가 제외 ${excluded}` : ''}${noPrice ? ` · 가격없어 제외 ${noPrice}` : ''})`,
        products,
      };
    } catch (e) {
      return {
        code, label, ok: false, imported: 0, excludedCount: 0, noPriceCount: 0,
        message: `✗ ${label} — ${String((e as Error).message || e)}`,
        products: [],
      };
    }
  });
  const products = lines.flatMap((l) => l.products);
  return { lines, products, partnerCount: partners.length };
}

function presentKeySet(products: EntityRecord[]): Set<string> {
  const s = new Set<string>();
  for (const p of products) {
    const k = String(p.product_code || p._key || '');
    if (k) s.add(k);
  }
  return s;
}

function buildPrevForGuard(
  partners: EntityRecord[],
  existing: EntityRecord[],
): Map<string, number> {
  const prevForGuard = new Map<string, number>();
  for (const p of partners) {
    const code = String(p.partner_code || p._key || '');
    if (!code) continue;
    // last_sheet_rows(읽은 행) 우선 — 없으면 구버전 last_sheet_imported 로 폴백.
    const rows = Number(p.last_sheet_rows ?? p.last_sheet_imported ?? 0);
    if (rows > 0) prevForGuard.set(code, rows);
  }
  for (const r of existing) {
    if (r._deleted) continue;
    const code = String(r.provider_company_code || '');
    if (!code || prevForGuard.has(code)) continue;
    prevForGuard.set(code, (prevForGuard.get(code) || 0) + 1);
  }
  return prevForGuard;
}

/**
 * 이미 당겨 온 결과 → master-ingress 저장 + (가드 통과 시) 부재→출고불가.
 * 미리보기(confirm) 후 호출 — fetch 재실행 없음.
 */
export async function commitFetchedPartnerSheets(
  companyId: string,
  master: MasterEntry[],
  fetched: PartnerSheetsFetch,
  prevForGuard?: Map<string, number>,
): Promise<{
  lines: PartnerFetchLine[];
  commit: MasterIngressCommit | null;
  ingress: { confirmed: number; review: number } | null;
  absent: AbsentSyncSummary;
  partnerCount: number;
  okCount: number;
  failCount: number;
}> {
  const store = getStore();
  const { lines, products, partnerCount } = fetched;
  const okCount = lines.filter((l) => l.ok).length;
  const failCount = lines.length - okCount;
  let commit: MasterIngressCommit | null = null;
  let ingress: { confirmed: number; review: number } | null = null;
  if (products.length) {
    commit = await commitSupplierProducts(companyId, products, master);
    ingress = { confirmed: commit.confirmed, review: commit.review };
  }

  const guard = prevForGuard ?? buildPrevForGuard(
    (await store.list('partner', companyId)).filter((p) => String(p.sheet_url || '').trim()),
    await store.list('product', companyId),
  );

  const absent: AbsentSyncSummary = {
    blocked: 0,
    skipped_locked: 0,
    skipped_guard: 0,
    notes: [],
  };
  const now = Date.now();
  for (const line of lines) {
    if (!line.ok) {
      absent.notes.push(`${line.label}: 부재처리 스킵(fetch 실패)`);
      continue;
    }
    const prev = guard.get(line.code) || 0;
    // ⚠ 가드에는 **읽은 행 수**(올린 것 + 출고불가로 걸러낸 것)를 넣는다.
    //  급감가드는 "시트가 깨졌나"를 보는 장치지 "공급사가 차를 막았나"를 보는 장치가 아니다.
    //  올린 대수만 넣으면 — 공급사가 절반을 출고불가로 돌린 날 가드가 걸려 부재처리가 통째로 스킵되고,
    //  그 차들은 유입에도 없으니 ERP 에서 계속 출고가능으로 남는다(정확히 반대 방향의 사고).
    const rowsRead = line.imported + (line.excludedCount || 0);
    const gate = shouldReconcileAbsent(rowsRead, prev);
    if (!gate.ok) {
      absent.skipped_guard++;
      absent.notes.push(`${line.label}: 부재처리 스킵(${gate.reason === 'collapse' ? '급감가드' : '유입0'})`);
    } else {
      const a = await applyAbsentBlocked(companyId, line.code, presentKeySet(line.products));
      absent.blocked += a.absent_blocked;
      absent.skipped_locked += a.skipped_locked;
      if (a.absent_blocked) {
        line.message += ` · 부재→출고불가 ${a.absent_blocked}`;
        absent.notes.push(`${line.label}: 출고불가 ${a.absent_blocked}`);
      }
    }
    try {
      await store.update('partner', companyId, line.code, {
        last_synced_at: now,
        last_sheet_imported: line.imported,
        last_sheet_rows: rowsRead,   // 급감가드 기준 — imported 와 달리 출고불가분을 포함한다
      } as EntityRecord);
    } catch { /* best-effort */ }
  }

  return { lines, commit, ingress, absent, partnerCount, okCount, failCount };
}

/** 당겨오기 + 저장(마스터 필수). 미리보기 없이 한 방에 쓸 때. */
export async function syncAllPartnerSheets(
  companyId: string,
  master: MasterEntry[],
): Promise<{
  lines: PartnerFetchLine[];
  commit: MasterIngressCommit | null;
  ingress: { confirmed: number; review: number } | null;
  absent: AbsentSyncSummary;
  partnerCount: number;
  okCount: number;
  failCount: number;
}> {
  const store = getStore();
  // 대상 선정은 listSheetPartners 하나로 — 여기 따로 filter 를 두면 fetch 대상과 어긋나
  //  가져오지도 않은 공급사의 매물을 부재(→출고불가) 처리해 버린다.
  const roster = await listSheetPartners(companyId);
  const codes = new Set(roster.map((r) => r.code));
  const partners = (await store.list('partner', companyId))
    .filter((p) => codes.has(String(p.partner_code || p._key || '')));
  const existing = await store.list('product', companyId);
  const prevForGuard = buildPrevForGuard(partners, existing);
  const fetched = await fetchAllPartnerSheets(companyId, master);
  return commitFetchedPartnerSheets(companyId, master, fetched, prevForGuard);
}
