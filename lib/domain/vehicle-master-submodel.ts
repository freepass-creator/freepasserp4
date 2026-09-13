const compact = (value: unknown): string => String(value ?? '').trim().replace(/\s+/g, ' ');
const comparable = (value: unknown): string => compact(value).toLowerCase().replace(/\s+/g, '');

/**
 * 차종마스터의 기본 세부모델 표기 SSOT.
 *
 * 마스터 원본은 `model=GV80, sub_model=GV80`처럼 기본 가지를 모델명 반복으로 보존한다.
 * 영업/ERP/정제 결과에서는 반복 대신 `기본형`으로 표준화한다.
 * 쿠페·ELECTRIFIED·세대코드 등 실제 이름이 있는 세부모델은 절대 바꾸지 않는다.
 */
export const BASE_SUB_MODEL_LABEL = '기본형' as const;

/** 마스터 원본 세부모델 → 표준 표시/발행 세부모델. */
export function masterSubModelLabel(model: unknown, masterSubModel: unknown): string {
  const modelName = compact(model);
  const subModel = compact(masterSubModel);
  if (!subModel) return '';
  if (modelName && comparable(modelName) === comparable(subModel)) return BASE_SUB_MODEL_LABEL;
  return subModel;
}

/**
 * 표준값 `기본형` → 마스터 원본 경로 키.
 * 마스터 조회/정합성 검사에서만 사용한다. 원본 master JSON 자체는 수정하지 않는다.
 */
export function masterSubModelKey(model: unknown, value: unknown): string {
  const modelName = compact(model);
  const subModel = compact(value);
  if (modelName && comparable(subModel) === comparable(BASE_SUB_MODEL_LABEL)) return modelName;
  return subModel;
}

/** 표준값과 마스터 원본 세부모델이 같은 경로인지 비교. */
export function sameMasterSubModel(model: unknown, canonicalValue: unknown, masterRawValue: unknown): boolean {
  return comparable(masterSubModelKey(model, canonicalValue)) === comparable(masterRawValue);
}
