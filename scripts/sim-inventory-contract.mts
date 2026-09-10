import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventoryCountSnapshot, isOpenInventoryAtom } from '../lib/domain/inventory-contract';
import { isStockedProduct } from '../lib/domain/product';
import type { EntityRecord } from '../lib/intake/entities';
import { captureSalesPublishSnapshot, readSalesPublishSnapshot, salesPublishMark } from '../lib/server/sales-publish-snapshot';
import { channelColumnName, salesPublishedColumns } from '../lib/domain/sales-published-tab-columns';
import { erpPhotoSource, isPickupPhotoAtom, isServerPhotoSource, photoProjectionViolations, photoProjectionWarnings, sheetPlateLink } from '../lib/domain/photo-projection';
import { productExternalImages, scrapableSources } from '../lib/domain/product-photos';
import { mergeRawPhotoEvidence, photoAtomFields } from '../lib/domain/photo-atom';

const rows = [
  { car_number: '테스트1', vehicle_status: '출고가능', status_kind: '가용', listable: true, provider_company_code: 'P1', source: 'sheet' },
  { car_number: '테스트2', vehicle_status: '계약중', status_kind: '선점', listable: true, provider_company_code: 'P1', source: 'sheet' },
  { car_number: '테스트3', vehicle_status: '출고협의', status_kind: '협의', listable: true, provider_company_code: 'P1', source: 'sheet' },
  { car_number: '테스트4', vehicle_status: '출고불가', status_kind: '불가', listable: false, provider_company_code: 'P1', source: 'sheet' },
  { car_number: '테스트5', vehicle_status: '', status_kind: '준비', listable: true, provider_company_code: 'P1', source: 'sheet' },
];
const snapshot = inventoryCountSnapshot(rows);
assert.deepEqual(
  { registered: snapshot.registered, unavailable: snapshot.unavailable, open: snapshot.open },
  { registered: 5, unavailable: 1, open: 4 },
);
assert.equal(snapshot.listableDrift, 0);
assert.equal(snapshot.statusKindDrift, 0);
assert.equal(snapshot.sourceIdentityViolations, 0);
assert.equal(snapshot.blankPlateViolations, 0);
assert.equal(snapshot.invalidPlateViolations, 5);
assert.equal(isOpenInventoryAtom({ vehicle_status: ' 출고 불가 ' }), false);
assert.equal(isOpenInventoryAtom({ vehicle_status: '계약중', listable: false }), true);
assert.equal(isStockedProduct({ vehicle_status: '계약중' } as EntityRecord), true);
assert.equal(isStockedProduct({ vehicle_status: '출고가능', price: {} } as EntityRecord), true);
assert.equal(isStockedProduct({ vehicle_status: '출고가능', _deleted: true } as EntityRecord), false);
assert.equal(inventoryCountSnapshot([{ vehicle_status: '출고가능', listable: false }]).listableDrift, 1);
assert.equal(inventoryCountSnapshot([{ vehicle_status: '출고가능', status_kind: '', listable: true, provider_company_code: 'P1', source: 'sheet' }]).statusKindDrift, 1);
assert.equal(inventoryCountSnapshot([{ vehicle_status: '출고가능', status_kind: '가용', listable: true }]).sourceIdentityViolations, 1);
assert.equal(inventoryCountSnapshot([{ vehicle_status: '출고불가', listable: false, _deleted: true }]).deletedMarkerViolations, 1);
assert.equal(inventoryCountSnapshot([{ vehicle_status: '출고가능', listable: true, _deleted: 'true' }]).deletedMarkerViolations, 1);
assert.equal(inventoryCountSnapshot([{ vehicle_status: '출고가능', listable: true, deletedAt: '2026-01-01' }]).deletedMarkerViolations, 1);
assert.equal(inventoryCountSnapshot([{ vehicle_status: '출고가능', listable: true, status: 'deleted' }]).deletedMarkerViolations, 1);
assert.equal(inventoryCountSnapshot([
  { car_number: '12가 3456', vehicle_status: '출고가능', listable: true },
  { car_number: '12가3456', vehicle_status: '출고불가', listable: false },
]).duplicatePlateViolations, 1);
assert.equal(inventoryCountSnapshot([{ car_number: '차량번호아님1', vehicle_status: '출고불가', listable: false }]).invalidPlateViolations, 1);
assert.equal(salesPublishedColumns('상품리스트').length, 69);
for (const tab of ['상품리스트', '손오공구독', '픽업구독', '오플구독']) {
  assert.ok(salesPublishedColumns(tab).includes('옵션(원문)'));
  assert.ok(salesPublishedColumns(tab).includes('세부모델'));
}
assert.equal(channelColumnName('반납형보증금'), '보증금 반납형');

