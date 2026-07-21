'use client';
import type { CSSProperties } from 'react';
import { BRAND_MAIN } from '@/lib/brand';
import { chatDisplayName } from '@/lib/domain/deal';
import { C, FS } from '@/components/ui';

/**
 * 채팅 발신 라벨
 *  · 관리자: 문자열 "freepass" 자체가 명함 CI 워드마크(Exo 2·600·네이비). 뒤에 CI 장식/뱃지 없음.
 *  · `.이름` = 일반 캡션
 *  · 그 외 역할 = 유저코드 평문
 */
export function ChatSenderLabel({
  role, name, code, style,
}: {
  role: string;
  name: string;
  code?: string;
  style?: CSSProperties;
}) {
  const base: CSSProperties = { fontSize: FS.cap, color: C.faint, lineHeight: 1, ...style };
  if (role === 'admin') {
    const n = String(name || '').trim();
    return (
      <span style={{ ...base, display: 'inline-flex', alignItems: 'flex-end' }}>
        {/* = login-brand-main 동일 — freepass 글자 자체가 CI */}
        <span style={{
          fontFamily: "'Exo 2', Pretendard, sans-serif",
          fontWeight: 600,
          fontSize: FS.cap,
          lineHeight: 1,
          color: C.brand,
          letterSpacing: '-0.04em',
          textTransform: 'lowercase',
        }}>
          {BRAND_MAIN}
        </span>
        {n ? <span style={{ fontSize: FS.cap, lineHeight: 1, fontWeight: 500 }}>.{n}</span> : null}
      </span>
    );
  }
  return <span style={base}>{chatDisplayName(role, name, code)}</span>;
}
