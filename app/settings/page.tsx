'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Page, Btn, C, SectionLabel, DetailGrid, ListRow, FilterChips, NUM,
} from '@/components/ui';
import { useSession } from '@/lib/auth-context';
import { getRole, setRole, actor, ROLE_LABEL, type Role } from '@/lib/domain/deal';
import { setGuest, isGuest } from '@/lib/auth-session';
import { haptic } from '@/lib/haptics';
import { BRAND } from '@/lib/brand';
import { listHidden, unhideProduct, clearHidden, subscribeHidden, type HiddenSnap } from '@/lib/product-hide';
import { listPassed, unpassProduct, clearPassed, subscribePassed, type PassSnap } from '@/lib/product-pass';
import { listRecent, listFavs, clearRecent, clearFavs, subscribeInterest } from '@/lib/product-interest';
import {
  getThemePref, setThemePref, getHapticOn, setHapticOn, subscribePrefs,
  type ThemePref, applyTheme,
} from '@/lib/prefs';
import { toast } from '@/components/Toaster';
import { useIsMobile } from '@/lib/use-mobile';

const DEMO_ROLES: { key: Role; label: string }[] = [
  { key: 'agent', label: '영업자' },
  { key: 'provider', label: '공급사' },
  { key: 'admin', label: '관리자' },
];

const THEMES: { key: ThemePref; label: string }[] = [
  { key: 'light', label: '라이트' },
  { key: 'dark', label: '다크' },
  { key: 'system', label: '시스템' },
];

const HAPTIC_OPTS: { key: 'on' | 'off'; label: string }[] = [
  { key: 'on', label: '켜기' },
  { key: 'off', label: '끄기' },
];

