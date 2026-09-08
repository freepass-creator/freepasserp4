'use client';
/**
 * 견적·원가 화면의 **문지기** — 관리자·공급사만 들여보낸다.
 *
 * ★사장님 2026-09-06 「일단 메뉴 자체를 관리자랑 공급사만 보게 해요. 아직 해당 없어」.
 *   ⚠ **메뉴에서 숨기는 것만으로는 막은 게 아니다.** 주소를 아는 사람은 그냥 들어온다.
 *     원가·마진·손익이 보이는 화면이라, 메뉴(하단바·전체메뉴)와 **페이지와 API** 셋을 다 막는다.
 *     명단은 `lib/domain/estimate/audience` 한 곳이 쥔다.
 *
 * ★인증이 아직 안 붙었을 때는 **아무 말도 하지 않는다**(빈 화면). 「권한이 없습니다」를 먼저 띄웠다가
 *   0.3초 뒤 화면이 뜨면, 볼 수 있는 사람이 매번 거절부터 당한다.
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import '@/components/estimate/estimate.css';
import { useSession, useAuthReady } from '@/lib/auth-context';
import { canSeeEstimate } from '@/lib/domain/estimate/audience';
import { isPublicPath } from '@/lib/public-access';

export default function EstimateGate({ children }: { children: ReactNode }) {
  const ready = useAuthReady();
  const session = useSession();

  /* ★★2026-09-08 «임시 공개» — 사장님 「일단 모두 공개로 해주고 로그인할지 말지는 나중에」.
     문지기를 **지우지 않고** 열어 둔다. 닫을 때 이 한 줄만 걷으면 명단이 그대로 되살아난다
     (`lib/domain/estimate/audience` · `lib/public-access.ts` 도 같이 되돌린다).
     ⚠ 지우면 다음 사람이 「원래 문이 없던 화면」으로 안다. 그래서 남겨 둔다. */
  if (isPublicPath('/estimate')) return <>{children}</>;

  if (!ready) return null;                       // 판정 전에는 아무것도 말하지 않는다
  if (canSeeEstimate(session?.role)) return <>{children}</>;

  return (
    <div className="est-root">
      <div className="phone">
        <div className="hd">
          <div className="wm"><span className="a">freepass</span><span className="b">mobility</span></div>
        </div>
        <div className="card" style={{ marginTop: 12 }}>
          <div className="step"><span className="no">!</span>견적</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-1)', marginTop: 2 }}>
            아직 열려 있지 않은 화면입니다
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.7, marginTop: 8 }}>
            견적은 지금 <b>관리자·공급사</b>만 봅니다. 원가·손익이 함께 보이는 화면이라 그렇습니다.
            <br />영업자용 화면은 준비되면 따로 엽니다.
          </div>
          <Link className="gate-go" href="/finder">상품찾기로</Link>
        </div>
      </div>
    </div>
  );
}
