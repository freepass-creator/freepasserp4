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
const validatedEngine = 'eafbd88e43b1b4e5bacab858a2e0c65845956e5f';
assert(workflow.includes(`ref: ${validatedEngine}`), '검증 엔진 pin이 제거됐습니다. main collector 이식 완료 전에는 pin을 풀면 안 됩니다.');
assert(workflow.includes('GOOGLE_CLOUD_PROJECT: freepasserp5'), 'production target은 freepasserp5여야 합니다.');
assert(workflow.includes('scripts/ingest-all-suppliers.mts'), 'production workflow가 검증된 일괄수집기를 호출하지 않습니다.');

console.log(`✓ inventory source contract locked: ${INVENTORY_SOURCES.length} suppliers`);
console.log(`✓ RP006=${iron.sourceUrl}`);
console.log(`✓ RP012=${sonogong.sourceUrl}`);
console.log(`✓ RP023=${autoplus.sourceUrl}`);
console.log(`✓ production engine pinned=${validatedEngine}`);
