/**
 * HTML escaping utilities for webview security
 */

/**
 * Type for values that can be escaped (handles common input types)
 */
type EscapableValue = string | number | null | undefined;

const HTML_ESCAPE_MAP: { [key: string]: string } = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;'
};

/**
 * Escape HTML special characters to prevent XSS attacks
 */
export function escapeHtml(str: EscapableValue): string {
  if (str === null || str === undefined) {
    return '';
  }

  const value = String(str);
  return value.replaceAll(/[&<>"'`=/]/g, char => HTML_ESCAPE_MAP[char] || char);
}

/**
 * Escape a value for use in HTML attributes
 */
export function escapeAttr(str: EscapableValue): string {
  return escapeHtml(str);
}

/**
 * Escape a value for use in JavaScript string literals within HTML
 * Use this when embedding data in inline scripts
 */
export function escapeJs(str: EscapableValue): string {
  if (str === null || str === undefined) {
    return '';
  }

  const value = String(str);
  return value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll("'", String.raw`\'`)
    .replaceAll('"', String.raw`\"`)
    .replaceAll('\n', String.raw`\n`)
    .replaceAll('\r', String.raw`\r`)
    .replaceAll('\t', String.raw`\t`)
    .replaceAll(/<\/script/gi, String.raw`<\/script`);
}

/**
 * Safely encode data for embedding in HTML as JSON
 * This is safer than inline scripts for passing data to webview
 */
export function safeJsonEncode(data: unknown): string {
  const json = JSON.stringify(data);
  // Escape HTML entities in JSON to prevent breaking out of script tags
  return json
    .replaceAll('<', String.raw`\u003c`)
    .replaceAll('>', String.raw`\u003e`)
    .replaceAll('&', String.raw`\u0026`)
    .replaceAll("'", String.raw`\u0027`);
}

/**
 * Check if a string contains potentially dangerous content
 */
export function containsUnsafeContent(str: string): boolean {
  const unsafePatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i, // onclick, onerror, etc.
    /<iframe/i,
    /<object/i,
    /<embed/i
  ];

  return unsafePatterns.some(pattern => pattern.test(str));
}
