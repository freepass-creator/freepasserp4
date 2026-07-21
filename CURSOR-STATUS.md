# Cursor 상태판

**이 파일은 Cursor 소유다.** Cursor가 여기에 진행상황을 기록한다.
Claude는 읽기만 하고 수정하지 않는다. (지시서는 `CURSOR-TASKS.md` — Claude 소유, 읽기만 할 것)

---

## 진행 기록

한 줄 형식: `T번호 | 커밋해시 | 변경파일수 | tsc | 한 줄 요약`

| 태스크 | 커밋 | 파일 | tsc | 요약 |
|---|---|---|---|---|
| T1 | `a2c2e14` | 3 | 0 | vstatus 죽은 배선 제거 (product-filters·page·sim-agent) |
| T2 | `b8e9bd7` | 8 | 0 | canonProductType 비교·렌더·export 경로 적용 |
| T3 | `6e734b8` | 5 | 0 | shortAt→msgClock 통합, ContractSend·미사용 export 삭제 |
| T4 | `19692b2` | 1 | 0 | PhotoUpload Btn/IconBtn·C/R/FS 원자화 (웹 조작=라이트박스) |
| T7 | `36c38e1` | 1 | 0 | 카탈로그 월대여료=priceList 밴드(홈 matchProduct와 동일). 최저가만 보던 로컬 비교 삭제 → 필터 결과 늘어날 수 있음(의도) |
| T8 | `e6107f0` | 1 | 0 | inventoryStatusIcon 색=VEHICLE_STATUS_TONE SSOT (아이콘 모양만 로컬). 맵=기존 하드코드와 동일 → 색 변화 없음 |
| T9 | `13bf969` | 1 | n/a | 죽은 원자 실사 표 (코드 변경 0, STATUS만 커밋) |

---

## 막힘 / 질문

_(아직 없음)_

---

## 보고서

### T9 — 죽은 원자 실사 (2026-07-21)

실측: 심볼 참조. **정의 파일·같은 파일 내부 참조는 사용처에서 제외.**
배럴(`ui/index.tsx`) 재export만 있는 경우도 사용처 0.

| 원자 | 사용처 수 | 사용 파일(최대 3) | CLAUDE.md 등재 |
|---|---:|---|---|
| DataTable | 0 | — | Y |
| ObjCard | 0 | — | Y |
| Cards | 0 | — | Y |
| Metric | 0 | — | Y |
| KV | 0 | — | Y |
| DetailRow | 0 | — | Y |
| DetailEmpty | 0 | — | Y |
| Dash | 0 | — | Y |
| Sec | 0 | — | Y |
| HiddenSecs | 0 | — | Y |
| Modal | 0 | — | Y |
| Drawer | 0 | — | Y |
| EmptyState | 0 | — | Y |
| ListBox | 0 | — | Y |
| DetailShell | 0 | — | Y |
| VSplit | 0 | — | Y |
| Panel | 0 | — | Y |
| RiskTag | 0 | — | Y |
| SevTag | 0 | — | Y |
| Status | 0 | — (StatusTag 내부만) | Y |
| StatusTag | 0 | — | Y |
| PERK_TONE | 0 | — | Y |
| RISK_TONE | 0 | — (RiskTag 내부만) | Y |
| STATUS_TONE | 0 | — (StatusTag 내부만) | Y |
| PriceFare | 0 | — | Y |
| PriceMini | 0 | — (PriceFare 내부만) | Y |
| OptionsInline | 0 | — | Y |
| CardFacts | 0 | — | Y |

#### 사용처 0 + CLAUDE.md 등재 (사장님 판단 대기)

위 표 **전부**. 문서에 등재되어 있으나 앱/페이지 import 0.
삭제·문서정리·실사용 유도는 **사장님 판단** (Cursor는 삭제하지 않음).

---

## 현재 상태

`대기중` — 열린 태스크 없음 (T5 잠금 · T6 폐기 · T3/T4는 커밋 완료). T5 해제 후 재개.
