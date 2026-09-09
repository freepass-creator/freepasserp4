/**
 * 원자 «상태 한 벌» — 한 곳에서만 판정한다 (SSOT).
 *
 * ★사장님 「한 곳으로 들어와 한 곳에서 나간다」 · Codex 2026-09-09 #1 위험:
 *   상태(출고불가·계약중·노출)가 «수집기마다 다르게» 계산되면, 실행 경로에 따라 판 차가 다시 서거나
 *   팔 차가 숨는다. 그래서 mirror·ingest·heal 이 «이 함수»만 쓴다 — 규칙이 세 곳에 흩어지지 않게.
 *
 * ★상태는 «한 벌»이다 — `vehicle_status` 가 정본이고 status·status_kind·status_reason·listable 은 거기서 파생.
 *   두 값을 다르게 들면(직접수집이 status 만 쓰던 2026-09-08 사고) 판매시트·문지기는 vehicle_status 를,
 *   ERP 일부는 status 를 읽어 어긋난다. 규칙 SSOT = `docs/원자-내려보내기-로직.md` §1.
 *
 * ★두 사실을 «섞지 않는다» — 공급사 가용상태(원천 raw)와 ERP 계약잠금(locked)은 다른 사실이다.
 *   여기서 «최종 노출상태»만 계산한다. 잠금 자체의 정본 쓰기는 `syncVehicleLock` 한 곳이다.
 */

const S = (v: unknown) => String(v ?? '').trim();

/** 「팔 수 있음」으로 치는 원천 표기 — 출고불가로 내려앉았는데 원천이 이거였으면 «시트이탈». */
export const AVAIL_STATUSES = new Set(['즉시출고', '출고가능']);

export type StatusBundle = {
  status: string;
  vehicle_status: string;
  status_kind: string;      // 가용 · 협의 · 준비 · 선점 · 불가
  status_reason: string;
  listable: boolean;        // 불가가 아니면 목록에 선다
  status_label_raw: string;
};

/**
 * 상태 한 벌을 판정한다.
 * @param base   현재 정본 상태(mirror=vehicle_status · ingest=canonSheetVehicleStatus(raw) · heal=골라낸 상태). 비면 「차량검수」.
 * @param raw    원천 표기(status_label_raw). 「계약중」·「점검」 override 와 「출고불가」 이유 판정에 쓴다.
 * @param locked 계약잠금(locked_by_contract). 계약중일 때 «계약선점 vs 공급사표기»를 가른다.
 */
export function resolveStatus(input: { base?: unknown; raw?: unknown; locked?: unknown }): StatusBundle {
  const raw = S(input.raw);
  let cur = S(input.base) || '차량검수';
  // 원천이 계약중/점검을 말하면 그게 이긴다(출고불가로 접힌 것을 되살리지 않되, 계약중·검수는 살린다 — 사장님 2026-09-04).
  if (/계약중/.test(raw)) cur = '계약중';
  else if (/점검|검수|정비/.test(raw)) cur = '차량검수';
  let kind = '불가', reason = '';
  if (cur === '즉시출고' || cur === '출고가능') kind = '가용';
  else if (cur === '출고협의') { kind = '협의'; reason = '공급사협의'; }
  else if (cur === '상품화중') { kind = '준비'; reason = '상품화중'; }
  else if (cur === '차량검수') { kind = '준비'; reason = '검수대기'; }
  else if (cur === '계약중') { kind = '선점'; reason = S(input.locked) ? '계약선점' : '공급사표기'; }
  else if (cur === '출고불가') { kind = '불가'; reason = (AVAIL_STATUSES.has(raw) || raw === '출고협의') ? '시트이탈' : (raw ? '공급사불가' : '정보없음'); }
  return { status: cur, vehicle_status: cur, status_kind: kind, status_reason: reason, listable: kind !== '불가', status_label_raw: raw };
}
