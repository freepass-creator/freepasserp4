/**
 * 전 공급사 시트 → 가용(available) 상품 대수 실측.
 * "상품" = 실제 빌릴 수 있는 차만. 배차중/운행중/렌트중/보류/계약/출고불가 = 제외.
 * 오토플러스는 2탭(main + 전기차 프로모션) 병합.
 */
const HUB = '1TVeVXyJJRx0SzD2vxqy3eEjSojmMIWXSu7AdsKmpfmY';
const csvUrl = (id: string, gid?: string) => `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ''}`;
const sheetId = (url: string) => url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1] || '';

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
const PLATE = /^\d{2,3}[가-힣][0-9A-Za-z]{4}$/;
// 상품 리스트 제외 = 물리적으로 나간 차만(배차중/운행중/렌트중/판매완료/반납/폐차).
// 포함(각 상태로 리스트 노출): 출고가능·보류·배차대기(→출고협의)·계약중·출고불가.
const RENTED = /배차중|운행중|렌트중|대여중|판매완료|반납|폐차|말소/;

async function fetchCsv(url: string): Promise<string> {
  const r = await fetch(url, { redirect: 'follow' });
  return r.ok ? await r.text() : '';
}

// 시트 → { total 고유차, available 가용 }
function count(csv: string): { total: number; avail: number } {
  const rows = parse(csv);
  const seen = new Set<string>(); let avail = 0;
  for (const r of rows) {
    let plate = '', pi = -1;
    for (let c = 0; c < Math.min(r.length, 6); c++) { const v = String(r[c] || '').trim(); if (PLATE.test(v)) { plate = v; pi = c; break; } }
    if (!plate || seen.has(plate)) continue;
    seen.add(plate);
    // 가용 = 상태셀(번호판 주변 0~13열)에 렌트/불가 마커 없음
    const scan = r.slice(0, Math.max(pi + 12, 13)).join(' ');
    if (!RENTED.test(scan)) avail++;
  }
  return { total: seen.size, avail };
}

async function main() {
  const hub = parse(await fetchCsv(csvUrl(HUB)));
  const suppliers = hub.slice(1).filter((r) => r[2]).map((r) => ({ name: r[0], code: r[1], id: sheetId(r[2]) }));
  console.log('공급사'.padEnd(14), '코드'.padEnd(9), '고유차', '가용');
  let sumTotal = 0, sumAvail = 0;
  for (const s of suppliers) {
    let total = 0, avail = 0;
    // 오토플러스는 main 판매차량리스트 gid 명시 + 전기차 프로모션 2탭 병합
    const mainGid = s.code === 'RP023' ? '284963459' : undefined;
    const main = count(await fetchCsv(csvUrl(s.id, mainGid)));
    total += main.total; avail += main.avail;
    if (s.code === 'RP023') {
      const promo = count(await fetchCsv(csvUrl(s.id, '2018553731')));
      total += promo.total; avail += promo.avail;
    }
    sumTotal += total; sumAvail += avail;
    console.log(String(s.name).padEnd(12), String(s.code).padEnd(9), String(total).padStart(5), String(avail).padStart(5));
  }
  console.log('─'.repeat(46));
  console.log('합계'.padEnd(24), String(sumTotal).padStart(5), String(sumAvail).padStart(5));
  console.log(`\n→ 전 공급사 고유차량 ${sumTotal}대 · 가용(배차중·렌트·보류·계약 제외) ${sumAvail}대`);
}
main().catch((e) => { console.error(e); process.exit(1); });
