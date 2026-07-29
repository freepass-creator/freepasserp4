'use client';

import { useEffect, useState } from 'react';

/**
 * 입·퇴장 전환 SSOT — BottomSheet mounted+leaving+EXIT_MS 패턴 재사용.
 * open=false여도 퇴장 애니메이션 끝날 때까지 mounted 유지.
 */
export function useEnterExit(open: boolean, ms = 220): {
  mounted: boolean;
  leaving: boolean;
} {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    setLeaving(true);
    const t = window.setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, ms);
    return () => window.clearTimeout(t);
  }, [open, mounted, ms]);

  return { mounted, leaving };
}
