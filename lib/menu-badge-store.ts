'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { type Role } from '@/lib/domain/deal';
import { loadMenuBadges, type MenuBadgeMap } from '@/lib/domain/menu-badges';

type Entry = {
  key: string;
  role: Role;
  badges: MenuBadgeMap;
  listeners: Set<() => void>;
  refreshing: boolean;
  timer: number | null;
  onFocus: (() => void) | null;
  onVisibility: (() => void) | null;
  onUnread: (() => void) | null;
};

const entries = new Map<string, Entry>();
const EMPTY: MenuBadgeMap = {};

function notify(entry: Entry) { for (const listener of entry.listeners) listener(); }

function getEntry(role: Role, scope: string) {
  const key = `${role}::${scope}`;
  const existing = entries.get(key);
  if (existing) return existing;
  const entry: Entry = { key, role, badges: EMPTY, listeners: new Set(), refreshing: false, timer: null, onFocus: null, onVisibility: null, onUnread: null };
  entries.set(key, entry);
  return entry;
}

function refresh(entry: Entry) {
  if (entry.refreshing || document.visibilityState === 'hidden') return;
  entry.refreshing = true;
  void loadMenuBadges(entry.role)
    .then((badges) => {
      if (entries.get(entry.key) !== entry) return;
      entry.badges = badges;
      notify(entry);
    })
    .catch(() => {})
    .finally(() => { if (entries.get(entry.key) === entry) entry.refreshing = false; });
}

function start(entry: Entry) {
  if (entry.timer != null) return;
  const run = () => refresh(entry);
  entry.onFocus = run;
  entry.onVisibility = () => { if (document.visibilityState === 'visible') run(); };
  entry.onUnread = run;
  run();
  entry.timer = window.setInterval(() => { if (document.visibilityState === 'visible') run(); }, 30_000);
  window.addEventListener('focus', entry.onFocus);
  document.addEventListener('visibilitychange', entry.onVisibility);
  window.addEventListener('fp:unread', entry.onUnread);
}

function stop(entry: Entry) {
  if (entry.timer != null) window.clearInterval(entry.timer);
  entry.timer = null;
  if (entry.onFocus) window.removeEventListener('focus', entry.onFocus);
  if (entry.onVisibility) document.removeEventListener('visibilitychange', entry.onVisibility);
  if (entry.onUnread) window.removeEventListener('fp:unread', entry.onUnread);
  entry.onFocus = null;
  entry.onVisibility = null;
  entry.onUnread = null;
}

function purgeOtherScopes(scope: string) {
  for (const [key, entry] of entries) {
    if (entry.key.endsWith(`::${scope}`)) continue;
    stop(entry);
    entries.delete(key);
  }
}

/** 상단 메뉴와 하단 탭이 같은 알림 숫자·폴링을 공유한다. */
export function useMenuBadges(role: Role | null, scope: string) {
  const key = role ? `${role}::${scope}` : '';
  const subscribe = useMemo(() => (listener: () => void) => {
    if (!role) return () => {};
    const entry = getEntry(role, scope);
    entry.listeners.add(listener);
    start(entry);
    return () => { entry.listeners.delete(listener); if (entry.listeners.size === 0) stop(entry); };
  }, [key]);
  const snapshot = useMemo(() => () => role ? getEntry(role, scope).badges : EMPTY, [key]);
  const badges = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  useEffect(() => { if (scope) purgeOtherScopes(scope); }, [scope]);
  const refreshNow = useMemo(() => () => { if (role) refresh(getEntry(role, scope)); }, [key]);
  return { badges, refresh: refreshNow };
}
