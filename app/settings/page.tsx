'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Page, Btn, ButtonLabel, SectionLabel, ListRow, FilterChips, Input, Select, Message, WorkTable, WorkRow, WorkInput, fmtPhone, ICON,
} from '@/components/ui';
import { Copy, Download, KeyRound, LoaderCircle, LogIn, LogOut, Save } from 'lucide-react';
import { useSession } from '@/lib/auth-context';
import { getRole, setRole, actor, ROLE_LABEL, type Role } from '@/lib/domain/deal';
import { clearLegacyGuestState } from '@/lib/auth-session';
import { haptic } from '@/lib/haptics';
import { BRAND, VERSION } from '@/lib/brand';
import { listHidden, subscribeHidden, type HiddenSnap } from '@/lib/product-hide';
import { listPassed, subscribePassed, type PassSnap } from '@/lib/product-pass';
import { listRecent, listFavs, subscribeInterest } from '@/lib/product-interest';
import {
  getThemePref, setThemePref, getHapticOn, setHapticOn, subscribePrefs,
  getIdleMinutes, setIdleMinutes, type ThemePref, applyTheme,
} from '@/lib/prefs';
import { confirmDialog, toast } from '@/components/Toaster';
import { useIsMobile } from '@/lib/use-mobile';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { isStockedProduct } from '@/lib/domain/product';
import type { EntityRecord } from '@/lib/intake/entities';
import { NAV_LABEL } from '@/lib/tabbar';
import { copyText } from '@/lib/clipboard';
// 설정의 파일/상품 선호 패널은 스크롤 아래의 보조 기능이다. 계정·화면 설정을 먼저
// 반응시키고, 해당 섹션이 필요할 때만 불러온다.
const ProductPreferences = dynamic(() => import('@/features/settings/ProductPreferences').then((m) => m.ProductPreferences), {
  ssr: false,
});
const MyFiles = dynamic(() => import('@/features/settings/MyFiles').then((m) => m.MyFiles), {
  ssr: false,
});
const EsignManualOfferSettings = dynamic(() => import('@/features/settings/EsignManualOfferSettings').then((m) => m.EsignManualOfferSettings), {
  ssr: false,
});
/** 로컬 미인증 데모 — 관리자 승격 금지. */
const DEMO_ROLES: { key: Role; label: string }[] = [
  { key: 'agent', label: '영업자' },
  { key: 'provider', label: '공급사' },
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

const IDLE_OPTS: { key: string; label: string }[] = [
  { key: '0', label: '끔' },
  { key: '10', label: '10분' },
  { key: '30', label: '30분' },
  { key: '60', label: '60분' },
];

/** 설정 — 계정·화면·피드백·관심·숨김·앱정보. 박스 중첩 없음. */
export default function Settings() {
  const session = useSession();
  const [mounted, setMounted] = useState(false);
  const visibleSession = mounted ? session : null;
  const [role, setRoleLocal] = useState<Role>('agent');
  const [hidden, setHidden] = useState<HiddenSnap[]>([]);
  const [passed, setPassed] = useState<PassSnap[]>([]);
  const [recentN, setRecentN] = useState(0);
  const [favN, setFavN] = useState(0);
  const [theme, setTheme] = useState<ThemePref>('light');
  const [hapticOn, setHapticLocal] = useState(true);
  const [appEnv, setAppEnv] = useState('—');
  const [pName, setPName] = useState('');
  const [pPhone, setPPhone] = useState('');
  const [pInit, setPInit] = useState({ name: '', phone: '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [pwdBusy, setPwdBusy] = useState(false);
  const [idleMin, setIdleLocal] = useState(0);
  const [origin, setOrigin] = useState('');
  const [photoDownloading, setPhotoDownloading] = useState(false);
  const [photoDownloadLabel, setPhotoDownloadLabel] = useState('공급사 사진 받기');
  const [photoProducts, setPhotoProducts] = useState<EntityRecord[]>([]);
  const [photoProvider, setPhotoProvider] = useState('');
  const mobile = useIsMobile();

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (mobile || visibleSession?.role !== 'admin') return;
    let alive = true;
    getStore().list('product', getCompanyId())
      .then((products) => { if (alive) setPhotoProducts(products.filter(isStockedProduct)); })
      .catch(() => { if (alive) setPhotoProducts([]); });
    return () => { alive = false; };
  }, [mobile, visibleSession?.role]);

  useEffect(() => {
    setRoleLocal(getRole());
    const on = (e: Event) => setRoleLocal((e as CustomEvent).detail as Role);
    window.addEventListener('fp:role', on);
    return () => window.removeEventListener('fp:role', on);
  }, [session]);

  // 내 프로필(이름·연락처) 로드 — 편집 폼 초기값
  useEffect(() => {
    if (!session) return;
    let alive = true;
    (async () => {
      try {
        const { loadMyProfile } = await import('@/lib/firebase/auth');
        const p = await loadMyProfile();
        if (!alive) return;
        const nm = String(p?.name ?? session.name ?? '');
        const ph = String(p?.phone ?? '');
        setPName(nm); setPPhone(ph); setPInit({ name: nm, phone: ph });
      } catch { /* noop */ }
    })();
    return () => { alive = false; };
  }, [session]);

  useEffect(() => {
    const refreshHide = () => { setHidden(listHidden()); setPassed(listPassed()); };
    const refreshInterest = () => { setRecentN(listRecent().length); setFavN(listFavs().length); };
    const refreshPrefs = () => {
      setTheme(getThemePref());
      setHapticLocal(getHapticOn());
      setIdleLocal(getIdleMinutes());
    };
    refreshHide();
    refreshInterest();
    refreshPrefs();
    applyTheme();
    setAppEnv(window.matchMedia('(display-mode: standalone)').matches ? '홈화면 앱' : '브라우저');
    setOrigin(window.location.origin);
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

  // actor()도 내부에서 localStorage 세션을 읽으므로 hydration 전에는 호출하지 않는다.
  const name = visibleSession ? visibleSession.name : mounted ? actor(role).name : '박영업';
  const email = visibleSession?.email || '';
  const company = visibleSession?.company_code || '';
  const demoRole = !visibleSession;
  const statusLabel = visibleSession ? '로그인' : '데모';

  const doLogout = async () => {
    haptic.impact();
    try { const { logout } = await import('@/lib/firebase/auth'); await logout(); } catch { /* noop */ }
    clearLegacyGuestState();
    // soft replace면 세션 null 설정이 데모 UI로 한 프레임 그려진 뒤 /login — 하드 이동으로 스킵.
    window.location.href = '/login';
  };

  const switchRole = (r: Role) => {
    if (r === 'admin' && !session) {
      toast('관리자 화면은 관리자 계정으로 로그인하세요.', 'info');
      return;
    }
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

  const profileDirty = !!session && (pName.trim() !== pInit.name.trim() || pPhone.trim() !== pInit.phone.trim());
  const saveProfile = async () => {
    if (!profileDirty || savingProfile) return;
    setSavingProfile(true);
    try {
      const { updateMyProfile } = await import('@/lib/firebase/auth');
      await updateMyProfile({ name: pName.trim(), phone: pPhone.trim() });
      setPInit({ name: pName.trim(), phone: pPhone.trim() });
      haptic.select();
      toast('내 정보를 저장했습니다', 'ok');
    } catch (e) { toast('저장 실패: ' + String((e as Error).message || e), 'error'); }
    finally { setSavingProfile(false); }
  };
  const changePassword = async () => {
    if (!email || pwdBusy) return;
    setPwdBusy(true);
    try {
      const { resetPassword } = await import('@/lib/firebase/auth');
      await resetPassword(email);
      toast(`비밀번호 재설정 메일을 보냈습니다 · ${email}`, 'ok');
    } catch (e) { toast('메일 발송 실패: ' + String((e as Error).message || e), 'error'); }
    finally { setPwdBusy(false); }
  };
  const onIdle = (m: number) => {
    setIdleMinutes(m);
    setIdleLocal(m);
    toast(m ? `${m}분 자리비움 시 자동 로그아웃` : '자동 로그아웃 끔', 'info');
  };
  const shareCode = visibleSession ? String(visibleSession.user_code || visibleSession.code || visibleSession.uid || '') : '';
  const shareUrl = origin && shareCode ? `${origin}/catalog?a=${encodeURIComponent(shareCode)}` : '';
  const copyShare = async () => {
    if (!shareUrl) return;
    if (await copyText(shareUrl)) {
      haptic.select();
      toast('공유 링크를 복사했습니다', 'ok');
    } else toast('복사 실패 — 링크를 길게 눌러 복사하세요', 'error');
  };
  const downloadAllInventoryPhotos = async () => {
    if (photoDownloading) return;
    setPhotoDownloading(true);
    try {
      const targets = photoProducts.filter((product) => String(product.provider_company_code || '').trim() === photoProvider);
      const providerName = String(targets[0]?.provider_name || photoProvider || '').trim();
      if (!photoProvider || !targets.length) throw new Error('사진을 받을 공급사를 선택해 주세요.');
      const approved = await confirmDialog({
        title: `${providerName} 차량사진`,
        message: `${providerName} 판매 가능 재고 ${targets.length.toLocaleString()}대의 사진을 차량 10대 단위 ZIP으로 저장합니다. 브라우저에서 여러 파일 다운로드를 허용해 주세요.`,
        okLabel: '사진 받기',
      });
      if (!approved) return;
      // ZIP 생성기와 사진 resolver는 관리자만 가끔 쓰는 무거운 경로다. 설정을 열 때
      // 내려받지 않고, 실제 다운로드를 확정한 뒤에만 가져온다.
      const { downloadInventoryPhotoArchives } = await import('@/lib/client/download-photo-zip');
      const result = await downloadInventoryPhotoArchives(targets, ({ batch, batches }) => setPhotoDownloadLabel(`사진 묶는 중 ${batch}/${batches}`));
      toast(`ZIP ${result.archives}개 · 차량 ${result.vehicles}대 · 사진 ${result.photos}장${result.noPhoto ? ` · 사진없음 ${result.noPhoto}대` : ''}${result.failed ? ` · 실패 ${result.failed}장` : ''}`, result.failed ? 'info' : 'ok');
    } catch (error) {
      toast(`전체 사진 다운로드 실패: ${String((error as Error)?.message || error)}`, 'error');
    } finally {
      setPhotoDownloading(false);
      setPhotoDownloadLabel('공급사 사진 받기');
    }
  };
  const photoProviderOptions = [...photoProducts.reduce((map, product) => {
    const code = String(product.provider_company_code || '').trim();
    if (!code) return map;
    const label = String(product.provider_name || code).trim();
    map.set(code, { value: code, label });
    return map;
  }, new Map<string, { value: string; label: string }>()).values()]
    .sort((a, b) => a.label.localeCompare(b.label, 'ko'));

  return (
    <Page title="설정">
      {/* 웹 = 폭 활용 2단(섹션 원자는 그대로, 배열만 컬럼) · 모바일 = 단일 세로 스크롤. */}
      <style>{`
        /* 그룹 간 16 — 섹션 리듬(12)보다 한 단 넓게(제목이 얇은 글자라 12면 그룹이 붙어 보임), 20은 과했다(2026-08-22 공통규격 정리). */
        .fp-settings-grid { max-width: 560px; width: 100%; box-sizing: border-box; margin: 0 auto; padding: 12px 0; display: flex; flex-direction: column; gap: 16px; }
        @media (min-width: 760px) {
          .fp-settings-grid { max-width: 960px; padding: 18px 16px 28px; display: block; column-count: 2; column-gap: 30px; }
          .fp-settings-grid > * { break-inside: avoid; -webkit-column-break-inside: avoid; margin-bottom: 22px; }
        }
      `}</style>
      <div className="fp-settings-grid">
        <div>
          <WorkTable title="계정">
            {visibleSession ? (
              <>
                <WorkRow label="이름"><WorkInput value={pName} onChange={setPName} placeholder="이름" /></WorkRow>
                <WorkRow label="연락처"><WorkInput value={pPhone} onChange={(v) => setPPhone(fmtPhone(v))} inputMode="tel" placeholder="010-0000-0000" /></WorkRow>
              </>
            ) : (
              <WorkRow label="이름">{name}</WorkRow>
            )}
            <WorkRow label="역할">{ROLE_LABEL[role] || role}</WorkRow>
            <WorkRow label="이메일">{email}</WorkRow>
            {company ? <WorkRow label="회사">{company}</WorkRow> : null}
            <WorkRow label="상태">{statusLabel}</WorkRow>
          </WorkTable>
          {visibleSession ? (
            <div style={{ marginTop: 8 }}>
              <Btn title={savingProfile ? '내 정보 저장 중' : '내 정보 저장'} size="sm" onClick={saveProfile} disabled={!profileDirty || savingProfile}>
                <ButtonLabel icon={<Save size={ICON.md} aria-hidden />}>{savingProfile ? '저장 중…' : '내 정보 저장'}</ButtonLabel>
              </Btn>
            </div>
          ) : null}
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleSession ? (
              <Btn title={pwdBusy ? '재설정 메일 전송 중' : '비밀번호 변경'} variant="ghost" full onClick={changePassword} disabled={pwdBusy}>
                <ButtonLabel icon={<KeyRound size={ICON.md} aria-hidden />}>{pwdBusy ? '메일 전송 중…' : '비밀번호 변경 (재설정 메일)'}</ButtonLabel>
              </Btn>
            ) : null}
            {/* danger 빨강은 파괴적 동작(로그아웃)에만. 미로그인 상태의 '로그인'은 주 액션이다. */}
            <Btn title={visibleSession ? '로그아웃' : '로그인'} variant={visibleSession ? 'danger' : 'solid'} full onClick={doLogout}>
              <ButtonLabel icon={visibleSession ? <LogOut size={ICON.md} aria-hidden /> : <LogIn size={ICON.md} aria-hidden />}>
                {visibleSession ? '로그아웃' : '로그인'}
              </ButtonLabel>
            </Btn>
          </div>
        </div>

        {visibleSession && shareUrl ? (
          <div>
            <SectionLabel mt={0}>카탈로그 공유</SectionLabel>
            <Message variant="info">내 영업자 정보가 연결된 상품 안내 링크입니다. 카톡·문자로 손님에게 공유하세요.</Message>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Input value={shareUrl} onChange={() => {}} readOnly full ariaLabel="카탈로그 공유 링크" />
              <Btn title="카탈로그 링크 복사" size="sm" onClick={copyShare}>
                <ButtonLabel icon={<Copy size={ICON.md} aria-hidden />}>복사</ButtonLabel>
              </Btn>
            </div>
          </div>
        ) : null}

        <div>
          <SectionLabel mt={0}>화면</SectionLabel>
          <FilterChips value={theme} onChange={(k) => onTheme(k as ThemePref)} options={THEMES} />
        </div>

        <div>
          <SectionLabel mt={0}>피드백</SectionLabel>
          <FilterChips
            value={hapticOn ? 'on' : 'off'}
            onChange={(k) => onHaptic(k as 'on' | 'off')}
            options={HAPTIC_OPTS}
          />
          <Message variant="info">모바일에서 탭·전환 시 짧은 진동. 미지원 기기는 자동으로 무시됩니다.</Message>
        </div>

        {visibleSession ? (
          <div>
            <SectionLabel mt={0}>보안</SectionLabel>
            <FilterChips value={String(idleMin)} onChange={(k) => onIdle(Number(k))} options={IDLE_OPTS} />
            <Message variant="info">설정한 시간 동안 활동이 없으면 자동 로그아웃됩니다. 공용 PC에서 유용.</Message>
          </div>
        ) : null}

        {/* 내가 올린 파일 — 읽기 전용. 로그인 사용자만(둘러보기엔 uid 가 없다) */}
        {visibleSession?.uid ? <div><MyFiles uid={visibleSession.uid} /></div> : null}

        <ProductPreferences
          recentCount={recentN}
          favoriteCount={favN}
          passed={passed}
          hidden={hidden}
          showInterest={!mobile}
        />

        {demoRole ? (
          <div>
            <SectionLabel mt={0}>데모 역할</SectionLabel>
            <FilterChips
              value={role}
              onChange={(k) => switchRole(k as Role)}
              options={DEMO_ROLES}
            />
            <Message variant="info">
              미로그인 데모용(영업·공급). 관리자 메뉴는 관리자 계정 로그인이 필요합니다.
              손님 공유 링크는 카탈로그·상품 안내(`/catalog`, `/q/…`)로 전달하세요.
            </Message>
          </div>
        ) : null}

        {visibleSession?.role === 'admin' ? (
          <div>
            <SectionLabel mt={0}>관리</SectionLabel>
            <EsignManualOfferSettings />
            {!mobile && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ marginBottom: 6 }}>
                  <Select
                    full
                    value={photoProvider}
                    onChange={setPhotoProvider}
                    placeholder="공급사 선택"
                    options={photoProviderOptions}
                  />
                </div>
                <Btn full variant="ghost" title="선택한 공급사의 판매 가능 차량사진 받기" onClick={downloadAllInventoryPhotos} disabled={photoDownloading || !photoProvider}>
                  <ButtonLabel icon={photoDownloading ? <LoaderCircle size={ICON.md} className="fp-spin" aria-hidden /> : <Download size={ICON.md} aria-hidden />}>
                    {photoDownloadLabel}
                  </ButtonLabel>
                </Btn>
                <Message variant="info">선택한 공급사의 사진을 차량번호 폴더로 정리해 차량 10대 단위 ZIP으로 저장합니다. PC에서만 이용할 수 있습니다.</Message>
              </div>
            )}
            {/* 관리자 전용 화면(월별정산·계약서관리 등) 입구는 모바일도 햄버거다(2026-08-22 밤 「관리자 햄버거 ㅇㅋ」 — 여기 두면 중복). */}
            <ListRow main="개발도구" href="/dev" />
            <ListRow main={NAV_LABEL.dataCheck} href="/data-check" />
            <ListRow main={NAV_LABEL.audit} href="/audit" />
          </div>
        ) : null}

        <div>
          <WorkTable title="앱">
            <WorkRow label="이름">{BRAND}</WorkRow>
            <WorkRow label="버전">{VERSION}</WorkRow>
            <WorkRow label="환경">{appEnv}</WorkRow>
          </WorkTable>
          <Message variant="info">화이트라벨 렌터카 중개 ERP.</Message>
        </div>
      </div>
    </Page>
  );
}
