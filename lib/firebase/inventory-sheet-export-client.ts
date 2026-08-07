'use client';

import { getAuthClient } from '@/lib/firebase/client';

export type SheetExportResult = { count: number; tab: string; url: string };

/**
 * 재고를 영업자용 구글시트로 내보낸다. 누를 때마다 새 탭이 맨 왼쪽에 생긴다.
 * 표를 만드는 쪽은 서버(`/api/inventory/sheet-export`)다 — 시트 자격증명이 브라우저에 없어야 한다.
 */
export async function exportInventoryToSheet(): Promise<SheetExportResult> {
  const user = getAuthClient()?.currentUser;
  if (!user) throw new Error('시트 내보내기에는 로그인이 필요합니다.');
  const response = await fetch('/api/inventory/sheet-export', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
    body: '{}',
    cache: 'no-store',
  });
  const body = await response.json().catch(() => ({})) as Partial<SheetExportResult> & { error?: string };
  if (!response.ok || !body.url) throw new Error(body.error || `시트 내보내기 실패 (${response.status})`);
  return { count: Number(body.count) || 0, tab: String(body.tab || ''), url: String(body.url) };
}
