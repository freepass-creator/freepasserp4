/**
 * **판매시트(영업자 표) = ERP — 맞추는 규칙 한 곳.**
 *
 * ★사장님 2026-08-20 —
 *   「영업자가 보는 거랑 우리 ERP 랑 바로 연동하자 · 일단 상품마스터 안 거치고」
 *   「ERP 에는 출고불가만 안 나타내는 거야. 상품화중·계약중은 다 표시되는 거임 · 상품시트도 마찬가지」
 *   「대여료 보증금 0인 거도 노출해 줘」
 *   「어찌 됐든 상품시트랑 동일해야 하고, 영업자가 불편하더라도 매칭이 중요함」
 *   「어디서 요청하든 맞출 수 있게끔 시트에도 매뉴얼해 놓고 코드에도 박아 놓자」 ← 이 파일이 그 «코드에 박은 것»이다.
 *
 * 이 글이 정본이고, 시트 「AI 운영 매뉴얼」 탭·docs/AI_OPERATING_MANUAL.md 는 여기서 찍어 낸 사본이다.
 * 규칙을 바꾸려면 이 파일을 고치고 `npx tsx scripts/publish-ai-manual-tab.mts --apply` 로 시트에 다시 찍는다.
 */

/** 규칙 한 줄 = [무엇, 어떻게, 어디(코드·도구)] */
export type ParityRule = [what: string, how: string, where: string];

export const SHEET_ERP_PARITY_VERSION = '2026-08-20 v1';

export const SHEET_ERP_PARITY_RULES: ParityRule[] = [
  ['① ERP 가 읽는 원본',
    '**영업자 상품리스트(판매시트) 3탭**(상품리스트·손오공구독·오플구독)을 그대로 읽는다. 상품마스터는 안 거친다(취급 이력 원장으로만 남는다). 되돌리려면 환경변수 SHEET_DAILY_SOURCE=product_master.',
    'lib/server/sheet-daily-sync.ts · lib/server/sales-inventory-sheet.ts'],
  ['② 판매시트에 싣는 줄',
    '공급사 시트에서 **출고불가만 빼고** 다 싣는다. 출고협의·상품화중·계약중은 싣는다. **차량번호가 없는 줄(「미정」)은 안 싣는다** — 번호가 열쇠라 ERP·계약·사진 어디에도 못 붙는다(번호가 나오면 다음 발행에 자동 합류).',
    'scripts/publish-origin-tab.mts'],
  ['③ ERP 상품찾기에 뜨는 차',
    '**출고불가만 숨긴다.** 상품화중·출고협의·계약중은 마크로 알리고 목록에 세운다. **대여료·보증금이 0(빈칸)인 차도 목록에 나온다** — 다만 견적(공유 링크·상세)은 유효 대여료가 있어야 한다.',
    'lib/domain/product.ts isHiddenFromCatalog · isOfferableProduct'],
  ['④ 시트 「계약중」의 뜻',
    'ERP 도 **계약중 그대로** 둔다(예전엔 출고불가로 투영해 목록에서 사라졌다 — 실측 손오공구독 2대). ERP 계약 엔진의 락은 이와 별개이고 시트가 만들지도 풀지도 못한다.',
    'lib/domain/sheet-daily-sync.ts projectSheetContractStatus'],
  ['⑤ 차명·모델 표기',
    '**모델 = 공급사 「모델명」(엔카 기준 이름)** · **차명 = 공급사 「차명(세부모델+트림)」 원문 그대로**. ERP 상품찾기 표도 제조사·모델·차명 세 칸이다(세부모델·파워트레인·세부트림은 화면에서 감춰 뒀다 — 나중에 스위치 하나로 연다).',
    'lib/domain/vehicle-detail-axes.ts · lib/domain/product-master-import.ts'],
  ['⑥ 스펙(연식·배기량·연료)',
    '3사(손오공·스위치·웰릭스) **자산 탭이 정본**이다(등록증 기반). 다르면 자산 값으로 우리 시트를 고친다. 그 밖의 공급사는 공급사 원문을 그대로 쓴다.',
    'tmp/fill-ours-from-ops.mts'],
  ['⑦ 맞는지 확인하는 법',
    '`npx tsx scripts/audit-sheet-erp-parity.mts` — 판매시트 대수와 ERP 목록 대수를 세고 **다른 차를 이유별로** 보여 준다. 매시 자동 동기의 마지막 단계로도 돈다.',
    'scripts/audit-sheet-erp-parity.mts · scripts/hourly-sync.mts'],
  ['⑧ 그래도 다를 수 있는 것(정상)',
    '**ERP 에만 있는 차** = 계약 엔진 락이 걸린 차(시트엔 공급사가 출고불가로 적어 둔 경우) — 공급사에 「계약중」으로 고쳐 달라고 하면 같아진다. **시트에만 있는 차**는 0 이어야 한다(있으면 버그).',
    'audit-sheet-erp-parity 「ERP 에만」 목록'],
];

/** 사람이 읽는 한 문단 — 시트 탭·문서 머리에 넣는다. */
export const SHEET_ERP_PARITY_SUMMARY =
  '판매시트(영업자 표)와 ERP 는 같은 표를 본다. ERP 는 판매시트 3탭을 그대로 읽고(상품마스터 안 거침), '
  + '양쪽 모두 «출고불가만» 빼며 상품화중·출고협의·계약중은 보여 준다. 대여료·보증금이 없는 차도 목록에는 나온다. '
  + '차량번호가 없는 줄만 판매시트에서 빠진다 — 번호가 열쇠라 그것이 없으면 어디에도 못 붙는다.';
