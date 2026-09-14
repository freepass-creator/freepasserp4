'use client';

import { createContext, useContext, type ReactNode } from 'react';

/** 업무 ERP에는 공개 프레임을 중복하지 않고 chrome 표식만 전달한다. */
export type InternalWhitelabelChrome = { enabled: boolean; headline: string };
const DEFAULT: InternalWhitelabelChrome = { enabled: false, headline: '' };
const InternalWhitelabelContext = createContext<InternalWhitelabelChrome>(DEFAULT);

export function InternalWhitelabelProvider({ value, children }: { value: InternalWhitelabelChrome; children: ReactNode }) {
  return <InternalWhitelabelContext.Provider value={value}>{children}</InternalWhitelabelContext.Provider>;
}

export function useInternalWhitelabel() { return useContext(InternalWhitelabelContext); }
