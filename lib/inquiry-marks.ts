'use client';
import { useEffect, useState } from 'react';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { getSession } from '@/lib/auth-session';
import { canAccessOwnedRecord } from '@/lib/domain/authorization';
import { hasRoomStoredActivity } from '@/lib/domain/room-activity';

/**
 * **문의가 오간 매물** 코드 집합 — 카드의 「문의중」 표시와 관심함 「문의」 탭이 같이 쓴다.
 *
 * 최근·관심은 이 기기(localStorage)지만 문의는 **방 데이터**에서 나온다.
 *   영업자      = 내가 문의를 남긴 매물
 *   공급사·관리자 = 나에게 문의가 들어온 매물
 * 그래서 기기를 바꿔도 따라오고, 두 화면(카드·탭)이 같은 답을 낸다.
 *
 * ★방 목록은 화면마다 다시 읽지 않는다 — 한 번 읽어 공유하고 `fp:unread`(새 말·읽음) 때만 갱신한다.
 *   카드가 수십 장 뜨는 목록에서 각자 조회하면 목록이 열리지 않는다.
 */
let codes = new Set<string>();
let loaded = false;
let inflight: Promise<void> | null = null;
const subs = new Set<() => void>();

function notify() { subs.forEach((fn) => fn()); }

function load(): Promise<void> {
  if (inflight) return inflight;
  inflight = getStore().list('room', getCompanyId())
    .then((rooms) => {
      const session = getSession();
      const next = new Set<string>();
      for (const room of rooms) {
        if (!canAccessOwnedRecord(session, room)) continue;
        if (!hasRoomStoredActivity(room)) continue;
        const code = String(room.product_code || room.product_uid || '').trim();
        if (code) next.add(code);
      }
      codes = next;
      loaded = true;
    })
    .catch(() => { loaded = true; })
    .finally(() => { inflight = null; notify(); });
  return inflight;
}

/** 문의가 오간 매물 코드들. 첫 호출에 한 번 읽고, 그 뒤엔 방 변화(fp:unread)에만 다시 읽는다. */
export function useInquiredCodes(): Set<string> {
  const [snapshot, setSnapshot] = useState(codes);
  useEffect(() => {
    const sync = () => setSnapshot(codes);
    subs.add(sync);
    if (!loaded) void load();
    const refresh = () => { void load(); };
    window.addEventListener('fp:unread', refresh);
    // 로그인 계정이 바뀌면 다시 읽는다 — 안 그러면 앞 사람의 «문의중» 표시가 카드에 남는다.
    window.addEventListener('fp:session', refresh);
    return () => {
      subs.delete(sync);
      window.removeEventListener('fp:unread', refresh);
      window.removeEventListener('fp:session', refresh);
    };
  }, []);
  return snapshot;
}
