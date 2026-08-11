import 'server-only';
import { firebaseAdminDatabase } from '@/lib/server/firebase-admin';
import { collectImages, productExternalImages, scrapableSources } from '@/lib/domain/product-photos';
import { isListableProduct } from '@/lib/domain/product';
import { ensureDriveFolder, getDriveAccessToken, getDriveBackupConfig, safeDriveName, uploadRemoteDrivePhoto } from '@/lib/server/drive-backup';
import type { EntityRecord } from '@/lib/intake/entities';

const DEFAULT_ROOT = '1X98iGOqEB7ZjGBdkrtesuFcQzvqIMClZ';
const PROVIDER_FOLDER: Record<string, string> = {
  RP023: '오토플러스', RP012: '손오공렌터카', RP004: '아이카', RP022: '퍼시픽', RP008: '리더스',
  RP018: '스타', 'PT-0001': '렌트존', RP015: '경진렌트카', RP016: '경진카', RP020: '우리캐피탈렌터카',
  RP010: 'KH', RP017: '센트로', RP021: '빌린카', RP006: '아이언', RP013: '웰릭스', 'PT-0023': 'SA',
  RP030: 'J&J렌트카', RP031: '이안카',
};

type Rec = Record<string, any>;
const S = (v: unknown) => String(v ?? '').trim();

async function shortHash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].slice(0, 6).map((n) => n.toString(16).padStart(2, '0')).join('');
}

async function sourcePhotos(product: EntityRecord, origin: string): Promise<string[]> {
  const direct = collectImages([
    product.image_urls, product.images, product.photos, product.photo, product.image_url, product.doc_images,
  ]).filter((url) => !url.startsWith('/api/drive-photo'));
  const external = productExternalImages(product);
  const resolved: string[] = [];
  for (const source of scrapableSources(product)) {
    const response = await fetch(`${origin}/api/extract-photos?url=${encodeURIComponent(source)}&size=1600`, {
      signal: AbortSignal.timeout(30_000), cache: 'no-store',
    });
    if (!response.ok) continue;
    const body = await response.json() as { ok?: boolean; urls?: string[] };
    if (body.ok && Array.isArray(body.urls)) resolved.push(...body.urls);
  }
  return [...new Set([...direct, ...external, ...resolved].filter((url) => /^https?:\/\//.test(url)))];
}

export async function runPhotoDriveSync(input: { origin: string; limit?: number; reset?: boolean }) {
  const config = getDriveBackupConfig();
  if (!config) throw new Error('Google Drive OAuth 환경변수 없음');
  const db = firebaseAdminDatabase();
  const stateRef = db.ref('v4/system/photo_drive_sync');
  if (input.reset) await stateRef.remove();
  const [productsSnap, stateSnap] = await Promise.all([db.ref('v4/products').get(), stateRef.get()]);
  const products = Object.entries((productsSnap.val() || {}) as Record<string, Rec>)
    .map(([key, value]) => ({ ...value, _key: key, product_code: S(value.product_code) || key } as EntityRecord))
    .filter((product) => isListableProduct(product))
    .filter((product) => !!(product.photo_link || product.image_url || product.image_urls || product.images || product.photos))
    .sort((a, b) => S(a._key).localeCompare(S(b._key)));
  const cursor = S(stateSnap.val()?.cursor);
  let start = cursor ? products.findIndex((product) => S(product._key) > cursor) : 0;
  if (start < 0) start = 0;
  const selected = products.slice(start, start + Math.max(1, Math.min(input.limit || 2, 5)));
  const accessToken = await getDriveAccessToken(config);
  const rootId = S(process.env.GOOGLE_DRIVE_PHOTO_FOLDER_ID) || DEFAULT_ROOT;
  const results: Rec[] = [];

  for (const product of selected) {
    const code = S(product.product_code || product._key);
    const providerCode = S(product.provider_company_code || product.partner_code);
    const supplierName = PROVIDER_FOLDER[providerCode] || safeDriveName(S(product.provider_name || providerCode), '미분류');
    const plate = S(product.car_number || product.vehicle_no || product.plate_no).replace(/\s+/g, '');
    const vehicleName = safeDriveName(plate || `차량번호미정_${code}`, code);
    const supplierFolder = await ensureDriveFolder(accessToken, rootId, supplierName);
    const vehicleFolder = await ensureDriveFolder(accessToken, supplierFolder, vehicleName);
    const sources = await sourcePhotos(product, input.origin);
    const driveUrls: string[] = [];
    let uploaded = 0;
    let existed = 0;
    let failed = 0;
    for (let index = 0; index < sources.length; index++) {
      const sourceUrl = sources[index];
      try {
        const hash = await shortHash(sourceUrl);
        const saved = await uploadRemoteDrivePhoto({
          accessToken, parentId: vehicleFolder,
          name: `${String(index + 1).padStart(3, '0')}_${hash}.jpg`, sourceUrl,
          appProperties: { product_code: code.slice(0, 120), provider_code: providerCode.slice(0, 120), source_hash: hash },
        });
        driveUrls.push(`/api/drive-photo?id=${saved.id}`);
        if (saved.existed) existed++; else uploaded++;
      } catch (error) {
        failed++;
        console.warn('[photo-drive-sync] photo failed', { code, sourceUrl, error: String(error) });
      }
    }
    if (driveUrls.length) {
      await db.ref(`v4/products/${S(product._key)}`).update({
        drive_image_urls: driveUrls,
        drive_photo_folder_id: vehicleFolder,
        drive_photo_synced_at: new Date().toISOString(),
      });
    }
    await stateRef.set({ cursor: S(product._key), updated_at: new Date().toISOString() });
    results.push({ code, supplierName, vehicleName, sources: sources.length, uploaded, existed, failed, folderId: vehicleFolder });
  }
  const complete = start + selected.length >= products.length;
  if (complete) await stateRef.set({ cursor: '', completed_at: new Date().toISOString(), total: products.length });
  return { ok: true, total: products.length, start, processed: selected.length, complete, results };
}
