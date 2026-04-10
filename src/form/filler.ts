/** 양식 서식 필드 값 채우기 — IRBlock[] 기반 in-place 교체 */

import type { IRBlock, IRTable, FormField } from "../types.js"
import { extractFormFields } from "./recognize.js"

/** 필드 채우기 결과 */
export interface FillResult {
  /** 값이 교체된 IRBlock[] */
  blocks: IRBlock[]
  /** 실제 채워진 필드 목록 */
  filled: FormField[]
  /** 매칭 실패한 라벨 (입력에는 있지만 서식에서 못 찾은 것) */
  unmatched: string[]
}

/**
 * IRBlock[]에서 양식 필드를 찾아 값을 교체.
 *
 * @param blocks 원본 IRBlock[] (변경하지 않음 — deep clone)
 * @param values 채울 값 맵 (라벨 → 새 값). 라벨은 부분 매칭 지원.
 * @returns FillResult
 *
 * @example
 * ```ts
 * const result = await parse("신청서.hwp")
 * if (!result.success) throw new Error(result.error)
 * const { blocks, filled } = fillFormFields(result.blocks, {
 *   "성명": "홍길동",
 *   "전화번호": "010-1234-5678",
 *   "주소": "서울시 강남구",
 * })
 * ```
 */
export function fillFormFields(
  blocks: IRBlock[],
  values: Record<string, string>,
): FillResult {
  // deep clone — 원본 불변
  const cloned = structuredClone(blocks)
  const filled: FormField[] = []
  const matchedLabels = new Set<string>()

  // 입력 라벨 정규화 (콜론/공백 제거)
  const normalizedValues = new Map<string, string>()
  for (const [label, value] of Object.entries(values)) {
    normalizedValues.set(normalizeLabel(label), value)
  }

  // 1) 테이블 기반 필드 교체
  for (const block of cloned) {
    if (block.type !== "table" || !block.table) continue
    fillTable(block.table, normalizedValues, filled, matchedLabels)
  }

  // 2) 인라인 "라벨: 값" 패턴 교체
  for (const block of cloned) {
    if (block.type !== "paragraph" || !block.text) continue
    const newText = fillInlineFields(block.text, normalizedValues, filled, matchedLabels)
    if (newText !== block.text) block.text = newText
  }

  const unmatched = [...normalizedValues.keys()]
    .filter(k => !matchedLabels.has(k))
    .map(k => {
      // 원본 라벨 키 복원
      for (const orig of Object.keys(values)) {
        if (normalizeLabel(orig) === k) return orig
      }
      return k
    })

  return { blocks: cloned, filled, unmatched }
}

/** 라벨 정규화 — 비교용 */
function normalizeLabel(label: string): string {
  return label.trim().replace(/[:：\s]/g, "")
}

/** 테이블 셀에서 라벨-값 패턴을 찾아 값 교체 */
function fillTable(
  table: IRTable,
  values: Map<string, string>,
  filled: FormField[],
  matchedLabels: Set<string>,
): void {
  if (table.cols < 2) return

  for (let r = 0; r < table.rows; r++) {
    for (let c = 0; c < table.cols - 1; c++) {
      const labelCell = table.cells[r][c]
      const valueCell = table.cells[r][c + 1]
      if (!labelCell || !valueCell) continue

      const normalizedCellLabel = normalizeLabel(labelCell.text)
      if (!normalizedCellLabel) continue

      // 정확 매칭 → 부분 매칭 순
      const matchKey = findMatchingKey(normalizedCellLabel, values)
      if (matchKey === undefined) continue

      const newValue = values.get(matchKey)!
      const oldValue = valueCell.text.trim()

      valueCell.text = newValue
      matchedLabels.add(matchKey)
      filled.push({
        label: labelCell.text.trim().replace(/[:：]\s*$/, ""),
        value: newValue,
        row: r,
        col: c,
      })
    }
  }

  // 헤더+데이터 행 패턴 (첫 행 전부 라벨)
  if (filled.length === 0 && table.rows >= 2 && table.cols >= 2) {
    const headerRow = table.cells[0]
    const allShortText = headerRow.every(cell => {
      const t = cell.text.trim()
      return t.length > 0 && t.length <= 20
    })
    if (!allShortText) return

    for (let r = 1; r < table.rows; r++) {
      for (let c = 0; c < table.cols; c++) {
        const headerLabel = normalizeLabel(headerRow[c].text)
        const matchKey = findMatchingKey(headerLabel, values)
        if (matchKey === undefined) continue

        const newValue = values.get(matchKey)!
        table.cells[r][c].text = newValue
        matchedLabels.add(matchKey)
        filled.push({
          label: headerRow[c].text.trim(),
          value: newValue,
          row: r,
          col: c,
        })
      }
    }
  }
}

/** 정확 매칭 → 포함 매칭 순으로 키 검색 */
function findMatchingKey(cellLabel: string, values: Map<string, string>): string | undefined {
  // 정확 매칭
  if (values.has(cellLabel)) return cellLabel
  // 포함 매칭 (셀 라벨이 입력 키를 포함하거나, 입력 키가 셀 라벨을 포함)
  for (const key of values.keys()) {
    if (cellLabel.includes(key) || key.includes(cellLabel)) return key
  }
  return undefined
}

/** 인라인 "라벨: 값" 패턴 교체 */
function fillInlineFields(
  text: string,
  values: Map<string, string>,
  filled: FormField[],
  matchedLabels: Set<string>,
): string {
  return text.replace(
    /([가-힣A-Za-z]{2,10})\s*[:：]\s*([^\n,;]{0,100})/g,
    (match, rawLabel: string, oldValue: string) => {
      const normalized = normalizeLabel(rawLabel)
      const matchKey = findMatchingKey(normalized, values)
      if (matchKey === undefined) return match

      const newValue = values.get(matchKey)!
      matchedLabels.add(matchKey)
      filled.push({
        label: rawLabel.trim(),
        value: newValue,
        row: -1,
        col: -1,
      })
      return `${rawLabel}: ${newValue}`
    },
  )
}
