/**
 * 실데이터 dry-run — 아이카·오토플러스 시트의 상태 컬럼이 매핑되는지 +
 * canonSheetVehicleStatus / isSheetExcluded 적용 후 분포(출고불가 제외 대수).
 * 마스터 스냅 없이 상태 로직만 검증(동기화 대수 정합의 핵심).
 */
import { canonSheetVehicleStatus, isSheetExcluded } from '@/lib/domain/sheet-import';

const csvUrl = (id: string, gid?: string) =>
  `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ''}`;

function parse(t: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else { if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c; }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// 상태 컬럼 탐지 = 별칭(상태/판매상태/재고상태) 또는 헤더가 상태값 자체(아이카 "즉시출고")
const STATUS_ALIAS = /^(상태|판매상태|재고상태|즉시출고|출고가능|출고불가|출고협의|상품화중|계약중|배차중|배차대기|입고대기|판매중|할인판매|출고상태|차량상태|배차상태|출고현황)$/;

async function inspect(name: string, id: string, gid?: string, headerHint = 0) {
  const csv = await (await fetch(csvUrl(id, gid), { redirect: 'follow' })).text();
  const rows = parse(csv);
  // 헤더행 자동탐지: 상태 별칭이 있는 첫 행
  let hIdx = headerHint;
  for (let i = 0; i < Math.min(12, rows.length); i++) {
    if ((rows[i] || []).some((c) => STATUS_ALIAS.test(String(c || '').trim()))) { hIdx = i; break; }
  }
  const header = (rows[hIdx] || []).map((c) => String(c || '').trim());
  const statusCol = header.findIndex((h) => STATUS_ALIAS.test(h));
  console.log(`\n== ${name} (headerRow=${hIdx}) ==`);
  console.log('상태컬럼:', statusCol >= 0 ? `#${statusCol} "${header[statusCol]}"` : '✗ 없음(매핑 실패 위험)');
  if (statusCol < 0) { console.log('헤더:', header.slice(0, 14).join(' | ')); return; }

  const rawTally: Record<string, number> = {};
  const canonTally: Record<string, number> = {};
  let imported = 0, rented = 0;
  for (const r of rows.slice(hIdx + 1)) {
    const raw = String(r[statusCol] || '').trim();
    if (!r.some((c) => String(c || '').trim())) continue; // 빈행
    rawTally[raw || '(빈)'] = (rawTally[raw || '(빈)'] || 0) + 1;
    if (isSheetExcluded(raw)) { rented++; continue; }
    const canon = canonSheetVehicleStatus(raw);
    canonTally[canon] = (canonTally[canon] || 0) + 1;
    imported++;
  }
  console.log('원문 상태 분포:', Object.entries(rawTally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' · '));
  console.log('→ 유입 상태 분포:', Object.entries(canonTally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' · '));
  console.log(`→ 상품 유입 ${imported}대 · 출고불가 제외 ${rented}대`);
}

async function main() {
  await inspect('아이카', '1AVW2uFy94qLPV4TU-MsgYMIDLrfC6KZhfxVjoFw7sH0');
  await inspect('오토플러스 본탭', '1TJBG4PABgly7EtGG6Os5GcY9La7kDR_yex56KHhXe2U', '284963459');
}
main().catch((e) => { console.error(e); process.exit(1); });
