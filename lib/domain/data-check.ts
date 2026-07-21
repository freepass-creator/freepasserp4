/**
 * data-check — 매물 데이터 자동 이상감지. 상시 품질점검(사진없음·중복·모순·노후·폐차급 등).
 *   쓰기 없음(읽기 스캔). 새 시트 취합 시마다 재점검 → 쓰레기 데이터 유입 즉시 포착.
 */
import { type EntityRecord } from '@/lib/intake/entities';
import { EXT_COLORS } from '@/lib/domain/color-master';
import { hasDepositClaim } from '@/lib/domain/contract';

export type CheckHit = { car: string; code: string; note?: string };
export type CheckGroup = { key: string; label: string; severity: 'high' | 'mid' | 'low'; hint: string; hits: CheckHit[] };

const GARBAGE_MAKER = new Set(['개인/사업자', '제조사', '']);
const COLORS = new Set<string>(EXT_COLORS);
const driveFolder = (u: unknown): string => { const m = /\/folders\/([a-zA-Z0-9_-]+)/.exec(String(u ?? '')); return m ? m[1] : ''; };
const parseYear = (v: EntityRecord): number => { const m = /(\d{2,4})/.exec(String(v.year ?? v.first_registration_date ?? '')); if (!m) return 0; const n = Number(m[1]); return n > 1900 ? n : n < 50 ? 2000 + n : 1900 + n; };
const parseKm = (v: unknown): number => { const n = Number(String(v ?? '').replace(/[^\d]/g, '')); return Number.isFinite(n) ? n : 0; };
const hasPhoto = (p: EntityRecord): boolean => !!(p.image_urls || p.photos || p.photo || p.image_url || String(p.photo_link ?? '').trim());

/** 전 매물 스캔 → 이상 그룹 목록(심각도·건수 순). entries 없이도 데이터 무결성 검사. */
export function checkInventory(products: EntityRecord[]): CheckGroup[] {
  const carCount = new Map<string, number>();
  const folderCars = new Map<string, Set<string>>();
  for (const p of products) {
    const car = String(p.car_number ?? '').trim();
    if (car) carCount.set(car, (carCount.get(car) || 0) + 1);
    const f = driveFolder(p.photo_link);
    if (f) { let s = folderCars.get(f); if (!s) { s = new Set(); folderCars.set(f, s); } s.add(car); }
  }
  const sharedFolders = new Set([...folderCars].filter(([, s]) => s.size > 1).map(([f]) => f));
  const nowYear = new Date().getFullYear();

  const G: Record<string, CheckGroup> = {};
  const add = (key: string, label: string, severity: CheckGroup['severity'], hint: string, hit: CheckHit) => {
    (G[key] ||= { key, label, severity, hint, hits: [] }).hits.push(hit);
  };
  for (const p of products) {
    const car = String(p.car_number ?? '').trim();
    const code = String(p.product_code ?? p._key ?? '');
    const hit = (note?: string): CheckHit => ({ car: car || '(차번없음)', code, note });
    if (!car) add('no_car', '차량번호 없음', 'high', '식별 불가 — 확인 필요', hit());
    else if ((carCount.get(car) || 0) > 1) add('dup_car', '차번 중복 (같은 차 여러 줄)', 'high', '어느 줄이 최신인지 골라 나머지 삭제', hit());
    if (GARBAGE_MAKER.has(String(p.maker ?? '').trim())) add('bad_maker', '제조사 이상 (개인/사업자 등)', 'high', '오입력 — 실제 제조사로 수정', hit(String(p.maker)));
    const md = String(p.model ?? '').trim();
    if (COLORS.has(md) || /^\d{2,3}[가-힣]\d{3,4}$/.test(md)) add('bad_model', '모델칸에 색상/차번 (오입력)', 'high', '세부모델에 실모델 있으면 매칭됨', hit(md));
    if (!hasPhoto(p)) add('no_photo', '사진 없음', 'mid', '공급사에 사진 요청', hit());
    else {
      const pl = String(p.photo_link ?? '');
      if (/drive\.google\.com\/open\b/.test(pl) && !driveFolder(pl) && !/[?&]id=/.test(pl)) add('broken_photo', '사진 링크 깨짐 (폴더ID 없음)', 'mid', 'v3에서 폴더 다시 링크', hit());
      else if (sharedFolders.has(driveFolder(pl))) add('shared_photo', '사진 폴더 공유 (뒤섞임 위험)', 'mid', '엉뚱한 차 사진일 수 있음 — 폴더 분리', hit());
    }
    const pr = p.price;
    if (!(pr && typeof pr === 'object' && Object.keys(pr).length)) add('no_price', '대여료 없음', 'mid', '가격 입력 or 손님화면 숨김', hit());
    const km = parseKm(p.mileage);
    if (km >= 150000) add('high_km', '초과주행 (15만km↑)', 'low', '폐차급 후보 — 확인', hit(`${Math.round(km / 10000)}만km`));
    const y = parseYear(p);
    if (y && nowYear - y >= 9) add('old', '노후 (9년↑, 곧 취급중단)', 'low', '10년 되면 자동 제외', hit(`${y}년식`));
  }
  const sevRank = { high: 0, mid: 1, low: 2 };
  return Object.values(G).sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.hits.length - a.hits.length);
}

