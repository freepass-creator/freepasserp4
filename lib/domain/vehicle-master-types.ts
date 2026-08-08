export type MasterVariant = {
  label: string;
  fuel: string;
  displacement_l: number | null;
  turbo: boolean;
  drivetrain: string | null;
  seat: number | null;
  battery_kwh: number | null;
  trims: string[];
  /**
   * 세부모델의 **기본 조합**(신호 부족 시 가져올 variant).
   * 입력을 채우는 값이 아니라 마스터에 미리 정해 둔 대표 파워트레인·인승·구동 한 줄.
   * 세부모델당 최대 1개.
   */
  default?: boolean;
};

export type MasterEntry = {
  id: string;
  maker: string;
  model: string;
  sub_model: string;
  gen_code: string;
  origin: string;
  year_start: string;
  year_end: string;
  title?: string;
  variants: MasterVariant[];
  trims?: string[];
};

/** 원문에 없어 마스터 선택지로 힌트 채운 원자(미리보기용). 저장 스펙 값은 아님. */
export type SnapDefaultAtoms = {
  seats?: boolean;
  drive_type?: boolean;
};

export type SnapResult = {
  maker: string;
  model: string;
  sub_model: string;
  gen_code: string;
  /** 차종마스터 원산지 SSOT. 금액 규칙처럼 국산/수입 구분이 필요한 후속 처리에서 사용한다. */
  origin?: string;
  year_start?: string;
  year_end?: string;
  variant?: string;
  trim_name?: string;
  fuel_type?: string;
  engine_cc?: string;
  seats?: string;
  drive_type?: string;
  year?: string;
  confidence: 'high' | 'medium' | 'low';
  /** 스냅 점수에만 쓴 기본값 힌트 — applySnap 이 `_snap_defaults` 로 옮긴다. */
  defaults?: SnapDefaultAtoms;
};

export type ExactMasterPath = {
  entry: MasterEntry;
  variantIndex: number;
  trim: string;
};

export type VehicleFilter = {
  maker: string[];
  model: string[];
  sub_model: string[];
  variant: string[];
  trim_name: string[];
};

export type MasterFitBucket = 'ok' | 'high' | 'medium' | 'low' | 'none' | 'no_signal';

export type MasterFitRow = {
  key: string;
  car: string;
  bucket: MasterFitBucket;
  before: string;
  after?: string;
  year?: string;
  confidence?: SnapResult['confidence'];
};
