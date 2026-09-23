import { readFileSync } from 'node:fs';
import { INVENTORY_SOURCES, getInventorySource } from '../lib/domain/inventory-source-registry';

const fail = (message: string): never => { throw new Error(`SSOT SOURCE CONTRACT: ${message}`); };
const assert = (ok: unknown, message: string): void => { if (!ok) fail(message); };

assert(INVENTORY_SOURCES.length === 24, `공급사 수가 24가 아닙니다: ${INVENTORY_SOURCES.length}`);

const codes = INVENTORY_SOURCES.map((source) => source.partnerCode);
assert(new Set(codes).size === codes.length, '공급사 코드가 중복됩니다.');

for (const source of INVENTORY_SOURCES) {
  assert(/^(RP|PT)-?\d+/i.test(source.partnerCode), `공급사 코드 형식 오류: ${source.partnerCode}`);
  assert(Boolean(source.name), `${source.partnerCode}: 공급사명이 없습니다.`);
  assert(Boolean(source.adapterId), `${source.partnerCode}: adapterId가 없습니다.`);
  assert(Boolean(source.sourceUrl), `${source.partnerCode}: sourceUrl이 없습니다.`);

  if (source.kind === 'google_sheet') {
    assert(Boolean(source.spreadsheetId), `${source.partnerCode}: Google Sheet인데 spreadsheetId가 없습니다.`);
    assert(source.sourceUrl.includes(String(source.spreadsheetId)), `${source.partnerCode}: sourceUrl과 spreadsheetId가 다릅니다.`);
  } else {
    assert(!source.spreadsheetId, `${source.partnerCode}: ${source.kind} 원천에 spreadsheetId를 재고 정본처럼 넣으면 안 됩니다.`);
  }

  if (source.sharedWith?.length) {
    for (const otherCode of source.sharedWith) {
      const other = getInventorySource(otherCode);
      assert(other.spreadsheetId === source.spreadsheetId, `${source.partnerCode}/${otherCode}: 공유 시트 ID가 다릅니다.`);
      assert(other.sharedWith?.includes(source.partnerCode), `${source.partnerCode}/${otherCode}: sharedWith가 비대칭입니다.`);
    }
  }
}

const iron = getInventorySource('RP006');
assert(iron.kind === 'website' && iron.adapterId === 'iron' && /ironrentcar\.com/.test(iron.sourceUrl), 'RP006 아이언 정본은 ironrentcar.com 이어야 합니다.');

const sonogong = getInventorySource('RP012');
assert(sonogong.kind === 'erp_api' && sonogong.adapterId === 'sonogong' && /sokrc\.com\/api/.test(sonogong.sourceUrl), 'RP012 손오공 정본은 sokrc.com ERP API 이어야 합니다.');

const autoplus = getInventorySource('RP023');
assert(autoplus.kind === 'website' && autoplus.adapterId === 'autoplus-reborn' && /reborncar\.co\.kr/.test(autoplus.sourceUrl), 'RP023 오토플러스 정본은 reborncar.co.kr 이어야 합니다.');

const bulk = readFileSync('scripts/ingest-all-suppliers.mts', 'utf8');
const single = readFileSync('scripts/ingest-supplier-to-firestore.mts', 'utf8');
for (const [name, text] of [['bulk', bulk], ['single', single]] as const) {
  assert(text.includes('SSOT HARD GUARD'), `${name} 수집기의 fail-closed 가드가 사라졌습니다.`);
  assert(text.includes('inventory-source-registry'), `${name} 수집기가 canonical registry를 참조하지 않습니다.`);
  assert(text.includes('process.exit(2)'), `${name} 수집기가 main에서 쓰기를 막지 않습니다.`);
}

const workflow = readFileSync('.github/workflows/erp5-ssot-refresh.yml', 'utf8');
/**
 * **검증 엔진 pin — 푸는 게 아니라 «목록»으로 넓힌다.**
 *
 * 원칙은 그대로다: main collector 이식이 끝나기 전에는 운영 워크플로가 «검증된 엔진»만 가리켜야 한다.
 * 다만 2026-09-16 사장님 지시로 하허호 F86(레트로 규격·굳힌 양식·감사·백업·정렬)을 그 엔진 «위에» 올렸다.
 * 올린 커밋은 `eafbd88e` 의 자손이고 수집기(ingest-all-suppliers·ingest-supplier-to-firestore)는 한 줄도
 * 안 건드렸다 — 아래 43~49행이 그 수집기 가드를 여전히 검사한다.
 * ⇒ 새 엔진을 쓰려면 **여기에 커밋을 적어 넣는다**(적지 않은 커밋으로는 운영이 안 돈다).
 */
