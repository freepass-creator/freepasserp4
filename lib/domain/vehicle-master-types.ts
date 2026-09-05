export type MasterVariant = {
  label: string;
  fuel: string;
  /** 제조사 제원표의 실제 총배기량(cc). 매칭·저장은 이 값을 최우선으로 쓴다. */
  engine_cc?: number | null;
  /** 화면/검색용 리터 표기(예: 1.6). 정확 제원은 engine_cc가 정본이다. */
  displacement_l: number | null;
  turbo: boolean;
  drivetrain: string | null;
  seat: number | null;
  battery_kwh: number | null;
  /** 동일 배기량 파워트레인을 가르는 보조 식별자. 모르면 null/생략한다. */
  engine_code?: string | null;
  transmission?: string | null;
  motor_layout?: string | null;
  power_kw?: number | null;
  /** 세부모델 전체 기간과 다른 파워트레인 판매기간(YYYY-MM). */
  production_start?: string | null;
  production_end?: string | null;
  aliases?: string[];
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
  /**
   * 세부모델(세대) 정본. 모델이 구분만 되면 된다 — **모델+개발코드**.
   * 풀체인지 첫 줄=`아반떼 CN8` · 같은 코드 페리=`더 뉴 아반떼 CN8`.
   * `디 올 뉴`/`올 뉴`는 aliases. 세부모델에 넣으면 다음 페리가 `더 뉴 디 올 뉴 …`가 된다.
   */
  sub_model: string;
  gen_code: string;
  origin: string;
  year_start: string;
  year_end: string;
  /** 실제 생산기간 월 단위 정본. 기존 year_*는 검색 호환용 연도 축이다. */
  production_start?: string;
  production_end?: string;
  generation_name?: string;
  body_type?: string;
  /** 등록증·카눈·엔카·공급사에서 쓰는 동일 세대 별칭. */
  aliases?: string[];
  title?: string;
  variants: MasterVariant[];
  trims?: string[];
  /** 비활성(은퇴) 세부모델 — 검증·카탈로그에서 제외. 삭제 아님(되돌리기). 예: 연료축 분리로 은퇴한 «X 하이브리드». */
  retired?: boolean;
  _retiredReason?: string;
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
  /** 전기·플러그인 kWh. 내연은 비는 게 정상. 트림이 없어도 세부모델에서 하나로 모이면 채운다. */
  battery_kwh?: string;
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
