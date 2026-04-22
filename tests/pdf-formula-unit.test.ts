/**
 * PDF 수식 OCR 유닛 테스트 — 외부 모델/바이너리 의존성 없는 순수 로직만 검증.
 * (e2e 테스트는 모델 다운로드 필요하므로 별도 파일에서 수행)
 */

import { describe, it } from "node:test"
import { strict as assert } from "node:assert"

import {
  postProcessLatex,
  stripTrailingWhitespace,
  collapseSpaces,
  stripEmptyGroups,
  fixLatexSpacing,
  isTrivialFormula,
  normalizeFormulaSpacing,
} from "../src/pdf/formula/postprocess.js"
import { __internal } from "../src/pdf/formula/detector.js"

const { nms, iou, letterbox } = __internal

describe("formula postprocess", () => {
  it("trailing whitespace command 제거", () => {
    assert.equal(stripTrailingWhitespace("x + y \\quad"), "x + y")
    assert.equal(stripTrailingWhitespace("x + y \\,"), "x + y")
    assert.equal(stripTrailingWhitespace("x + y \\! \\,"), "x + y")
    assert.equal(stripTrailingWhitespace("x + y"), "x + y")
  })

  it("연속 공백 축약", () => {
    assert.equal(collapseSpaces("a   b   c"), "a b c")
    assert.equal(collapseSpaces(" a b "), " a b ")
    assert.equal(collapseSpaces("\\frac{a}{b}"), "\\frac{a}{b}")
  })

  it("빈 그룹 제거 — 상첨자", () => {
    assert.equal(stripEmptyGroups("x^{} y"), "x y")
    assert.equal(stripEmptyGroups("x_{} y"), "x y")
    assert.equal(stripEmptyGroups("x_{ } y"), "x y")
  })

  it("빈 그룹 제거 — \\cmd{}", () => {
    assert.equal(stripEmptyGroups("\\hat{} y"), " y")
    assert.equal(stripEmptyGroups("\\bar{ } y"), " y")
    assert.equal(stripEmptyGroups("\\vec{}{x}"), "{x}")
  })

  it("clean LaTeX 에서는 idempotent (공백 없는 형태)", () => {
    const s = "\\frac{a}{b}"
    assert.equal(postProcessLatex(s), s)
    // normalizeFormulaSpacing 이 연산자 주변 공백을 제거 (LaTeX math mode 에선 의미 동일)
    assert.equal(postProcessLatex("x^{2}+y^{2}=z^{2}"), "x^{2}+y^{2}=z^{2}")
    assert.equal(postProcessLatex("x^{2} + y^{2} = z^{2}"), "x^{2}+y^{2}=z^{2}")
  })

  it("복합 후처리", () => {
    // trailing quad + 빈 sup + 연속 공백 — normalizer 로 `\sum_{i=1}` 뒤 공백 제거
    const raw = "\\sum_{i=1}^{} x_i   \\quad"
    assert.equal(postProcessLatex(raw), "\\sum_{i=1}x_i")
  })
})

describe("fixLatexSpacing", () => {
  it("\\cmd 뒤 영문자 분리", () => {
    assert.equal(fixLatexSpacing("\\cdotd"), "\\cdot d")
    assert.equal(fixLatexSpacing("\\timesd_{k}"), "\\times d_{k}")
    assert.equal(fixLatexSpacing("O(n^{2}\\cdotd)"), "O(n^{2}\\cdot d)")
  })

  it("\\cmd 뒤 중괄호는 영향 없음", () => {
    assert.equal(fixLatexSpacing("\\mathrm{model}"), "\\mathrm{model}")
    assert.equal(fixLatexSpacing("\\frac{a}{b}"), "\\frac{a}{b}")
    assert.equal(fixLatexSpacing("\\sqrt{d_{k}}"), "\\sqrt{d_{k}}")
  })

  it("\\cmd 뒤 공백이 이미 있으면 유지", () => {
    assert.equal(fixLatexSpacing("\\cdot d"), "\\cdot d")
    assert.equal(fixLatexSpacing("\\times d_{k}"), "\\times d_{k}")
  })

  it("일반 텍스트는 변경 없음", () => {
    assert.equal(fixLatexSpacing("x + y = z"), "x + y = z")
    assert.equal(fixLatexSpacing("d_{k}=d_{v}=64"), "d_{k}=d_{v}=64")
  })
})

