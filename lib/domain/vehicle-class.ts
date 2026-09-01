/**
 * 차종분류는 **한 칸**(준대형 세단). 코드는 `vehicle-class-catalog.ts`(vc-15).
 * 판매시트는 크기+구분을 붙이지 않고 이 조합 글자(또는 코드가 가리키는 글자)를 싣는다.
 */
import { type EntityRecord } from '@/lib/intake/entities';
import { canonVehicleClassLabel } from './vehicle-class-catalog';

export const SEGMENTS = ['경형', '소형', '준중형', '중형', '준대형', '대형'] as const;
export const BODY_TYPES = ['SUV', 'MPV', 'RV', '세단', '해치백', '쿠페', '왜건', '승합', '화물', '픽업', '밴'] as const;

const CLASS_MAP: Record<string, string> = {
  모닝: '경형 해치백', 레이: '경형 MPV', 리오: '소형 세단',
  프라이드: '소형 세단', 스토닉: '소형 SUV', 셀토스: '소형 SUV', 니로: '소형 SUV', 니로ev: '소형 SUV',
  k3: '준중형 세단', 쏘울: '소형 SUV', 스포티지: '준중형 SUV', ev6: '준중형 SUV', xceed: '준중형 SUV',
  k5: '중형 세단', 쏘렌토: '중형 SUV', ev9: '대형 SUV',
  k7: '준대형 세단', k8: '준대형 세단', 스팅어: '준대형 세단', 카니발: '대형 MPV', 카렌스: '중형 MPV',
  k9: '대형 세단', 모하비: '대형 SUV', 봉고: '소형화물', 봉고3: '소형화물', 타스만: '중형 픽업',
  캐스퍼: '경형 SUV', 엑센트: '소형 세단', 베뉴: '소형 SUV', 코나: '소형 SUV', 아이오닉: '준중형 세단',
  아반떼: '준중형 세단', 아반떼n: '준중형 세단', i30: '준중형 해치백', 아이오닉5: '준중형 SUV', 아이오닉6: '준대형 세단', 투싼: '준중형 SUV',
  쏘나타: '중형 세단', 싼타페: '중형 SUV', 넥쏘: '중형 SUV', 아이오닉7: '대형 SUV',
  그랜저: '준대형 세단', 팰리세이드: '대형 SUV', 스타리아: '대형 MPV', 스타렉스: '대형 MPV', 포터: '소형화물', 포터2: '소형화물',
  g70: '중형 세단', g80: '준대형 세단', g90: '대형 세단', gv60: '준중형 SUV', gv70: '중형 SUV', gv80: '대형 SUV',
  스파크: '경형 해치백', 트랙스: '소형 SUV', 트레일블레이저: '소형 SUV', 말리부: '중형 세단', 트래버스: '대형 SUV', 콜로라도: '중형 픽업', 이쿼녹스: '중형 SUV',
  qm6: '중형 SUV', xm3: '소형 SUV', sm6: '중형 세단', 캡처: '소형 SUV', 아르카나: '소형 SUV',
  티볼리: '소형 SUV', 코란도: '준중형 SUV', 렉스턴: '중형 SUV', 토레스: '중형 SUV', 렉스턴스포츠: '중형 픽업',
  'e-클래스': '준대형 세단', e클래스: '준대형 세단', 's-클래스': '대형 세단', s클래스: '대형 세단',
  'c-클래스': '중형 세단', c클래스: '중형 세단', 'a-클래스': '준중형 해치백', a클래스: '준중형 해치백',
  '3시리즈': '중형 세단', '5시리즈': '준대형 세단', '7시리즈': '대형 세단',
  a4: '중형 세단', a6: '준대형 세단', a8: '대형 세단',
  골프: '준중형 해치백', 티구안: '준중형 SUV',
  쿠퍼: '소형 해치백', 에이스맨: '소형 SUV', 컨트리맨: '소형 SUV',
  모델3: '중형 세단', 모델y: '중형 SUV', 모델s: '준대형 세단', 모델x: '대형 SUV',
  그랑콜레오스: '중형 SUV', sm3: '준중형 세단', sm5: '중형 세단', sm7: '준대형 세단',
  eq900: '대형 세단', 로체: '중형 세단', 액티언: '중형 SUV', xt6: '대형 SUV',
};

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, '');

