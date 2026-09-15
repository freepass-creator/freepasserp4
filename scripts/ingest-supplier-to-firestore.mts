import { getInventorySource } from '../lib/domain/inventory-source-registry';

/**
 * SSOT HARD GUARD
 *
 * 이 파일의 과거 구현은 공급사 원천을 MIRROR_SOURCES / partner.sheet_url 에서 다시 추론했다.
 * canonical SSOT 도입 이후 그 경로는 금지한다. 잘못된 원천으로 Firestore를 쓰느니 중단하는 게 원칙이다.
 *
 * 실제 운영 수집은 `.github/workflows/erp5-ssot-refresh.yml`에서 검증된 ERP5 SSOT 엔진
 * `eafbd88e43b1b4e5bacab858a2e0c65845956e5f`을 사용한다.
 * 검증 엔진을 main으로 완전히 이식한 뒤에만 이 가드를 canonical collector로 교체한다.
 */

const code = (process.argv.find((arg) => arg.startsWith('--code='))?.split('=')[1] || '').trim().toUpperCase();
if (!code) {
  console.error('SSOT HARD GUARD: --code=RPxxx 공급사 코드가 필요합니다.');
  process.exit(2);
}

const source = getInventorySource(code);
console.error(`SSOT HARD GUARD: ${source.partnerCode} ${source.name}의 재고 정본은 ${source.kind} -> ${source.sourceUrl}`);
console.error('main의 옛 단일 공급사 수집기는 폐기되었습니다. partner.sheet_url / MIRROR_SOURCES로 원천을 재해석하지 않습니다.');
console.error('실제 반영은 ERP5 SSOT workflow만 사용하세요.');
process.exit(2);
