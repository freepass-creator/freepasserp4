'use client';

import type { EntityRecord } from '@/lib/intake/entities';
import { productPhotos, resolveServerPhotos } from '@/lib/domain/product-photos';

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function join(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.byteLength; }
  return out;
}

function header(size: number, write: (view: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  write(new DataView(bytes.buffer));
  return bytes;
}

type ZipFile = { name: string; bytes: Uint8Array };

/** 별도 패키지 없이 만드는 ZIP(store). 이미지 자체가 이미 압축 포맷이라 재압축하지 않는다. */
export function createPhotoZip(files: ZipFile[]): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const localHeader = header(30, (v) => {
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true);
      v.setUint16(8, 0, true); v.setUint32(14, crc, true);
      v.setUint32(18, file.bytes.byteLength, true); v.setUint32(22, file.bytes.byteLength, true);
      v.setUint16(26, name.byteLength, true);
    });
    local.push(localHeader, name, file.bytes);

    const centralHeader = header(46, (v) => {
      v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true);
      v.setUint16(8, 0x0800, true); v.setUint16(10, 0, true); v.setUint32(16, crc, true);
      v.setUint32(20, file.bytes.byteLength, true); v.setUint32(24, file.bytes.byteLength, true);
      v.setUint16(28, name.byteLength, true); v.setUint32(42, offset, true);
    });
    central.push(centralHeader, name);
    offset += localHeader.byteLength + name.byteLength + file.bytes.byteLength;
  }

  const centralBytes = join(central);
  const end = header(22, (v) => {
    v.setUint32(0, 0x06054b50, true); v.setUint16(8, files.length, true); v.setUint16(10, files.length, true);
    v.setUint32(12, centralBytes.byteLength, true); v.setUint32(16, offset, true);
  });
  return join([...local, centralBytes, end]);
}

function safeName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || '차량사진';
}

function extension(contentType: string, url: string): string {
  const byType: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
  const type = contentType.split(';')[0].toLowerCase();
  if (byType[type]) return byType[type];
  return url.match(/\.(jpe?g|png|webp|gif|avif)(?:[?#]|$)/i)?.[1].replace(/^jpeg$/i, 'jpg').toLowerCase() || 'jpg';
}

async function fetchPhoto(url: string, index: number, vehicleName: string): Promise<ZipFile> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`사진 ${index + 1} 다운로드 실패 (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error(`사진 ${index + 1}이 비어 있습니다.`);
  const ext = extension(response.headers.get('content-type') || '', url);
  return { name: `${safeName(vehicleName)}_${String(index + 1).padStart(2, '0')}.${ext}`, bytes };
}

function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

export async function downloadPhotoZip(urls: string[], vehicleName: string): Promise<{ saved: number; failed: number }> {
  const settled = await Promise.allSettled(urls.map((url, index) => fetchPhoto(url, index, vehicleName)));
  const files = settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  if (!files.length) throw new Error('다운로드 가능한 사진이 없습니다.');

  const zip = createPhotoZip(files);
  const zipBuffer = new ArrayBuffer(zip.byteLength);
  new Uint8Array(zipBuffer).set(zip);
  const blob = new Blob([zipBuffer], { type: 'application/zip' });
  saveBlob(blob, `${safeName(vehicleName)}_사진_${files.length}장.zip`);
  return { saved: files.length, failed: settled.length - files.length };
}

export type InventoryPhotoProgress = { batch: number; batches: number; vehicles: number; totalVehicles: number };

/** 전체 재고는 수 GB가 될 수 있어 차량 10대씩 ZIP을 닫고 메모리를 반환한다. */
export async function downloadInventoryPhotoArchives(
  products: EntityRecord[],
  onProgress?: (progress: InventoryPhotoProgress) => void,
): Promise<{ archives: number; vehicles: number; photos: number; noPhoto: number; failed: number }> {
  const batchSize = 10;
  const batches = Math.ceil(products.length / batchSize);
  let archives = 0; let vehicles = 0; let photos = 0; let noPhoto = 0; let failed = 0;

  for (let start = 0; start < products.length; start += batchSize) {
    const group = products.slice(start, start + batchSize);
    const batch = Math.floor(start / batchSize) + 1;
    onProgress?.({ batch, batches, vehicles: start, totalVehicles: products.length });
    const zipFiles: ZipFile[] = [];

    for (const product of group) {
      const plate = String(product.car_number || product.vehicle_no || product.plate_no || product.product_code || product._key || '차량');
      const provider = String(product.provider_name || product.provider_company_code || '공급사미입력');
      const immediate = productPhotos(product);
      const resolved = await resolveServerPhotos(product, 1920);
      const urls = [...new Set([...immediate, ...resolved])];
      if (!urls.length) { noPhoto++; continue; }
      vehicles++;
      const settled = await Promise.allSettled(urls.map((url, index) => fetchPhoto(url, index, plate)));
      for (const result of settled) {
        if (result.status === 'rejected') { failed++; continue; }
        result.value.name = `${safeName(provider)}/${safeName(plate)}/${result.value.name}`;
        zipFiles.push(result.value); photos++;
      }
    }

    if (zipFiles.length) {
      const zip = createPhotoZip(zipFiles);
      const buffer = new ArrayBuffer(zip.byteLength); new Uint8Array(buffer).set(zip);
      saveBlob(new Blob([buffer], { type: 'application/zip' }), `프리패스_전체차량사진_${String(batch).padStart(2, '0')}-${String(batches).padStart(2, '0')}.zip`);
      archives++;
      // 다운로드 이벤트와 Blob 해제를 브라우저가 처리할 틈을 준다.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  onProgress?.({ batch: batches, batches, vehicles: products.length, totalVehicles: products.length });
  return { archives, vehicles, photos, noPhoto, failed };
}
