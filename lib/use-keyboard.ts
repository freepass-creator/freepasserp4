'use client';

import { useSyncExternalStore } from 'react';

/**
 * 소프트 키보드가 실제로 올라와 있는지.
 *
 * focus 여부로 판정하면 안 된다. 뒤로가기로 키보드만 내려도 입력칸은 계속 focus 상태라,
 * focus 기준이면 하단바가 돌아오지 않는다. 따라서 visual viewport 축소만 기준으로 삼는다.
 * AppTabBar·WorkPage·채팅처럼 호출부가 함께 있을 수 있으므로 listener는 모듈에서 한 번만 유지한다.
 */
const listeners = new Set<() => void>();
let listening = false;
let snapshot = '0:0'; // supported:open — primitive snapshot으로 useSyncExternalStore 안정성 유지

function readSnapshot() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!vv) return '0:0';
  // 주소창 접힘(약 60px)과 키보드를 구분하기 위한 여유.
  const gap = window.innerHeight - vv.height - vv.offsetTop;
  return `1:${gap > 120 ? 1 : 0}`;
}

function notify() {
  const next = readSnapshot();
  if (next === snapshot) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function start() {
  if (listening || typeof window === 'undefined') return;
  const vv = window.visualViewport;
  if (!vv) return;
  listening = true;
  snapshot = readSnapshot();
  vv.addEventListener('resize', notify);
  vv.addEventListener('scroll', notify);
}

function stopIfIdle() {
  if (!listening || listeners.size > 0 || typeof window === 'undefined') return;
  const vv = window.visualViewport;
  if (vv) {
    vv.removeEventListener('resize', notify);
    vv.removeEventListener('scroll', notify);
  }
  listening = false;
  snapshot = '0:0';
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    stopIfIdle();
  };
}

function getSnapshot() { return snapshot; }
function getServerSnapshot() { return '0:0'; }

export function useKeyboardOpen(): { open: boolean; supported: boolean } {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [supported, open] = state.split(':');
  return { supported: supported === '1', open: open === '1' };
}