describe("normalizeFormulaSpacing", () => {
  it("\\mathrm 내부 character 공백 제거", () => {
    assert.equal(
      normalizeFormulaSpacing("\\mathrm { m o d d }"),
      "\\mathrm{modd}",
    )
    assert.equal(
      normalizeFormulaSpacing("\\mathrm { M u l t i H e a d }"),
      "\\mathrm{MultiHead}",
    )
  })

  it("숫자 사이 공백 제거", () => {
    assert.equal(normalizeFormulaSpacing("6 4"), "64")
    assert.equal(normalizeFormulaSpacing("2 0 1 8"), "2018")
    assert.equal(normalizeFormulaSpacing("d = 5 1 2"), "d=512")
  })

  it("괄호/구두점 주변 공백 제거", () => {
    assert.equal(normalizeFormulaSpacing("( Q, K, V )"), "(Q,K,V)")
    assert.equal(normalizeFormulaSpacing("h \\~ = 8"), "h\\~=8")
  })

  it("\\cmd 뒤 변수 공백 유지", () => {
    assert.equal(normalizeFormulaSpacing("\\cdot d"), "\\cdot d")
    assert.equal(normalizeFormulaSpacing("\\alpha b"), "\\alpha b")
    assert.equal(normalizeFormulaSpacing("O ( n \\cdot d )"), "O(n\\cdot d)")
  })

  it("첨자/중괄호 주변 공백 제거", () => {
    assert.equal(normalizeFormulaSpacing("d _ { k }"), "d_{k}")
    assert.equal(normalizeFormulaSpacing("W _ { i } ^ { Q }"), "W_{i}^{Q}")
  })

  it("연속 공백 정리", () => {
    assert.equal(normalizeFormulaSpacing("a   b"), "ab")
    assert.equal(normalizeFormulaSpacing("\\cdot   d"), "\\cdot d")
  })

  it("빈 문자열/공백만", () => {
    assert.equal(normalizeFormulaSpacing(""), "")
    assert.equal(normalizeFormulaSpacing("   "), "")
  })
})

describe("isTrivialFormula", () => {
  it("2자 이하 trivial", () => {
    assert.equal(isTrivialFormula("O"), true)
    assert.equal(isTrivialFormula("a"), true)
    assert.equal(isTrivialFormula("."), true)
    assert.equal(isTrivialFormula("n"), true)
    assert.equal(isTrivialFormula("{O}"), true) // 중괄호 제거 후 1자
    assert.equal(isTrivialFormula(" x "), true)
    assert.equal(isTrivialFormula("ab"), true)
  })

  it("단일 \\cmd trivial", () => {
    assert.equal(isTrivialFormula("\\imath"), true)
    assert.equal(isTrivialFormula("\\varPi"), true)
    assert.equal(isTrivialFormula("\\pi"), true)
    assert.equal(isTrivialFormula("\\eta"), true)
    assert.equal(isTrivialFormula("\\sigma"), true)
    assert.equal(isTrivialFormula("\\theta"), true)
    assert.equal(isTrivialFormula("\\emptyset"), true)
  })

  it("단일 \\mathrm 장식 trivial", () => {
    assert.equal(isTrivialFormula("\\mathrm{fcloc}"), true)
    assert.equal(isTrivialFormula("\\mathrm{abc}"), true)
    assert.equal(isTrivialFormula("\\textrm{hi}"), true)
    assert.equal(isTrivialFormula("\\operatorname{max}"), true)
  })

  it("반복 토큰 dominant trivial", () => {
    assert.equal(isTrivialFormula("\\pm \\pm \\pm \\pm \\pm"), true)
    assert.equal(isTrivialFormula("a a a a"), true)
    // \cap \exists \exists \rceil — 4 토큰, max=2, 50% → trivial
    assert.equal(isTrivialFormula("\\cap \\exists \\exists \\rceil"), true)
  })

  it("의미 있는 수식은 keep", () => {
    assert.equal(isTrivialFormula("O(1)"), false)
    assert.equal(isTrivialFormula("O(n^{2})"), false)
    assert.equal(isTrivialFormula("d_{k}"), false) // 4자
    assert.equal(isTrivialFormula("d_{k}=64"), false)
    assert.equal(isTrivialFormula("\\sqrt{d_{k}}"), false)
    assert.equal(isTrivialFormula("PE_{pos+k}"), false)
    assert.equal(isTrivialFormula("\\mathrm{Attention}(Q,K,V)"), false)
    assert.equal(
      isTrivialFormula("d_{k}=d_{v}=d_{\\mathrm{model}}/h=64"),
      false,
    )
    assert.equal(isTrivialFormula("\\frac{1}{\\sqrt{d_{k}}}"), false)
  })

  it("postProcessLatex 가 trivial 시 빈 문자열 반환", () => {
    assert.equal(postProcessLatex("O"), "")
    assert.equal(postProcessLatex("\\imath"), "")
    assert.equal(postProcessLatex("\\mathrm{fcloc}"), "")
    assert.equal(postProcessLatex("\\pm \\pm \\pm \\pm"), "")
    // 정상 수식은 유지
    assert.equal(
      postProcessLatex("d_{k}=d_{v}=64"),
      "d_{k}=d_{v}=64",
    )
  })
})