/** 설정 — 계정·화면·피드백·관심·숨김·앱정보. 박스 중첩 없음. */
export default function Settings() {
  const router = useRouter();
  const mobile = useIsMobile();
  const session = useSession();
  const guest = isGuest();
  const [role, setRoleLocal] = useState<Role>('agent');
  const [hidden, setHidden] = useState<HiddenSnap[]>([]);
  const [passed, setPassed] = useState<PassSnap[]>([]);
  const [recentN, setRecentN] = useState(0);
  const [favN, setFavN] = useState(0);
  const [theme, setTheme] = useState<ThemePref>('light');
  const [hapticOn, setHapticLocal] = useState(true);
  const [appEnv, setAppEnv] = useState('—');

  useEffect(() => {
    setRoleLocal(getRole());
    const on = (e: Event) => setRoleLocal((e as CustomEvent).detail as Role);
    window.addEventListener('fp:role', on);
    return () => window.removeEventListener('fp:role', on);
  }, [session]);

  useEffect(() => {
    const refreshHide = () => { setHidden(listHidden()); setPassed(listPassed()); };
    const refreshInterest = () => { setRecentN(listRecent().length); setFavN(listFavs().length); };
    const refreshPrefs = () => {
      setTheme(getThemePref());
      setHapticLocal(getHapticOn());
    };
    refreshHide();
    refreshInterest();
    refreshPrefs();
    applyTheme();
    setAppEnv(window.matchMedia('(display-mode: standalone)').matches ? '홈화면 앱' : '브라우저');
    const offH = subscribeHidden(refreshHide);
    const offP = subscribePassed(refreshHide);
    const offI = subscribeInterest(refreshInterest);
    const offPr = subscribePrefs(refreshPrefs);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onMq = () => { if (getThemePref() === 'system') applyTheme('system'); };
    mq.addEventListener('change', onMq);
    return () => {
      offH(); offP(); offI(); offPr();
      mq.removeEventListener('change', onMq);
    };
  }, []);

  const name = session ? session.name : actor(role).name;
  const email = session?.email || '';
  const company = session?.company_code || '';
  const demoRole = !session;
  const statusLabel = session ? '로그인' : guest ? '둘러보기(비로그인)' : '데모';

  const doLogout = async () => {
    haptic.impact();
    try { const { logout } = await import('@/lib/firebase/auth'); await logout(); } catch { /* noop */ }
    setGuest(false);
    router.replace('/login');
  };

  const switchRole = (r: Role) => {
    setRole(r);
    setRoleLocal(r);
    haptic.tap();
  };

  const onTheme = (t: ThemePref) => {
    setThemePref(t);
    setTheme(t);
    haptic.select();
    toast(t === 'system' ? '시스템 테마' : t === 'dark' ? '다크 테마' : '라이트 테마', 'ok');
  };

  const onHaptic = (v: 'on' | 'off') => {
    setHapticOn(v === 'on');
    setHapticLocal(v === 'on');
    if (v === 'on') haptic.select();
    toast(v === 'on' ? '햅틱 켜짐' : '햅틱 꺼짐', 'info');
  };

  const empty = (text: string) => (
    <div style={{ padding: '10px 0 4px', fontSize: 13, color: C.faint, lineHeight: 1.45 }}>{text}</div>
  );

  return (
    <Page title="설정">
      <div style={{
        maxWidth: 560,
        width: '100%',
        margin: mobile ? undefined : '0 auto',
        boxSizing: 'border-box',
        padding: mobile ? '12px 14px' : '16px 0 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}>
        <div>
          <SectionLabel mt={0}>계정</SectionLabel>
          <DetailGrid rows={[
            ['이름', name],
            ['역할', ROLE_LABEL[role] || role],
            ['이메일', email],
            ...(company ? [['회사', company] as [string, string]] : []),
            ['상태', statusLabel],
          ]} />
          <div style={{ marginTop: 12 }}>
            <Btn variant="danger" full onClick={doLogout}>
              {session || guest ? '로그아웃' : '로그인'}
            </Btn>
          </div>
        </div>

        <div>
          <SectionLabel mt={0}>화면</SectionLabel>
          <div style={{ fontSize: 12, color: C.faint, marginBottom: 8 }}>테마</div>
          <FilterChips value={theme} onChange={(k) => onTheme(k as ThemePref)} options={THEMES} />
        </div>

        <div>
          <SectionLabel mt={0}>피드백</SectionLabel>
          <div style={{ fontSize: 12, color: C.faint, marginBottom: 8 }}>햅틱(진동)</div>
          <FilterChips
            value={hapticOn ? 'on' : 'off'}
            onChange={(k) => onHaptic(k as 'on' | 'off')}
            options={HAPTIC_OPTS}
          />
          <div style={{ marginTop: 8, fontSize: 12, color: C.faint, lineHeight: 1.45 }}>
            모바일에서 탭·전환 시 짧은 진동. 미지원 기기는 자동으로 무시됩니다.
          </div>
        </div>

        <div>
          <SectionLabel mt={0}>
            관심함{recentN + favN > 0 ? ` · ${recentN + favN}` : ''}
          </SectionLabel>
          <DetailGrid rows={[
            ['최근 본', `${recentN}건`],
            ['찜', `${favN}건`],
          ]} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            <Btn size="sm" variant="ghost" disabled={recentN === 0} onClick={() => {
              haptic.impact();
              clearRecent();
              toast('최근 본을 비웠습니다', 'info');
            }}>최근 비우기</Btn>
            <Btn size="sm" variant="ghost" disabled={favN === 0} onClick={() => {
              haptic.impact();
              clearFavs();
              toast('찜을 비웠습니다', 'info');
            }}>찜 비우기</Btn>
          </div>
        </div>

        <div>
          <SectionLabel mt={0}>
            관심없음{passed.length > 0 ? ` · ${passed.length}` : ''}
          </SectionLabel>
          {passed.length === 0 ? empty('「관심없음」한 상품은 목록 맨 뒤로 보냅니다.') : (
            <>
              {passed.map((h) => (
                <ListRow
                  key={h.code}
                  main={h.name || h.code}
                  sub={h.plate ? <span style={{ fontFamily: NUM }}>{h.plate}</span> : undefined}
                  right={(
                    <Btn size="sm" variant="ghost" onClick={() => {
                      haptic.select();
                      unpassProduct(h.code);
                      toast('다시 앞쪽에 표시합니다', 'ok');
                    }}>앞으로</Btn>
                  )}
                />
              ))}
              <div style={{ paddingTop: 8 }}>
                <Btn size="sm" variant="ghost" onClick={() => {
                  haptic.impact();
                  clearPassed();
                  toast('관심없음을 모두 해제했습니다', 'info');
                }}>전체 앞으로</Btn>
              </div>
            </>
          )}
        </div>

        <div>
          <SectionLabel mt={0}>
            숨긴 상품{hidden.length > 0 ? ` · ${hidden.length}` : ''}
          </SectionLabel>
          {hidden.length === 0 ? empty('「숨기기」한 상품은 목록에서 빠집니다. 여기서 다시 볼 수 있어요.') : (
            <>
              {hidden.map((h) => (
                <ListRow
                  key={h.code}
                  main={h.name || h.code}
                  sub={h.plate ? <span style={{ fontFamily: NUM }}>{h.plate}</span> : undefined}
                  right={(
                    <Btn size="sm" variant="ghost" onClick={() => {
                      haptic.select();
                      unhideProduct(h.code);
                      toast('다시 목록에 표시됩니다', 'ok');
                    }}>보이기</Btn>
                  )}
                />
              ))}
              <div style={{ paddingTop: 8 }}>
                <Btn size="sm" variant="ghost" onClick={() => {
                  haptic.impact();
                  clearHidden();
                  toast('숨긴 상품을 모두 해제했습니다', 'info');
                }}>전체 보이기</Btn>
              </div>
            </>
          )}
        </div>

        {demoRole ? (
          <div>
            <SectionLabel mt={0}>데모 역할</SectionLabel>
            <FilterChips
              value={role}
              onChange={(k) => switchRole(k as Role)}
              options={DEMO_ROLES}
            />
            <div style={{ marginTop: 8, fontSize: 12, color: C.faint, lineHeight: 1.45 }}>
              미로그인 데모용. 관리자로 바꾸면 메뉴·개발도구에 들어갑니다.
            </div>
          </div>
        ) : null}

        {role === 'admin' ? (
          <div>
            <SectionLabel mt={0}>관리</SectionLabel>
            <ListRow main="개발도구" href="/dev" />
            <ListRow main="데이터점검" href="/data-check" />
            <ListRow main="감사로그" href="/audit" />
          </div>
        ) : null}

        <div>
          <SectionLabel mt={0}>앱</SectionLabel>
          <DetailGrid rows={[
            ['이름', BRAND],
            ['버전', '4.0.0-alpha'],
            ['환경', appEnv],
          ]} />
          <div style={{ marginTop: 10, fontSize: 12, color: C.faint, lineHeight: 1.5 }}>
            화이트라벨 렌터카 중개 ERP.
          </div>
        </div>
      </div>
    </Page>
  );
}
