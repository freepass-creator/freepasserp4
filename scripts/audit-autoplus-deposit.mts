/**
 * AutoPlus 보증금 규칙 read-only audit.
 *
 * Google Sheet를 두 후보 규칙으로 각각 파싱하고, 마지막으로 검증된 로컬
 * ingress snapshot과 차량번호/기간별 rent·deposit을 대조한다.
 * Firebase/Sheet write와 로컬 파일 write는 하지 않는다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDelimited, type DepositRule } from '../lib/domain/sheet-import';
import {
  AUTOPLUS_GID_MAIN,
  AUTOPLUS_GID_PROMO,
  importAutoplusMerged,
} from '../lib/domain/sheet-autoplus';
import type { MasterEntry } from '../lib/domain/vehicle-master-match';

type Price = Record<string, { rent: number; deposit: number }>;
type SnapshotProduct = { car_number?: string; price?: Price };
type Snapshot = { at?: string; imported?: number; withPrice?: number; products?: SnapshotProduct[] };

const SHEET_ID = '1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;

const plate = (value: unknown) => String(value ?? '').replace(/\s/g, '');
const priceOf = (value: unknown): Price => (
  value && typeof value === 'object' ? value as Price : {}
);

async function fetchCsv(
  _url: string,
  gid?: string,
  options: { visibleRowsOnly?: boolean } = {},
): Promise<string[][]> {
  if (options.visibleRowsOnly) throw new Error('CSV/gviz는 숨김 행을 포함하므로 오토플러스 감사에 사용할 수 없습니다');
  const activeGid = gid || AUTOPLUS_GID_MAIN;
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${activeGid}`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error(`AutoPlus CSV ${activeGid}: HTTP ${response.status}`);
  return parseDelimited(await response.text());
}

async function runRule(rule: Exclude<DepositRule, ''>, entries: MasterEntry[]) {
  return importAutoplusMerged({
    url: SHEET_URL,
    providerCode: 'RP023',
    entries,
    fetchTable: fetchCsv,
    headerRow: 0,
    depositRule: rule,
  });
}

function compareToSnapshot(
  products: Array<{ car_number?: unknown; price?: unknown }>,
  snapshot: Snapshot,
) {
  const oldByPlate = new Map(
    (snapshot.products || []).map((product) => [plate(product.car_number), product]),
  );
  let sharedVehicles = 0;
  let sharedPriceCells = 0;
  let sameRent = 0;
  let sameDeposit = 0;
  let samePair = 0;
  const mismatches: Array<Record<string, unknown>> = [];

  for (const product of products) {
    const normalizedPlate = plate(product.car_number);
    const old = oldByPlate.get(normalizedPlate);
    if (!old) continue;
    sharedVehicles++;
    const currentPrice = priceOf(product.price);
    const oldPrice = priceOf(old.price);
    for (const period of Object.keys(currentPrice)) {
      if (!oldPrice[period]) continue;
      sharedPriceCells++;
      const rentMatches = currentPrice[period].rent === oldPrice[period].rent;
      const depositMatches = currentPrice[period].deposit === oldPrice[period].deposit;
      if (rentMatches) sameRent++;
      if (depositMatches) sameDeposit++;
      if (rentMatches && depositMatches) samePair++;
      if ((!rentMatches || !depositMatches) && mismatches.length < 8) {
        mismatches.push({
          plate: normalizedPlate,
          period,
          old: oldPrice[period],
          current: currentPrice[period],
        });
      }
    }
  }
  return { sharedVehicles, sharedPriceCells, sameRent, sameDeposit, samePair, mismatches };
}

function depositRatios(products: Array<{ price?: unknown }>) {
  const ratios: Record<string, number> = {};
  let cells = 0;
  for (const product of products) {
    for (const item of Object.values(priceOf(product.price))) {
      if (!item.rent) continue;
      cells++;
      const ratio = item.deposit / item.rent;
      const key = Number.isInteger(ratio) ? `${ratio}x` : ratio.toFixed(3);
      ratios[key] = (ratios[key] || 0) + 1;
    }
  }
  return { cells, ratios };
}

(async () => {
  const masterJson = JSON.parse(readFileSync(resolve('public/data/vehicle-master.json'), 'utf8'));
  const entries = (masterJson.entries || masterJson) as MasterEntry[];
  const snapshot = JSON.parse(
    readFileSync(resolve('data/sheet-ingress/RP023-autoplus.json'), 'utf8'),
  ) as Snapshot;
  if (!entries.length) throw new Error('vehicle master is empty');

  const [rentMultiple, monthsPerYear] = await Promise.all([
    runRule('rent_multiple', entries),
    runRule('months_per_year', entries),
  ]);

  const rentMultiplePlates = new Set(rentMultiple.products.map((product) => plate(product.car_number)));
  const snapshotByPlate = new Map(
    (snapshot.products || []).map((product) => [plate(product.car_number), product]),
  );
  const unresolvedOriginVehicles = monthsPerYear.products
    .filter((product) => !rentMultiplePlates.has(plate(product.car_number)))
    .map((product) => {
      const rawVehicle = product._raw_vehicle && typeof product._raw_vehicle === 'object'
        ? product._raw_vehicle as Record<string, unknown>
        : {};
      const old = snapshotByPlate.get(plate(product.car_number));
      const historicalRatios = [...new Set(
        Object.values(priceOf(old?.price))
          .filter((item) => item.rent > 0)
          .map((item) => item.deposit / item.rent),
      )];
      return {
        plate: plate(product.car_number),
        maker: product.maker || '',
        model: product.model || '',
        rawMaker: rawVehicle.maker || '',
        rawModel: rawVehicle.model || '',
        snapConfidence: product._snap_confidence || '',
        historicalRatios,
      };
    });

  const summarize = (rule: string, result: typeof rentMultiple) => ({
    rule,
    imported: result.imported,
    main: result.mainN,
    promoOnly: result.promoOnlyN,
    excluded: result.excludedCount,
    noPrice: result.noPriceCount,
    blockingDuplicates: result.blockingDuplicateCount,
    issueSamples: result.issueSamples,
    ratios: depositRatios(result.products),
    historicalComparison: compareToSnapshot(result.products, snapshot),
  });

  console.log(JSON.stringify({
    mode: 'READ_ONLY',
    liveSheetId: SHEET_ID,
    historicalSnapshot: {
      at: snapshot.at,
      imported: snapshot.imported,
      withPrice: snapshot.withPrice,
    },
    unresolvedOriginVehicles,
    candidates: [
      summarize('rent_multiple', rentMultiple),
      summarize('months_per_year', monthsPerYear),
    ],
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
