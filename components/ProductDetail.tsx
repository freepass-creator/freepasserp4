'use client';
import { Fragment, useState, useEffect, type ReactNode } from 'react';
import { type EntityRecord } from '@/lib/intake/entities';
import { detailSections, type Audience } from '@/lib/domain/product';
import { useProductPhotoState } from '@/components/use-product-photos';
import { getRole } from '@/lib/domain/deal';
import { won, Badge, Btn, C, R, NUM, FW, FS, ICON, CloseBtn, IconBtn, SCRIM, FormCard } from '@/components/ui';
import { toast } from '@/components/Toaster';
import { downloadPhotoZip, downloadSinglePhoto } from '@/lib/client/download-photo-zip';
import { useDragScroll } from '@/lib/use-drag-scroll';
import {
  badges, Plate, idParts, CardBenefits, CardEvents, OptionChips,
} from '@/components/product-card-atoms';
import { FavHeart } from '@/components/FavHeart';
import { ProductStateMarks } from '@/components/ProductStateMarks';
import { ProductPhotoImage, ProductPhotoPlaceholder } from '@/components/ProductPhoto';
import { ProductPriceTable } from '@/components/ProductPriceTable';
import { useReportedTopOffset } from '@/lib/content-column';
import { useIsMobile } from '@/lib/use-mobile';
import { ChevronLeft, ChevronRight, Download, LoaderCircle } from 'lucide-react';

/**
 * 매물 상세 SSOT — 웹·모바일 **동일 원자·동일 타이포**.
 * 차이는 페이지 껍데기 배열(패딩·하단바·스와이프)만. dense/모바일 폰트 분기 금지.
 * /m · 소통·계약 패널 · /q 공용.
 */
/** work(영업자 작업화면) 사진 **폭** 상한 — 16:10 그대로 460×288. 상세 칸이 넓어져도 사진만 커지진 않는다. */
const WORK_PHOTO_W = 460;

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

