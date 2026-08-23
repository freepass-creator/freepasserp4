/**
 * 판매시트 정제 축을 화면에서도 그대로 쓴다.
 * 세부모델·세부트림은 표시하고, 폐지한 파워트레인과 추가표기만 감춘다.
 */
export const SHOW_VEHICLE_DETAIL_AXES = true;
export const HIDDEN_VEHICLE_AXES = ['variant', 'trim_extra'] as const;

export const isHiddenVehicleAxis = (field: unknown): boolean =>
  (HIDDEN_VEHICLE_AXES as readonly string[]).includes(String(field ?? ''));
