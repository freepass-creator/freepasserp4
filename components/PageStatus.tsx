'use client';
import type { LucideIcon } from 'lucide-react';
import { FileText, ScrollText, Users, History, Search, Wrench } from 'lucide-react';
import { C, NUM, FW, FS, R } from '@/components/ui';
import { NAV_ICON } from '@/lib/tabbar';

/**
 * 상단바 상태창 SSOT — 상품검색과 동일 DNA.
 *   [아이콘] 라벨 N단위 · (선택) 보조 라벨 M단위
 */
export function PageStatus({
  icon: Icon,
  label,
  count,
  unit = '건',
  secondaryLabel,
  secondaryCount,
  secondaryUnit,
}: {
  icon: LucideIcon;
  label: string;
  count?: number | string | null;
  unit?: string;
  secondaryLabel?: string;
  secondaryCount?: number | string | null;
  secondaryUnit?: string;
}) {
  const n = count == null || count === '' ? null : count;
  const sn = secondaryCount == null || secondaryCount === '' ? null : secondaryCount;
  const sUnit = secondaryUnit ?? unit;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      minWidth: 0, width: '100%',
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, flex: '0 0 auto', borderRadius: R,
        background: C.head, color: C.mute,
      }}>
        <Icon size={15} strokeWidth={2.25} />
      </span>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 6,
        minWidth: 0, flex: '1 1 auto',
        whiteSpace: 'nowrap', overflow: 'hidden',
        fontSize: FS.title, fontWeight: FW.head, letterSpacing: '-0.02em', color: C.ink,
      }}>
        <span style={{ color: C.mute, fontWeight: FW.strong, fontSize: FS.body }}>{label}</span>
        {n != null ? (
          <span style={{ fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>
            {typeof n === 'number' ? n.toLocaleString() : n}
            <span style={{ marginLeft: 1, fontSize: FS.sub, fontWeight: FW.strong, color: C.mute }}>{unit}</span>
          </span>
        ) : null}
        {secondaryLabel ? (
          <>
            <span style={{ color: C.line, fontWeight: FW.meta, margin: '0 2px' }}>·</span>
            <span style={{
              color: sn != null ? C.brand : C.ink,
              fontWeight: FW.strong,
              fontSize: FS.body,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>{secondaryLabel}</span>
            {sn != null ? (
              <span style={{
                fontFamily: NUM, fontVariantNumeric: 'tabular-nums', color: C.brand,
              }}>
                {typeof sn === 'number' ? sn.toLocaleString() : sn}
                <span style={{ marginLeft: 1, fontSize: FS.sub, fontWeight: FW.strong }}>{sUnit}</span>
              </span>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** 페이지 타이틀·경로 → 상태 아이콘 (하단탭 NAV_ICON 우선) */
export function statusIconFor(titleOrPath: string): LucideIcon {
  const s = titleOrPath;
  if (s === '/' || s === '상품' || s.startsWith('/m/')) return NAV_ICON.product;
  if (s.includes('문의') || s.startsWith('/chat')) return NAV_ICON.chat;
  if (s === '계약' || s.startsWith('/contract')) return NAV_ICON.contract;
  if (s.includes('재고') || s.startsWith('/inventory')) return NAV_ICON.inventory;
  if (s.includes('설정') || s.startsWith('/settings')) return NAV_ICON.settings;
  if (s.includes('정책') || s.startsWith('/policy')) return ScrollText;
  if (s.includes('정산') || s.startsWith('/settlement')) return FileText;
  if (s.includes('회원') || s.startsWith('/members')) return Users;
  if (s.includes('감사') || s.startsWith('/audit')) return History;
  if (s.includes('데이터') || s.startsWith('/data-check')) return Search;
  if (s.includes('개발') || s.startsWith('/dev')) return Wrench;
  return NAV_ICON.product;
}