const SIZE_BY_LEN = [...SEGMENTS].sort((a, b) => b.length - a.length);

export function splitVehicleClass(text: string): { size: string; kind: string } {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t) return { size: '', kind: '' };
  const size = SIZE_BY_LEN.find((s) => t === s || t.startsWith(`${s} `)) || '';
  const kind = size ? t.slice(size.length).trim() : t;
  return { size, kind };
}

export function joinVehicleClass(size: string, kind: string): string {
  return [String(size || '').trim(), String(kind || '').trim()].filter(Boolean).join(' ');
}

/** 렉스턴 스포츠·칸은 픽업. 모델이 「렉스턴」이면 CLASS_MAP이 SUV를 준다. */
export function isRextonSports(model: unknown, subModel: unknown): boolean {
  const t = `${norm(model)}${norm(subModel)}`;
  return t.includes('렉스턴') && t.includes('스포츠');
}

function bodyGuess(p: EntityRecord): string {
  const t = norm(p.model) + norm(p.sub_model) + norm(p.trim_name);
  const seats = Number(p.seats) || 0;
  if (/스포츠/.test(t) && /렉스턴/.test(t)) return '픽업';
  if (/화물|트럭|봉고|포터|픽업|카고|더블캡|킹캡/.test(t)) return '화물';
  if (/카니발|스타리아|스타렉스|미니밴|승합|카렌스/.test(t) || seats >= 9) return 'MPV';
  if (/suv|투싼|스포티지|쏘렌토|싼타페|팰리세이드|코나|셀토스|티볼리|렉스턴|코란도|토레스|트랙스|트레일|gv\d/.test(t)) return 'SUV';
  return '';
}

export function classifyVehicleClass(p: EntityRecord): string {
  const key = norm(p.model);
  const sub = norm(p.sub_model);
  if (isRextonSports(p.model, p.sub_model)) return '중형 픽업';
  if (/a-?클래스|a클래스/.test(key) && /세단/.test(sub)) return '준중형 세단';
  // 코덱스 인수인계 2026-08-21: 인승 9 이상은 모델 고정 분류보다 우선. 팰리세이드 9인승=대형 MPV, 7인승=대형 SUV.
  const seats = Number(p.seats) || 0;
  if (seats >= 9) {
    const mapped = CLASS_MAP[key] || Object.keys(CLASS_MAP)
      .sort((a, b) => b.length - a.length)
      .map((k) => (k.length >= 2 && (key.includes(k) || sub.includes(k)) ? CLASS_MAP[k] : ''))
      .find(Boolean) || '';
    const size = splitVehicleClass(mapped).size;
    return size ? `${size} MPV` : 'MPV';
  }
  if (key && CLASS_MAP[key]) return CLASS_MAP[key];
  const keys = Object.keys(CLASS_MAP).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (k.length >= 2 && (key.includes(k) || sub.includes(k))) return CLASS_MAP[k];
  }
  const guessed = bodyGuess(p);
  return canonVehicleClassLabel(guessed) || guessed;
}

/** 모델+세부모델+세부트림을 겹치지 않게 이은 한 칸. */
export function composeRefinedVehicleName(model: unknown, subModel: unknown, trim: unknown): string {
  const has = (hay: string, needle: string) => {
    const h = needle.replace(/\s+/g, '').toLowerCase();
    return h.length >= 2 && hay.replace(/\s+/g, '').toLowerCase().includes(h);
  };
  const modelText = String(model || '').trim();
  const subText = String(subModel || '').trim();
  const trimText = String(trim || '').trim();
  const head = has(subText, modelText) ? (subText || modelText) : [modelText, subText].filter(Boolean).join(' ').trim();
  const suf = trimText && !has(head, trimText) ? trimText : '';
  return [head, suf].filter(Boolean).join(' ').trim();
}

export function suggestVehicleClass(p: EntityRecord): { current: string; suggested: string; mismatch: boolean } {
  const current = String(p.vehicle_class || '').trim();
  const suggested = classifyVehicleClass(p);
  return { current, suggested, mismatch: !!suggested && suggested !== current };
}
