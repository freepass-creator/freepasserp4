'use client';
import { useState, useEffect, Fragment, type CSSProperties } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { priceList, detailSections, cheapest, type Audience } from '@/lib/domain/product';
import { useProductPhotos } from '@/components/use-product-photos';
import { getRole } from '@/lib/domain/deal';
import { won, C } from '@/components/ui';
import { useIsMobile } from '@/lib/use-mobile';
import { useDragScroll } from '@/lib/use-drag-scroll';
import { badges, Plate, idParts } from '@/components/product-card-atoms';
import { FavHeart } from '@/components/FavHeart';
import { ReportButton } from '@/components/ReportButton';

// 매물 상세 = 공통 원자(사진 갤러리·라이트박스 · 전기간 요금표 · 정책 섹션). 모바일=단일컬럼 반응형.
// /m 전체페이지 + 소통·계약 우패널이 같이 씀(새로 만들지 않고 이 원자를 끌어다 씀).
export function ProductDetail({ p, audience }: { p: EntityRecord; audience?: Audience }) {
  const [lb, setLb] = useState<number | null>(null);
  const [main, setMain] = useState(0);
  const photos = useProductPhotos(p);
  const thumbs = useDragScroll();
  useEffect(() => { setMain(0); }, [p.product_code]);
  const mainIdx = Math.min(main, Math.max(0, photos.length - 1));
  const aud: Audience = audience || (getRole() === 'admin' ? 'admin' : 'agent');
  const secs = detailSections(p, aud);
  const prices = priceList(p);
  const cheap = cheapest(p);
  const pol = (p._policy || {}) as Record<string, unknown>;
  // 세부 타이포 — 웹은 공간대비 넉넉히(13~13.5), 모바일은 담백히. 원자 공유·크기만 분기.
  const mobile = useIsMobile();
  const fTitle = mobile ? 13 : 13.5, fBody = mobile ? 12.5 : 13.5, fLab = mobile ? 12 : 13, fTable = mobile ? 12 : 13, fChip = mobile ? 11.5 : 12.5;
  const lab: CSSProperties = { width: mobile ? 84 : 92, flex: `0 0 ${mobile ? 84 : 92}px`, color: C.mute, fontSize: fLab };
  const caption = [pol.basic_driver_age, pol.annual_mileage, pol.insurance_included].filter(Boolean).join(' · ');
  const { idMain, idExt } = idParts(p);

  return (
    <div>
      {/* 헤더 = 카드와 같은 신원 언어. 찜은 카드와 동일하게 사진 좌측 하단. */}
      <div style={{ marginBottom: 11 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.25 }}>{idMain}</h1>
          {idExt && <span style={{ fontSize: 14, fontWeight: 500, color: C.mute }}>{idExt}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 8 }}><Plate p={p} />{badges(p)}</div>
      </div>

      {photos.length ? (
        <div>
          <div onClick={() => setLb(mainIdx)} style={{ position: 'relative', aspectRatio: '16 / 10', background: '#eef1f5', borderRadius: 6, overflow: 'hidden', cursor: 'zoom-in' }}>
            <img src={photos[mainIdx]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <span style={{ position: 'absolute', left: 8, bottom: 8, zIndex: 2 }}><FavHeart p={p} onPhoto /></span>
            <span style={{ position: 'absolute', right: 8, bottom: 8, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 3, fontFamily: 'var(--font-mono)' }}>{mainIdx + 1} / {photos.length}</span>
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
                <button key={i} onClick={() => { if (thumbs.consumeClick()) return; setMain(i); }} aria-label={`사진 ${i + 1}`} style={{ flex: '0 0 auto', width: 74, height: 48, borderRadius: 4, overflow: 'hidden', border: `2px solid ${i === mainIdx ? C.brand : 'transparent'}`, padding: 0, cursor: 'inherit', background: '#eef1f5', pointerEvents: 'auto' }}>
                  <img src={ph} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ position: 'relative', aspectRatio: '16 / 10', background: '#eef1f5', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.faint, fontSize: 12.5 }}>
          사진 준비중
          <span style={{ position: 'absolute', left: 8, bottom: 8 }}><FavHeart p={p} onPhoto /></span>
        </div>
      )}

      {(() => { const firstSub = secs.findIndex((x) => x.tier === 'sub'); return secs.map((sec, si) => (
        <Fragment key={sec.title}>
          {si === firstSub && firstSub > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.faint, letterSpacing: '0.03em' }}>부가 정보</span>
              <span style={{ flex: 1, height: 1, background: C.line2 }} />
            </div>
          )}
          <div style={{ marginTop: 11 }}>
            <div style={{ fontSize: fTitle, fontWeight: 800, color: C.ink, marginBottom: 4 }}>{sec.title}</div>
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 4, background: '#fff', overflow: 'hidden' }}>
              {sec.kind === 'price' ? (
                <>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: fTable, tableLayout: 'fixed' }}>
                    <thead><tr>{['기간', '월대여료', '보증금'].map((h, i) => <th key={i} style={{ width: '33.33%', padding: '6px 10px', textAlign: i ? 'right' : 'left', background: C.head, borderBottom: `1px solid ${C.line}`, fontSize: 11, color: '#33415a', fontWeight: 700 }}>{h}</th>)}</tr></thead>
                    <tbody>{prices.length === 0 ? <tr><td colSpan={3} style={{ padding: 12, textAlign: 'center', color: C.faint }}>가격 문의</td></tr> :
                      prices.map((pr, i) => {
                        const isCheap = !!cheap && pr.m === cheap.m;
                        return (
                          <tr key={i} style={{ borderTop: i ? `1px solid ${C.line2}` : 'none', background: isCheap ? '#eff6ff' : 'transparent' }}>
                            <td style={{ padding: '6px 10px' }}>{pr.m}개월{isCheap && <span style={{ marginLeft: 5, fontSize: 9.5, fontWeight: 800, color: '#fff', background: C.brand, borderRadius: 3, padding: '1px 5px', verticalAlign: 'middle' }}>최저</span>}</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 800, color: C.brand, fontFamily: 'var(--font-mono)' }}>{won(pr.rent)}</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{won(pr.deposit)}</td>
                          </tr>
                        );
                      })}</tbody>
                  </table>
                  {caption && <div style={{ padding: '6px 10px', fontSize: 11, color: C.faint, borderTop: `1px solid ${C.line2}` }}>* {caption} 기준</div>}
                </>
              ) : sec.kind === 'ins' ? (<>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: fTable, tableLayout: 'fixed' }}>
                  <thead><tr>{['항목', '보장한도', '면책금'].map((h, i) => <th key={i} style={{ width: i ? '36%' : '28%', textAlign: i ? 'right' : 'left', padding: '5px 10px', background: C.head, borderBottom: `1px solid ${C.line}`, fontSize: 11, fontWeight: 700, color: '#33415a' }}>{h}</th>)}</tr></thead>
                  <tbody>{sec.rows.map(([lbl, limit, ded], i) => (
                    <tr key={i} style={{ borderTop: i ? `1px solid ${C.line2}` : 'none' }}>
                      <td style={{ padding: '5px 10px', color: C.mute }}>{lbl}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: limit ? C.ink : '#cbd5e1', fontVariantNumeric: 'tabular-nums' }}>{limit || '—'}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: ded ? C.ink : '#cbd5e1', fontVariantNumeric: 'tabular-nums' }}>{ded || '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
                {sec.note && <div style={{ padding: '7px 10px', fontSize: 11.5, color: C.mute, borderTop: `1px solid ${C.line2}`, background: '#fafbfc', display: 'flex', gap: 7, alignItems: 'center' }}><span style={{ fontSize: 10, fontWeight: 700, color: C.faint }}>부가</span>{sec.note}</div>}
              </>) : sec.kind === 'chips' ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '8px 10px' }}>
                  {sec.items.map((o, i) => <span key={i} style={{ fontSize: fChip, color: C.mute, background: C.head, borderRadius: 4, padding: '2px 8px' }}>{o}</span>)}
                </div>
              ) : (
                <>
                  {sec.rows.map(([k, v], i) => (
                    <Fragment key={i}>
                      <div style={{ display: 'flex', padding: '5px 10px', borderTop: i ? `1px solid ${C.line2}` : 'none' }}>
                        <span style={lab}>{k}</span>
                        <span style={{ fontSize: fBody, color: v ? C.ink : '#cbd5e1', fontVariantNumeric: 'tabular-nums' }}>{v || '—'}</span>
                      </div>
                      {sec.chips && sec.chips.length > 0 && sec.chipsAfter === i + 1 && (
                        <div style={{ display: 'flex', padding: '6px 10px', borderTop: `1px solid ${C.line2}` }}>
                          <span style={lab}>{sec.chipsLabel || '선택옵션'}</span>
                          <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {sec.chips.map((o, j) => <span key={j} style={{ fontSize: fChip, color: C.mute, background: C.head, borderRadius: 4, padding: '2px 8px' }}>{o}</span>)}
                          </div>
                        </div>
                      )}
                    </Fragment>
                  ))}
                  {sec.chips && sec.chips.length > 0 && sec.chipsAfter == null && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '8px 10px', borderTop: `1px solid ${C.line2}` }}>
                      {sec.chips.map((o, i) => <span key={i} style={{ fontSize: fChip, color: C.mute, background: C.head, borderRadius: 4, padding: '2px 8px' }}>{o}</span>)}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </Fragment>
      )); })()}

      {/* 하단 = 다 본 뒤 이상하면 검수 요청(영업자/관리자만, 고객화면 제외) */}
      {aud !== 'customer' && (
        <div style={{ marginTop: 18, paddingTop: 12, borderTop: `1px solid ${C.line2}`, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.faint }}>사진·정보가 이상한가요?</span>
          <ReportButton p={p} />
        </div>
      )}

      {lb !== null && photos.length > 0 && (
        <div onClick={() => setLb(null)} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(0,0,0,0.92)', overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '48px 12px' }}>
          <button onClick={(e) => { e.stopPropagation(); setLb(null); }} aria-label="닫기" style={{ position: 'fixed', top: 14, right: 14, width: 40, height: 40, borderRadius: 20, border: 'none', background: 'rgba(255,255,255,0.18)', color: '#fff', fontSize: 22, cursor: 'pointer', zIndex: 1 }}>×</button>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {photos.map((ph, i) => <img key={i} src={ph} alt="" style={{ width: '100%', height: 'auto', borderRadius: 6, display: 'block' }} />)}
          </div>
        </div>
      )}
    </div>
  );
}
