/**
 * 차종마스터에 «부합 안 된» 매물을 원인별로 가르는 SSOT.
 *
 * 차종마스터는 필수가 아니라 선택이다 — 차번·대여료만 있으면 매물로 등록된다(2026-08-06 결정).
 * 그래도 붙을 수 있는 건 붙여야 하는데, 안 붙는 것을 «검수대기» 한 덩어리로 두면 아무도 손을
 * 못 댄다. 33대를 한 줄로 세워 놓고 무엇부터 볼지 정할 수 없기 때문이다.
 *
 * 그래서 **처리 주체가 다른 축**으로 가른다. 각 갈래는 손볼 사람이 서로 다르다:
 *
 *   no_model      원문에 차종이 없다(「기타」·공란)        → 공급사에 물어야 한다. 우리가 못 푼다.
 *   not_in_master 제조사·모델 자체가 마스터에 없다          → 마스터에 추가하면 붙는다.
 *   mis_snapped   세부모델이 «딴 차»다(옛 오매칭 흔적)      → 다시 스냅하면 고쳐진다. 코드가 푼다.
 *   trim_conflict 트림이 다른 모델을 가리킨다               → 사람이 봐야 한다(원문이 섞였다).
 *   low_signal    세대까지 붙었는데 확신도 미달             → 트림·연식 신호가 모자란다.
 *
 * 이 순서가 곧 판정 순서다. 앞선 갈래일수록 «우리가 못 고치는» 쪽이라 먼저 걸러낸다.
 */
import type { EntityRecord } from '@/lib/intake/entities';
import type { MasterEntry } from '@/lib/domain/vehicle-master-match';

export type MasterMisfitKind =
  | 'fit'
  | 'no_model'
  | 'not_in_master'
  | 'mis_snapped'
  | 'trim_conflict'
  | 'low_signal';

export const MASTER_MISFIT_LABEL: Record<MasterMisfitKind, string> = {
  fit: '차종 확정',
  no_model: '원문에 차종 없음 — 공급사 확인',
  not_in_master: '마스터에 없는 차 — 마스터 추가',
  mis_snapped: '세부모델이 딴 차 — 재스냅',
  trim_conflict: '트림이 다른 모델 — 사람 확인',
  low_signal: '신호 부족(트림·연식) — 보완',
};

/** 손볼 사람이 누구인지 — 목록을 나눠 놓고도 누가 처리할지 모르면 그대로 쌓인다. */
export const MASTER_MISFIT_OWNER: Record<MasterMisfitKind, string> = {
  fit: '',
  no_model: '공급사',
  not_in_master: '우리(마스터)',
  mis_snapped: '우리(재스냅)',
  trim_conflict: '우리(검수)',
  low_signal: '우리(매처·시트)',
};

const S = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => S(v).replace(/\s+/g, '').toLowerCase();

/** 「기타」·공란처럼 그 자체로는 차종을 못 알려 주는 표기. */
const EMPTY_MODEL = /^(기타|미정|없음|없|미상|기타차량|-)$/;

export type MasterIndex = {
  makers: Set<string>;
  modelsByMaker: Map<string, Set<string>>;
};

export function buildMasterIndex(entries: MasterEntry[]): MasterIndex {
  const makers = new Set<string>();
  const modelsByMaker = new Map<string, Set<string>>();
  for (const e of entries) {
    const maker = norm(e.maker);
    makers.add(maker);
    if (!modelsByMaker.has(maker)) modelsByMaker.set(maker, new Set());
    modelsByMaker.get(maker)!.add(norm(e.model));
  }
  return { makers, modelsByMaker };
}

/**
 * @param confidence snapToMaster 결과의 확신도(없으면 미매칭)
 */
export function classifyMasterMisfit(
  product: EntityRecord,
  index: MasterIndex,
  confidence?: string,
): MasterMisfitKind {
  if (confidence === 'high' || confidence === 'medium') return 'fit';

  const record = product as Record<string, unknown>;
  const maker = S(record.maker);
  const model = S(record.model);
  const sub = S(record.sub_model);

  // 세부모델이 자기 모델을 안 품고 있으면 예전 스냅이 딴 차를 붙여 둔 것이다.
  // 실측(2026-08-06): 폭스바겐 CC 에 「더 뉴 아반떼 AD」, 혼다 S2000 에 「E-클래스 W214」.
  if (sub && model && !norm(sub).includes(norm(model))) return 'mis_snapped';
  if (!model || EMPTY_MODEL.test(norm(model))) return 'no_model';
  if (!index.makers.has(norm(maker)) || !index.modelsByMaker.get(norm(maker))?.has(norm(model))) {
    return 'not_in_master';
  }
  if (confidence === 'low' && S(record.trim_name)) return 'trim_conflict';
  return 'low_signal';
}
