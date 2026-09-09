'use client';
/**
 * **정산 콕핏 — 진짜 문.** 로그인한 관리자가 원자를 보고 남긴다.
 *
 * ★얼굴은 `components/settlement/SettlementBoard` 한 몸이고, 여기는 «데이터 오는 길»만 맡는다.
 *   같은 얼굴을 미리보기(`/settlement/board/preview`)도 쓴다 — 사장님 2026-09-09
 *   「일단 화면 디자인부터 하고 로그인에 붙이면 안 될까?」
 *
 * ★★★**인증이 «복원될 때까지» 묻지 않는다.** 로그인 화면으로 보내는 일은 `AuthProvider` 가 한다.
 *   그 앞에서 우리가 「로그인이 필요합니다」를 띄우면 **로그인 화면을 가린다** —
 *   2026-09-09 사장님 「야 로그인이 필요하면 로그인 화면을 줘야 하는데 왜 안 나와??」가 그것이었다.
 */
import { useMemo } from 'react';
import { getAuthClient } from '@/lib/firebase/client';
import { useAuthReady, useSession } from '@/lib/auth-context';
import SettlementBoard, { type BoardApi, type Board, type Car } from '@/components/settlement/SettlementBoard';

async function bearer(): Promise<string | null> {
  const user = getAuthClient()?.currentUser;
  return user ? user.getIdToken() : null;
}

export default function SettlementBoardPage() {
  const ready = useAuthReady();
  const session = useSession();

  const api = useMemo<BoardApi>(() => ({
    ready: ready && !!session,
    load: async (month, q) => {
      const t = await bearer(); if (!t) return null;
      const p = new URLSearchParams();
      if (month) p.set('month', month);
      if (q) p.set('q', q);
      const r = await fetch(`/api/settlement/board?${p}`, { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' });
      return r.ok ? (await r.json() as Board) : null;
    },
    save: async (patch) => {
      const t = await bearer(); if (!t) return { ok: false, error: '로그인이 풀렸습니다' };
      const r = await fetch('/api/settlement/board', {
        method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch }),
      });
      const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
      return { ok: r.ok && !!j.ok, error: j.error };
    },
    car: async (plate) => {
      const t = await bearer(); if (!t) return null;
      const r = await fetch(`/api/settlement/board?plate=${encodeURIComponent(plate)}`,
        { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json() as Car;
      return j.found ? j : null;
    },
  }), [ready, session]);

  /** 인증 복원 전·비로그인 — 아무것도 안 그린다. 껍데기가 로그인 화면을 그린다. */
  if (!ready || !session) return null;
  return <SettlementBoard api={api} />;
}
