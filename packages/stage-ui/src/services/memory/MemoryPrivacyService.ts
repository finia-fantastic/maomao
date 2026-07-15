/**
 * Strips sensitive content from text before memory storage.
 *
 * Filters: passwords, API keys, tokens, private keys, verification codes,
 * and other common credential formats.
 */

/**
 * Patterns that match common credential formats.
 *
 * - JWT tokens: `eyJ...` base64url encoded header.payload.signature
 * - API keys: sk-*, api_key=, etc.
 * - Private keys: -----BEGIN ... PRIVATE KEY-----
 * - Connection strings with passwords: mongodb://user:pass@host
 * - Auth headers: Authorization: Bearer ..., x-api-key: ...
 * - Verification codes: 6-digit numeric codes in context of "code", "验证码", etc.
 */
const CREDENTIAL_PATTERNS: Array<{ pattern: RegExp, name: string }> = [
  // JWT tokens
  { pattern: /eyJ[\w-]{20,}\.[\w-]{20,}\.[\w-]*/g, name: 'JWT token' },
  // OpenAI-style API keys
  { pattern: /sk-[A-Za-z0-9]{32,}/g, name: 'API key (sk-*)' },
  // Generic API keys in assignment contexts
  { pattern: /(?:api[_-]?key|apikey|API_KEY)\s*[:=]\s*['"]?[\w-]{16,}['"]?/gi, name: 'API key assignment' },
  // Private key blocks
  { pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, name: 'Private key block' },
  // Bearer tokens in Authorization headers
  { pattern: /(?:Authorization|auth)\s*:\s*Bearer\s+[\w\-.]+/gi, name: 'Bearer token' },
  // GitHub/other service tokens
  { pattern: /(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{22,})/g, name: 'GitHub token' },
  // Generic secret keys
  { pattern: /(?:secret|token|password|passwd)\s*[:=]\s*['"][^'"]{6,}['"]/gi, name: 'Secret assignment' },
]

/**
 * Checks whether the given text contains any credential-like patterns.
 */
export function containsCredentials(text: string): boolean {
  return CREDENTIAL_PATTERNS.some(({ pattern }) => {
    const fresh = new RegExp(pattern.source, pattern.flags)
    return fresh.test(text)
  })
}

/**
 * Strips known credential patterns from text, replacing them with `[REDACTED: <type>]`.
 *
 * @returns The sanitized text and a count of redacted matches.
 */
export function stripCredentials(text: string): { sanitized: string, redactedCount: number } {
  let result = text
  let count = 0

  for (const { pattern, name } of CREDENTIAL_PATTERNS) {
    const fresh = new RegExp(pattern.source, pattern.flags)
    const matches = result.match(fresh)
    if (matches) {
      count += matches.length
      result = result.replaceAll(fresh, `[REDACTED: ${name}]`)
    }
  }

  return { sanitized: result, redactedCount: count }
}

/**
 * Checks whether the content should be filtered for sensitive information.
 *
 * Returns `true` if the content likely contains secrets that should not be stored.
 * The caller should check `enableSensitiveMemory` setting to decide final action.
 */
export function isSensitiveContent(text: string): boolean {
  // Check for credential patterns
  if (containsCredentials(text))
    return true

  // Check for common sensitive content markers
  const sensitiveIndicators = [
    /\bpassword\b/i,
    /\bsecret\b/i,
    /\btoken\b/i,
    /\bprivate\s*key\b/i,
    /\bapi\s*key\b/i,
    /\bcredential\b/i,
    /\b登录密码\b/,
    /\b支付密码\b/,
    /\b密钥\b/,
    /\b验证码\b/,
  ]

  return sensitiveIndicators.some(pattern => pattern.test(text))
}