const VALIDATED_ENGINES = [
  'eafbd88e43b1b4e5bacab858a2e0c65845956e5f',   // Codex gate 엔진(원본 검증분)
  '3a334ddf6e8acd721883757f7951052bf9188b87',   // + 하허호 F86(claude/f86-on-gate · 2026-09-16 · 정렬 상품구분→모델까지)
  'd635f8c87c3840a6956184b4d20f99dd968b6138',   // + 분류/구분 칩 색 SSOT 통일(PR #303 cherry-pick) — 수집기 미변경
  'a0b5a66c94870ea843a7a9f15daba986954c788e',   // + F01 발행 시 옛 조건부서식 삭제(PR #308 cherry-pick) — 수집기 미변경
  '0c4ec76b605c3ac50efcd9483dd2294bd89e22c0',   // + fields 마스크 400 긴급수정(PR #310 cherry-pick) — 수집기 미변경
  '308511563d8e8f56dbd94f715469d8ae7ed9171a',   // + (2)+(3)+(4) 재정렬 — (4)가 (2) 없는 가지에서 갈라져 색 SSOT가 빠졌던 것 수정
  '1939018a8edb0f4993d61e12e5e0df4864ca9cb8',   // + F86 표시규격 다섯(구분·배차상태 값별색 공유 · 공지사항 탭 없음 · 탭이름은 종합만 시각 · 장기요금 없는 차도 실음 · 하이픈류도 미입력) — 수집기 미변경
  '1f923d27bb9b6a8327afe0f7f5aa38eac8d6cd8f',   // + 「미입력」·「해당없음」 연한 회색(MISSING_INK) — 수집기 미변경
  /**
   * ★2026-09-16 — **이 엔진은 수집기를 «건드렸다».** 위 항목들과 달라서 따로 적는다.
   *   사장님 지시 「정산원장에 차량번호가 접수에 들어온다는건 계약중으로 바뀐다는거지, 그러다가
   *   공급사 원천시트에서 불가가 되거나 삭제되면 출고불가 되는거고」로
   *   `ingest-supplier-to-firestore.mts` 의 「계약중(락)은 원천에서 빠져도 안 내린다」 예외를 없앴다.
   *   ⇒ 계약중이던 차가 원천에서 사라지면 이제 출고불가(계약완료)가 된다. 출고협의·상품화중은 그대로 지킨다
   *     (손오공 API 는 `계약가능=Y` 인 차만 주므로 그 상태는 원래 안 보여 준다).
   *   ★fail-closed 가드 셋(SSOT HARD GUARD · inventory-source-registry · process.exit(2))은 그대로다
   *     — 위 43~49행이 그것을 검사하고 통과한다. canonical registry·원천 주소도 안 건드렸다.
   *   함께 든 것: 차량번호 고정 링크색 제거(링크 있는 줄만 파랑) · 정산원장 접수→락
   *     (sync-vehicle-lock-from-ledger.mts 신설) · 색·표시낱말 SSOT 통일과 잠금(check:color-ssot).
   */
  '2e880cefa96e3fa4bfc79902fed448d5bd74abdb',
  /**
   * ★2026-09-17 — 이 엔진도 수집기를 «건드렸다»(위 2e880cef 와 같은 성격이라 이어서 적는다).
   *   사장님 「손오공 보증금 ssot에 제대로 반영 안된거 같음」·「규칙 글자로」로
   *   `ingest-supplier-to-firestore.mts` 의 손오공 보증금을 «계산 숫자»(dep3) 대신 규칙 글자로 바꿨다
   *   (`deposit: 0` · API 경로에 `sonokongDepositRuleText()` 배선). 셈법은 글자로 남는다.
   *   함께: 차량가격 빈칸도 「미입력」 · 보증금 규격을 발행 문지기(inventory-contract)에 박음.
   *   ★fail-closed 가드 셋과 canonical registry·원천 주소는 그대로다 — 43~49행 검사가 통과한다.
   */
  '6a6f3f75c065143ad14286d08baa28e382535eea',
  /**
   * ★2026-09-17 — 긴급수정. F86 탭 이름 시각 문패의 초를 뗐다(콜론 두 개가 Sheets API A1 파싱을
   * "Unable to parse range"로 깨뜨려 발행이 8회 연속 실패했다 — 위 erp5-ssot-refresh.yml 주석 참고).
   * 수집기(ingest-all-suppliers·ingest-supplier-to-firestore)는 이번에도 안 건드렸다.
   */
  '9bef7bf0ffd21a96e3098a6f31adf1b1a0258c60',
  /**
   * ★2026-09-18 — category-colors.ts '분류'.신차렌트가 (2)의 통일 작업에서 잘못 골라진 값
   * (B81A8C, 어두운 자주)을 원래 판매시트 확정값(FF00FF, 밝은 분홍)으로 되돌렸다. 웹 화면
   * (파인더·영업자홈피) 카드 배지도 같은 색을 내도록 badges.tsx에 'pink' 톤을 새로 추가했다.
   * publish-jonghap-tab.mts의 리터럴 참조를 정본으로 바꿔 check:color-ssot 위반도 없앴다.
   * 수집기(ingest-all-suppliers·ingest-supplier-to-firestore)는 안 건드렸다 — 색·표시 전용 수정.
   */
  '14892951a929cf03796231f260e6bc2ff3060efc',
  /**
   * ★2026-09-18 — PR #411 merge. F86 publisher 결과는 그대로 두고 freshness checker가
   *   publisher의 f86TabCarriesMark를 공유하도록 정렬했다. 「종합」만 HH:MM 시각, 회사 탭은
   *   「회사 · N대」이며, 칸/차번/머리글/탭 차례 대조와 반례 시험은 유지·강화했다.
   */
  'cf940df642edf315adbc6da2b4134fbad53da160',
  /**
   * ★2026-09-21 — F86 첫 네 탭 이름을 접미사 없이 고정하고, RP012 중고렌트+오공구독을
   *   손오공상품에, T카 외부재고를 픽업구독에 두는 기존 assignSalesTab 결정을 발행기·감사에 잠갔다.
   * 손오공 원천은 계속 ERP API이며 수집기 내용은 cf940df6과 같다.
   */
  'c3838708b84527db241f1985c140a3ec6ece6bff',
  /**
   * ★2026-09-21 — 손오공 API 응답 분류를 Firestore atom에 sonokong-product-v1로 명시 저장한다.
   *   source_bucket·response_bucket·product_type·sales_group을 함께 남기며,
   *   손오공상품=중고렌트+오공구독, 픽업구독=별도라는 F01/F86 공통 계약을 한 함수로 읽는다.
   *   원천·fail-closed 가드는 그대로이고, 기존 문서는 가변 수집 때 분류를 backfill한다.
   *   F01/F86 탭 문패는 맨 앞 상품리스트만 갱신시각·대수를, 나머지는 탭명·대수만 표시한다.
   */
  '0e0bfb3a6e227fd65b754c1d74f7ca5c8b1c327e',
  '6d9375a0d7fcf8e00d41712a3a154c6b1163f032', // shared F01/F86 presentation; online readback 35576634024
  '716aa5fe66a8f3512668bcaff4c769c2fe7f2775', // fixed widths, supplementary parity gate, and F86 long-term-rent-only presentation
  '3032fc955db9558051aac1f69aad80b027f4cc02', // legacy supplementary sheets are observation-only; new sources control publication
  'a1e5135a306aea344845b11ffe4cb467fd2d6764', // F86 hides short-term deposits through 12 months and keeps long-term deposits visible
  '05f43fb14aabfc48f18092b4481dd31b0e71e3f7', // archive the known legacy F01 catalog tab before publishing the stable IDs
  '2be7207c2e5beed9cd8b63c169a06380eab3dd35', // ignore hidden retired F01 tabs when enforcing visible presentation uniqueness,
  '46484b8cccfd3a1b55cf49aad4f6e67ebe983807', // exclude hidden retired F01 tabs from Atom/F01/F86 parity audit
  'ea78781527635552f5c56a45be1531f3b2399c8b', // reject Shooting Brake pins when current raw name lacks that body-style evidence
  '8af50fda4a5541245d4f2e1e650bfc0cbe0ea059', // preserve F01 semantic manufacturer/fuel/color rules in F86 retro presentation
  '26977f35d65f780662eefa75c605fea492656da1', // permanently forbid the retired F86 summary tab and lock exact tab naming
  '639ae01a7646d92c6d91048a37d685991ec8a786', // preserve F86 product-type colors and keep the post-publish long-fee audit executable
  'acd97be170cb03bb938d8c2de4672f1b08975e15', // 손오공상품 대표사진 셀 + 원문/doc_images 공개 경계 + F01/F86 readback
];
const pinnedEngine = VALIDATED_ENGINES.find((engine) => workflow.includes(`ref: ${engine}`));
assert(pinnedEngine, '검증 엔진 pin이 제거됐습니다. main collector 이식 완료 전에는 pin을 풀면 안 됩니다(새 엔진은 VALIDATED_ENGINES 에 적는다).');
assert(/audit-supplementary-inventory-reference\.mts --snapshot=tmp\/erp5-sales-publish\.json[\s\S]*동일 스냅샷으로 판매시트 게시/.test(workflow),
  '오플·손오공 보완참조 관측은 F01/F86 쓰기 직전에 기록돼야 합니다.');