/**
 * 차량 잠금 정합성 — 매물의 vehicle_status 와 실제 계약 상태가 어긋난 건을 찾는다. **읽기 전용.**
 *
 * 왜 필요한가: 잠금 규칙이 "계약 진행 = 출고불가"에서 "계약금 입금 선점 = 계약중"으로 바뀌었다.
 * 옛 규칙으로 출고불가가 박힌 매물은 새 규칙에선 잠글 이유가 없는데도 카탈로그에서 영구히 사라진다.
 * 다만 출고불가는 공급사가 수기로도 거는 값이라 자동 복구가 불가능하다 — 그래서 "찾아서 보여주기"까지만 한다.
 */
export function checkVehicleLocks(products: EntityRecord[], contracts: EntityRecord[]): CheckGroup[] {
  const byProduct = new Map<string, EntityRecord[]>();
  for (const c of contracts) {
    const pc = String(c.product_code ?? '').trim();
    if (!pc || c._deleted === true || String(c.contract_status ?? '') === '계약취소') continue;
    let arr = byProduct.get(pc); if (!arr) { arr = []; byProduct.set(pc, arr); }
    arr.push(c);
  }

  const G: Record<string, CheckGroup> = {};
  const add = (key: string, label: string, severity: CheckGroup['severity'], hint: string, hit: CheckHit) => {
    (G[key] ||= { key, label, severity, hint, hits: [] }).hits.push(hit);
  };

  for (const p of products) {
    const code = String(p.product_code ?? p._key ?? '');
    const car = String(p.car_number ?? '').trim() || '(차번없음)';
    const st = String(p.vehicle_status ?? '').trim();
    const owner = String(p.locked_by_contract ?? '').trim();
    const cts = byProduct.get(code) || [];
    const completed = cts.find((c) => String(c.contract_status ?? '') === '계약완료');
    const claimed = cts.find((c) => hasDepositClaim(c));
    const shouldBe = completed ? '출고불가' : claimed ? '계약중' : '';
    const shouldOwner = String((completed || claimed)?.contract_code ?? '');

    if (st === '출고불가' && !completed) {
      add('stale_block', '출고불가인데 완료 계약 없음', 'high',
        '옛 규칙 잔재일 수 있음 — 손님 화면에서 영구히 사라진 상태. 공급사 수기 설정과 구분 안 되니 확인 후 수동 해제',
        { car, code, note: claimed ? '입금선점만 있음 → 계약중이 맞음' : '계약 없음' });
    }
    if (st === '계약중' && !claimed && !completed) {
      add('orphan_claim', '계약중인데 선점 계약 없음', 'high',
        '해제 누락 잔재 — 재고가 묶여 있음. 매물 편집에서 출고가능으로 되돌리면 됨', { car, code });
    }
    if (shouldBe && st !== shouldBe && st !== '출고불가') {
      add('missing_lock', '잠겨야 하는데 안 잠김', 'high',
        `계약이 ${shouldBe} 상태인데 매물은 "${st || '(빈값)'}" — 이중판매 위험`, { car, code, note: shouldOwner });
    }
    if (shouldBe && owner && owner !== shouldOwner) {
      add('owner_mismatch', '잠금 주인 불일치', 'mid',
        '매물에 각인된 계약과 실제 잠근 계약이 다름 — 재선점이 막힐 수 있음', { car, code, note: `각인 ${owner} ≠ 실제 ${shouldOwner}` });
    }
    if (shouldBe && !owner) {
      add('no_owner', '잠금 주인 미각인 (구데이터)', 'low',
        '소유필드 도입 이전 잠금 — 해당 계약에서 체크를 한 번 갱신하면 자동으로 각인됨', { car, code, note: shouldOwner });
    }
  }

  const sevRank = { high: 0, mid: 1, low: 2 };
  return Object.values(G).sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.hits.length - a.hits.length);
}
