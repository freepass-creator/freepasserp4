/**
 * **차량 축 레지스트리 — 한 축을 «한 줄»로 선언하는 유일한 자리.**
 *
 * ★왜(사장님 2026-08-22 「그럼 오류 없게끔 만들어줘」)
 *   열 하나를 세우려면 그동안 **여섯 곳**을 고쳐야 했다 —
 *     ① `supplier-template-sheet.AI_TAIL_COLUMNS`(정제칸)
 *     ② `sales-sheet-mapping.SALES_MAPPING`(판매시트 열·차례)
 *     ③ `sales-sheet-format.LEFT/RIGHT_COLUMNS`(정렬)
 *     ④ `sheet-import.HEADER_ALIASES`(ERP 필드)
 *     ⑤ `intake/entities`(재고관리 편집 칸)
 *     ⑥ 매뉴얼 숫자
 *   실제로 2026-08-22 하루에만 두 번 빠뜨렸다 — 세부모델·세부트림이 정렬 목록에 없어 **조용히 가운데**로 나갔고,
 *   차종코드는 ERP 별칭이 없어 **6,605대 중 0건**이었다. 사람이든 AI 든 여섯 곳을 다 기억할 수 없다.
 *
 * ★그래서 이 파일은 **코드를 대체하지 않고 «계약»을 선언한다.**
 *   `scripts/check-sales-axes.mts` 가 이 선언과 위 여섯 곳이 실제로 같은지 대조해서 다르면 실패시킨다.
 *   즉 이 표만 맞게 적으면, 어느 한 곳을 빠뜨렸을 때 배포 전에 걸린다.
 *
 * ★`minFillSheet`·`minFillErp` 는 **«값이 새는 것»을 잡는 문턱**이다(단위 %).
 *   형식 검사(열이 있나)만으로는 못 잡는다 — 실제로 세부모델이 100%→33% 로 떨어진 채 사흘을 갔다.
 *   지금 실측값보다 **여유를 두고** 잡는다. 목표치가 아니라 «이 밑으로 떨어지면 사고»의 선이다.
 */

export type SalesAxis = {
  /** 판매시트 열 이름 = 이 축의 이름. */
  column: string;
  /** ERP 상품 필드. 판매시트에만 있고 ERP 로 안 가는 열(요금·정책)은 null. */
  erpField: string | null;
  /** 시트 서식 정렬. 글자=왼쪽 · 숫자=오른쪽 · 날짜/표식=가운데. */
  align: 'left' | 'right' | 'center';
  /** 공급사 시트 **정제칸**(구분선 오른쪽, 우리가 채우는 칸)에서 오는 축인가. */
  fromRefined: boolean;
  /**
   * 정제칸 이름이 판매시트 열 이름과 **다를 때만** 적는다(같으면 생략).
   * ⚠ 이 대응을 검사 스크립트마다 따로 적어 두면 갈린다 — 실제로 `check-sales-axes` 와 `audit-axis-coverage` 에
   *   같은 표를 복붙해 뒀다가 2026-08-22 최종 점검에서 여기로 합쳤다.
   */
  refinedColumn?: string;
  /** 판매시트에 실린 값 최소 채움률(%). 이 밑이면 검사 실패. */
  minFillSheet: number;
  /** ERP 에 반영된 최소 채움률(%). */
  minFillErp: number;
  /** 왜 이 축이 있는가 — 사람이 읽는 한 줄. */
  why: string;
};

/**
 * 2026-08-23 실측 채움률(판매시트 357대 / ERP 판매가능 474대):
 *   제조사 100/100 · 모델 100/100 · 세부모델 100/100 · 세부트림 88/73 ·
 *   연료 100/100 · 배기량 94/93 · 차종구분 98/98 · 원산지 98/98 · 인승 76/77 · 구동 50/54
 * 문턱은 그보다 낮게 — «떨어졌다»를 잡는 것이지 «완벽»을 요구하는 게 아니다.
 */
