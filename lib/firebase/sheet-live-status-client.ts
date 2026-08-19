'use client';

import { getAuthClient } from '@/lib/firebase/client';

export const SHEET_LIVE_STATUS_POLL_MS = 60_000;

export async function fetchSheetLiveStatuses(signal?: AbortSignal): Promise<Record<string, string> | null> {
  const user = getAuthClient()?.currentUser;
  if (!user) return null;
  const token = await user.getIdToken();
  const response = await fetch('/api/sheet/live-status', {
    method: 'POST',
    cache: 'no-store',
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      'Cache-Control': 'no-cache',
    },
  });
  const payload = await response.json().catch(() => ({})) as { statuses?: unknown; blockReason?: unknown; error?: unknown };
  if (payload.statuses && typeof payload.statuses === 'object' && !Array.isArray(payload.statuses)) {
    return payload.statuses as Record<string, string>;
  }
  if (!response.ok) throw new Error(String(payload.blockReason || payload.error || `HTTP ${response.status}`));
  return null;
}

