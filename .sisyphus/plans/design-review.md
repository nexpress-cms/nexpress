# NexPress 설계서 리뷰 (3차)

> 리뷰 대상: `nexpress-core-design.md`, `plugin-system-design.md`, `nexpress.txt` (기획서 v3)
> 1차 리뷰: 2026-04-17
> 2차 리뷰: 2026-04-17 (K-P 섹션, 플러그인 1.1.1 추가)
> 3차 리뷰: 2026-04-20 (C.9-C.13 인증 섹션 추가, QA 시나리오 전체 추가)
> 상태: 코드 작성 전 (설계 단계)

---

## 전체 평가 (3차)

1차 리뷰에서 지적한 21건 중 **18건이 해결되었다.** (2차 대비 +1: CB-1 해결)

2차 리뷰에서 유일한 실질적 미해결이었던 **CB-1(인증/세션 모델)**이 C.9-C.13 추가로 완전히 해결되었다:
- C.9: 비밀번호 변경 후 새 세션 생성 흐름 (invalidateAllSessions → 새 세션 + 토큰 발급)
- C.10: Refresh token rotation (old 삭제 → new 발급, 단일 트랜잭션, replay 방어)
- C.11: CSRF protection (double-submit cookie 패턴)
- C.12: 3-tier 인증 검증 전략 (Edge/API Handler/RSC 각각의 역할과 trade-off 문서화)
- C.13: End-to-end 시퀀스 다이어그램 7개 (login, read, write, refresh, password change, logout, admin force-invalidation)

**구현 차단 이슈는 0건이다. 즉시 코드 작성 착수가 가능하다.**

남은 3건은 모두 의도적 범위 제한 또는 구현 중 결정 사항이다.

---

## ✅ 해결됨 (Resolved) — 18건

### 구현 차단 → 전체 해결 (6/6건)

| ID | 원래 이슈 | 해결 섹션 | 요약 |
|---|---|---|---|
| CB-1 | 인증/세션 모델 내부 모순 | Core C.9-C.13 | refresh rotation + replay 방어(C.10), CSRF double-submit cookie(C.11), 비밀번호 변경 후 세션 재생성(C.9), 3-tier 인증 전략(C.12), E2E 시퀀스 7개(C.13) |
| CB-2 | 빌드 타임 코어 vs 런타임 플러그인 모델 충돌 | Plugin 1.1.1 | v1 Plugin = npm package + rebuild로 명시. 런타임 설치 불가. 모순 해소 |
| CB-3 | 라우팅 모델 미완성 | Core K | 예약 경로 목록, 해석 우선순위(system → static → slug), 플러그인 루트 경로(rewrites), optional catch-all `[[...slug]]` 정의 |
| CB-4 | 스케줄러/워커 아키텍처 부재 | Core M | pg-boss 기반 job queue. 미디어 처리·webhook·import/export를 비동기 job으로 분리 |
| CB-5 | 쓰기 작업 일관성 모델 부재 | Core L.1 | 4단계 파이프라인(validate → hooks → DB tx → async jobs). 트랜잭션 경계 명확화 |
| CB-6 | 권한 모델이 너무 단순함 | Core L.2 | API 핸들러에서 access 함수 enforcement 패턴 정의. 컬렉션별·오퍼레이션별 접근 제어 |

### 높은 심각도 → 해결 (6/8건)

| ID | 원래 이슈 | 해결 섹션 | 요약 |
|---|---|---|---|
| HS-1 | Zod 빌드 타임 검증만 존재 | Core O.1 | 런타임 Zod 스키마 생성 명시. `saveDocument()`에서 런타임 검증 적용 |
| HS-3 | 스키마 진화 정책 미정의 | Core O.2 | 필드 추가/삭제/이름변경/타입변경/컬렉션 삭제 각 시나리오별 가이드라인 제공 |
| HS-4 | 미디어 생명주기 불완전 | Core O.3 | `nx_media_refs` 참조 추적 테이블, soft delete, 업로드 제한, 비동기 처리 |
| HS-5 | Import/Export 안전성 부족 | Core I.4 | preflight 검증, slug 기반 upsert, 미디어 hash 매칭, 트랜잭션, idempotent |
| HS-7 | 검색 구현 부재 | Core P | PostgreSQL FTS (`tsvector`/`tsquery`), GIN 인덱스, 자동 인덱싱, 랭킹 |
| HS-8 | 에러 처리/관측성 부재 | Core N.1 | `NxApiError` 표준 형식, 에러 코드 체계, 구조화 로깅 |

### 중간 심각도 → 해결 (6/7건)

| ID | 원래 이슈 | 해결 섹션 | 요약 |
|---|---|---|---|
| MS-1 | Revision JSONB 스냅샷 비대화 | Core N.5 | `NxRevisionPolicy` — retention, autosave 구분, pruning cron |
| MS-2 | 로컬 미디어 스토리지와 수평 확장 충돌 | Core N.8 | v1 단일 노드 명시. 시작 시 경고 |
| MS-3 | 테마 JSON → CSS injection 위험 | Core N.3 | `sanitizeTokenValue()` — 세미콜론/중괄호/url()/expression() 제거 |
| MS-4 | `unstable_cache` 의존 | Core N.6 | `nxCache` 추상화 레이어. 향후 교체 가능 |
| MS-6 | Draft/Preview 캐시 누출 위험 | Core N.7 | Draft 요청 캐시 bypass, `Cache-Control: no-store` |
| MS-7 | CORS / Rate Limiting / CSP 미정의 | Core N.2 | 보안 헤더, 엔드포인트별 rate limit, CSP 정의 |

---

