'use client';
import { useState, useEffect, type CSSProperties, type ReactNode } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { priceList, detailSections, cheapest, type Audience } from '@/lib/domain/product';
import { useProductPhotos } from '@/components/use-product-photos';
import { getRole } from '@/lib/domain/deal';
import { won, Badge, C, R, NUM, FW, FS, CloseBtn, IconBtn, SCRIM } from '@/components/ui';
import { useDragScroll } from '@/lib/use-drag-scroll';
import {
  badges, Plate, idParts, CardBenefits, CardEvents, OptionChips,
} from '@/components/product-card-atoms';
import { FavHeart } from '@/components/FavHeart';
import { ProductPhotoImage, ProductPhotoPlaceholder } from '@/components/ProductPhoto';
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

/**
 * 빈 슬롯(`-`)을 흐리게 — 지우지는 않는다.
 * 「가솔린 · - · 1,000cc · 5인승」의 `-`는 «구동방식을 모른다»는 정보다. 지우면 그 축이 있었다는 것조차
 * 안 보여 영업자가 손님에게 «없다»고 잘못 말한다. 그래서 **정보는 남기고 무게만 낮춘다.**
 * 구분자는 gSlots 가 만든 ` · ` 하나뿐이라 쪼개도 값이 깨지지 않는다.
 */
function dimDashes(v: ReactNode): ReactNode {
  if (typeof v !== 'string' || !v.includes('-')) return v;
  const parts = v.split(' · ');
  if (parts.length < 2 || !parts.some((x) => x === '-')) return v;
  return parts.map((x, i) => (
    <span key={i}>
      {i > 0 && <span style={{ color: C.faint }}> · </span>}
      {x === '-' ? <span style={{ color: C.faint }}>-</span> : x}
    </span>
  ));
}

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

/**
 * `brochure` = 손님에게 보여주는 순서(사진 먼저). `/q`·공급사·손님 화면의 문법.
 * `work` = 영업자가 일하는 순서 — **가격 → 조건 칩 → 스펙 → 사진(썸네일)**.
 *   영업자는 사진을 보러 오지 않는다. 손님이 묻는 순서가 가격이고, 사진은 «있으면 보낸다»다.
 *   사진 없는 매물이 절반 가까워 고정 16:10 히어로를 두면 그 자리가 통째로 죽는다.
 *   원자·타이포는 동일하다 — 바뀌는 것은 **순서와 사진 크기**뿐.
 */
export type DetailLayout = 'brochure' | 'work';