const pickupPhoto = {
  provider_company_code: 'RP012', product_type: '픽업구독', sheet_source_tab: '픽업재고',
  photo_link: 'https://img-mycarsave.lotterentacar.net/car/first.jpg',
  tica_link: 'https://www.lotterentacar.net/tcar/detail/123',
};
assert.equal(isPickupPhotoAtom(pickupPhoto), true);
assert.equal(erpPhotoSource(pickupPhoto), pickupPhoto.photo_link, 'ERP는 실제 사진 원천만 받는다');
assert.equal(sheetPlateLink(pickupPhoto), pickupPhoto.tica_link, '픽업 시트는 T카 상세페이지로 간다');
assert.deepEqual(photoProjectionViolations(pickupPhoto), []);
const normalPhoto = {
  product_type: '중고렌트', sheet_source_tab: '상품리스트',
  photo_link: 'https://drive.google.com/drive/folders/folder-id',
  tica_link: 'https://www.lotterentacar.net/tcar/stale',
};
assert.equal(isPickupPhotoAtom(normalPhoto), false);
assert.equal(erpPhotoSource(normalPhoto), normalPhoto.photo_link);
assert.equal(sheetPlateLink(normalPhoto), normalPhoto.photo_link, '일반 시트는 검증된 사진 링크로 간다');
assert.deepEqual(photoProjectionViolations(normalPhoto), []);
assert.deepEqual(photoProjectionViolations({ provider_company_code: 'RP012', product_type: '픽업구독', photo_link: pickupPhoto.photo_link }), []);
assert.deepEqual(photoProjectionWarnings({ provider_company_code: 'RP012', product_type: '픽업구독', photo_link: pickupPhoto.photo_link }), ['픽업구독 T카 링크 누락']);
assert.deepEqual(photoProjectionViolations({ provider_company_code: 'RP012', product_type: '픽업구독', tica_link: normalPhoto.photo_link }), ['픽업구독 시트 링크가 T카가 아님']);
assert.equal(isPickupPhotoAtom({ provider_company_code: 'OTHER', product_type: '픽업구독' }), false);
assert.deepEqual(photoProjectionViolations({ product_type: '중고렌트', photo_link: 'https://autoplus.co.kr/car/1' }), []);
assert.deepEqual(photoProjectionViolations({ product_type: '중고렌트', photo_link: '주소아님' }), ['일반 재고 시트 링크 형식 오류', 'ERP에서 사진으로 해석할 수 없는 원천']);
assert.deepEqual(photoProjectionViolations({ product_type: '중고렌트', photo_link: 'https://example.com/detail/1' }), ['ERP에서 사진으로 해석할 수 없는 원천']);
assert.deepEqual(photoProjectionViolations({ product_type: '중고렌트', image_urls: ['https://example.com/detail/1'] }), ['ERP 직접 사진 필드가 이미지 주소가 아님']);
assert.equal(productExternalImages({ photo_link: 'https://www.googleapis.com/drive/v3/files/abc' } as EntityRecord).length, 0);
assert.deepEqual(productExternalImages({ photo_link: 'https://example.com/detail/1' } as EntityRecord), []);
assert.deepEqual(productExternalImages({ photo_link: 'https://cdn.autoplus.co.kr/car/1.jpg' } as EntityRecord), ['https://cdn.autoplus.co.kr/car/1.jpg']);
assert.deepEqual(scrapableSources({ photo_link: 'https://moderentcar.co.kr/car/1' } as EntityRecord), ['https://moderentcar.co.kr/car/1']);
assert.equal(isServerPhotoSource('https://example.com/detail?next=autoplus.co.kr'), false);
assert.equal(isServerPhotoSource('https://bit.ly/not-resolved'), false);
assert.equal(isServerPhotoSource('https://tinyurl.com/not-resolved'), false);
const allSourcePhotos = Array.from({ length: 23 }, (_, index) => `https://img.example.test/car/${index + 1}.jpg`);
const photoAtom = photoAtomFields([...allSourcePhotos, allSourcePhotos[0], 'not-a-url'], 1789008257806);
assert.deepEqual(photoAtom.image_urls, allSourcePhotos, '사진 원자는 10장으로 자르지 않고 원천 순서대로 전부 보존한다');
assert.equal(photoAtom.photo_collected_at, 1789008257806);
assert.match(String(photoAtom.photo_source_hash), /^[a-f0-9]{64}$/);
assert.deepEqual(photoAtomFields(['/api/file/preview?file_name=car.jpg'], 1789008257806, 'https://sokrc.com').image_urls, ['https://sokrc.com/api/file/preview?file_name=car.jpg']);
const oldRawPhotos = ['https://img.example.test/old/1.jpg'];
assert.deepEqual(mergeRawPhotoEvidence({ 차명: '원문차명', 사진: oldRawPhotos }, []), { 차명: '원문차명', 사진: oldRawPhotos });
assert.deepEqual(mergeRawPhotoEvidence({ 차명: '원문차명', 사진: oldRawPhotos }, allSourcePhotos).사진, allSourcePhotos);

