/**
 * 번호미정 신차 임시번호 — `100신0001` 순번 부여 + **부여 결과 영구 보관**.
 *
 * 왜 저장해야 하나:
 *  번호가 아직 없는 신차는 시트에 "미정"으로 여러 줄 들어온다(실측 우리캐피탈 RP020:
 *  그랑 콜레오스 아이코닉 10대 — 색상·출고월만 다른 3그룹). 이 줄들에 번호를 붙여야
 *  매물이 되는데, **행 위치나 행 내용으로 번호를 만들면 안 된다.**
 *   · 행 위치 기반(erp3 `100신{absRow}`) — 위에서 한 줄만 지워도 아래 전부가 밀려
 *     이미 계약이 걸린 매물이 다른 실물 차로 조용히 바뀐다.
 *   · 행 내용 해시 — 시트에서 셀 하나만 고쳐도 번호가 바뀐다. 옛 레코드는 계약중으로 남고
 *     같은 차가 출고가능으로 하나 더 생긴다(트윈 중복판매).
 *  그래서 **한 번 부여한 번호는 partner 레코드에 적어두고 다음 동기화 때 그대로 재사용한다.**
 *  스펙이 같은 차가 늘면 뒤에 새 번호만 더 뽑고, 줄면 남는 번호는 안 쓴다
 *  (그 매물은 시트에 없으니 평소대로 부재처리 대상이 된다).
 *
 * 저장 형태(partner 레코드):
 *   pending_plates: { "<스펙서명>": ["100신0001","100신0002", …] }
 *   pending_plate_seq: 12          // 그 공급사가 지금까지 쓴 마지막 순번
 */
import { type EntityRecord } from '@/lib/intake/entities';

export type PendingPlateMap = Record<string, string[]>;

const S = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');

/**
 * 스펙 서명 — "같은 차로 볼 것인가"의 기준.
 * 색상·출고예정월까지 넣는다. 우리캐피탈 10대가 색상(클라우드펄/메탈릭블랙)과
 * 출고월(26-07-31 / 26-08-)로 3그룹이라, 이걸 빼면 서로 다른 차가 한 덩어리가 된다.
 */
export function pendingSignature(rec: EntityRecord): string {
  return [
    S(rec.maker), S(rec.model), S(rec.sub_model), S(rec.trim_name),
    S(rec.ext_color), S(rec.int_color),
    S(rec.first_registration_date) || S(rec.year),
    S(rec.fuel_type),
  ].join('|').toLowerCase();
}

/** 저장 레코드의 최초 원문을 우선해 임시번호 서명을 복원한다(구버전 _pending_signature 백필용). */
export function storedPendingSignature(rec: EntityRecord): string {
  const saved = String(rec._pending_signature ?? '').trim();
  if (saved) return saved;
  const raw = rec._raw_vehicle && typeof rec._raw_vehicle === 'object'
    ? rec._raw_vehicle as EntityRecord
    : null;
  return pendingSignature(raw ? { ...rec, ...raw } : rec);
}

const fmt = (n: number) => `100신${String(n).padStart(4, '0')}`;

export type PlateAllocator = {
  /** sig 의 idx 번째(0-based) 차에 줄 임시번호. 이미 준 게 있으면 그대로. */
  assign: (sig: string, idx: number) => string;
  /** 이번에 새로 뽑은 게 있으면 true — 있을 때만 partner 를 갱신한다. */
  dirty: () => boolean;
  /** 저장할 값 */
  snapshot: () => { pending_plates: PendingPlateMap; pending_plate_seq: number };
};

/** 저장된 부여기록 위에서 동작하는 할당기. 기록에 없으면 seq 를 올려 새로 뽑는다. */
export function createPlateAllocator(
  saved: PendingPlateMap | undefined,
  savedSeq: number,
): PlateAllocator {
  if (saved != null && (typeof saved !== 'object' || Array.isArray(saved))) {
    throw new Error('번호미정 부여기록 형식 오류');
  }
  const map: PendingPlateMap = {};
  const allocated = new Set<string>();
  for (const [k, v] of Object.entries(saved || {})) {
    if (!k.trim() || !Array.isArray(v)) throw new Error('번호미정 부여기록 서명/목록 오류');
    map[k] = v.map((x) => {
      const plate = String(x ?? '').trim();
      if (!/^100신\d{4,}$/.test(plate)) throw new Error(`번호미정 부여기록 번호 형식 오류 — ${plate || '공란'}`);
      if (allocated.has(plate)) throw new Error(`번호미정 부여기록 중복 — ${plate}`);
      allocated.add(plate);
      return plate;
    });
  }
  // 재부여 사고 방지: 기록에 있는 번호 중 최대값보다 seq 가 작으면 끌어올린다.
  //  ⚠ 숫자만 긁으면 안 된다 — `100신0001` → `1000001` 이 되어 다음 번호가 100신1000002 로 튄다.
  //    반드시 접두 `100신` 뒤의 순번만 읽는다.
  const seqInput = Number(savedSeq);
  if (!Number.isSafeInteger(seqInput) || seqInput < 0) throw new Error('번호미정 순번 설정 오류');
  let seq = seqInput;
  let maxAllocated = 0;
  for (const list of Object.values(map)) {
    for (const p of list) {
      const m = /^100신(\d+)$/.exec(String(p).trim());
      const n = m ? Number(m[1]) : 0;
      if (Number.isFinite(n) && n > maxAllocated) maxAllocated = n;
    }
  }
  if (seq < maxAllocated) {
    throw new Error(`번호미정 순번 설정 오류 — 저장 ${seq}, 부여 최대 ${maxAllocated}`);
  }
  let dirty = false;
  return {
    assign(sig, idx) {
      const list = map[sig] || (map[sig] = []);
      while (list.length <= idx) { list.push(fmt(++seq)); dirty = true; }
      return list[idx];
    },
    dirty: () => dirty,
    snapshot: () => ({ pending_plates: map, pending_plate_seq: seq }),
  };
}

/**
 * 저장 없이 쓰는 할당기 — 미리보기·단일시트용.
 * 서명 해시라 미리보기 안에서는 안정적이지만 **저장 경로에서 쓰면 안 된다**(다음 동기화 때 번호가 흔들린다).
 */
export function previewPlateAllocator(): PlateAllocator {
  const map: PendingPlateMap = {};
  let seq = 0;
  return {
    assign(sig, idx) {
      const list = map[sig] || (map[sig] = []);
      while (list.length <= idx) list.push(fmt(++seq));
      return list[idx];
    },
    dirty: () => false,
    snapshot: () => ({ pending_plates: map, pending_plate_seq: seq }),
  };
}