function FactCell({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div style={{
      minWidth: 0, padding: '8px 4px',
      gridColumn: wide ? '1 / -1' : undefined,
    }}>
      <span style={{ display: 'block', marginBottom: 4, color: C.mute, fontSize: FS.cap, fontWeight: FW.strong }}>{label}</span>
      <span style={{ display: 'block', minWidth: 0, fontSize: FS.body, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere', lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}

/**
 * `brochure` = 손님에게 보여주는 순서(사진 먼저). `/q`·공급사·손님 화면의 문법.
 * `work` = 영업자 작업화면. 사진도 헤더 바로 아래(폭만 WORK_PHOTO_W).
 *   아래로 숨기면 «사진 없음»으로 오해한다.
 */
export type DetailLayout = 'brochure' | 'work';

/** 상세 상단 보조행용 — 검수 요청 옆에서 이 차량 사진 전체를 받는다(PC 전용). */
export function ProductPhotoDownloadButton({ p }: { p: EntityRecord }) {
  const mobile = useIsMobile();
  const [downloading, setDownloading] = useState(false);
  const { photos, pending } = useProductPhotoState(p);
  if (mobile) return null;
  const { idMain } = idParts(p);
  const vehicleName = String(p.car_number || p.vehicle_no || p.plate_no || p.product_code || idMain || '차량사진');
  const download = async () => {
    if (downloading || !photos.length) return;
    setDownloading(true);
    try {
      const result = await downloadPhotoZip(photos, vehicleName);
      toast(result.failed ? `사진 ${result.saved}장 저장 · ${result.failed}장 실패` : `사진 ${result.saved}장 저장 완료`, result.failed ? 'info' : 'ok');
    } catch (error) {
      toast(String((error as Error)?.message || '사진 다운로드 실패'), 'error');
    } finally { setDownloading(false); }
  };
  return (
    <Btn
      size="sm"
      variant="ghost"
      onClick={download}
      disabled={downloading || pending || !photos.length}
      title={photos.length ? '이 차량의 사진을 ZIP으로 한 번에 저장' : pending ? '사진 확인 중' : '등록된 사진 없음'}
    >
      {downloading || pending ? <LoaderCircle size={ICON.sm} className="fp-spin" aria-hidden /> : <Download size={ICON.sm} aria-hidden />}
      {downloading ? '묶는 중' : pending ? '사진 확인 중' : photos.length ? `사진 전체받기 · ${photos.length}장` : '사진 없음'}
    </Btn>
  );
}

export function ProductDetail({ p, audience, layout = 'brochure' }: {
  p: EntityRecord;
  audience?: Audience;
  layout?: DetailLayout;
}) {
  const mobile = useIsMobile();
  const [lb, setLb] = useState<number | null>(null);
  const [main, setMain] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const { photos, pending } = useProductPhotoState(p);
  const thumbs = useDragScroll();
  useEffect(() => { setMain(0); }, [p.product_code]);
  const mainIdx = Math.min(main, Math.max(0, photos.length - 1));
  /**
   * 메인 사진을 넘기면 **아래 썸네일 줄도 따라간다**.
   *
   * 지금까지는 테두리만 옮겨 다녀서, 26장짜리 매물에서 몇 장 넘기면 «지금 보는 사진»이
   * 썸네일 줄 밖으로 나가 어디쯤인지 안 보였다(사장님 지적 2026-08-11).
   * `scrollIntoView` 는 페이지까지 같이 움직여 화면이 튀므로 가로 스크롤만 직접 옮긴다.
   */
  useEffect(() => {
    const strip = thumbs.ref.current;
    const el = strip?.children?.[mainIdx] as HTMLElement | undefined;
    if (!strip || !el) return;
    const target = el.offsetLeft - (strip.clientWidth - el.clientWidth) / 2;
    const max = strip.scrollWidth - strip.clientWidth;
    strip.scrollTo({ left: Math.max(0, Math.min(target, max)), behavior: 'smooth' });
  }, [mainIdx, photos.length, thumbs.ref]);
  const aud: Audience = audience || (getRole() === 'admin' ? 'admin' : 'agent');
  const work = layout === 'work';
  const [swipeX, setSwipeX] = useState<number | null>(null); // 메인 사진 좌우 스와이프
  const stepPhoto = (dir: number) => { if (photos.length > 1) setMain((m) => (m + dir + photos.length) % photos.length); };
  const secs = detailSections(p, aud);
  const { idMain, idExt } = idParts(p);
  const photoFileName = String(p.car_number || p.vehicle_no || p.plate_no || p.product_code || idMain || '차량사진');
  // 사진이 칼럼 맨 위에서 얼마나 내려와 있는지 = 우측 대여료 카드가 내려와야 할 만큼.
  //  머리 «높이»가 아니라 사진 «위치»를 잰다 — 높이만 재면 머리의 아래 여백이 빠져 그만큼 어긋난다.
  const photoRef = useReportedTopOffset<HTMLDivElement>('--fp-detail-head-h');
  const downloadOnePhoto = async (url: string, index: number) => {
    try {
      await downloadSinglePhoto(url, index, photoFileName);
      toast(`사진 ${index + 1} 저장 완료`, 'ok');
    } catch (error) {
      toast(String((error as Error)?.message || '사진 다운로드 실패'), 'error');
    }
  };
  const downloadAllPhotos = async () => {
    if (downloading || !photos.length) return;
    setDownloading(true);
    try {
      const vehicleName = String(p.car_number || p.vehicle_no || p.plate_no || p.product_code || idMain || '차량사진');
      const result = await downloadPhotoZip(photos, vehicleName);
      toast(result.failed ? `사진 ${result.saved}장 저장 · ${result.failed}장 실패` : `사진 ${result.saved}장 저장 완료`, result.failed ? 'info' : 'ok');
    } catch (error) {
      toast(String((error as Error)?.message || '사진 다운로드 실패'), 'error');
    } finally { setDownloading(false); }
  };
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
          {!mobile ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
              <div style={{ fontSize: FS.title, fontWeight: FW.title, color: C.ink }}>차량사진</div>
              {aud !== 'customer' && (
                <Btn size="sm" variant="ghost" onClick={downloadAllPhotos} disabled={downloading} title="공급사 차량사진을 ZIP으로 한 번에 저장">
                  {downloading ? <LoaderCircle size={ICON.sm} className="fp-spin" aria-hidden /> : <Download size={ICON.sm} aria-hidden />}
                  {downloading ? '묶는 중' : `전체받기 ${photos.length}`}
                </Btn>
              )}
            </div>
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
                ><ChevronLeft size={ICON.xl} strokeWidth={2.5} /></IconBtn>
                <IconBtn
                  title="다음 사진"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); stepPhoto(1); }}
                  style={{
                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', zIndex: 2,
                    border: 'none', background: C.ink, color: C.taupeBg, opacity: 0.7, borderRadius: '50%',
                  }}
                ><ChevronRight size={ICON.xl} strokeWidth={2.5} /></IconBtn>
              </>
            )}
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

      {/* 3 섹션 — 사진 다음 읽기 순서 SSOT:
          차량스펙(제조사) → 대여료조건 → 보험조건 → 계약조건 → 기타사항. */}
      {secs.map((sec) => (
        <section key={sec.title} style={{ marginTop: 16 }}>
          <FormCard title={sec.title} hint={sec.hint}>
            {sec.kind === 'price' ? (
              <ProductPriceTable p={p} />
            ) : sec.kind === 'ins' ? (
              <div style={{ overflow: 'hidden' }}>
                <table aria-label="보험 보장한도와 면책금" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: FS.body }}>
                  <thead><tr>
                    <th scope="col" style={{ width: '28%', padding: '6px 4px', textAlign: 'left', color: C.mute, fontSize: FS.cap, fontWeight: FW.strong }}>항목</th>
                    <th scope="col" style={{ width: '36%', padding: '6px 4px', textAlign: 'right', color: C.mute, fontSize: FS.cap, fontWeight: FW.strong }}>보장한도</th>
                    <th scope="col" style={{ width: '36%', padding: '6px 4px', textAlign: 'right', color: C.mute, fontSize: FS.cap, fontWeight: FW.strong }}>면책금</th>
                  </tr></thead>
                  <tbody>{sec.rows.map(([lbl, limit, ded]) => (
                    <tr key={lbl}>
                      <th scope="row" style={{ padding: '7px 4px', textAlign: 'left', fontWeight: FW.strong, whiteSpace: 'nowrap' }}>{lbl}</th>
                      <td style={{ padding: '7px 4px', textAlign: 'right', color: limit ? C.ink : C.faint, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{limit || '—'}</td>
                      <td style={{ padding: '7px 4px', textAlign: 'right', color: ded ? C.ink : C.faint, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{ded || '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
                {sec.note && <div style={{ padding: '7px 4px 0', fontSize: FS.cap, color: C.mute, display: 'flex', gap: 7, alignItems: 'center' }}><span style={{ fontSize: FS.micro, fontWeight: FW.label, color: C.faint }}>부가</span>{sec.note}</div>}
              </div>
            ) : sec.kind === 'chips' ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {sec.items.map((o) => <span key={o} style={{ fontSize: FS.sub, color: C.mute, background: C.head, borderRadius: R, padding: '2px 8px' }}>{o}</span>)}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(220px, 1fr))', columnGap: 14, rowGap: 2 }}>
                {kvRows(sec.rows).map(([k, v], i) => (
                  <Fragment key={`${k}-${i}`}>
                    <FactCell label={k} wide={['차량', '동력', '색상', '운전자 범위', '결제 · 위약', '특이사항'].includes(k) || v.length > 32}>
                      {v ? dimDashes(v) : <span style={{ color: C.faint }}>—</span>}
                    </FactCell>
                    {sec.chips && sec.chipsAfter === 1 && i === 0 && (
                      <FactCell label={sec.chipsLabel || '선택옵션'} wide>
                        <OptionChips p={p} expand />
                      </FactCell>
                    )}
                  </Fragment>
                ))}
                {sec.chips && sec.chips.length > 0 && sec.chipsAfter == null && (
                  <FactCell label={sec.chipsLabel || '선택옵션'} wide>
                    <OptionChips p={p} expand />
                  </FactCell>
                )}
              </div>
            )}
          </FormCard>
        </section>
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
              <div key={i} style={{ position: 'relative' }}>
                {(
                  <IconBtn
                    title={`사진 ${i + 1} 한 장 받기`}
                    onClick={(e) => { e.stopPropagation(); void downloadOnePhoto(ph, i); }}
                    style={{ position: 'absolute', top: 10, right: 10, zIndex: 1, background: SCRIM.heavy, color: C.inverse, border: 'none' }}
                  >
                    <Download size={ICON.md} aria-hidden />
                  </IconBtn>
                )}
                <ProductPhotoImage
                  src={ph}
                  alt=""
                  style={{ width: '100%', height: 'auto', borderRadius: R, display: 'block' }}
                  fallbackStyle={{ aspectRatio: '16 / 10' }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