const ingestStep = workflow.match(/- name: 원천에서 ERP5 현재 원자 계산[\s\S]*?(?=\n      - name:)/)?.[0] ?? '';
assert(ingestStep.includes("if: github.event_name == 'schedule' || github.event_name == 'repository_dispatch' || github.event_name == 'workflow_run' || github.event_name == 'push'"),
  '수동 적용은 원천 재수집/ERP5 원자 재계산을 실행하면 안 됩니다.');
assert(workflow.includes('types: [erp5_refresh_watchdog]'), '예약 누락 watchdog 복구 이벤트 계약이 사라졌습니다.');
assert(ingestStep.includes("github.event_name == 'workflow_dispatch' && !inputs.apply"), '수동 준비 회차만 ERP5 원자를 갱신해야 합니다.');
const captureStep = workflow.match(/- name: ERP5 발행 스냅샷 고정[\s\S]*?(?=\n      - name:)/)?.[0] ?? '';
assert(captureStep.includes("github.event_name == 'workflow_dispatch' && !inputs.apply"), '준비 전용 회차가 고정 스냅샷을 남겨야 합니다.');
assert(/ready_run_id:[\s\S]*READY_RUN_ID_INPUT: \$\{\{ inputs\.ready_run_id \}\}[\s\S]*READY_RUN_ID="\$READY_RUN_ID_INPUT"/.test(workflow)
  && workflow.includes('gh run list --workflow erp5-ssot-refresh.yml --status success')
  && workflow.includes('.expired == false')
  && workflow.includes('gh run download "$READY_RUN_ID"'),
  '수동 적용은 지정 회차 또는 최신 성공 회차의 만료되지 않은 고정 스냅샷만 사용해야 합니다.');
