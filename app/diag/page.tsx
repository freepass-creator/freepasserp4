'use client';
/**
 * 진단 — RTDB 연결·권한·건수를 한 화면에서 확인. 문제 생겼을 때 콘솔 대신 여기를 본다.
 * 원칙: 아무것도 기다리지 않고 뜬다. 각 노드는 개별 타임아웃 → 하나가 멈춰도 나머지는 결과가 나온다.
 */
import { useState } from 'react';
import { ref, get } from 'firebase/database';
import { getRtdb, getAuthClient, firebaseReady } from '@/lib/firebase/client';
import { getSession } from '@/lib/auth-session';
import { getStore } from '@/lib/store';
import { getCompanyId } from '@/lib/tenant';
import { type EntityRecord } from '@/lib/intake/entities';
import { productImages, productExternalImages, scrapableSources, productPhotos } from '@/lib/domain/product-photos';
import { Page, Btn, Input, C, R, NUM, SectionLabel, Badge, CenterNote, FW, FS } from '@/components/ui';

type Probe = { path: string; state: 'ok' | 'denied' | 'timeout' | 'error'; count: number; detail: string; ms: number };

const NODES = [
  'products', 'v4/products', 'policies', 'partners',
  'contracts', 'v4/contracts', 'users', 'v4/users', 'rooms',
];

