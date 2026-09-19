import { readFileSync } from 'node:fs';
import { photoAtomFields } from '../lib/domain/photo-atom';
import { sanitizeProductForGuest } from '../lib/domain/public-catalog';
import { productImages } from '../lib/domain/product-photos';

const urls=Array.from({length:37},(_,i)=>`https://cdn.autoplus.co.kr/PRODUCT/TEST/photo-${String(i+1).padStart(2,'0')}.jpg`);
const atom=photoAtomFields(urls,Date.now()) as {image_urls?:string[]};
if(!Array.isArray(atom.image_urls)||atom.image_urls.length!==urls.length) throw new Error(`photoAtomFields truncated: ${atom.image_urls?.length}/${urls.length}`);

const guest=sanitizeProductForGuest('TEST',{product_code:'TEST',car_number:'12가3456',vehicle_status:'출고가능',listable:true,image_urls:urls} as never,null) as Record<string,unknown>;
const guestUrls=guest.image_urls as string[]|undefined;
if(!Array.isArray(guestUrls)||guestUrls.length!==urls.length) throw new Error(`guest detail truncated: ${guestUrls?.length}/${urls.length}`);

const ui=productImages({image_urls:urls} as never);
if(ui.length!==urls.length) throw new Error(`detail gallery truncated: ${ui.length}/${urls.length}`);

const collector=readFileSync('scripts/ingest-supplier-to-firestore.mts','utf8');
for(const needle of ["photo: find(aliasOf('사진링크'))","photo_link: S(row.photoLink)"]) {
  if(!collector.includes(needle)) throw new Error(`generic supplier photo ingestion missing: ${needle}`);
}
const reborn=readFileSync('scripts/ingest-reborncar-to-firestore.mts','utf8');
for(const needle of ['getCarImageList.rb','photoAtomFields(imageUrls','patch.image_urls']) {
  if(!reborn.includes(needle)) throw new Error(`reborncar full gallery ingestion missing: ${needle}`);
}
const cache=readFileSync('scripts/cache-photo-urls.mts','utf8');
if(/urls\.slice\(\s*0\s*,\s*12\s*\)/.test(cache)) throw new Error('photo cache still truncates to 12');
console.log(`✓ 사진 전량 보존 계약 PASS — 원자/손님상세/UI ${urls.length}장 유지 · 일반시트 사진링크 · 오토플러스 gallery API · 캐시 장수제한 없음`);
