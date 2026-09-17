/** 이안카 재고 전량 덤프 → lib/wonja/이안카차량.json (정본).
 *
 *  이 API가 정본이다 — 시트를 사람이 손으로 채우던 걸 걷어내려는 첫 걸음(사장님 2026-09-17
 *  「다음에 동기화될 땐 반영이 돼야 되고 … 로직 엔진에 들어와서 세는 게 돼야 돼」).
 *
 *  ⚠ 기간별 요금(1~60개월)·보증금 API는 아직 못 찾았다(ianka.mjs 머리말 참고) — 이 덤프는
 *  차번·상태·제원만 준다. 요금·보증금은 여기서 지어내지 않는다(빈 채로 둔다).
 *
 *    node scripts/이안카.mjs            전량 갱신 + 요약
 *    node scripts/이안카.mjs --조용      파일만
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pullAll } from '../lib/ianka.mjs';

const 루트 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const 출력 = path.join(루트, 'lib', 'wonja', '이안카차량.json');
const 조용 = process.argv.includes('--조용');

/** API status → 우리 배차상태. 모르는 값은 절대 「출고가능」으로 짐작하지 않고 출고불가로 내린다. */
function 배차상태(status) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'available') return '출고가능';
  if (s === 'merchandising') return '출고협의'; // 상품화중 — 아직 못 파는 상태
  return '출고불가';
}

function 정규화(unit, modelName) {
  return {
    차번: unit.plate,
    차량ID: unit.vehicleNo,
    차명원문: unit.name || modelName,
    연식: unit.year != null ? String(unit.year) : '',
    연료: unit.fuel || '',
    외장: unit.color || '',
    주행거리: unit.mileage != null ? Number(unit.mileage) : null,
    상태원문: unit.status,
    배차상태: 배차상태(unit.status),
    소속: unit.affiliation || '',
    배차지: unit.dispatchLocation || '',
    사진: unit.thumbnail || null,
  };
}

async function main() {
  const inv = await pullAll();
  const 차량 = [];
  for (const model of inv.models || []) {
    for (const unit of model.units || []) 차량.push(정규화(unit, model.name));
  }
  const 예약중 = (inv.reservedVehicles || []).map((r) => ({ 차번: r.plate, 차량ID: r.vehicleNo, 차명원문: r.name, 예약시각: r.reservedAt }));

  const out = {
    갱신: new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 19).replace('T', ' '),
    출처: 'xn--le5bt3bwxk.com /api/inventory',
    최상위집계: { total: inv.total, fleetTotal: inv.fleetTotal, reservedTotal: inv.reservedTotal, stale: inv.stale, syncedAt: inv.syncedAt, source: inv.source },
    집계: { 계: 차량.length, 출고가능: 차량.filter((c) => c.배차상태 === '출고가능').length, 예약중: 예약중.length },
    차량,
    예약중,
  };
  fs.mkdirSync(path.dirname(출력), { recursive: true });
  fs.writeFileSync(출력, JSON.stringify(out, null, 2));

  if (!조용) {
    console.log(`✅ 총 ${차량.length}대(출고가능 ${out.집계.출고가능}대) + 예약중 ${예약중.length}대 → ${출력}`);
    console.log(`   최상위 total=${inv.total} · fleetTotal=${inv.fleetTotal} · reservedTotal=${inv.reservedTotal}`);
    if (inv.total !== 차량.length) {
      console.log(`   ⚠ total(${inv.total})과 실제 units 합계(${차량.length})가 다르다 — API 응답 구조가 바뀌었는지 확인.`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('실패:', e.message); process.exit(1); });
}
