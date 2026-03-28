# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-03-28

### Breaking Changes
- **`KordocError`, `sanitizeError`, `isPathTraversal`을 public API에서 제거** — 내부 유틸이므로 `import { ... } from "kordoc"`으로 접근 불가. 테스트는 `../src/utils.js` 직접 import 사용.

### Changed
- **cleanPdfText 한국어 줄 병합 개선** — 150자 regex를 3개 함수(`startsWithMarker`, `isStandaloneHeader`, `mergeKoreanLines`)로 분리. 한글 번호(가./나.), 숫자(1./2.), 괄호((1)/(가)), 기호(○/●/※), 법령 조항(제N조/항/호) 패턴 보호. 마커 뒤 공백 없는 케이스도 보호.
- **precheckZipSize 안전성 강화** — try/catch 추가 (악성 버퍼의 RangeError 방어), 22바이트 미만 버퍼 조기 반환, `@internal` 태그 명시

### Added
- **실제 문서 통합 테스트** — `tests/fixtures/`에 있는 실제 .hwp, .hwpx, .pdf 파일로 전체 파이프라인 검증 (fixture 없으면 skip)
- **합성 HWPX 통합 테스트** — 마크다운 테이블 구조 정밀 검증 (헤더/구분선/데이터 행), 멀티 섹션 순서, 단락 구분 등
- **precheckZipSize 단위 테스트** 10개 — EOCD/CD 파싱, 경계 조건, 악성 입력, parseHwpxDocument 간접 검증
- **cleanPdfText 테스트** 5개 추가 — 제N조, 공백 없는 마커, 기호 마커

### Fixed
- README 보안 섹션에 **ZIP bomb 한계를 사용자 대면으로 명시** — CD 선언 크기 위조 가능성, 실제 방어선(per-file 누적 체크) 설명

## [1.0.2] - 2026-03-28

### Changed
- **KordocError 클래스 도입** — 모든 파서가 `KordocError`를 throw, MCP `sanitizeError`가 `instanceof`로 판별. 문자열 패턴 매칭 제거
- **JSZip ZIP bomb 사전 검증** — `loadAsync` 전 raw buffer에서 Central Directory를 직접 파싱하여 선언된 비압축 크기 합산 검증
- **toArrayBuffer 최적화** — offset=0이고 전체 ArrayBuffer를 차지하면 복사 없이 직접 반환
- **sanitizeError, isPathTraversal을 utils.ts로 이동** — 테스트가 실제 코드를 직접 import하여 검증

### Fixed
- cfb 버전을 정확히 핀 (`^1.2.2` → `1.2.2`), 번들링 일관성 확보
- `@types/node` `^25` → `^18`로 다운그레이드, engines `>=18`과 일치
- CHANGELOG 날짜를 git log 실제 커밋 날짜 기준으로 정정
- SECURITY.md Response Timeline을 개인 프로젝트 현실에 맞게 완화
- MAX_RECORDS 테스트에 잘림 이후 데이터 정합성 검증 추가

## [1.0.1] - 2026-03-28

### Fixed
- JSZip 검증에서 undocumented internal API(`_data.uncompressedSize`) 의존 제거, 엔트리 수 기반 검증으로 교체
- MCP 에러 정제를 regex 기반에서 allowlist 기반으로 교체

### Added
- 보안 로직 회귀 테스트 9개 추가 (MAX_RECORDS, span 방어, 제어문자 코드 10, 경로 순회, 에러 정제)
- CHANGELOG.md
- SECURITY.md (취약점 리포팅 절차)

## [1.0.0] - 2026-03-28

### Changed
- **Breaking**: 버전을 1.0.0으로 올림 (API 안정화 선언)

### Security
- PDF: MAX_PAGES(5,000) + 누적 텍스트 크기 100MB 제한으로 OOM 방지
- HWP5: 바이너리에서 읽은 rows/cols를 MAX_ROWS/MAX_COLS로 클램핑
- HWP5: readRecords MAX_RECORDS(500K) 제한으로 메모리 폭주 방지
- HWP5: findSections fallback 경로에도 MAX_SECTIONS(100) 적용
- HWPX: manifest 경로 검색을 Regex에서 문자열 비교로 교체 (ReDoS 벡터 제거)
- HWPX: 백슬래시 정규화 + Windows 드라이브 문자 경로 순회 차단
- MCP: 에러 메시지에서 파일시스템 경로 정보 제거
- detect: 4바이트 미만 버퍼 명시적 가드
- tsup: CLI/MCP 빌드에 sourcemap 추가

### Fixed
- HWP5: 제어문자 코드 10(각주/미주)을 isExt 범위에 포함

## [0.2.2] - 2026-03-28

### Security
- colSpan/rowSpan 클램핑, MCP safePath 강화, 파일 크기 제한

## [0.2.1] - 2026-03-28

### Security
- ZIP bomb 방지, XXE/Billion Laughs 방지, HWP5 압축 폭탄 방지, 경로 순회 차단

### Changed
- pdfjs-dist를 선택적 peerDependency로 변경

## [0.2.0] - 2026-03-28

### Changed
- IR 패턴 도입, 2-pass 테이블 빌더, 파서-렌더러 분리

## [0.1.0] - 2026-03-28

### Added
- 최초 릴리스: HWP 5.x, HWPX, PDF 파싱, CLI, MCP 서버
