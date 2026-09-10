'use client';
/**
 * **정산 콕핏 — 미리보기 문.** 로그인 없이 «얼굴만» 본다.
 *
 * ⚠ **Next App Router 의 page 는 정해진 것 말고 «아무것도 내보낼 수 없다».**
 *   여기서 `useSampleApi`·`IntakeStationPreview` 를 같이 내보냈다가 타입 검사가 깨졌다
 *   (2026-09-10 코덱스 검증이 잡았다 — 나는 grep 으로 걸러 보느라 못 봤다).
 *   ⇒ 샘플과 얼굴은 `components/settlement/SamplePreview.tsx` 로 옮겼다. 여기는 «문»만 남는다.
 */
import { SettlementBoardPreview } from '@/components/settlement/SamplePreview';
export default function Page() { return <SettlementBoardPreview />; }