const channelPublisher = readFileSync('scripts/build-channel-supplier-sheet.mts', 'utf8');
const photoLinkChecker = readFileSync('scripts/check-plate-photo-link.mts', 'utf8');
const sheetAtomAuditor = readFileSync('scripts/audit-sheet-vs-atom.mts', 'utf8');
assert.match(channelPublisher, /HAHUHO_PRODUCT_SHEET_ID/);
assert.match(photoLinkChecker, /HAHUHO_PRODUCT_SHEET_ID/);
assert.match(sheetAtomAuditor, /HAHUHO_PRODUCT_SHEET_ID/);
assert.doesNotMatch(photoLinkChecker, /files\s*\|\|\s*\[\]\)\[0\]/);

for (const file of [
  'scripts/make-sample-sheet-google.mts',
  'scripts/build-channel-supplier-sheet.mts',
  'scripts/check-sales-publish-context.mts',
  'scripts/audit-sheet-vs-atom.mts',
  'scripts/materialize-product-list-atom.mts',
]) {
  const source = readFileSync(file, 'utf8');
  assert.match(source, /isOpenInventoryAtom/);
  assert.doesNotMatch(source, /filter\(\(v\) => v\.listable === true\)/);
}
assert.match(readFileSync('scripts/audit-photo-projection.mts', 'utf8'), /photoProjectionViolations/);

