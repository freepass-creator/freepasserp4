/**
 * 오토플러스 판매차량리스트: 시트 원본 차번 vs import 결과 — 빠진 2대 추적.
 */
import { SHEET_ADAPTERS } from '../lib/domain/sheet-adapters';
import { importSheetTable, parseDelimited, autoMapHeaders } from '../lib/domain/sheet-import';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { MasterEntry } from '../lib/domain/vehicle-master-match';

const SHEET_ID = '1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U';
const GID = '284963459';
const PROVIDER = 'RP023';

function plate(s: unknown) {
  const t = String(s ?? '').replace(/\s/g, '');
  return /^\d{2,3}[가-힣]\d{4}$/.test(t) || /^[가-힣]{2}\d{2}[가-힣]\d{4}$/.test(t) ? t : '';
}

(async () => {
  const csv = await (await fetch(
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}`,
  )).text();
  const raw = parseDelimited(csv);
  let hi = 0;
  for (let i = 0; i < Math.min(20, raw.length); i++) {
    if ((raw[i] || []).some((c) => /차량번호|차번/.test(String(c)))) { hi = i; break; }
  }
  const prepared = SHEET_ADAPTERS.generic.prepareTable(raw, { headerRow: hi });
  const headers = prepared[0] || [];
  const mapping = autoMapHeaders(headers);
  const pi = mapping.car_number;
  console.log('headerRow', hi, 'plateCol', pi, 'headers', headers.filter(Boolean).slice(0, 12));

  // 원본 데이터행 전수
  type RowInfo = { row: number; plate: string; status: string; cells: string[] };
  const sheetRows: RowInfo[] = [];
  const plateOrder: string[] = [];
  const dupPlates: string[] = [];
  const seen = new Set<string>();
  const si = mapping.vehicle_status;
  for (let i = 1; i < prepared.length; i++) {
    const cells = prepared[i] || [];
    const p = plate(pi != null ? cells[pi] : '');
    const st = si != null ? String(cells[si] || '').trim() : '';
    if (!p) {
      // 차번 칸 비었지만 다른 칸에 차번?
      const alt = cells.map(plate).find(Boolean) || '';
      if (alt) console.log('ALT-PLATE row', i + hi, 'col-elsewhere', alt, cells.slice(0, 8).join('|'));
      else if (cells.some((c) => String(c).trim())) {
        console.log('NO-PLATE row', i + hi, cells.slice(0, 10).join(' | '));
      }
      continue;
    }
    sheetRows.push({ row: i + hi, plate: p, status: st, cells });
    if (seen.has(p)) dupPlates.push(p);
    else { seen.add(p); plateOrder.push(p); }
  }
  console.log('\n시트 차번행', sheetRows.length, '유일', seen.size, '중복표기', dupPlates.length, dupPlates);

  const master = JSON.parse(readFileSync(resolve('public/data/vehicle-master.json'), 'utf8'));
  const entries = (master.entries || master) as MasterEntry[];
  const res = importSheetTable(prepared, { providerCode: PROVIDER, entries });
  console.log('import imported', res.imported, 'skipped', res.skipped, 'totalDataRows', res.total);

  const imported = new Set(res.products.map((p) => String(p.car_number).replace(/\s/g, '')));
  const missing = plateOrder.filter((p) => !imported.has(p));
  const extra = [...imported].filter((p) => !seen.has(p));
  console.log('\n시트유일 - import =', seen.size - imported.size);
  console.log('시트에만 있음(import 누락)', missing);
  console.log('import에만 있음(임시번호 등)', extra);

  // 100 가설들
  console.log('\n--- 100대 가설 ---');
  console.log('유일차번', seen.size);
  console.log('차번행(중복포함)', sheetRows.length);
  console.log('import', res.imported);
  console.log('출고가능(canon)', res.products.filter((p) => p.vehicle_status === '출고가능' || p.vehicle_status === '즉시출고').length);
  console.log('!출고불가', res.products.filter((p) => p.vehicle_status !== '출고불가').length);
  console.log('판매중+할인판매 원문', sheetRows.filter((r) => /판매중|할인판매/.test(r.status)).length);
  console.log('원문 비보류', sheetRows.filter((r) => !/^보류/.test(r.status)).length);
  console.log('유일 + 중복건수', seen.size + dupPlates.length);

  // 상태별 유일
  const bySt = new Map<string, number>();
  for (const p of seen) {
    const st = sheetRows.find((r) => r.plate === p)?.status || '(빈)';
    bySt.set(st, (bySt.get(st) || 0) + 1);
  }
  console.log('유일×상태', Object.fromEntries(bySt));

  // skipped 원인: 동일 차번 재등장
  if (dupPlates.length) {
    for (const d of [...new Set(dupPlates)]) {
      const hits = sheetRows.filter((r) => r.plate === d);
      console.log('DUP', d, hits.map((h) => `row${h.row}:${h.status}`).join(', '));
    }
  }

  // 프로모 12 + 메인 ?
  const promoCsv = await (await fetch(
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=2018553731`,
  )).text();
  const promoRaw = parseDelimited(promoCsv);
  const promoPlates = new Set<string>();
  for (const r of promoRaw) {
    const p = plate(r[1]);
    if (p) promoPlates.add(p);
  }
  let promoOnly = 0;
  for (const p of promoPlates) if (!seen.has(p)) promoOnly++;
  console.log('\n프로모 유일', promoPlates.size, '메인외', promoOnly);
  console.log('메인유일+프로모만', seen.size + promoOnly);
  console.log('import+프로모만', res.imported + promoOnly);
})().catch((e) => { console.error(e); process.exit(1); });
