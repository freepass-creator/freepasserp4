/**
 * 관제탑 상태를 «동기»로 올리는 다리 — `hourly-sync.mts` 가 `spawnSync` 로 부른다.
 *
 * ★왜 이게 필요한가 (2026-09-04 실측)
 *   자동동기 본체는 단계가 전부 `spawnSync`(블로킹)라, 메인 이벤트 루프가 단계 내내 막혀 있다.
 *   그래서 `void publishOpsStatus(status)` 처럼 «비동기로 던져 두면» RTDB 쓰기의 async 연속이
 *   끝까지 못 돌고, 마지막에 `process.exit()` 가 죽여 버린다 — 관제탑이 영영 안 켜졌다(문서 빈 채).
 *   → 상태를 파일(`tmp/ops-status.json`)에 동기로 적어 두고, 이 «자식 프로세스»가 자기 이벤트
 *     루프에서 느긋이 써넣는다. 부모는 `spawnSync` 로 이 자식이 끝날 때까지 «블로킹»으로 기다리므로
 *     쓰기가 실제로 끝난 뒤에 다음 단계로 간다.
 *
 * ★곁다리 원칙 그대로 — 자격증명이 없든 파일이 없든 «조용히» 0 으로 끝낸다. 본업을 막지 않는다.
 */
import { readFileSync } from 'node:fs';
import { publishOpsStatus } from './publish-ops-status.mts';
import type { OpsPipelineStatus } from '../../lib/ops-status';

try {
  const raw = readFileSync('tmp/ops-status.json', 'utf8');
  const status = JSON.parse(raw) as OpsPipelineStatus;
  await publishOpsStatus(status);
} catch {
  // 관제탑은 곁다리다 — 무슨 일이 있어도 조용히 넘어간다.
}
process.exit(0);
