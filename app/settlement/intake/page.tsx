'use client';
/** **접수 워크스테이션 — 진짜 문.** 로그인한 관리자가 재고를 보며 접수한다. */
import { useMemo } from 'react';
import { getAuthClient } from '@/lib/firebase/client';
import { useAuthReady, useSession } from '@/lib/auth-context';
import IntakeStation from '@/components/settlement/IntakeStation';
import type { BoardApi, Board, Car, LineSpec } from '@/components/settlement/SettlementBoard';

async function bearer(): Promise<string | null> {
  const user = getAuthClient()?.currentUser;
  return user ? user.getIdToken() : null;
}

export default function IntakePage() {
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
      const j = await r.json().catch(() => ({})) as { ok?: boolean; error?: string; id?: string };
      return { ok: r.ok && !!j.ok, error: j.error, id: j.id };
    },
    edit: async (id, patch) => {
      const t = await bearer(); if (!t) return { ok: false, error: '로그인이 풀렸습니다' };
      const r = await fetch('/api/settlement/board', {
        method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, patch }),
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
    /** 접수 줄 하나를 «통째로» — 목록에 못 실은 시트 나머지 칸이 여기 온다. */
    line: async (id) => {
      const t = await bearer(); if (!t) return null;
      const r = await fetch(`/api/settlement/board?line=${encodeURIComponent(id)}`,
        { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json() as { found?: boolean; spec?: LineSpec[] };
      return j.found ? (j.spec || []) : null;
    },
  }), [ready, session]);
  if (!ready || !session) return null;
  return <IntakeStation api={api} />;
}