describe("formula detector — IoU / NMS / letterbox", () => {
  it("iou — 완전 겹침 = 1, 분리 = 0", () => {
    assert.ok(Math.abs(iou({ x1: 0, y1: 0, x2: 10, y2: 10 }, { x1: 0, y1: 0, x2: 10, y2: 10 }) - 1) < 1e-6)
    assert.ok(iou({ x1: 0, y1: 0, x2: 10, y2: 10 }, { x1: 20, y1: 20, x2: 30, y2: 30 }) < 1e-6)
  })

  it("iou — 4분의 1 겹침", () => {
    const v = iou({ x1: 0, y1: 0, x2: 10, y2: 10 }, { x1: 5, y1: 5, x2: 15, y2: 15 })
    // inter=25, areaA=areaB=100, union=175 → 25/175 ≈ 0.143
    assert.ok(Math.abs(v - 25 / 175) < 1e-3)
  })

  it("nms — IoU ≥ 임계값이면 낮은 score 제거", () => {
    const cands = [
      { x1: 0, y1: 0, x2: 10, y2: 10, kind: "inline" as const, score: 0.9 },
      { x1: 1, y1: 1, x2: 11, y2: 11, kind: "inline" as const, score: 0.8 }, // IoU ≈ 0.68
      { x1: 100, y1: 100, x2: 110, y2: 110, kind: "inline" as const, score: 0.85 }, // 분리
    ]
    const kept = nms(cands, 0.45)
    assert.equal(kept.length, 2)
    // 높은 score 두 개 유지
    assert.ok(kept.find((c) => c.score === 0.9))
    assert.ok(kept.find((c) => c.score === 0.85))
  })

  it("letterbox — 정사각형 이미지는 패딩 없이 전체 커버", () => {
    // 100×100 RGBA 이미지를 target=10 으로
    const data = new Uint8Array(100 * 100 * 4)
    data.fill(128) // mid gray
    const frame = { width: 100, height: 100, data }
    const out = letterbox(frame, 10)
    assert.equal(out.scale, 0.1)
    assert.equal(out.padX, 0)
    assert.equal(out.padY, 0)
    assert.equal(out.tensor.length, 3 * 10 * 10)
    // 중앙 픽셀은 128/255 ≈ 0.502
    const midIdx = 5 * 10 + 5
    assert.ok(Math.abs(out.tensor[midIdx] - 128 / 255) < 0.02)
  })

  it("letterbox — 가로로 긴 이미지는 상하 패딩", () => {
    const data = new Uint8Array(200 * 100 * 4)
    data.fill(255)
    const frame = { width: 200, height: 100, data }
    const out = letterbox(frame, 100)
    assert.equal(out.scale, 0.5)
    assert.equal(out.padX, 0)
    assert.equal(out.padY, 25)
    // 패딩 영역 (y=0) 은 114/255
    const padIdx = 0 * 100 + 50
    assert.ok(Math.abs(out.tensor[padIdx] - 114 / 255) < 0.01)
    // 본문 영역 (y=50) 은 255/255 = 1
    const contentIdx = 50 * 100 + 50
    assert.ok(Math.abs(out.tensor[contentIdx] - 1) < 0.01)
  })
})
