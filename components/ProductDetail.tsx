'use client';
import { useState, useEffect, type CSSProperties, type ReactNode } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { priceList, detailSections, cheapest, type Audience } from '@/lib/domain/product';
import { useProductPhotos } from '@/components/use-product-photos';
import { getRole } from '@/lib/domain/deal';
import { won, C, R, NUM, FW, FS, IconBtn } from '@/components/ui';
import { useDragScroll } from '@/lib/use-drag-scroll';
import {
  badges, Plate, idParts, CardBenefits, CardEvents, OptionChips,
} from '@/components/product-card-atoms';
import { FavHeart } from '@/components/FavHeart';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * 매물 상세 SSOT — 웹·모바일 **동일 원자·동일 타이포**.
 * 차이는 페이지 껍데기 배열(패딩·하단바·스와이프)만. dense/모바일 폰트 분기 금지.
 * /m · 소통·계약 패널 · /q 공용.
 */
const LAB_W = 92;
const lab: CSSProperties = {
  width: LAB_W, flex: `0 0 ${LAB_W}px`, color: C.mute, fontSize: FS.body,
};
const box: CSSProperties = {
  border: `1px solid ${C.line}`, borderRadius: R, background: C.taupeBg, overflow: 'hidden',
};

function KvRow({ label, children, first }: { label: string; children: ReactNode; first?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '7px 12px', fontSize: FS.body,
      borderTop: first ? 'none' : `1px solid ${C.line2}`,
    }}>
      <span style={lab}>{label}</span>
      <span style={{ minWidth: 0, flex: 1, fontVariantNumeric: 'tabular-nums' }}>{children}</span>
    </div>
  );
}