export function ProductDetail({ p, audience, layout = 'brochure' }: { p: EntityRecord; audience?: Audience; layout?: DetailLayout }) {
  const [lb, setLb] = useState<number | null>(null);
  const [main, setMain] = useState(0);
  const photos = useProductPhotos(p);
  const thumbs = useDragScroll();
  useEffect(() => { setMain(0); }, [p.product_code]);
  const mainIdx = Math.min(main, Math.max(0, photos.length - 1));
  const aud: Audience = audience || (getRole() === 'admin' ? 'admin' : 'agent');
  const work = layout === 'work';
  const [swipeX, setSwipeX] = useState<number | null>(null); // 메인 사진 좌우 스와이프
  const stepPhoto = (dir: number) => { if (photos.length > 1) setMain((m) => (m + dir + photos.length) % photos.length); };
  const secs = detailSections(p, aud);
  const prices = priceList(p);
  const cheap = cheapest(p);
  const pol = (p._policy || {}) as Record<string, unknown>;
  const caption = [pol.basic_driver_age, pol.annual_mileage, pol.insurance_included].filter(Boolean).join(' · ');
  const { idMain, idExt } = idParts(p);
  /** work = 차량번호를 요약바가 이미 들고 있다. 세부표에서 한 번 더 찍지 않는다(같은 값 세 번 → 표가 길어 보인다). */
  const kvRows = (rows: [string, string][]) => (work ? rows.filter(([k]) => k !== '차량번호') : rows);

  return (
    <div>
      {/* 1 헤더 — 차명 → 차번·상태·상품·심사 → 우대·이벤트 (원자 공용).
          work 에서는 차명·차번을 상단 요약바(ProductWorkBar)가 이미 고정으로 들고 있어 제목 줄을 뺀다.
          대신 사진 위에 얹혀 있던 관심(하트)이 사라지지 않게 칩 줄로 내려 붙인다. */}
      <div style={{ marginBottom: 11 }}>
        {!work && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: FS.page, fontWeight: FW.title, letterSpacing: '-0.02em', margin: 0, lineHeight: 1.25 }}>{idMain}</h1>
            {idExt && <span style={{ fontSize: FS.title, fontWeight: FW.meta, color: C.mute }}>{idExt}</span>}
          </div>
        )}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          marginTop: work ? 0 : 8, rowGap: 6,
        }}>
          {aud !== 'customer' && !work && <Plate p={p} />}
          {/* work = 차번·상태를 요약바가 이미 들고 있다. 같은 값을 두 번 찍지 않는다. */}
          {badges(p, false, false, false, aud, { hideStatus: work })}
          <CardBenefits p={p} inline />
          <CardEvents p={p} inline />
          {/* 사진 없음도 매물의 성질이다 — 별도 줄을 잡아먹지 않게 칩으로 붙인다.
              (안 그리면 «없는 건지 안 뜬 건지»를 모른다. 사진 없는 차가 절반 가까이다.) */}
          {work && photos.length === 0 && <Badge tone="gray" variant="quiet" title="등록된 사진이 없습니다">사진없음</Badge>}
          {work && aud !== 'customer' && <FavHeart p={p} compact />}
        </div>
      </div>

      {/* 2-work 사진 = 칩 줄 바로 아래 썸네일 한 줄(48px). 누르면 기존 라이트박스로 전부 크게 본다.
          히어로 400px 은 없앴지만 **맨 아래로 내렸더니 사진이 사라진 것처럼 읽혔다**(2026-08-07 실사용 지적).
          영업자에게 사진은 «가격 다음»이지 «맨 마지막»이 아니다 — 위에 두되 자리는 한 줄만 쓴다.
          사진이 없으면 그 사실을 한 줄로 말한다. 아무것도 안 그리면 «없는 건지 안 뜬 건지»를 모른다. */}
      {work ? (
        photos.length > 0 ? (
          <div
            ref={thumbs.ref}
            onPointerDown={thumbs.onPointerDown}
            onPointerMove={thumbs.onPointerMove}
            onPointerUp={thumbs.onPointerUp}
            onPointerCancel={thumbs.onPointerUp}
            style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, cursor: 'grab', touchAction: 'pan-y', userSelect: 'none', WebkitOverflowScrolling: 'touch' }}
          >
            {photos.map((ph, i) => (
              <IconBtn
                key={i}
                title={`사진 ${i + 1} 크게보기`}
                onClick={() => { if (thumbs.consumeClick()) return; setLb(i); }}
                style={{
                  flex: '0 0 auto', width: 74, height: 48, borderRadius: R, overflow: 'hidden',
                  border: `1px solid ${C.line}`, padding: 0, background: C.placeholder, cursor: 'inherit',
                }}
              >
                <ProductPhotoImage
                  src={ph}
                  alt=""
                  draggable={false}
                  compactPlaceholder
                  style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                />
              </IconBtn>
            ))}
          </div>
        ) : null
      ) : photos.length ? (
        <div>
          <div
            onPointerDown={(e) => {
              // 버튼(좌우 화살표·관심) 위에서 시작한 포인터는 사진 제스처가 아니다.
              if ((e.target as HTMLElement).closest('button, a')) return;
              setSwipeX(e.clientX);
            }}
            onPointerUp={(e) => {
              const sx = swipeX; setSwipeX(null);
              // 화살표·관심 위에서 뗀 것은 사진 탭이 아님 — 여기서 안 거르면 화살표를 눌러도
              // 크게보기가 먼저 열려 "좌우로 안 넘어간다"처럼 보인다(자식의 stopPropagation은 pointerup을 못 막음).
              if ((e.target as HTMLElement).closest('button, a')) return;
              if (sx != null && Math.abs(e.clientX - sx) > 40) { stepPhoto(e.clientX < sx ? 1 : -1); return; } // 스와이프=넘김
              setLb(mainIdx); // 탭=크게보기
            }}
            style={{ position: 'relative', aspectRatio: '16 / 10', background: C.placeholder, borderRadius: R, overflow: 'hidden', cursor: 'zoom-in', touchAction: 'pan-y', userSelect: 'none' }}
          >
            <ProductPhotoImage
              src={photos[mainIdx]}
              alt=""
              draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
            />
            {photos.length > 1 && (
              <>
                <IconBtn
                  title="이전 사진"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); stepPhoto(-1); }}
                  style={{
                    position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 2,
                    border: 'none', background: C.ink, color: C.taupeBg, opacity: 0.7, borderRadius: '50%',
                  }}
                ><ChevronLeft size={20} strokeWidth={2.5} /></IconBtn>
                <IconBtn
                  title="다음 사진"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); stepPhoto(1); }}
                  style={{
                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 2,
                    border: 'none', background: C.ink, color: C.taupeBg, opacity: 0.7, borderRadius: '50%',
                  }}
                ><ChevronRight size={20} strokeWidth={2.5} /></IconBtn>
              </>
            )}
            {aud !== 'customer' && <span style={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }}><FavHeart p={p} onPhoto /></span>}
            <span style={{ position: 'absolute', right: 8, bottom: 8, background: SCRIM.heavy, color: C.inverse, fontSize: FS.cap, fontWeight: FW.strong, padding: '2px 8px', borderRadius: R, fontFamily: NUM, fontVariantNumeric: 'tabular-nums', pointerEvents: 'none' }}>{mainIdx + 1} / {photos.length}</span>
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
                  <ProductPhotoImage
                    src={ph}
                    alt=""
                    draggable={false}
                    compactPlaceholder
                    style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                  />
                </IconBtn>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ position: 'relative', aspectRatio: '16 / 10', background: C.placeholder, borderRadius: R, overflow: 'hidden' }}>
          <ProductPhotoPlaceholder style={{ position: 'absolute', inset: 0 }} />
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
                        <td style={{ padding: '6px 10px', textAlign: 'center', fontWeight: FW.head, color: C.brand, fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{won(pr.rent)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: NUM, fontVariantNumeric: 'tabular-nums' }}>{pr.deposit > 0 ? won(pr.deposit) : '무보증'}</td>
                      </tr>
                    );
                  })}</tbody>
              </table>
              {caption && <div style={{ padding: '6px 10px', fontSize: FS.cap, color: C.faint, borderTop: `1px solid ${C.line2}` }}>* {caption} 기준</div>}
            </div>
          ) : sec.kind === 'ins' ? (
            <div style={box}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: FS.body, tableLayout: 'fixed' }}>
                <thead><tr>{['항목', '보장한도', '면책금'].map((h, i) => <th key={h} style={{ width: '33.33%', textAlign: i === 0 ? 'left' : i === 1 ? 'center' : 'right', padding: '5px 10px', background: C.head, borderBottom: `1px solid ${C.line}`, fontSize: FS.cap, fontWeight: FW.strong, color: C.mute }}>{h}</th>)}</tr></thead>
                <tbody>{sec.rows.map(([lbl, limit, ded], i) => (
                  <tr key={lbl} style={{ borderTop: i ? `1px solid ${C.line2}` : 'none' }}>
                    <td style={{ padding: '5px 10px', color: C.mute }}>{lbl}</td>
                    <td style={{ padding: '5px 10px', textAlign: 'center', color: limit ? C.ink : C.faint, fontVariantNumeric: 'tabular-nums' }}>{limit || '—'}</td>
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
              {kvRows(sec.rows).map(([k, v], i) => (
                <div key={`${k}-${i}`}>
                  <KvRow label={k} first={i === 0}>
                    {v ? dimDashes(v) : <span style={{ color: C.faint }}>—</span>}
                  </KvRow>
                  {sec.chips && sec.chipsAfter === 1 && i === 0 && (
                    <KvRow label={sec.chipsLabel || '선택옵션'}>
                      <OptionChips p={p} expand />
                    </KvRow>
                  )}
                </div>
              ))}
              {sec.chips && sec.chips.length > 0 && sec.chipsAfter == null && (
                <KvRow label={sec.chipsLabel || '선택옵션'} first={kvRows(sec.rows).length === 0}>
                  <OptionChips p={p} expand />
                </KvRow>
              )}
            </div>
          )}
        </div>
      ))}

      {lb !== null && photos.length > 0 && (
        <div onClick={() => setLb(null)} style={{ position: 'fixed', inset: 0, zIndex: 80, background: SCRIM.black, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '48px 12px' }}>
          <CloseBtn
            title="닫기"
            onClick={(e) => { e.stopPropagation(); setLb(null); }}
            style={{
              position: 'fixed', top: 14, right: 14, width: 40, height: 40, borderRadius: '50%',
              border: 'none', background: `color-mix(in srgb, ${C.inverse} 18%, transparent)`, color: C.inverse, zIndex: 1,
            }}
          />
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {photos.map((ph, i) => (
              <ProductPhotoImage
                key={i}
                src={ph}
                alt=""
                style={{ width: '100%', height: 'auto', borderRadius: R, display: 'block' }}
                fallbackStyle={{ aspectRatio: '16 / 10' }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
