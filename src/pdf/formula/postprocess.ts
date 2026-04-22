/**
 * LaTeX 후처리 — Pix2Text `latex_ocr.py` 의 post_process 간소화 + 자체 필터
 *
 * 1) 후행 whitespace command 제거 (\, \: \; \! \quad \qquad \enspace \thinspace \ )
 * 2) 연속 공백 → 1개
 * 3) 빈 그룹 반복 제거 (^{} _{} \hat{} \bar{} \vec{} 등)
 * 4) \cmd 뒤 영문자 공백 분리 (\cdotd → \cdot d, \timesd → \times d)
 * 5) isTrivialFormula — 다이어그램 단일 글자/반복/장식 오탐 제거
 */

const TRAILING_WHITESPACE_CMDS = [
  "\\,",
  "\\:",
  "\\;",
  "\\!",
  "\\ ",
  "\\quad",
  "\\qquad",
  "\\enspace",
  "\\thinspace",
] as const

export function postProcessLatex(latex: string): string {
  let s = stripTrailingWhitespace(latex)
  s = collapseSpaces(s)
  for (let i = 0; i < 10; i++) {
    const next = stripEmptyGroups(s)
    if (next === s) break
    s = next
  }
  s = fixLatexSpacing(s)
  s = normalizeFormulaSpacing(s)
  s = s.trim()
  // trivial 이면 빈 문자열 반환 — 상위(pipeline/parser) 에서 latex.trim() 비었을 때 skip.
  if (isTrivialFormula(s)) return ""
  return s
}

export function stripTrailingWhitespace(s: string): string {
  let t = s
  // 바깥 loop: 한 번 제거 후 다시 체크 (중첩 "\\, \\quad" 같은 경우)
  for (;;) {
    const trimmed = t.replace(/[\s]+$/, "")
    let changed = false
    for (const p of TRAILING_WHITESPACE_CMDS) {
      if (trimmed.endsWith(p)) {
        t = trimmed.slice(0, trimmed.length - p.length)
        changed = true
        break
      }
    }
    if (!changed) return trimmed
  }
}

export function collapseSpaces(s: string): string {
  let out = ""
  let prevSpace = false
  for (const c of s) {
    if (/\s/.test(c)) {
      if (!prevSpace) {
        out += " "
        prevSpace = true
      }
    } else {
      out += c
      prevSpace = false
    }
  }
  return out
}

/**
 * 빈 그룹 `{}` 또는 `{\s+}` 를 찾아 선행하는 `^`, `_`, 또는 `\cmd` 와 함께 제거.
 */
export function stripEmptyGroups(s: string): string {
  let out = ""
  let i = 0
  const bytes = s
  while (i < bytes.length) {
    const ch = bytes[i]
    if (ch === "{") {
      // 빈 { \s* } 스캔
      let j = i + 1
      while (j < bytes.length && /\s/.test(bytes[j])) j++
      if (j < bytes.length && bytes[j] === "}") {
        // 앞쪽 공백 제거
        while (out.endsWith(" ") || out.endsWith("\t")) {
          out = out.slice(0, -1)
        }
        if (out.endsWith("^") || out.endsWith("_")) {
          out = out.slice(0, -1)
        } else {
          // \cmd 형태인지 탐색
          let k = out.length
          while (k > 0 && /[A-Za-z]/.test(out[k - 1])) k--
          if (k > 0 && out[k - 1] === "\\" && k < out.length) {
            out = out.slice(0, k - 1)
          }
          // 아니면 아무것도 안 함 — 빈 {} 만 제거
        }
        i = j + 1
        continue
      }
    }
    out += ch
    i++
  }
  return out
}

/**
 * LaTeX 명령어 화이트리스트 — 공백 누락 감지에 사용.
 * MFR 이 `\cdot d` 를 `\cdotd` 로 합쳐 출력할 때, 어느 지점에서 명령어가 끝나는지
 * 알려진 커맨드명으로 판단한다. 완전한 리스트는 아니며 OCR 에서 실제 관찰된 케이스 중심.
 */
