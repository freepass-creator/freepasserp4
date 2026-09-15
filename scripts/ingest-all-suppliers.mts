import { INVENTORY_SOURCES } from '../lib/domain/inventory-source-registry';

/**
 * SSOT HARD GUARD
 *
 * 이 main 브랜치에 남아 있던 옛 일괄수집기는 MIRROR_SOURCES + partner.sheet_url 로
 * 원천을 다시 추론했다. 그 방식은 canonical inventory source contract와 충돌하므로 폐기한다.
 *
 * 실제 운영 수집은 `.github/workflows/erp5-ssot-refresh.yml`이 검증된 ERP5 SSOT 엔진
 * (`eafbd88e43b1b4e5bacab858a2e0c65845956e5f`)을 고정 실행한다.
 * 검증 엔진을 main으로 완전히 이식하기 전까지 main에서 임의 수집을 허용하지 않는다.
 *
 * 원천 변경은 오직 `lib/domain/inventory-source-registry.ts`에서만 한다.
 */

const only = (process.argv.find((arg) => arg.startsWith('--only='))?.split('=')[1] || '')
  .split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
const sources = only.length
  ? INVENTORY_SOURCES.filter((source) => only.includes(source.partnerCode))
  : INVENTORY_SOURCES;

console.error('SSOT HARD GUARD: main의 옛 직접수집 경로는 폐기되었습니다.');
for (const source of sources) {
  console.error(`- ${source.partnerCode} ${source.name}: ${source.kind} -> ${source.sourceUrl}`);
}
console.error('실제 반영은 ERP5 SSOT workflow만 사용하세요. partner.sheet_url / MIRROR_SOURCES는 재고 원천이 아닙니다.');
process.exit(2);
