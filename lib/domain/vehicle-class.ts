/**
 * 차종(vehicle_class) SSOT — 세그먼트 × 차형. 모델명으로 정확 분류(마스터엔 차종 없음 → 여기가 단일 출처).
 *   · 세그먼트: 경형·소형·준중형·중형·준대형·대형   · 차형: (세단 생략)·SUV·RV·해치백·쿠페·왜건·승합·화물
 *   · 표기 = "세그먼트[ 차형]"  예: 중형 SUV, 준대형, 대형 RV, 경형.
 *   · 정확성 원칙: 모델 큐레이션 맵 우선 → 없으면 차형만 규칙추정(세그먼트 불명은 공란 유지, 오분류 방지).
 */
import { type EntityRecord } from '@/lib/intake/entities';

export const SEGMENTS = ['경형', '소형', '준중형', '중형', '준대형', '대형'] as const;
export const BODY_TYPES = ['SUV', 'RV', '세단', '해치백', '쿠페', '왜건', '승합', '화물'] as const;

// 모델(정규화 키) → 차종. 키=공백제거 소문자 모델명(sub_model 아닌 model 기준). 국산 주력 커버.
const CLASS_MAP: Record<string, string> = {
  // ── 기아 ──
  모닝: '경형', 레이: '경형', 리오: '소형',
  프라이드: '소형', 스토닉: '소형 SUV', 셀토스: '소형 SUV', 니로: '소형 SUV', 니로ev: '소형 SUV',
  k3: '준중형', 쏘울: '소형 SUV', 스포티지: '준중형 SUV', ev6: '준중형 SUV', xceed: '준중형 SUV',
  k5: '중형', 쏘렌토: '중형 SUV', ev9: '대형 SUV',
  k7: '준대형', k8: '준대형', 스팅어: '준대형', 카니발: '대형 RV', 카렌스: '중형 RV',
  k9: '대형', 모하비: '대형 SUV', 봉고: '소형화물', 봉고3: '소형화물', 타스만: '중형 픽업',
  // ── 현대 ──
  캐스퍼: '경형', 엑센트: '소형', 베뉴: '소형 SUV', 코나: '소형 SUV', 아이오닉: '준중형',
  아반떼: '준중형', 아반떼n: '준중형', i30: '준중형', 아이오닉5: '준중형 SUV', 아이오닉6: '준대형', 투싼: '준중형 SUV',
  쏘나타: '중형', 싼타페: '중형 SUV', 넥쏘: '중형 SUV', 아이오닉7: '대형 SUV',
  그랜저: '준대형', 팰리세이드: '대형 SUV', 스타리아: '대형 RV', 스타렉스: '대형 RV', 포터: '소형화물', 포터2: '소형화물',
  // ── 제네시스 ──
  g70: '중형', g80: '준대형', g90: '대형', gv60: '준중형 SUV', gv70: '중형 SUV', gv80: '대형 SUV',
  // ── 쉐보레/르노/KGM ──
  스파크: '경형', 트랙스: '소형 SUV', 트레일블레이저: '소형 SUV', 말리부: '중형', 트래버스: '대형 SUV', 콜로라도: '중형 픽업', 이쿼녹스: '중형 SUV',
  qm6: '중형 SUV', xm3: '소형 SUV', sm6: '중형', 캡처: '소형 SUV', 아르카나: '소형 SUV',
  티볼리: '소형 SUV', 코란도: '준중형 SUV', 렉스턴: '중형 SUV', 토레스: '중형 SUV', 렉스턴스포츠: '중형 픽업',
};

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, '');

// 차형만 규칙추정(세그먼트 불명 시). 모델·세부모델·인승으로.
function bodyGuess(p: EntityRecord): string {
  const t = norm(p.model) + norm(p.sub_model) + norm(p.trim_name);
  const seats = Number(p.seats) || 0;
  if (/화물|트럭|봉고|포터|픽업|카고|더블캡|킹캡/.test(t)) return '화물';
  if (/카니발|스타리아|스타렉스|미니밴|승합|카렌스/.test(t) || seats >= 9) return 'RV';
  if (/suv|투싼|스포티지|쏘렌토|싼타페|팰리세이드|코나|셀토스|티볼리|렉스턴|코란도|토레스|트랙스|트레일|gv\d/.test(t)) return 'SUV';
  return ''; // 세단 등은 세그먼트만
}

/** 매물 → 차종. 큐레이션 맵 우선(정확), 없으면 차형만 추정(세그먼트 공란=오분류 방지). */
export function classifyVehicleClass(p: EntityRecord): string {
  const key = norm(p.model);
  if (key && CLASS_MAP[key]) return CLASS_MAP[key];
  // 세부모델에 모델명이 섞인 경우(예: "더 뉴 쏘렌토 MQ4") 맵 키 포함 탐색
  const sub = norm(p.sub_model);
  for (const k of Object.keys(CLASS_MAP)) { if (k.length >= 2 && (key.includes(k) || sub.includes(k))) return CLASS_MAP[k]; }
  return bodyGuess(p); // 못 찾으면 차형만(세그먼트는 비워 오분류 회피)
}

/** 현재 차종 값이 분류기와 다른지(교정 후보). '' 이거나 다르면 제안. */
export function suggestVehicleClass(p: EntityRecord): { current: string; suggested: string; mismatch: boolean } {
  const current = String(p.vehicle_class || '').trim();
  const suggested = classifyVehicleClass(p);
  return { current, suggested, mismatch: !!suggested && suggested !== current };
}
