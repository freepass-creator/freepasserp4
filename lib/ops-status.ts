/*
 * ⚠ 이 파일은 **서버 전용이 아니다**(`server-only` 를 붙이지 않는다).
 *   같은 스키마를 셋이 쓴다 — 상태를 «쓰는» 자동동기 스크립트, «읽는» API,
 *   그리고 «그리는» 관제탑 화면. 세 곳이 각자 모양을 정하면 그게 곧 드리프트다.
 *   비밀이 없는 타입·경로·순수 판정만 둔다.
 */
/**
 * 관제탑 상태 SSOT — **파이프라인이 지금 무엇을 하고 있나**를 한 곳에 적는다.
 *
 * ★왜 필요한가 (2026-09-04 실측)
 *   자동동기는 21단계 전 구간의 성공·실패·소요초를 **이미 잘 남기고 있다** —
 *   `tmp/자동동기-상태.json`. 그런데 그 파일에는 문제가 둘 있었다:
 *     ㉠ `tmp/` 는 git 무시라 **그 PC 안에만** 있다. 원격에서 못 본다.
 *     ㉡ **끝나야 써진다**(`writeStatus()` 가 종료·중단 시점에만 호출). 그래서
 *        「지금 도는 중인가」를 알려면 `ls tmp/hourly-sync.lock/` 을 셸에서 쳐 봐야 했다.
 *   그리고 그 파일을 **읽는 코드가 저장소에 하나도 없었다**(grep 0건).
 *   ⇒ 잘 남기는데 아무도 못 보는 상태였다. 여기서 그걸 닫는다.
 *
 * ★비용 — 문서 **하나**다. 관제탑은 이것만 읽는다.
 *   매물 전량(1.2MB)을 폴링하면 열 명이 10분마다 봐도 월 50달러쯤 나가지만,
 *   이 2KB 짜리 한 줄이면 30초마다 봐도 월 몇 천 원이다. 폴링 «주기»가 아니라
 *   읽는 «크기»가 비용을 정한다.
 *
 * ★그리고 숫자가 한 군데서 나온다. 2026-09-04 하루에만 대수가 576·697·716 셋으로 갈렸다.
 *   관제탑·손님 화면·시트가 같은 문서를 보면 그 갈림이 애초에 안 생긴다.
 */

/** 관제탑이 읽는 자리. 문서 하나 — 통째로 덮어쓴다(부분 갱신 안 한다). */
export const OPS_PIPELINE_PATH = 'v4/ops/pipeline';

/** 한 단계의 결과 — `hourly-sync.mts` 의 `steps[]` 와 같은 모양이다(두 벌로 만들지 않는다). */
export type OpsStep = {
  단계: string;
  ok: boolean;
  초?: number;
  신호?: string;
  요약?: string;
};

export type OpsPipelineStatus = {
  /** 실행 표딱지 — 회차를 가른다. */
  runId: string;
  /** 언제 시작했나 (KST 표기) */
  startedAt: string;
  /** 마지막으로 이 문서를 만진 시각 — **이 값이 곧 심장박동**이다. */
  updatedAt: string;
  /** 신선도 판정용 epoch ms. 화면은 「몇 분 전」을 이걸로 센다. */
  updatedMs: number;
  /** 도는 중인가. 끝나면 false. */
  running: boolean;
  /** 반영(APPLY)인가 미리보기(dry-run)인가 — 미리보기 회차를 성공으로 착각하지 않게. */
  apply: boolean;
  /** 시작부터 지금까지 초. */
  elapsedSec: number;
  /** 전체 성패. **도는 중에는 `null`** — 아직 모른다는 뜻이고, 화면이 성공으로 칠하면 안 된다. */
  ok: boolean | null;
  /** 중단 사유(있을 때만). */
  stoppedBy?: string;
  /** 지금 하고 있는 단계 이름 — 도는 중일 때만 의미가 있다. */
  currentStep?: string;
  /** 여태 끝난 단계들. */
  steps: OpsStep[];
  /** 차종마스터 매칭 커버리지(⓪ 손오공 정제가 준다). */
  coverage?: { 총: number; 매칭: number; 모델없음: number; 트림실패: number; 매칭율: number } | null;
  /** 눈에 띄게 남긴 것 — 느린 단계·어긋남 신호·중단. */
  warnings: string[];
  /** 한 줄 요약 조각들. */
  summary: string[];
  /** 어느 기계에서 돌았나 — 로컬 스케줄러와 GitHub Actions 를 가른다. */
  host?: string;
};

/** 심장이 이만큼 조용하면 「멈춘 것으로 본다」 — 잠금 판정과 같은 값(5분). */
export const OPS_STALE_MS = 5 * 60_000;

/**
 * 화면이 쓰는 «지금 상태» 판정 — 문자열 하나로 좁힌다.
 * ★`running: true` 인데 심장이 조용하면 **「돈다」가 아니라 「멈췄다」**이다.
 *   프로세스가 죽으면 문서를 닫아 줄 놈이 없어서 running 이 true 인 채로 남는다.
 *   그 상태를 초록으로 칠하면 관제탑이 거짓말을 한다.
 */
export type OpsHealth = 'running' | 'stalled' | 'ok' | 'failed' | 'none';

export function opsHealth(s: OpsPipelineStatus | null, now = Date.now()): OpsHealth {
  if (!s) return 'none';
  const quiet = now - (Number(s.updatedMs) || 0);
  if (s.running) return quiet > OPS_STALE_MS ? 'stalled' : 'running';
  return s.ok === false ? 'failed' : 'ok';
}

export const OPS_HEALTH_LABEL: Record<OpsHealth, string> = {
  running: '돌고 있음',
  stalled: '멈춤 — 심장이 조용하다',
  ok: '정상 — 마지막 회차 성공',
  failed: '실패 — 마지막 회차가 끝까지 못 갔다',
  none: '기록 없음 — 아직 한 번도 안 올라왔다',
};