export function ProductDetail({ p, audience }: { p: EntityRecord; audience?: Audience }) {
  const [lb, setLb] = useState<number | null>(null);
  const [main, setMain] = useState(0);
  const photos = useProductPhotos(p);
  const thumbs = useDragScroll();
  useEffect(() => { setMain(0); }, [p.product_code]);
  const mainIdx = Math.min(main, Math.max(0, photos.length - 1));
  const aud: Audience = audience || (getRole() === 'admin' ? 'admin' : 'agent');
  const [swipeX, setSwipeX] = useState<number | null>(null); // 메인 사진 좌우 스와이프
  const stepPhoto = (dir: number) => { if (photos.length > 1) setMain((m) => (m + dir + photos.length) % photos.length); };
  const secs = detailSections(p, aud);
  const prices = priceList(p);
  const cheap = cheapest(p);
  const pol = (p._policy || {}) as Record<string, unknown>;
  const caption = [pol.basic_driver_age, pol.annual_mileage, pol.insurance_included].filter(Boolean).join(' · ');
  const { idMain, idExt } = idParts(p);

  return (
    <div>
      {/* 1 헤더 — 차명 → 차번·상태·상품·심사 → 우대·이벤트 (원자 공용) */}
      <div style={{ marginBottom: 11 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: FS.page, fontWeight: FW.title, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.25 }}>{idMain}</h1>
          {idExt && <span style={{ fontSize: FS.title, fontWeight: FW.meta, color: C.mute }}>{idExt}</span>}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          marginTop: 8, rowGap: 6,
        }}>
          {aud !== 'customer' && <Plate p={p} />}
          {badges(p, false, false, false, aud)}
          <CardBenefits p={p} inline />
          <CardEvents p={p} inline />
        </div>
      </div>

      {/* 2 사진 */}
      {photos.length ? (
        <div>
          <div
            onPointerDown={(e) => setSwipeX(e.clientX)}
            onPointerUp={(e) => {
              const sx = swipeX; setSwipeX(null);
              if (sx != null && Math.abs(e.clientX - sx) > 40) { stepPhoto(e.clientX < sx ? 1 : -1); return; } // 스와이프=넘김
              setLb(mainIdx); // 탭=크게보기
            }}
            style={{ position: 'relative', aspectRatio: '16 / 10', background: C.placeholder, borderRadius: R, overflow: 'hidden', cursor: 'zoom-in', touchAction: 'pan-y', userSelect: 'none' }}
          >
            <img src={photos[mainIdx]} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
            {photos.length > 1 && (
              <>
                <button aria-label="이전 사진" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); stepPhoto(-1); }}
                  style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', cursor: 'pointer', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><ChevronLeft size={20} strokeWidth={2.5} /></button>
                <button aria-label="다음 사진" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); stepPhoto(1); }}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', cursor: 'pointer', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><ChevronRight size={20} strokeWidth={2.5} /></button>
              </>
            )}
            {aud !== 'customer' && <span style={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }}><FavHeart p={p} onPhoto /></span>}
            <span style={{ position: 'absolute', right: 8, bottom: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: FS.cap, fontWeight: FW.strong, padding: '2px 8px', borderRadius: R, fontFamily: NUM, pointerEvents: 'none' }}>{mainIdx + 1} / {photos.length}</span>
          </div>
          {photos.length > 1 && (
            <div
              ref={thumbs.ref}
              onPointerDown={thumbs.onPointerDown}
              onPointerMove={thumbs.onPointerMove}
              onPointerUp={thumbs.onPointerUp}
              onPointerCancel={thumbs.onPointerUp}
              style={{ display: 'flex', gap: 6, marginTop: 6, overflowX: 'auto', paddingBottom: 2, cursor: 'grab', touchAction: 'pan-y', userSelect: 'none', WebkitOverflowScrolling: 'touch' }}
            >
              {photos.map((ph, i) => (
                <IconBtn
                  key={i}
                  title={`사진 ${i + 1}`}
                  onClick={() => { if (thumbs.consumeClick()) return; setMain(i); }}
                  style={{
                    flex: '0 0 auto', width: 74, height: 48, borderRadius: R, overflow: 'hidden',
                    border: `2px solid ${i === mainIdx ? C.brand : 'transparent'}`,
                    padding: 0, background: C.placeholder, cursor: 'inherit',
                  }}
                >
                  <img src={ph} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
                </IconBtn>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ position: 'relative', aspectRatio: '16 / 10', background: C.placeholder, borderRadius: R, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.faint, fontSize: FS.sub }}>
          사진 준비중
          {aud !== 'customer' && <span style={{ position: 'absolute', top: 8, right: 8 }}><FavHeart p={p} onPhoto /></span>}
        </div>
      )}

      {/* 3 섹션 — 데이터=detailSections. 표기 원자=웹·모바일 동일 */}
      {secs.map((sec) => (
        <div key={sec.title} style={{ marginTop: 11 }}>
          <div style={{ fontSize: FS.title, fontWeight: FW.title, color: C.ink, marginBottom: 4 }}>{sec.title}</div>
          {sec.kind === 'price' ? (
            <div style={box}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: FS.body, tableLayout: 'fixed' }}>
                <thead><tr>{['기간', '월대여료', '보증금'].map((h, i) => <th key={h} style={{ width: '33.33%', padding: '6px 10px', textAlign: i === 0 ? 'left' : i === 1 ? 'center' : 'right', background: C.head, borderBottom: `1px solid ${C.line}`, fontSize: FS.cap, color: C.mute, fontWeight: FW.strong }}>{h}</th>)}</tr></thead>
                <tbody>{prices.length === 0 ? <tr><td colSpan={3} style={{ padding: 12, textAlign: 'center', color: C.faint }}>가격 문의</td></tr> :
                  prices.map((pr, i) => {
                    const isCheap = !!cheap && pr.m === cheap.m;
                    return (
                      <tr key={pr.m} style={{ borderTop: i ? `1px solid ${C.line2}` : 'none', background: isCheap ? C.selected : 'transparent' }}>
                        <td style={{ padding: '6px 10px' }}>{pr.m}개월{isCheap && <span style={{ marginLeft: 5, fontSize: FS.micro, fontWeight: FW.label, color: C.taupeBg, background: C.brand, borderRadius: R, padding: '1px 5px', verticalAlign: 'middle' }}>최저</span>}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'center', fontWeight: FW.head, color: C.brand, fontFamily: NUM }}>{won(pr.rent)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: NUM }}>{won(pr.deposit)}</td>
                      </tr>
                    );
                  })}</tbody>
              </table>
              {caption && <div style={{ padding: '6px 10px', fontSize: FS.cap, color: C.faint, borderTop: `1px solid ${C.line2}` }}>* {caption} 기준</div>}
            </div>
          ) : sec.kind === 'ins' ? (
            <div style={box}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: FS.body, tableLayout: 'fixed' }}>
                <thead><tr>{['항목', '보장한도', '면책금'].map((h, i) => <th key={h} style={{ width: i ? '36%' : '28%', textAlign: i ? 'right' : 'left', padding: '5px 10px', background: C.head, borderBottom: `1px solid ${C.line}`, fontSize: FS.cap, fontWeight: FW.strong, color: C.mute }}>{h}</th>)}</tr></thead>
                <tbody>{sec.rows.map(([lbl, limit, ded], i) => (
                  <tr key={lbl} style={{ borderTop: i ? `1px solid ${C.line2}` : 'none' }}>
                    <td style={{ padding: '5px 10px', color: C.mute }}>{lbl}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: limit ? C.ink : C.faint, fontVariantNumeric: 'tabular-nums' }}>{limit || '—'}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: ded ? C.ink : C.faint, fontVariantNumeric: 'tabular-nums' }}>{ded || '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
              {sec.note && <div style={{ padding: '7px 10px', fontSize: FS.cap, color: C.mute, borderTop: `1px solid ${C.line2}`, background: C.head, display: 'flex', gap: 7, alignItems: 'center' }}><span style={{ fontSize: FS.micro, fontWeight: FW.label, color: C.faint }}>부가</span>{sec.note}</div>}
            </div>
          ) : sec.kind === 'chips' ? (
            <div style={{ ...box, padding: '8px 10px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {sec.items.map((o) => <span key={o} style={{ fontSize: FS.sub, color: C.mute, background: C.head, borderRadius: R, padding: '2px 8px' }}>{o}</span>)}
              </div>
            </div>
          ) : (
            // kv — 행·옵션 칩 원자 동일. chipsAfter=1이면 첫 행 뒤에 OptionChips(all).
            <div style={box}>
              {sec.rows.map(([k, v], i) => (
                <div key={`${k}-${i}`}>
                  <KvRow label={k} first={i === 0}>
                    {v || <span style={{ color: C.faint }}>—</span>}
                  </KvRow>
                  {sec.chips && sec.chipsAfter === 1 && i === 0 && (
                    <KvRow label={sec.chipsLabel || '선택옵션'}>
                      <OptionChips p={p} expand />
                    </KvRow>
                  )}
                </div>
              ))}
              {sec.chips && sec.chips.length > 0 && sec.chipsAfter == null && (
                <KvRow label={sec.chipsLabel || '선택옵션'} first={sec.rows.length === 0}>
                  <OptionChips p={p} expand />
                </KvRow>
              )}
            </div>
          )}
        </div>
      ))}

      {lb !== null && photos.length > 0 && (
        <div onClick={() => setLb(null)} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.92)', overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '48px 12px' }}>
          <IconBtn
            title="닫기"
            onClick={(e) => { e.stopPropagation(); setLb(null); }}
            style={{
              position: 'fixed', top: 14, right: 14, width: 40, height: 40, borderRadius: '50%',
              border: 'none', background: 'rgba(255,255,255,0.18)', color: '#fff', fontSize: FS.page, zIndex: 1,
            }}
          >×</IconBtn>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {photos.map((ph, i) => <img key={i} src={ph} alt="" style={{ width: '100%', height: 'auto', borderRadius: R, display: 'block' }} />)}
          </div>
        </div>
      )}
    </div>
  );
}
