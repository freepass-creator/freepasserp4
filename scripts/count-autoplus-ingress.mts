/**
 * 오토플러스 시트 → 2탭 병합 dry-run + 재고(출고가능+보류) 집계.
 * Firebase write 없음. 목표: 재고 대수 99.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { parseDelimited, canonSheetVehicleStatus } from '../lib/domain/sheet-import';
import {
  AUTOPLUS_GID_MAIN,
  AUTOPLUS_GID_PROMO,
  countAutoplusStock,
  importAutoplusMerged,
} from '../lib/domain/sheet-autoplus';
import type { MasterEntry } from '../lib/domain/vehicle-master-match';

const SHEET_ID = '1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U';
const PROVIDER = 'RP023';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;

async function fetchCsv(_url: string, gid?: string): Promise<string[][]> {
  const g = gid || AUTOPLUS_GID_MAIN;
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${g}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`csv ${g} ${r.status}`);
  return parseDelimited(await r.text());
}

(async () => {
  const masterPath = resolve('public/data/vehicle-master.json');
  const masterJson = JSON.parse(readFileSync(masterPath, 'utf8'));
  const entries = (masterJson.entries || masterJson) as MasterEntry[];
  if (!entries?.length) throw new Error('master empty');

  const res = await importAutoplusMerged({
    url: SHEET_URL,
    providerCode: PROVIDER,
    entries,
    fetchTable: fetchCsv,
    headerRow: 0,
    // 2026-08-03: live Sheet와 2026-07-28 가격 108/108 snapshot 대조로
    // AutoPlus 운영 규칙이 국산×2·수입×3임을 확인했다.
    depositRule: 'rent_multiple',
  });

  const stock = countAutoplusStock(res.products);
  const contract = res.byStatus['계약중'] || 0;
  const avail = (res.byStatus['출고가능'] || 0) + (res.byStatus['즉시출고'] || 0);
  const blocked = res.byStatus['출고불가'] || 0;

  console.log('=== 오토플러스 2탭 병합 ===');
  console.log('main', res.mainN, '+ promoOnly', res.promoOnlyN, '=', res.imported);
  console.log('규격상태', res.byStatus);
  console.log('출고가능(+즉시)', avail, '· 보류→출고불가', blocked, '· 계약중', contract);
  console.log('재고 대수(출고가능+보류)', stock, stock === 99 ? '✓ 목표 99' : `⚠ 목표 99 · 실측 ${stock} (시트 변동 가능)`);
  console.log('가격 샘플', res.products.find((p) => p.price)?.price || '(없음)');
  const withPrice = res.products.filter((p) => p.price && typeof p.price === 'object').length;
  console.log('가격 수집', withPrice, '/', res.imported);
  console.log('snap', res.snap);

  const outDir = resolve('data/sheet-ingress');
  mkdirSync(outDir, { recursive: true });
  const snapshot = {
    at: new Date().toISOString(),
    provider: PROVIDER,
    sheetId: SHEET_ID,
    gids: { main: AUTOPLUS_GID_MAIN, promo: AUTOPLUS_GID_PROMO },
    stock,
    stockTarget: 99,
    stockOk: stock === 99,
    byStatus: res.byStatus,
    mainN: res.mainN,
    promoOnlyN: res.promoOnlyN,
    imported: res.imported,
    withPrice,
    snap: res.snap,
    products: res.products.map((p) => ({
      product_code: p.product_code,
      car_number: p.car_number,
      vehicle_status: p.vehicle_status,
      status_label_raw: p.status_label_raw || '',
      year: p.year,
      first_registration_date: p.first_registration_date,
      mileage: p.mileage,
      price: p.price,
      _snap_confidence: p._snap_confidence,
    })),
  };
  const outPath = resolve(outDir, 'RP023-autoplus.json');
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
  console.log('\nSNAPSHOT', outPath);
  console.log('canon', ['판매중', '할인판매', '보류', '계약중'].map((s) => `${s}→${canonSheetVehicleStatus(s)}`).join(' · '));

  // 게이트: 2탭 병합·가격 수집 필수. 재고 99는 실무 목표 — 시트 변동 시 경고만.
  if (withPrice < res.imported * 0.9) {
    console.error(`\nFAIL: 가격 수집 부족 ${withPrice}/${res.imported}`);
    process.exit(1);
  }
  if (res.imported < 90) {
    console.error(`\nFAIL: 병합 유입 이상 ${res.imported}`);
    process.exit(1);
  }
  if (stock !== 99) {
    console.warn(`\nWARN: 재고(출고가능+보류)=${stock}, 실무 목표 99 — 공식은 동일, 시트 원문 확인`);
  } else {
    console.log('\nPASS stock=99');
  }
  console.log('PASS merge+price');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
