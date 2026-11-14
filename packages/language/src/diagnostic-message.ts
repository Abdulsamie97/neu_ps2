/**
 * @file diagnostic-message.ts
 * @brief Extrahiert den Text aus LSP-Diagnosen.
 * @author Abdul
 */

/**
 * @brief Liest Meldungen einheitlich aus Text- und Markup-Diagnosen.
 * @param diagnostic LSP-Diagnose mit einer Nachricht als String oder MarkupContent.
 * @returns Nachricht zur Ausgabe in textbasierten Oberflaechen.
 */
export function getDiagnosticMessage({ message }: { message: string | { value: string } }): string {
  return typeof message === 'string' ? message : message.value;
}