const KNOWN_LATEX_CMDS: ReadonlySet<string> = new Set([
  // 연산자
  "cdot", "cdots", "ldots", "dots", "vdots", "ddots",
  "times", "div", "pm", "mp", "ast", "star", "circ", "bullet",
  "oplus", "ominus", "otimes", "odot",
  // 관계
  "approx", "equiv", "neq", "ne", "sim", "simeq", "cong",
  "leq", "geq", "le", "ge", "ll", "gg", "prec", "succ", "preceq", "succeq",
  "propto", "parallel", "perp",
  // 집합/논리
  "in", "notin", "ni", "subset", "supset", "subseteq", "supseteq",
  "cap", "cup", "bigcap", "bigcup", "emptyset", "varnothing",
  "forall", "exists", "nexists", "neg", "lnot", "land", "lor", "vee", "wedge",
  // 그리스 소문자
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon",
  "zeta", "eta", "theta", "vartheta", "iota", "kappa", "lambda",
  "mu", "nu", "xi", "omicron", "pi", "varpi", "rho", "varrho",
  "sigma", "varsigma", "tau", "upsilon", "phi", "varphi",
  "chi", "psi", "omega",
  // 그리스 대문자
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma",
  "Upsilon", "Phi", "Psi", "Omega",
  // 화살표
  "to", "gets", "mapsto", "rightarrow", "leftarrow", "leftrightarrow",
  "Rightarrow", "Leftarrow", "Leftrightarrow", "uparrow", "downarrow",
  "longrightarrow", "longleftarrow", "longmapsto",
  // 큰 연산자
  "sum", "prod", "coprod", "int", "iint", "iiint", "oint", "bigoplus", "bigotimes",
  // 함수명
  "sin", "cos", "tan", "sec", "csc", "cot",
  "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh",
  "log", "ln", "lg", "exp", "lim", "liminf", "limsup",
  "sup", "inf", "max", "min", "arg", "det", "dim", "gcd", "deg", "hom", "ker", "mod",
  // 특수 기호/수식
  "infty", "partial", "nabla", "prime", "aleph", "ell", "hbar", "Re", "Im",
  "top", "bot", "angle", "vdash", "dashv",
  // 기타
  "left", "right", "big", "Big", "bigg", "Bigg",
])

/**
 * `\cmd` 뒤에 영문자가 바로 붙으면 공백 분리 (e.g. `\cdotd` → `\cdot d`, `\timesd_{k}` → `\times d_{k}`).
 *
 * MFR 이 좁은 영역에서 가끔 `\cdot` 과 다음 변수 사이 공백을 누락. 그대로 두면 LaTeX 파서가
 * `\cdotd` 를 undefined command 로 처리 (KaTeX: 에러 / TeX: 정의되지 않은 제어 시퀀스).
 * 알려진 LaTeX 명령어 prefix 중 가장 긴 것을 찾아 분할하면 렌더 안정성 확보.
 *
 * `\cmd{..}` (영문자 뒤 `{`) 는 인자 포함 형태로 간주해 분리하지 않음.
 */
export function fixLatexSpacing(s: string): string {
  let out = ""
  let i = 0
  while (i < s.length) {
    if (s[i] === "\\" && i + 1 < s.length && /[A-Za-z]/.test(s[i + 1])) {
      // \cmd 최장일치
      let j = i + 1
      while (j < s.length && /[A-Za-z]/.test(s[j])) j++
      const full = s.slice(i + 1, j) // 명령어 이름 (앞 \ 제거)
      const nextChar = j < s.length ? s[j] : ""

      // \cmd{..} 형태 — 인자로 이어지므로 분리하지 않음
      if (nextChar === "{") {
        out += "\\" + full
        i = j
        continue
      }

      // 자체가 알려진 명령어이거나, 긴 prefix 가 없으면 그대로
      let splitAt = full.length
      if (!KNOWN_LATEX_CMDS.has(full) && full.length >= 3) {
        // 뒤에서부터 prefix 길이를 줄이며 가장 긴 known cmd 찾기
        for (let len = full.length - 1; len >= 2; len--) {
          if (KNOWN_LATEX_CMDS.has(full.slice(0, len))) {
            splitAt = len
            break
          }
        }
      }

      out += "\\" + full.slice(0, splitAt)
      if (splitAt < full.length) {
        out += " " + full.slice(splitAt)
      }
      i = j
    } else {
      out += s[i]
      i++
    }
  }
  return out
}

/**
 * trivial(noise) 수식 판정.
 *
 * true 인 케이스 (MFD 오탐 주범):
 *   1) 공백/중괄호 제거 후 2자 이하 (e.g. `O`, `a`, `.`, `n`)
 *   2) 단일 `\cmd` (e.g. `\imath`, `\pi`, `\eta`, `\sigma`, `\theta`, `\emptyset`, `\varPi`)
 *   3) 단일 `\mathrm{..}` / `\textrm{..}` / `\operatorname{..}` 류 + 짧은 내용 (e.g. `\mathrm{fcloc}`)
 *   4) 동일 토큰이 3회 이상 + 전체의 50% 이상 (e.g. `\pm \pm \pm \pm`, `\cap \exists \exists \rceil`)
 *
 * false 유지 (의미 있는 수식):
 *   `O(1)`, `d_{k}=64`, `\sqrt{d_{k}}`, `PE_{pos+k}`, 등
 */
