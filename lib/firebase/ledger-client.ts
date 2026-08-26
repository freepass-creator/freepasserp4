'use client';

import { getAuthClient } from '@/lib/firebase/client';

/**
 * **정산원장 API 는 로그인 토큰을 붙여야 열린다.**
 *
 * ★2026-08-26: `/api/settlement/ledger` 가 인증 없이 열려 있었다 —
 *   URL 만 알면 금액과 고객연락처가 통째로 나갔다. 화면을 관리자에게만 보여 주는 것과
 *   API 를 관리자에게만 여는 것은 다르다. 그래서 서버에 자물쇠를 달았고, 부르는 쪽은 여기로 모은다.
 * ⚠ 부르는 곳마다 토큰 붙이는 코드를 복사하면 한 곳은 반드시 빠뜨린다.
 */
export async function ledgerFetch(path: string, init?: RequestInit): Promise<Response> {
  const user = getAuthClient()?.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  return fetch(path, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.headers || {}),
      Authorization: 'Bearer ' + (await user.getIdToken()),
    },
  });
}
