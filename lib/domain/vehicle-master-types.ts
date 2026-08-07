export type MasterVariant = {
  label: string;
  fuel: string;
  displacement_l: number | null;
  turbo: boolean;
  drivetrain: string | null;
  seat: number | null;
  battery_kwh: number | null;
  trims: string[];
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