const hourly = readFileSync('scripts/hourly-sync.mts', 'utf8');
const supplierIngest = readFileSync('scripts/ingest-supplier-to-firestore.mts', 'utf8');
const hourlyStringNormalizer = hourly.indexOf('const S =');
const hourlyFirstStringNormalizerUse = hourly.search(/[^A-Za-z0-9_$]S\(/);
assert.ok(
  hourlyStringNormalizer >= 0,
  '시간별 동기화의 환경값 정규화 함수 S 선언을 찾지 못했다',
);
assert.ok(
  hourlyFirstStringNormalizerUse >= 0 && hourlyStringNormalizer < hourlyFirstStringNormalizerUse,
  '시간별 동기화는 환경값 정규화 함수 S를 처음 사용하기 전에 선언해야 한다',
);
assert.match(hourly, /sales-publish-snapshots\/\$\{RUN_ID\}\.json/);
assert.match(hourly, /if \(!pub\.ok\) stop/);
assert.match(hourly, /if \(!ch\.ok\) stop/);
assert.match(hourly, /else stop\(parity\.picked/);
assert.match(hourly, /if \(!erp\.ok\) stop/);
assert.doesNotMatch(hourly, /mirror-to-firestore\.mts/);
assert.match(hourly, /RTDB 미러 제거/);
assert.match(hourly, /fill-intake-date\.mts/);
assert.match(hourly, /fix-atoms-from-refined-sheets\.mts'.*'--apply'/);
assert.doesNotMatch(hourly, /RTDB 기반 입고일자 보정 제거|RTDB 원자 치유 제거/);
assert.match(hourly, /heal-atom-provenance\.mts'.*'--apply'/);
assert.match(hourly, /audit-pipeline-destinations\.mts/);
assert.match(hourly, /check-plate-photo-link\.mts/);
assert.match(hourly, /audit-photo-projection\.mts'.*--snapshot=/);
assert.doesNotMatch(hourly, /손오공-구독사진-드라이브\.mjs/);
assert.doesNotMatch(readFileSync('sonokong/scripts/손오공-재고시트.mjs', 'utf8'), /사진들[^\n]*slice\(0,\s*10\)/);
assert.match(supplierIngest, /const photoMoved = !STATUS_ONLY/);
assert.doesNotMatch(supplierIngest.match(/const VAR_FIELDS_STATUS[^\n]+/)?.[0] || '', /image_urls|photo_collected_at|photo_source_hash|tica_link/);
assert.match(hourly, /publish-origin-tab\.mts'.*\.\.\.STAGE/);
const daily = readFileSync('scripts/run-daily.mts', 'utf8');
assert.match(daily, /publish-origin-tab\.mts'.*\.\.\.STAGE/);
assert.match(daily, /const LOCKDIR = 'tmp\/hourly-sync\.lock'/);
assert.match(daily, /if \(!acquireLock\(\)\) stop/);
assert.match(daily, /HEARTBEAT_STALE_MS/);
assert.match(daily, /renameSync\(LOCKDIR, stale\)/);
assert.match(daily, /heal-atom-provenance\.mts'.*'--apply'/);
assert.match(daily, /audit-pipeline-destinations\.mts/);
assert.match(daily, /check-plate-photo-link\.mts/);
assert.match(daily, /audit-photo-projection\.mts'.*--snapshot=/);
for (const workflow of ['.github/workflows/sheet-sync.yml', '.github/workflows/sales-erp-hourly.yml']) {
  assert.match(readFileSync(workflow, 'utf8'), /group: freepass-sales-publish/);
}
for (const file of ['scripts/publish-origin-tab.mts', 'scripts/publish-sonogong-tab.mts']) {
  assert.match(readFileSync(file, 'utf8'), /구형 .* 발행기는 운영 F01을 쓸 수 없다/);
}
const captureSource = readFileSync('scripts/capture-sales-publish-snapshot.mts', 'utf8');
assert.match(captureSource, /flag: 'wx'/);
assert.doesNotMatch(readFileSync('scripts/mirror-to-firestore.mts', 'utf8'), /검수상태 === '원문없음'\) doc\.listable = false/);
assert.match(readFileSync('scripts/heal-atom-status.mts', 'utf8'), /파생값 어긋남/);
const auditSource = readFileSync('scripts/audit-sheet-vs-atom.mts', 'utf8');
assert.match(auditSource, /const EQ = \(a: unknown, b: unknown\) => S\(a\) === S\(b\)/);
assert.match(auditSource, /valueRenderOption=UNFORMATTED_VALUE/);
assert.match(readFileSync('scripts/run-sheet-daily-sync-local.mts', 'utf8'), /APPLY && !sheetArg/);
assert.match(readFileSync('lib/server/sales-inventory-sheet.ts', 'utf8'), /process\.env\.SALES_INVENTORY_SHEET_ID/);
assert.match(auditSource, /title !== expectedTitle/);
assert.match(auditSource, /expectedTitles\.has\(title\)/);
assert.match(auditSource, /found\.company !== expectedCompany/);
assert.match(auditSource, /JSON\.stringify\(hdr\) !== JSON\.stringify\(expectedHeader\)/);
assert.match(auditSource, /f01OrderViolations/);
assert.match(auditSource, /f86OrderViolations/);
assert.match(auditSource, /f01BlankPlateRows/);
assert.match(auditSource, /f86BlankPlateRows/);
assert.match(auditSource, /핵심투영어긋남/);
assert.match(auditSource, /if \(!snapshotPath\) throw/);
assert.doesNotMatch(auditSource, /Number\.POSITIVE_INFINITY/);

const fakeCollections: Record<string, any[]> = {
  products: rows.map((data, index) => ({ id: `p${index + 1}`, data: () => data })),
  policy: [{ id: 'policy1', data: () => ({ name: '정책' }) }],
  partner: [{ id: 'partner1', data: () => ({ name: '공급사' }) }],
};
const fakeDb = {
  collection: (name: string) => ({ name }),
  runTransaction: async (fn: (tx: any) => Promise<any>) => fn({
    get: async (ref: { name: string }) => ({ docs: fakeCollections[ref.name] || [] }),
  }),
};
const captured = await captureSalesPublishSnapshot(fakeDb);
assert.equal(captured.inventory.open, 4);
assert.match(salesPublishMark(captured), /\d{2}\.\d{2} \d{2}:\d{2}:\d{2} · \d{17}-[0-9a-f]{12}/);
const dir = mkdtempSync(join(tmpdir(), 'sales-publish-sim-'));
const path = join(dir, 'snapshot.json');
try {
  writeFileSync(path, JSON.stringify(captured), 'utf8');
  assert.equal(readSalesPublishSnapshot(path).payloadHash, captured.payloadHash);
  const tampered = { ...captured, products: [...captured.products, { _key: 'tampered' }] };
  writeFileSync(path, JSON.stringify(tampered), 'utf8');
  assert.throws(() => readSalesPublishSnapshot(path), /해시 불일치/);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('✓ 재고 계약: 등록 원자 - 출고불가, 계약중·가격미입력 포함, 파생값 드리프트 탐지');
