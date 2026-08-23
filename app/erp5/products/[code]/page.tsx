'use client';

import { useParams } from 'next/navigation';
import { ArrowLeft, ArrowUpRight, CarFront } from 'lucide-react';
import { useAuthReady, useSession } from '@/lib/auth-context';
import { getCompanyId } from '@/lib/tenant';
import { useFinderData } from '@/features/finder/useFinderData';
import { finderDataScope } from '@/features/finder/finder-data-store';
import { useProductPhotoState } from '@/components/use-product-photos';
import { benefitSignals, canonProductType, creditDisplay, priceList, vehicleName } from '@/lib/domain/product';
import { ICON } from '@/components/ui';
import styles from '../../workspace.module.css';

const S = (value: unknown, fallback = '미입력') => String(value || '').trim() || fallback;
const won = (value: unknown) => `${(Number(value) || 0).toLocaleString('ko-KR')}원`;
const mileage = (value: unknown) => {
  const raw = String(value || '').trim();
  const parsed = Number(raw.replace(/[^0-9.-]/g, ''));
  return raw && Number.isFinite(parsed) ? `${parsed.toLocaleString('ko-KR')}km` : raw;
};

export default function Erp5ProductDetail() {
  const { code } = useParams<{ code: string }>();
  const authReady = useAuthReady();
  const session = useSession();
  const { rows } = useFinderData({ companyId: getCompanyId(), authReady, sessionUid: session?.uid, sessionScope: finderDataScope(session) });
  const product = (rows || []).find((row) => String(row.product_code || row._key || '') === code);
  const { photos, pending } = useProductPhotoState(product || {}, 1280);
  if (rows == null) return <main className={styles.detailLoading}>차량 정보를 불러오는 중입니다.</main>;
  if (!product) return <main className={styles.detailLoading}>차량을 찾을 수 없습니다. <a href="/erp5">상품찾기로 돌아가기</a></main>;
  const facts = [
    ['제조사', product.maker], ['세부모델', product.sub_model || product.model], ['파워트레인', product.variant || product.powertrain],
    ['세부트림', product.trim_name], ['차종분류', product.vehicle_class], ['외부색상', product.ext_color], ['내부색상', product.int_color],
    ['연식', product.year], ['주행거리', mileage(product.mileage)],
  ];
  const conditions = [canonProductType(product.product_type), creditDisplay(product), ...benefitSignals(product).map((item) => item.label)].filter(Boolean);
  return <main className={styles.productDetailPage}>
    <header><a href="/erp5"><ArrowLeft size={ICON.md} /> 상품찾기</a><div><span>{S(product.vehicle_status, '출고협의')}</span><h1>{vehicleName(product)}</h1><p>{S(product.car_number, '번호 미정')} · {S(product.provider_name || product.provider_company_code, '공급사 미확인')}</p></div><a href={`/erp5/esign?product=${encodeURIComponent(code)}`}>이 차량으로 계약 <ArrowUpRight size={ICON.sm} /></a></header>
    <div className={styles.productDetailGrid}>
      <section className={styles.detailGallery}>{photos[0] ? <div style={{ backgroundImage: `url("${photos[0].replace(/"/g, '%22')}")` }} /> : <div><CarFront size={42} /><span>{pending ? '사진 불러오는 중' : '등록된 사진 없음'}</span></div>}{photos.length > 1 ? <p>{photos.slice(1, 5).map((photo) => <span key={photo} style={{ backgroundImage: `url("${photo.replace(/"/g, '%22')}")` }} />)}</p> : null}</section>
      <section className={styles.detailFacts}><h2>차량설명</h2><dl>{facts.map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{S(value)}</dd></div>)}</dl><h2>조건설명</h2><div className={styles.detailConditionChips}>{conditions.map((condition) => <span key={String(condition)}>{String(condition)}</span>)}</div></section>
      <section className={styles.detailPrices}><h2>기간별 대여료</h2><div>{priceList(product).sort((a, b) => a.m - b.m).map((price) => <article key={price.m}><b>{price.m}개월</b><strong>월 {won(price.rent)}</strong><span>보증금 {won(price.deposit)}</span></article>)}</div></section>
    </div>
  </main>;
}