export const SALES_AXES: SalesAxis[] = [
  { column: '제조사', erpField: 'maker', align: 'left', fromRefined: true, refinedColumn: '제조사(정제)', minFillSheet: 95, minFillErp: 95,
    why: '차명 축 ①. 목록·검색의 첫 갈래' },
  { column: '모델', erpField: 'model', align: 'left', fromRefined: true, minFillSheet: 95, minFillErp: 95,
    why: '차명 축 ②. 손님이 말하는 이름(그랜저·아반떼)' },
  { column: '세부모델', erpField: 'sub_model', align: 'left', fromRefined: true, minFillSheet: 90, minFillErp: 90,
    why: '차명 축 ③. 세대까지(더 뉴 그랜저 GN7). 화면 「차명」의 앞부분' },
  { column: '세부트림', erpField: 'trim_name', align: 'left', fromRefined: true, minFillSheet: 70, minFillErp: 65,
    why: '차명 축 ④. 화면 「차명」의 뒷부분. 정제칸이 비면 여기도 빈다' },
  { column: '외장', erpField: 'ext_color', align: 'center', fromRefined: true, refinedColumn: '외장색상', minFillSheet: 80, minFillErp: 80,
    why: '규격 12색. 손님이 먼저 묻는 값' },
  { column: '내장', erpField: 'int_color', align: 'center', fromRefined: true, refinedColumn: '내장색상', minFillSheet: 50, minFillErp: 50,
    why: '규격 10색. 원본에 없는 차가 많아 문턱이 낮다' },
  { column: '연식', erpField: 'year', align: 'center', fromRefined: false, minFillSheet: 90, minFillErp: 90,
    why: '공급사 원문. 연식·주행은 차를 고르는 두 축' },
  { column: 'Km', erpField: 'mileage', align: 'right', fromRefined: false, minFillSheet: 80, minFillErp: 80,
    why: '공급사 원문' },
  { column: '연료', erpField: 'fuel_type', align: 'center', fromRefined: true, refinedColumn: '연료(정제)', minFillSheet: 95, minFillErp: 95,
    why: '엔진 이야기는 차명이 아니라 이 칸이 든다(파워트레인 폐지)' },
  { column: '배기량', erpField: 'engine_cc', align: 'right', fromRefined: true, refinedColumn: '배기량(정제)', minFillSheet: 80, minFillErp: 85,
    why: '연료와 짝. 전기차는 비는 게 정상이라 100% 가 아니다' },
  { column: '배터리용량', erpField: 'battery_capacity', align: 'right', fromRefined: true, refinedColumn: '배터리용량(정제)', minFillSheet: 0, minFillErp: 0,
    why: '전기차 kWh. 내연은 비는 게 정상. 세부모델만 알아도 값이 하나로 모이면 채운다' },
  { column: '차종구분', erpField: 'vehicle_class', align: 'left', fromRefined: true, refinedColumn: '차종분류', minFillSheet: 90, minFillErp: 90,
    why: '준중형 세단·중형 SUV 한 칸. 크기+구분을 우리가 붙이지 않는다' },
  { column: '원산지', erpField: 'origin', align: 'left', fromRefined: true, minFillSheet: 90, minFillErp: 90,
    why: '★국산/수입 — **보증금 배율(국산 ×2·수입 ×3)의 근거**. 표시값이 아니라 돈이다' },
  { column: '구동', erpField: 'drive_type', align: 'left', fromRefined: true, refinedColumn: '구동방식', minFillSheet: 30, minFillErp: 30,
    why: '정제칸 절반만 차 있다(사장님이 채울 자리). 값 규격은 2WD·AWD 두 가지로 이미 깨끗하다. '
      + 'ERP 문턱을 60→30 으로 내린 것은 봐주는 게 아니라 **재는 대상이 달라져서다** — '
      + '전에 ERP 가 88% 로 보인 것은 옛 차종마스터 스냅(xDrive·콰트로·4MATIC)이 얹혀 있던 탓이고, '
      + '2026-08-23 부터 ERP 는 시트를 그대로 비춘다(시트 50% ▶ ERP 54%). '
      + '이 문턱은 «시트에서 ERP 로 새는가»를 잡는 것이고, «정제칸이 비었는가»는 위 정제칸 수치가 보여 준다' },
  { column: '인승', erpField: 'seats', align: 'right', fromRefined: true, minFillSheet: 60, minFillErp: 60,
    why: '원장 값을 옮기는 칸(정제해서 만드는 값이 아니다)' },
  { column: '차량번호', erpField: 'car_number', align: 'center', fromRefined: false, minFillSheet: 99, minFillErp: 99,
    why: '차를 알아보는 열쇠. 비면 그 줄은 안 읽는다' },
  /**
   * ★**공급사 원문 두 칸 — 「2중 보관」**(사장님 2026-08-23).
   *   정제칸이 정본이 된 뒤로 공급사가 적은 글자는 어디에도 안 남았다. 정제가 틀렸을 때 되짚을 근거라 반드시 함께 나른다.
   *   문턱이 낮은 것은 «없는 게 정상인 차»가 많아서다 — 옵션을 안 적는 공급사가 있고, 차명만 적는 공급사도 있다.
   */
  { column: '차명(원문)', erpField: 'supplier_vehicle_name', align: 'left', fromRefined: false, minFillSheet: 60, minFillErp: 60,
    why: '공급사가 적은 차명 그대로. 정제값과 대조하는 자리 · 상세 「기타」에 선다' },
  { column: '옵션(원문)', erpField: 'options', align: 'left', fromRefined: false, minFillSheet: 0, minFillErp: 0,
    why: '공급사가 적은 옵션 그대로. ERP options도 이 원문 하나를 쓴다' },
];

/**
 * **판매시트가 나르는 축** — 여기 있는 축은 «시트가 정본»이다.
 * ⚠ 축을 빼기로 하면 ERP 값도 같이 비워야 한다. soft-merge 는 빈 값을 무시하므로
 *   시트에서 열만 빼면 ERP 에 옛 값이 **영원히 굳는다**(2026-08-22 파워트레인 3,737대가 그랬다).
 *   그때 쓰는 도구: `scripts/clear-legacy-variant.mts` 를 본떠 한 칸씩 비운다.
 */
export const SHEET_OWNED_ERP_FIELDS: string[] = SALES_AXES
  .map((a) => a.erpField)
  .filter((f): f is string => !!f);

/** 폐지된 축 — 되살리지 마라. 이유를 적어 둔다(다음 사람이 «왜 없지?» 하고 되살리는 걸 막는다). */
export const RETIRED_AXES: { column: string; why: string }[] = [
  { column: '파워트레인', why: '2026-08-22 폐지. 엔진 이야기는 연료·배기량 칸이 든다. 차명에 「2.2 디젤」이 끼면 목록·상세·공유가 지저분해진다. ERP 잔재 3,737대 삭제 완료' },
  { column: '차대번호', why: '2026-08-22 상품리스트에서 뺌(사장님). 공급사 시트·ERP 에는 남는다 — 번호판 나오기 전 신차를 같은 차로 잇는 용도' },
  { column: '추가표기', why: 'ERP 실측 0대 · 정제칸에도 없다' },
];
