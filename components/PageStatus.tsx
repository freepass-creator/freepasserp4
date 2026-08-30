'use client';
import type { LucideIcon } from 'lucide-react';
import { FileText, ScrollText, Users, History, Search, Wrench } from 'lucide-react';
import { C, NUM, FW, FS, R, ICON, ctrlH } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
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
  const mobile = useIsMobile();
  const n = count == null || count === '' ? null : count;
  const sn = secondaryCount == null || secondaryCount === '' ? null : secondaryCount;
  const sUnit = secondaryUnit ?? unit;
  const chip = ctrlH(false, 'sm');
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: mobile ? 7 : 8,
      minWidth: 0, width: '100%',
    }}>
      {/* 모바일 = **박스 없는 맨 아이콘**(사장님 2026-08-22 「좌측 상단 아이콘도 박스에 들어가 있으면 안 되는데」)
          — 우측 햄버거와 같은 문법·같은 글리프 크기(ICON.md). 잉크가 곧 왼쪽 12px 기준선이 된다.
          웹은 회색 칩 유지(좌측 전체메뉴 버튼이 테두리를 가져 둘이 짝을 이룬다). */}
      {/* 모바일 네이비 띠 위에서는 CSS 가 이 아이콘을 감춘다(그 자리는 CI 마크) — globals.css .fp-pagestatus-icon */}
      <span className="fp-pagestatus-icon" style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flex: '0 0 auto', color: C.mute,
        ...(mobile ? null : { width: chip, height: chip, borderRadius: R, background: C.head }),
      }}>
        <Icon size={mobile ? ICON.md : ICON.sm} strokeWidth={2.25} />
      </span>
      {/* ★모바일 = **한 줄이 한 크기**(FS.title) — 굵기·색으로만 위계를 준다.
             제목 18 / 보조 13 처럼 섞으면 한 줄 안에서 글자가 두 번 꺾여 «크기가 안 맞는» 걸로 보인다
             (사장님 2026-08-30 「위에 글씨 크기 … 제대로 해서」).
          ⚠ **키우지 않는다.** 한때 FS.page(18)로 올렸다가 되돌렸다 —
             사장님 2026-08-30 「상단 텍스트 크기만 좀 일괄적으로, **완전 B2C 플랫폼은 아니니까**」.
             소비자 앱 머리처럼 큰 제목은 이 도구의 격에 안 맞는다. 크기는 웹과 같은 단(FS.title)에 두고
             «모바일다움»은 크기가 아니라 짜임(제목=잉크 굵게 / 대수·보조=회색)으로 낸다.
          웹은 반대다(라벨 회색 · 숫자 잉크) — 고밀도 격자에서는 숫자가 먼저 읽혀야 한다. */}
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: mobile ? 5 : 6,
        minWidth: 0, flex: '1 1 auto',
        whiteSpace: 'nowrap', overflow: 'hidden',
        fontSize: FS.title, fontWeight: FW.head, letterSpacing: '-0.02em', color: C.ink,
      }}>
        <span style={mobile
          ? { color: C.ink, fontWeight: FW.head }
          : { color: C.mute, fontWeight: FW.strong, fontSize: FS.body }}>{label}</span>
        {n != null ? (
          <span style={{
            fontFamily: NUM, fontVariantNumeric: 'tabular-nums',
            ...(mobile ? { color: C.mute, fontWeight: FW.strong } : null),
          }}>
            {typeof n === 'number' ? n.toLocaleString() : n}
            <span style={{
              marginLeft: 1, fontWeight: FW.strong, color: C.mute,
              ...(mobile ? null : { fontSize: FS.sub }),
            }}>{unit}</span>
          </span>
        ) : null}
        {secondaryLabel ? (
          <>
            <span style={{ color: C.line, fontWeight: FW.meta, margin: '0 2px' }}>·</span>
            <span style={{
              color: sn != null ? C.brand : C.ink,
              fontWeight: FW.strong,
              ...(mobile ? null : { fontSize: FS.body }),
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>{secondaryLabel}</span>
            {sn != null ? (
              <span style={{
                fontFamily: NUM, fontVariantNumeric: 'tabular-nums', color: C.brand,
              }}>
                {typeof sn === 'number' ? sn.toLocaleString() : sn}
                <span style={{ marginLeft: 1, fontWeight: FW.strong, ...(mobile ? null : { fontSize: FS.sub }) }}>{sUnit}</span>
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
  if (s.includes('내가본') || s.startsWith('/interest')) return NAV_ICON.interest;
  if (s.includes('정책') || s.startsWith('/policy')) return ScrollText;
  if (s.includes('정산') || s.startsWith('/settlement')) return FileText;
  if (s.includes('회원') || s.startsWith('/members')) return Users;
  if (s.includes('감사') || s.startsWith('/audit')) return History;
  if (s.includes('데이터') || s.startsWith('/data-check')) return Search;
  if (s.includes('개발') || s.startsWith('/dev')) return Wrench;
  return NAV_ICON.product;
}
