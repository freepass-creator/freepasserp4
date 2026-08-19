'use client';

import { EsignSendCenter } from '@/components/EsignSendCenter';

/** ERP5 전용 전자계약 작성·발송 화면. 계약 엔진은 운영 SSOT를 그대로 사용한다. */
export default function Erp5EsignPage() {
  return <EsignSendCenter basePath="/erp5/esign" />;
}