export function isTrivialFormula(s: string): boolean {
  const t = s.trim()
  if (t.length === 0) return true

  // 1) 공백/중괄호 제거 후 길이 ≤ 2
  const stripped = t.replace(/[\s{}]/g, "")
  if (stripped.length <= 2) return true

  // 2) 단일 \cmd (e.g. \imath, \varPi, \pi)
  if (/^\\[A-Za-z]+$/.test(t)) return true

  // 3) 단일 \mathrm{..} / \textrm{..} / \operatorname{..} / \mathit{..} / \mathbf{..} / \mathcal{..} + 짧은 내용
  if (
    /^\\(?:mathrm|textrm|text|operatorname|mathit|mathbf|mathcal|mathsf|mathtt)\{[A-Za-z]{1,6}\}$/.test(
      t,
    )
  )
    return true

  const tokens = tokenizeLatex(t)

  // 4) 반복 토큰 dominant (e.g. "\\pm \\pm \\pm \\pm")
  if (tokens.length >= 3) {
    const freq = new Map<string, number>()
    for (const tok of tokens) freq.set(tok, (freq.get(tok) ?? 0) + 1)
    let maxCount = 0
    for (const c of freq.values()) if (c > maxCount) maxCount = c
    if (maxCount >= 3 && maxCount / tokens.length >= 0.5) return true
  }

  // 5) 심볼만 구성된 짧은 식 — 토큰 2~4개이고 연산자/숫자 없음 (e.g. "\\cap \\exists \\exists \\rceil")
  //    의미 있는 수식은 대개 `=` 또는 숫자가 포함됨. 허용되는 연산자: = + - / * < > 숫자
  if (tokens.length >= 2 && tokens.length <= 4) {
    const hasOpOrNum = tokens.some((tok) =>
      /^[=+\-/*<>]$/.test(tok) || /^[0-9]$/.test(tok),
    )
    if (!hasOpOrNum) return true
  }

  return false
}

/**
 * LaTeX 를 단순 토큰 배열로 분할 — `\cmd` 는 하나의 토큰, 그 외는 non-space 단일 문자.
 * isTrivialFormula 의 반복 감지용.
 */
function tokenizeLatex(s: string): string[] {
  const result: string[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === "\\") {
      let j = i + 1
      while (j < s.length && /[A-Za-z]/.test(s[j])) j++
      if (j === i + 1 && j < s.length) j++ // `\\` 또는 `\{` 같은 단일 escape
      result.push(s.slice(i, j))
      i = j
    } else if (/\s/.test(c)) {
      i++
    } else {
      result.push(c)
      i++
    }
  }
  return result
}

/**
 * MFR tokenizer 가 LaTeX 토큰 사이에 삽입하는 과도한 공백을 정리.
 *
 * 예: `\mathrm { m o d d }` → `\mathrm{modd}`, `6 4` → `64`, `( Q, K, V )` → `(Q,K,V)`
 *
 * 규칙: 공백을 앞뒤 토큰 기준으로 유지/제거 결정.
 *   - 직전이 `\cmd` 이고 직후가 영문자 → **유지** (e.g. `\cdot d`, `\alpha b` — 공백 없으면 greedy 로 `\cdotd` 가 명령어로 해석될 수 있음)
 *   - 그 외 → **제거** (숫자/괄호/중괄호/첨자/구두점 주변 공백은 LaTeX 의미를 바꾸지 않음)
 *
 * `fixLatexSpacing` 이후에 호출되는 것을 전제 — 먼저 공백 누락을 복원한 뒤 과도한 공백을 걷어냄.
 */
export function normalizeFormulaSpacing(s: string): string {
  // `\cmd`, 단일 escape, 공백, 일반 문자 단위로 토큰화 (공백도 토큰으로 유지)
  const tokens: string[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === "\\") {
      let j = i + 1
      while (j < s.length && /[A-Za-z]/.test(s[j])) j++
      if (j === i + 1 && j < s.length) j++ // 단일 escape (`\\`, `\{` 등)
      tokens.push(s.slice(i, j))
      i = j
    } else if (/\s/.test(c)) {
      tokens.push(" ")
      i++
    } else {
      tokens.push(c)
      i++
    }
  }

  const out: string[] = []
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k] !== " ") {
      out.push(tokens[k])
      continue
    }
    // 공백 토큰 — 유지 여부 결정
    // 연속 공백은 나중에 병합 (아래 로직은 앞뒤 non-space 토큰 기준)
    let prev = ""
    for (let p = k - 1; p >= 0; p--) {
      if (tokens[p] !== " ") {
        prev = tokens[p]
        break
      }
    }
    let next = ""
    for (let q = k + 1; q < tokens.length; q++) {
      if (tokens[q] !== " ") {
        next = tokens[q]
        break
      }
    }
    const prevIsCmd = /^\\[A-Za-z]+$/.test(prev)
    const nextIsAlpha = /^[A-Za-z]$/.test(next)
    if (prevIsCmd && nextIsAlpha) {
      // 앞 cmd 와 뒤 변수 분리용 공백 (연속 공백이더라도 하나만 남김)
      if (out.length === 0 || out[out.length - 1] !== " ") {
        out.push(" ")
      }
    }
    // 그 외 공백은 drop
  }

  // 앞/뒤 공백 제거
  while (out.length > 0 && out[0] === " ") out.shift()
  while (out.length > 0 && out[out.length - 1] === " ") out.pop()

  return out.join("")
}