assert(workflow.includes("steps.snapshot_capture.outcome == 'success' || steps.snapshot_restore.outcome == 'success'"),
  '정시 캡처와 수동 READY 복원 경계를 발행 조건이 함께 확인해야 합니다.');
assert(/id: supplementary[\s\S]*audit-supplementary-inventory-reference/.test(workflow), '보완참조 게이트 outcome을 식별해야 합니다.');
assert(/id: supplementary[\s\S]*continue-on-error: true/.test(workflow),
  '보완 시트는 새 원천 발행을 막지 않는 관측 증거여야 합니다.');
assert(!workflow.includes("steps.supplementary.outcome == 'success'"),
  '과거 보완 시트와의 차이를 새 원천 발행 조건으로 사용하면 안 됩니다.');
assert(workflow.includes("inputs.target == 'F86' && '--only=F86'"),
  'F86 전용 적용은 사진 링크 감사도 F86에만 한정해야 합니다.');
const validatedEngine = pinnedEngine as string;
assert(workflow.includes('GOOGLE_CLOUD_PROJECT: freepasserp5'), 'production target은 freepasserp5여야 합니다.');
assert(workflow.includes('scripts/ingest-all-suppliers.mts'), 'production workflow가 검증된 일괄수집기를 호출하지 않습니다.');

console.log(`✓ inventory source contract locked: ${INVENTORY_SOURCES.length} suppliers`);
console.log(`✓ RP006=${iron.sourceUrl}`);
console.log(`✓ RP012=${sonogong.sourceUrl}`);
console.log(`✓ RP023=${autoplus.sourceUrl}`);
console.log(`✓ production engine pinned=${validatedEngine}`);