/** 개별 타임아웃 — RTDB get 은 오프라인/차단 시 영영 응답하지 않을 수 있다. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | { __timeout: true }> {
  return Promise.race([p, new Promise<{ __timeout: true }>((r) => setTimeout(() => r({ __timeout: true }), ms))]);
}

export default function Diag() {
  const co = getCompanyId();
  const [probes, setProbes] = useState<Probe[] | null>(null);
  const [storeInfo, setStoreInfo] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const auth = firebaseReady() ? getAuthClient() : null;
  const user = auth?.currentUser || null;
  const sess = getSession();

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setProbes(null);
    setStoreInfo([]);

    const db = getRtdb();
    const out: Probe[] = [];
    if (!db) {
      out.push({ path: '(RTDB)', state: 'error', count: 0, detail: 'getRtdb() = null — Firebase 설정 없음', ms: 0 });
      setProbes(out); setBusy(false); return;
    }

    for (const path of NODES) {
      const t0 = Date.now();
      try {
        const snap = await withTimeout(get(ref(db, path)), 8000);
        const ms = Date.now() - t0;
        if (snap && typeof snap === 'object' && '__timeout' in snap) {
          out.push({ path, state: 'timeout', count: 0, detail: '8초 내 응답 없음', ms });
        } else {
          const val = (snap as { val: () => unknown }).val();
          const n = val && typeof val === 'object' ? Object.keys(val as object).length : 0;
          out.push({ path, state: 'ok', count: n, detail: val == null ? '노드 없음(null)' : '', ms });
        }
      } catch (e) {
        const msg = String((e as Error)?.message || e);
        const denied = /permission_denied|permission denied/i.test(msg);
        out.push({ path, state: denied ? 'denied' : 'error', count: 0, detail: msg.slice(0, 160), ms: Date.now() - t0 });
      }
      setProbes([...out]);
    }

    // 스토어 경유 실제 목록 — 어댑터 필터(카슝·10년이상·삭제)까지 통과한 최종 건수
    const info: string[] = [];
    info.push(`backend = ${getStore().backend}`);
    try {
      const t0 = Date.now();
      const list = await withTimeout(getStore().list('product', co), 15000);
      if (list && typeof list === 'object' && '__timeout' in list) info.push('list(product) = 15초 내 응답 없음 ⚠');
      else {
        const rows = list as { vehicle_status?: unknown }[];
        info.push(`list(product) = ${rows.length}건 (${Date.now() - t0}ms)`);
        const byStatus = new Map<string, number>();
        for (const r of rows) { const k = String(r.vehicle_status || '(빈값)'); byStatus.set(k, (byStatus.get(k) || 0) + 1); }
        info.push('상태분포: ' + ([...byStatus].map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'));
      }
    } catch (e) { info.push(`list(product) 실패: ${String((e as Error)?.message || e).slice(0, 160)}`); }
    setStoreInfo(info);
    setBusy(false);
  };

  // ── 사진 진단 — 차번/매물코드로 찾아 단계별로 어디서 끊기는지 ──
  const [photoQ, setPhotoQ] = useState('');
  const [photoOut, setPhotoOut] = useState<string[] | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  const runPhoto = async () => {
    const needle = photoQ.trim();
    if (!needle || photoBusy) return;
    setPhotoBusy(true);
    setPhotoOut(null);
    const L: string[] = [];
    try {
      const rows = (await getStore().list('product', co)) as EntityRecord[];
      const norm = (v: unknown) => String(v ?? '').replace(/\s/g, '');
      const p = rows.find((r) => norm(r.car_number) === norm(needle) || norm(r.product_code) === norm(needle) || norm(r._key) === norm(needle));
      if (!p) { L.push(`매물을 못 찾음: "${needle}" (목록 ${rows.length}건 중)`); setPhotoOut(L); setPhotoBusy(false); return; }
      L.push(`매물: ${String(p.product_code)} · ${String(p.car_number || '')} · ${String(p.maker || '')} ${String(p.model || '')}`);
      L.push('');
      L.push('── 원본 필드 ──');
      for (const k of ['photo', 'photos', 'image_url', 'image_urls', 'images', 'doc_images', 'photo_link']) {
        const v = (p as Record<string, unknown>)[k];
        L.push(`${k}: ${v == null ? '(없음)' : JSON.stringify(v).slice(0, 300)}`);
      }
      L.push('');
      L.push('── 해석 단계 ──');
      const imgs = productImages(p); const ext = productExternalImages(p); const scr = scrapableSources(p);
      L.push(`productImages(업로드사진) = ${imgs.length}건 ${imgs.slice(0, 3).join(' | ')}`);
      L.push(`productExternalImages(직접 <img>) = ${ext.length}건 ${ext.slice(0, 3).join(' | ')}`);
      L.push(`scrapableSources(서버해석 대상) = ${scr.length}건 ${scr.join(' | ')}`);
      L.push(`productPhotos(최종 즉시표시) = ${productPhotos(p).length}건`);
      L.push('');
      L.push('── 서버 해석(/api/extract-photos) ──');
      const link = String(p.photo_link || '').trim();
      if (!scr.length && link) {
        L.push(`⚠ photo_link 는 있는데 스크래핑 대상으로 인식되지 않음 → 서버해석을 아예 안 부름.`);
        L.push(`   link = ${link}`);
        L.push(`   (참고: 인식 패턴은 drive.google.com/drive/folders/ · /drive/u/N/folders/ · moderentcar.co.kr · autoplus.co.kr 뿐)`);
      }
      for (const s of (scr.length ? scr : link ? [link] : [])) {
        try {
          const r = await fetch(`/api/extract-photos?url=${encodeURIComponent(s)}&size=1280`);
          const d = await r.json();
          L.push(`${s}`);
          L.push(`  → HTTP ${r.status} · source=${d?.source ?? '?'} · urls=${Array.isArray(d?.urls) ? d.urls.length : 0}건 ${d?.error ? '· error=' + String(d.error).slice(0, 160) : ''}`);
          if (Array.isArray(d?.urls) && d.urls.length) L.push(`  첫장: ${d.urls[0]}`);
        } catch (e) { L.push(`${s} → 호출 실패: ${String((e as Error)?.message || e).slice(0, 160)}`); }
      }
      if (!scr.length && !link) L.push('photo_link 자체가 비어 있음 — 공급사 시트에 사진링크가 없다는 뜻.');
    } catch (e) {
      L.push(`실패: ${String((e as Error)?.message || e).slice(0, 300)}`);
    }
    setPhotoOut(L);
    setPhotoBusy(false);
  };

  const tone = (s: Probe['state']) => (s === 'ok' ? 'green' : s === 'denied' ? 'red' : s === 'timeout' ? 'amber' : 'gray') as 'green' | 'red' | 'amber' | 'gray';
  const kv = (k: string, v: string) => (
    <div key={k} style={{ display: 'flex', gap: 8, fontSize: FS.sub, padding: '3px 0' }}>
      <span style={{ color: C.mute, minWidth: 120 }}>{k}</span>
      <span style={{ color: C.ink, fontFamily: NUM, wordBreak: 'break-all' }}>{v}</span>
    </div>
  );

  return (
    <Page title="진단" meta="RTDB 연결·권한·건수">
      <SectionLabel mt={0}>환경</SectionLabel>
      {kv('firebaseReady', String(firebaseReady()))}
      {kv('DATA_BACKEND', String(process.env.NEXT_PUBLIC_DATA_BACKEND || '(없음)'))}
      {kv('companyId', co)}
      {kv('auth.currentUser', user ? `${user.uid} · ${user.email || ''}${user.isAnonymous ? ' · 익명' : ''}` : '(없음 — 토큰 미복원 또는 비로그인)')}
      {kv('session', sess ? `${sess.role} · ${sess.name} · company=${sess.company_code || '-'}` : '(없음)')}

      <div style={{ marginTop: 16 }}>
        <Btn onClick={run} disabled={busy}>{busy ? '진단 중…' : '진단 실행'}</Btn>
      </div>

      {probes && (
        <div style={{ marginTop: 16 }}>
          <SectionLabel mt={0}>노드별 읽기</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {probes.map((p) => (
              <div key={p.path} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', border: `1px solid ${C.line}`, borderRadius: R, padding: '6px 10px' }}>
                <span style={{ fontFamily: NUM, fontSize: FS.sub, minWidth: 130, color: C.ink }}>{p.path}</span>
                <Badge tone={tone(p.state)}>{p.state}</Badge>
                <span style={{ fontFamily: NUM, fontSize: FS.sub, fontWeight: FW.head, color: C.ink }}>{p.state === 'ok' ? `${p.count}건` : '—'}</span>
                <span style={{ fontSize: FS.cap, color: C.faint }}>{p.ms}ms</span>
                {p.detail && <span style={{ fontSize: FS.cap, color: C.mute, flex: 1, minWidth: 0 }}>{p.detail}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {storeInfo.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <SectionLabel mt={0}>스토어 경유 최종 목록</SectionLabel>
          {storeInfo.map((l, i) => (
            <div key={i} style={{ fontSize: FS.sub, color: C.ink, fontFamily: NUM, padding: '3px 0' }}>{l}</div>
          ))}
        </div>
      )}

      {!probes && !busy && <CenterNote minHeight={80}>“진단 실행”을 누르면 각 노드를 순서대로 확인합니다.</CenterNote>}

      <div style={{ marginTop: 24 }}>
        <SectionLabel mt={0}>사진 진단 (차번 또는 매물코드)</SectionLabel>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Input value={photoQ} onChange={setPhotoQ} placeholder="예: 161허1402" />
          <Btn onClick={runPhoto} disabled={photoBusy}>{photoBusy ? '확인 중…' : '사진 확인'}</Btn>
        </div>
        {photoOut && (
          <pre style={{
            marginTop: 10, fontSize: FS.cap, lineHeight: 1.6, color: C.ink, background: C.head,
            border: `1px solid ${C.line}`, borderRadius: R, padding: 12,
            whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: NUM,
          }}>{photoOut.join('\n')}</pre>
        )}
      </div>
    </Page>
  );
}
