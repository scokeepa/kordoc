/** PDF 텍스트 추출 (pdfjs-dist 기반 서버사이드 파싱) */

import type { ParseResult } from "../types.js"
import { KordocError } from "../utils.js"

/** 최대 처리 페이지 수 — OOM 방지 */
const MAX_PAGES = 5000
/** 누적 텍스트 최대 크기 (100MB) — 메모리 폭주 방지 */
const MAX_TOTAL_TEXT = 100 * 1024 * 1024

import { createRequire } from "module"
import { pathToFileURL } from "url"

// pdfjs-dist는 external로 빌드됨 — 설치 안 되어 있으면 런타임에 잡힘
interface PdfjsModule {
  getDocument: (opts: Record<string, unknown>) => { promise: Promise<PdfjsDocument> }
  GlobalWorkerOptions: { workerSrc: string }
}
interface PdfjsDocument {
  numPages: number
  getPage: (n: number) => Promise<PdfjsPage>
  destroy: () => Promise<void>
}
interface PdfjsPage {
  getTextContent: () => Promise<{ items: PdfjsTextItem[] }>
}
interface PdfjsTextItem {
  str: string
  transform: number[]
  width: number
  height: number
}

let pdfjsModule: PdfjsModule | null = null

async function loadPdfjs(): Promise<PdfjsModule | null> {
  if (pdfjsModule) return pdfjsModule
  try {
    const mod = await import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as PdfjsModule
    // 워커 경로를 file:// URL로 설정 (Node.js ESM 환경 필수)
    const req = createRequire(import.meta.url)
    const workerPath = req.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")
    mod.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
    pdfjsModule = mod
    return mod
  } catch (err) {
    // import 실패 원인을 구분하여 반환
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("Cannot find") || msg.includes("MODULE_NOT_FOUND")) {
      return null // 미설치
    }
    throw new KordocError(`pdfjs-dist 로딩 실패: ${msg}`)
  }
}

export async function parsePdfDocument(buffer: ArrayBuffer): Promise<ParseResult> {
  const pdfjs = await loadPdfjs()
  if (!pdfjs) {
    return {
      success: false,
      fileType: "pdf",
      pageCount: 0,
      error: "pdfjs-dist가 설치되지 않았습니다. npm install pdfjs-dist",
    }
  }

  const data = new Uint8Array(buffer)
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false,
  }).promise

  try {
    const pageCount = doc.numPages
    if (pageCount === 0) {
      return { success: false, fileType: "pdf", pageCount: 0, error: "PDF에 페이지가 없습니다." }
    }

    const pageTexts: string[] = []
    let totalChars = 0
    let totalTextBytes = 0
    const effectivePageCount = Math.min(pageCount, MAX_PAGES)

    for (let i = 1; i <= effectivePageCount; i++) {
      const page = await doc.getPage(i)
      const textContent = await page.getTextContent()
      const lines = groupTextItemsByLine(textContent.items)
      const pageText = lines.join("\n")
      totalChars += pageText.replace(/\s/g, "").length
      totalTextBytes += pageText.length * 2
      if (totalTextBytes > MAX_TOTAL_TEXT) throw new KordocError(`텍스트 추출 크기 초과 (${MAX_TOTAL_TEXT / 1024 / 1024}MB 제한)`)
      pageTexts.push(pageText)
    }

    const avgCharsPerPage = totalChars / effectivePageCount
    if (avgCharsPerPage < 10) {
      return {
        success: false,
        fileType: "pdf",
        pageCount,
        isImageBased: true,
        error: `이미지 기반 PDF로 추정됩니다 (${pageCount}페이지, 추출 텍스트 ${totalChars}자).`,
      }
    }

    let markdown = ""
    for (let i = 0; i < pageTexts.length; i++) {
      const cleaned = cleanPdfText(pageTexts[i])
      if (cleaned.trim()) {
        if (i > 0 && markdown) markdown += "\n\n"
        markdown += cleaned
      }
    }

    markdown = reconstructTables(markdown)

    const truncated = pageCount > MAX_PAGES
    return { success: true, fileType: "pdf", markdown, pageCount: effectivePageCount, isImageBased: false, ...(truncated && { warning: `PDF가 ${pageCount}페이지이지만 ${MAX_PAGES}페이지까지만 처리했습니다` }) }
  } finally {
    await doc.destroy().catch(() => {})
  }
}

// ─── 텍스트 아이템 → 행 그룹핑 ──────────────────────

function groupTextItemsByLine(items: PdfjsTextItem[]): string[] {
  if (items.length === 0) return []

  const textItems = items.filter(item => typeof item.str === "string" && item.str.trim() !== "")
  if (textItems.length === 0) return []

  textItems.sort((a, b) => {
    const yDiff = b.transform[5] - a.transform[5]
    if (Math.abs(yDiff) < 2) return a.transform[4] - b.transform[4]
    return yDiff
  })

  const lines: string[] = []
  let currentY = textItems[0].transform[5]
  let currentLine: { text: string; x: number; width: number }[] = []

  for (const item of textItems) {
    const y = item.transform[5]

    if (Math.abs(currentY - y) > Math.max(item.height * 0.5, 2)) {
      if (currentLine.length > 0) lines.push(mergeLineItems(currentLine))
      currentLine = []
      currentY = y
    }

    currentLine.push({ text: item.str, x: item.transform[4], width: item.width })
  }

  if (currentLine.length > 0) lines.push(mergeLineItems(currentLine))
  return lines
}

