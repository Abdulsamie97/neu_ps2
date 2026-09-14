/**
 * @file spec-predicates.ts
 * @brief Ordnet die VeriFast-nahe Listenlaenge dem internen Arraymodell zu.
 * @author Abdul
 */

/** @returns Den internen Praedikatsnamen; historische `vf_*`-Namen bleiben lesbar. */
export function canonicalSpecPredicateKind(kind: string): string {
  return kind === 'length' ? 'vf_len' : kind;
}
