'use client';
import { useState, useEffect, type CSSProperties, type ReactNode } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { priceList, detailSections, cheapest, type Audience } from '@/lib/domain/product';
import { useProductPhotoState } from '@/components/use-product-photos';
import { getRole } from '@/lib/domain/deal';
import { won, Badge, C, R, NUM, FW, FS, CloseBtn, IconBtn, SCRIM } from '@/components/ui';
import { useDragScroll } from '@/lib/use-drag-scroll';
import {
  badges, Plate, idParts, CardBenefits, CardEvents, OptionChips,
} from '@/components/product-card-atoms';
import { FavHeart } from '@/components/FavHeart';
import { ProductStateMarks } from '@/components/ProductStateMarks';
import { ProductPhotoImage, ProductPhotoPlaceholder } from '@/components/ProductPhoto';
import { ProductPriceTable } from '@/components/ProductPriceTable';
import { useReportedTopOffset } from '@/lib/content-column';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * 매물 상세 SSOT — 웹·모바일 **동일 원자·동일 타이포**.
 * 차이는 페이지 껍데기 배열(패딩·하단바·스와이프)만. dense/모바일 폰트 분기 금지.
 * /m · 소통·계약 패널 · /q 공용.
 */
const LAB_W = 92;
/** work(영업자 작업화면) 사진 **폭** 상한 — 16:10 그대로 460×288. 상세 칸이 넓어져도 사진만 커지진 않는다. */
const WORK_PHOTO_W = 460;
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
 * `work` = 영업자 작업화면. 사진도 헤더 바로 아래(폭만 WORK_PHOTO_W).
 *   아래로 숨기면 «사진 없음»으로 오해한다.
 */
export type DetailLayout = 'brochure' | 'work';

export function ProductDetail({ p, audience, layout = 'brochure', priceAside = false }: {
  p: EntityRecord;
  audience?: Audience;
  layout?: DetailLayout;
  /**
   * 가격표를 본문에서 뺀다 — 넓은 화면에서 **우측 보조패널**이 대신 들고 있을 때.
   * 헤이딜러 구조: 본문은 차 설명, 우측은 돈과 행동. 손님·영업자·공급사가 같은 골격을 쓴다.
   * 좁은 화면에는 보조패널이 없으므로 가격은 본문 제자리에 남는다(2026-08-08 결정).
   */
  priceAside?: boolean;
}) {
  const [lb, setLb] = useState<number | null>(null);
  const [main, setMain] = useState(0);
  const { photos, pending } = useProductPhotoState(p);
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
  // 사진이 칼럼 맨 위에서 얼마나 내려와 있는지 = 우측 대여료 카드가 내려와야 할 만큼.
  //  머리 «높이»가 아니라 사진 «위치»를 잰다 — 높이만 재면 머리의 아래 여백이 빠져 그만큼 어긋난다.
  const photoRef = useReportedTopOffset<HTMLDivElement>('--fp-detail-head-h');
  /** work = 차량번호를 요약바가 이미 들고 있다. 세부표에서 한 번 더 찍지 않는다(같은 값 세 번 → 표가 길어 보인다). */
  const kvRows = (rows: [string, string][]) => (work ? rows.filter(([k]) => k !== '차량번호') : rows);

  return (
    <div>
      {/* 1 헤더 — 차명 → 차번·상태·상품·심사 → 우대·이벤트 (원자 공용).
          work 에서는 차명·차번은 우측 카드·상단바가 들고 있어 제목 줄을 뺀다.
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
          {work && photos.length === 0 && !pending && <Badge tone="gray" variant="quiet" title="등록된 사진이 없습니다">사진없음</Badge>}
          {work && aud !== 'customer' && <ProductStateMarks p={p} />}
          {work && aud !== 'customer' && <FavHeart p={p} compact />}
        </div>
      </div>

      {/* 2 사진 — 웹·work 모두 헤더 바로 아래(안 보이면 없다고 판단함).
          work만 폭 상한(WORK_PHOTO_W)으로 가격표가 같이 보이게.
          ref = 이 자리(사진 윗선)를 우측 칼럼에 알린다. */}
      <div ref={photoRef}>
      {(photos.length ? (
        <div style={work ? { maxWidth: WORK_PHOTO_W, marginBottom: 4 } : undefined}>
          {work ? (
            <div style={{ fontSize: FS.title, fontWeight: FW.title, color: C.ink, marginBottom: 4 }}>차량사진</div>
          ) : null}
          <div
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest('button, a')) return;
              setSwipeX(e.clientX);
            }}
            onPointerUp={(e) => {
              const sx = swipeX; setSwipeX(null);
              if ((e.target as HTMLElement).closest('button, a')) return;
              if (sx != null && Math.abs(e.clientX - sx) > 40) { stepPhoto(e.clientX < sx ? 1 : -1); return; }
              setLb(mainIdx);
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
            {/* 표시(문의중·최근)는 별표 **왼쪽** — 누르는 자리는 언제나 맨 오른쪽 하나로 고정. */}
            {aud !== 'customer' && !work && (
              <span style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <ProductStateMarks p={p} onPhoto />
                <FavHeart p={p} onPhoto />
              </span>
            )}
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
      ) : work ? (
        pending ? <div style={{ fontSize: FS.cap, color: C.faint, marginBottom: 4 }}>사진 불러오는 중…</div> : null
      ) : (
        <div style={{ position: 'relative', aspectRatio: '16 / 10', background: C.placeholder, borderRadius: R, overflow: 'hidden' }}>
          <ProductPhotoPlaceholder style={{ position: 'absolute', inset: 0 }} />
          {aud !== 'customer' && <span style={{ position: 'absolute', top: 8, right: 8 }}><FavHeart p={p} onPhoto /></span>}
        </div>
      ))}
      </div>

      {/* 3 섹션 — 데이터=detailSections. 표기 원자=웹·모바일 동일.
          본문은 **아무것도 고정하지 않는다.** 금액은 우측 대여료 카드가 틀고정으로 들고 있고,
          여기서 또 붙이면 스크롤할 때 사진이 밀려 올라가는 것처럼 보인다(2026-08-08 지적). */}
      {secs.filter((sec) => !(priceAside && sec.kind === 'price')).map((sec) => (
        <div key={sec.title} style={{ marginTop: 11 }}>
          <div style={{ fontSize: FS.title, fontWeight: FW.title, color: C.ink, marginBottom: 4 }}>{sec.title}</div>
          {sec.kind === 'price' ? (
            <ProductPriceTable p={p} />
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
