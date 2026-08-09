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
  /** 공급사 파워트레인 칸이 비어 마스터 조합을 자동 선택함. */
  variant?: boolean;
  /** 공급사 세부트림 신호가 없어 선택된 조합의 첫(기본) 트림을 자동 선택함. */
  trim_name?: boolean;
  /** 아래 원자는 공급사 입력이 비어 선택된 마스터 노드에서 자동 완성함. */
  fuel_type?: boolean;
  engine_cc?: boolean;
  seats?: boolean;
  drive_type?: boolean;
};

export type SnapIssue = {
  code: 'powertrain_conflict' | 'trim_not_in_master';
  /** 충돌한 입력 원자. */
  field?: 'fuel_type' | 'engine_cc' | 'seats' | 'drive_type' | 'turbo' | 'trim_name';
  /** 공급사 원문 중 검수 화면에 보여 줄 짧은 값. */
  value?: string;
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
  /** 공급사 입력이 비어 마스터 조합에서 자동 선택한 원자. applySnap 이 `_snap_defaults` 로 옮긴다. */
  defaults?: SnapDefaultAtoms;
  /** 명시 입력과 마스터 조합이 충돌한 근거. low 검수 사유로 보존한다. */
  issues?: SnapIssue[];
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