function mergeLineItems(items: { text: string; x: number; width: number }[]): string {
  if (items.length <= 1) return items[0]?.text || ""
  items.sort((a, b) => a.x - b.x)

  let result = items[0].text
  for (let i = 1; i < items.length; i++) {
    const gap = items[i].x - (items[i - 1].x + items[i - 1].width)
    if (gap > 15) result += "\t"
    else if (gap > 3) result += " "
    result += items[i].text
  }
  return result
}

/**
 * PDF 텍스트 후처리 — 페이지 번호 제거, 한국어 줄 병합, 빈 줄 정규화.
 */
export function cleanPdfText(text: string): string {
  const stripped = text
    .replace(/^[\s]*[-–—]\s*\d+\s*[-–—][\s]*$/gm, "")   // 페이지 번호: - 1 -, — 25 —
    .replace(/^\s*\d+\s*\/\s*\d+\s*$/gm, "")             // 페이지 번호: 3 / 10

  return mergeKoreanLines(stripped)
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// ─── 한국어 줄 병합 ─────────────────────────────────────

/**
 * 다음 줄이 리스트/번호/구조 마커로 시작하는지 판별.
 * 이 패턴들은 한국 공문서에서 독립 항목이므로 이전 줄과 병합하면 안 됨.
 */
function startsWithMarker(line: string): boolean {
  const t = line.trimStart()
  if (/^[가-힣ㄱ-ㅎ][.)]/.test(t)) return true     // 한글 번호: 가. 나) 다.
  if (/^\d+[.)]/.test(t)) return true               // 숫자 번호: 1. 2) 3.
  if (/^\([가-힣ㄱ-ㅎ\d]+\)/.test(t)) return true   // 괄호 번호: (1) (가)
  if (/^[○●※▶▷◆◇■□★☆\-·]\s/.test(t)) return true // 기호 마커: ○ ● ※ ▶ - ·
  if (/^제\d+[조항호장절]/.test(t)) return true      // 법령 조항: 제1조, 제2항, 제3호
  return false
}

/**
 * 이전 줄이 독립 구조 헤더(법령 조항 번호 등)인지 판별.
 * 예: "제1조", "제2조(목적)", "제3장 국민의 권리" — 다음 줄과 병합하면 안 됨.
 */
function isStandaloneHeader(line: string): boolean {
  const t = line.trim()
  if (t.length > 40) return false                    // 긴 줄은 본문 — 헤더 아님
  return /^제\d+[조항호장절]/.test(t)
}

/**
 * 한국어 문단 줄 병합 — 리스트/번호/법령 마커 보호.
 *
 * 병합 조건:
 * 1. 이전 줄이 한글/구두점(·,-)으로 끝남
 * 2. 다음 줄이 한글/여는괄호로 시작
 * 3. 다음 줄이 리스트/구조 마커가 아님
 * 4. 이전 줄이 독립 구조 헤더가 아님
 */
function mergeKoreanLines(text: string): string {
  const lines = text.split("\n")
  const result: string[] = [lines[0]]

  for (let i = 1; i < lines.length; i++) {
    const prev = result[result.length - 1]
    const curr = lines[i]

    const shouldMerge =
      /[가-힣·,\-]$/.test(prev) &&
      /^[가-힣(]/.test(curr) &&
      !startsWithMarker(curr) &&
      !isStandaloneHeader(prev)

    if (shouldMerge) {
      result[result.length - 1] = prev + " " + curr
    } else {
      result.push(curr)
    }
  }

  return result.join("\n")
}

function reconstructTables(text: string): string {
  const lines = text.split("\n")
  const result: string[] = []
  let tableBuffer: string[][] = []

  for (const line of lines) {
    if (line.includes("\t")) {
      tableBuffer.push(line.split("\t").map(c => c.trim()))
    } else {
      if (tableBuffer.length >= 2) result.push(formatAsMarkdownTable(tableBuffer))
      else if (tableBuffer.length === 1) result.push(tableBuffer[0].join(" | "))
      tableBuffer = []
      result.push(line)
    }
  }

  if (tableBuffer.length >= 2) result.push(formatAsMarkdownTable(tableBuffer))
  else if (tableBuffer.length === 1) result.push(tableBuffer[0].join(" | "))

  return result.join("\n")
}

function formatAsMarkdownTable(rows: string[][]): string {
  const maxCols = Math.max(...rows.map(r => r.length))
  // defensive copy — 원본 배열 변경 방지
  const normalized = rows.map(r => {
    const copy = [...r]
    while (copy.length < maxCols) copy.push("")
    return copy
  })

  const lines: string[] = []
  lines.push("| " + normalized[0].join(" | ") + " |")
  lines.push("| " + normalized[0].map(() => "---").join(" | ") + " |")
  for (let i = 1; i < normalized.length; i++) {
    lines.push("| " + normalized[i].join(" | ") + " |")
  }
  return lines.join("\n")
}
