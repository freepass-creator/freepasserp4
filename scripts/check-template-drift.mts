/**
 * 아직 두 프로젝트가 함께 쓰는 레거시 부속서식만 대조한다.
 *
 * `rental-contract.html`은 2026-08-10부터 프리패스 자체 전자계약의 원본이다.
 * 착한거래 사본을 기준으로 덮어쓰면 프리패스 Snapshot/PDF 경계와 승인된 문구가
 * 되돌아가므로 이 검사 대상에 넣지 않는다.
 * `contract-individual.html`도 프리패스에서 「출고 시 주행거리」·「초과주행 요금」
 * 표현과 스페어키 제거를 승인해 별도 정본으로 갈라졌으므로 공유 대조 대상이 아니다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** 착한거래 리포 위치 - 환경변수로 덮어쓸 수 있다. */
const PEER = process.env.CHAKHANDEAL_REPO || resolve(process.cwd(), '..', 'chakhandeal');
const HERE = resolve(process.cwd(), 'public', 'contract-template');
const THERE = join(PEER, 'public', 'contract-template');
const SHARED_LEGACY_TEMPLATES = ['contract-guarantor.html'] as const;

/** 줄바꿈(CRLF/LF)만 다른 것은 갈린 것이 아니다. */
const norm = (s: string) => s.replace(/\r\n/g, '\n');

if (!existsSync(THERE)) {
  console.log(`⚠ 착한거래 서식을 찾지 못해 대조하지 못했습니다 - ${THERE}`);
  console.log('  (CHAKHANDEAL_REPO 로 경로를 지정하면 대조합니다)');
  process.exit(0);
}

const drifted: string[] = [];

for (const name of SHARED_LEGACY_TEMPLATES) {
  const a = join(HERE, name);
  const b = join(THERE, name);
  if (!existsSync(a)) { drifted.push(`${name} - 이 리포에 없음`); continue; }
  if (!existsSync(b)) { drifted.push(`${name} - 착한거래에 없음`); continue; }
  const same = norm(readFileSync(a, 'utf8')) === norm(readFileSync(b, 'utf8'));
  console.log(`${same ? '✓' : '✗'} ${name}`);
  if (!same) drifted.push(`${name} - 내용이 다름`);
}

if (drifted.length) {
  console.log(`\n━━ 서식이 갈렸습니다 (${drifted.length}건)`);
  drifted.forEach((d) => console.log(`  · ${d}`));
  console.log('\n공유 부속서식만 필요한 방향으로 직접 동기화하세요.');
  console.log('프리패스 원본 rental-contract.html은 이 검사로 덮어쓰면 안 됩니다.');
  process.exit(1);
}

console.log(`\n━━ 공유 부속서식 ${SHARED_LEGACY_TEMPLATES.length}개가 착한거래와 같습니다`);
console.log('✓ 프리패스 본계약서 rental-contract.html·contract-individual.html은 자체 원본으로 분리됨');
