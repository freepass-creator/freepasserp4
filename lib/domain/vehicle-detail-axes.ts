/**
 * **세부모델·파워트레인·세부트림 — 지금은 숨긴다(2026-08-20).**
 *
 * ★사장님 2026-08-20 — 「상세 검색에 제조사 모델만 검색되게 해야겠네.. 일단은.. ERP 에도」 · 「뒤에 세부모델 여기를 숨겨놔 나중에 열 거야」.
 *   차종마스터 자동매칭이 세대·트림을 추정해 틀린 값을 박아 왔고(QM6 → 기아 레이 등), 사장님이 「모델명만 규격, 나머지는 공급사 원문」으로 단순화했다.
 *   그래서 **값은 지우지 않고 화면에서만 감춘다** — 나중에 세부트림 작업이 끝나면 이 스위치 하나만 true 로 바꾸면 그대로 돌아온다.
 *
 * 감추는 곳: 파인더(영업자 표) 열 · 재고 편집/조회의 차종 마스터 칸 · 검색 대상(제조사·모델·차명만 남긴다).
 * 감추지 않는 곳: 시트·상품마스터·ERP 데이터(그대로 저장·동기), 차량번호·차명·연식·주행·연료·배기량 등 나머지 표시.
 */
export const SHOW_VEHICLE_DETAIL_AXES = false;

/** 화면에서 감추는 축 — 열 키·폼 필드 이름이 같다. */
export const HIDDEN_VEHICLE_AXES = ['sub_model', 'variant', 'trim_name', 'trim_extra'] as const;

export const isHiddenVehicleAxis = (field: unknown): boolean =>
  !SHOW_VEHICLE_DETAIL_AXES && (HIDDEN_VEHICLE_AXES as readonly string[]).includes(String(field ?? ''));
