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
];
const pinnedEngine = VALIDATED_ENGINES.find((engine) => workflow.includes(`ref: ${engine}`));
assert(pinnedEngine, '검증 엔진 pin이 제거됐습니다. main collector 이식 완료 전에는 pin을 풀면 안 됩니다(새 엔진은 VALIDATED_ENGINES 에 적는다).');
const validatedEngine = pinnedEngine as string;
assert(workflow.includes('GOOGLE_CLOUD_PROJECT: freepasserp5'), 'production target은 freepasserp5여야 합니다.');
assert(workflow.includes('scripts/ingest-all-suppliers.mts'), 'production workflow가 검증된 일괄수집기를 호출하지 않습니다.');

console.log(`✓ inventory source contract locked: ${INVENTORY_SOURCES.length} suppliers`);
console.log(`✓ RP006=${iron.sourceUrl}`);
console.log(`✓ RP012=${sonogong.sourceUrl}`);
console.log(`✓ RP023=${autoplus.sourceUrl}`);
console.log(`✓ production engine pinned=${validatedEngine}`);