## 🟡 미해결 (Remaining) — 3건

모두 구현 차단이 아닌, 의도적 범위 제한 또는 구현 시 결정 사항이다.

### HS-2. 플러그인 격리 (의도적 수용)

**심각도**: 🟡 낮음 (의도적 설계 결정)

Plugin 1.1.1에서 v1 trust model을 정직하게 문서화했다:
- "v1 plugins run with the same permissions as the NexPress core"
- 사용자 대면 보안 경고 문구 명시 (Admin UI 플러그인 페이지에 표시)
- Stage 2(Proxy capability enforcement) / Stage 3(isolated-vm) 로드맵 존재

**남은 작업**: 출시 전 사용자 문서에 경고 포함 확인.

### HS-6. 분산 캐시 전략 (의도적 범위 제한)

**심각도**: 🟡 낮음

Core N.4에서 v1은 단일 노드로 명시. 멀티 노드는 v2+ 로드맵.
ISR 캐시, in-memory rate limiter, pg-boss worker 모두 단일 프로세스 기준.

**남은 작업**: 배포 가이드에 "v1은 단일 인스턴스 배포만 지원합니다" 명시.

### MS-5. Admin 상태 관리 미정의

**심각도**: 🟡 중간

여전히 미정의. 구현 과정에서 점진적으로 결정 가능:
- Optimistic update 전략
- Autosave (디바운스 주기, 충돌 동작)
- 동시 편집 충돌 감지 (optimistic locking / version check)
- Dirty form navigation 경고

**권장**: 에디터 컴포넌트 구현 시 함께 결정. 별도 설계 문서 불필요.

---

## 🔵 새로 발견된 관찰 사항 (Non-blocking)

전체 설계서 재통독 과정에서 발견한 소규모 관찰 사항:

| # | 항목 | 심각도 | 설명 |
|---|---|---|---|
| OBS-1 | D.5 ISR 예시에서 `unstable_cache` 직접 사용 | 문서 불일치 | N.6에서 `nxCache` 추상화를 정의했으나, D.5 코드 예시는 `unstable_cache`를 직접 import. 실제 구현 시 `nxCache`로 통일 필요 |
| OBS-2 | `status` vs `_status` 컬럼 혼동 가능성 | DX | `nxBaseColumns.status` (draft/published/archived)와 versioning용 `_status` (draft/published)가 공존. Payload CMS 패턴이나, 개발자 혼동 방지를 위해 코드 주석 또는 타입 수준의 구분 필요 |
| OBS-3 | 검색 언어 하드코딩 | 향후 i18n | P.1에서 `plainto_tsquery('english', ...)` 하드코딩. i18n 추가 시 `regconfig` 파라미터화 필요. v1 범위 내 문제 아님 |
| OBS-4 | Rate limiter가 in-memory | 운영 | 프로세스 재시작 시 rate limit 카운터 리셋. v1 단일 노드에서는 허용 가능하나 인지 필요 |
| OBS-5 | Audit log 미설계 | 관측성 | N.1에서 구조화 로깅(pino)은 정의했으나, 인증/콘텐츠/플러그인 변경에 대한 전용 audit log 테이블은 없음. 운영 후 필요성 판단 |

---

## 🔵 참고 사항 (변경 없음)

| 항목 | 비고 |
|---|---|
| Redis / 외부 캐시 레이어 | v1에서 Postgres + Next 캐시로 충분. N.4에서 명시 |
| CI/CD 파이프라인 | 아키텍처 이슈가 아님 |
| i18n (다국어) | 기획서에 "향후"로 명시됨 |
| 실시간 협업 편집 | MVP 제외로 명시됨 |
| 멀티사이트 | MVP 제외로 명시됨 |
| 접근성 (a11y) | Admin UI에 shadcn/ui 사용하므로 기본 수준은 확보되나, 명시적 정책 없음 |
| 비밀번호 정책 | 8자 최소만 있고, 복잡성 요구사항 없음 |
| 비밀번호 재설정 (이메일) | v1 로컬 관리자용이면 불필요할 수 있음 |

---

## 📋 권장 조치 (3차 업데이트)

| 순서 | 조치 | 관련 이슈 | 긴급도 |
|---|---|---|---|
| 1 | 플러그인 사용자 대면 보안 경고를 사용자 문서에 포함 | HS-2 | 출시 전 |
| 2 | 배포 가이드에 "v1 = 단일 인스턴스" 명시 | HS-6 | 출시 전 |
| 3 | D.5 ISR 코드 예시를 `nxCache`로 수정 (문서 정합성) | OBS-1 | 구현 시 |
| 4 | Admin 에디터 상태 관리 (autosave, optimistic locking) | MS-5 | 에디터 구현 시 |

---

## 에스컬레이션 트리거 (변경 없음)

다음 요구사항이 추가되면 현재 설계로는 불가하며, 별도 설계가 필요하다:

- **리빌드 없이 서드파티 플러그인 런타임 설치/제거** → 훨씬 제한적인 확장 모델 필요
- **Day 1부터 멀티 노드 셀프 호스팅** → 공유 캐시/작업/스케줄러 시맨틱 필요
- **v1에서 비신뢰 플러그인** → CMS 기능이 아니라 별도 플랫폼 프로젝트로 취급

---

## 결론

**설계 완료. 구현 착수 가능.**

21건의 원래 이슈 중 18건 해결, 나머지 3건은 의도적 범위 제한 또는 구현 중 결정 사항이다.
구현 차단 이슈(Critical Blocker)는 0건이다.

QA 시나리오도 섹션별로 정의되어 있어 구현 후 검증 기준이 명확하다.
