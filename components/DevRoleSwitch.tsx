'use client';
import { useEffect, useState } from 'react';
import type { Role } from '@/lib/domain/deal';
import { getSession } from '@/lib/auth-session';
import { canUseDevRole, getDevRole, setDevRole } from '@/lib/dev-role';
import { Btn, C, R, FS, FW, SH } from '@/components/ui';

const ROLES: { key: Role; label: string }[] = [
  { key: 'agent', label: '영업자' },
  { key: 'provider', label: '공급사' },
  { key: 'admin', label: '관리자' },
];

/**
 * 테스트 모드 스위치 — 로그인한 채로 **화면만** 다른 역할로 본다.
 *
 * 역할별로 화면이 갈리면서(영업자=내 대화 / 공급사·관리자=문의 목록 / 손님=대여료만)
 * 확인하려면 계정을 번갈아 로그인해야 했다. 그 왕복을 없앤다.
 *
 * ★켜져 있는 동안 **화면 구석에 계속 떠 있다.** 모르고 남겨 두면 없는 버그를 쫓게 된다.
 * ★권한은 안 바뀐다 — 서버 규칙은 로그인 uid 의 실제 역할로 판단한다(배치 확인용).
 */
export function DevRoleSwitch() {
  const [allowed, setAllowed] = useState(false);
  const [role, setRoleS] = useState<Role | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setAllowed(canUseDevRole());
    setRoleS(getDevRole());
    const on = () => { setAllowed(canUseDevRole()); setRoleS(getDevRole()); };
    window.addEventListener('fp:session', on);
    return () => window.removeEventListener('fp:session', on);
  }, []);

  if (!allowed) return null;

  const real = getSession()?.role;
  const pick = (r: Role | null) => {
    setDevRole(r);
    setRoleS(r);
    setOpen(false);
  };

  return (
    <div style={{
      position: 'fixed', left: 10, bottom: 'calc(var(--fp-tabbar-h, 0px) + 10px)', zIndex: 90,
      display: 'flex', alignItems: 'center', gap: 6,
      background: role ? C.warnBg : C.taupeBg,
      border: `1px solid ${role ? C.warn : C.line}`,
      borderRadius: R, boxShadow: SH.cardRest, padding: '4px 6px',
    }}>
      <button
        type="button"
        className="fp-press"
        onClick={() => setOpen((v) => !v)}
        title="테스트 역할 전환(화면만 바뀝니다)"
        style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: FS.micro, fontWeight: FW.label, color: role ? C.warn : C.mute }}
      >
        {role ? `테스트 · ${ROLES.find((x) => x.key === role)?.label}` : '테스트 역할'}
      </button>
      {open ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {ROLES.map((r) => (
            <Btn
              key={r.key}
              size="sm"
              variant={role === r.key ? 'solid' : 'ghost'}
              title={`${r.label} 화면으로`}
              onClick={() => pick(r.key)}
            >{r.label}</Btn>
          ))}
          <Btn size="sm" variant="ghost" title="원래 역할로" onClick={() => pick(null)}>
            해제{real ? ` · ${ROLES.find((x) => x.key === real)?.label || real}` : ''}
          </Btn>
        </span>
      ) : null}
    </div>
  );
}
