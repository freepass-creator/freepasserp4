/**
 * 관리자 전체 시트 연동 — 공급사별 sheet_url 순회 → 취합 → master-ingress 커밋.
 * UI는 SheetSync. 저장은 commitSupplierProducts만 (마스터 틀 SSOT).
 */
import { type EntityRecord } from '@/lib/intake/entities';
import { getStore } from '@/lib/store';
import { type MasterEntry } from '@/lib/domain/vehicle-master-match';
import { fetchSheetTable, importSheetTable, type MappingProfile } from '@/lib/domain/sheet-import';
import { commitSupplierProducts, type MasterIngressCommit } from '@/lib/domain/master-ingress';
import { partnerSheetOpts } from '@/lib/domain/sheet-adapters';

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

/** 시트가 지정된 공급사만 (영업채널 제외). */
export async function listSheetPartners(companyId: string): Promise<PartnerSheetRow[]> {
  const rows = await getStore().list('partner', companyId);
  return rows
    .filter((p) => {
      if (!String(p.sheet_url || '').trim()) return false;
      const t = String(p.partner_type || '');
      return !t || t === '공급사';
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
  message: string;
  products: EntityRecord[];
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
): Promise<{ lines: PartnerFetchLine[]; products: EntityRecord[]; partnerCount: number }> {
  if (!master?.length) throw new Error('차종마스터 없음');
  const partners = (await getStore().list('partner', companyId)).filter((p) => {
    if (!String(p.sheet_url || '').trim()) return false;
    const t = String(p.partner_type || '');
    return !t || t === '공급사';
  });
  const lines = await mapPool(partners, CONCURRENCY, async (p): Promise<PartnerFetchLine> => {
    const label = String(p.name || p.partner_name || p.partner_code);
    const code = String(p.partner_code || p._key || '');
    try {
      const o = partnerSheetOpts(p);
      const raw = await fetchSheetTable(o.url, o.gid || undefined);
      const t = o.adapter.prepareTable(raw, { headerRow: o.headerRow });
      if (t.length < 2) throw new Error('헤더+데이터 없음');
      const res = importSheetTable(t, {
        providerCode: o.providerCode,
        entries: master,
        profile: safeProfile(o.profileRaw),
      });
      return {
        code, label, ok: true, imported: res.imported,
        message: `✓ ${label} [${o.adapter.id}] — ${res.imported}매물 (확정 ${res.snap.high + res.snap.medium}·검수 ${res.snap.low + res.snap.none})`,
        products: res.products,
      };
    } catch (e) {
      return {
        code, label, ok: false, imported: 0,
        message: `✗ ${label} — ${String((e as Error).message || e)}`,
        products: [],
      };
    }
  });
  const products = lines.flatMap((l) => l.products);
  return { lines, products, partnerCount: partners.length };
}

/** 당겨오기 + master-ingress 저장(마스터 필수·검수 플래그). */
export async function syncAllPartnerSheets(
  companyId: string,
  master: MasterEntry[],
): Promise<{
  lines: PartnerFetchLine[];
  commit: MasterIngressCommit | null;
  ingress: { confirmed: number; review: number } | null;
  partnerCount: number;
  okCount: number;
  failCount: number;
}> {
  const { lines, products, partnerCount } = await fetchAllPartnerSheets(companyId, master);
  const okCount = lines.filter((l) => l.ok).length;
  const failCount = lines.length - okCount;
  let commit: MasterIngressCommit | null = null;
  let ingress: { confirmed: number; review: number } | null = null;
  if (products.length) {
    commit = await commitSupplierProducts(companyId, products, master);
    ingress = { confirmed: commit.confirmed, review: commit.review };
    const now = Date.now();
    const store = getStore();
    await Promise.all(lines.filter((l) => l.ok).map(async (l) => {
      try { await store.update('partner', companyId, l.code, { last_synced_at: now } as EntityRecord); } catch { /* best-effort */ }
    }));
  }
  return { lines, commit, ingress, partnerCount, okCount, failCount };
}
