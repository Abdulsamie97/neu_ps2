/**
 * @file c-update-helpers.ts
 * @brief C-Helfer fuer Praefix- und Postfix-Updates auf Pseudo2-Werten.
 *
 * Die Helfer werden nur bei tatsaechlich verwendeten Update-Ausdruecken in den
 * erzeugten C-Code eingefuegt. Ihre Vertrage erhalten den Wert des alten
 * Operanden und den neuen Wert des Variablenslots getrennt.
 *
 * @author Abdul
 */

/** Erzeugt die vier C-Funktionen mit passenden VeriFast-Vertraegen. */
export function generateCUpdateHelpers(): string {
  return [
    generateUpdateHelper('post', 'inc', '-1', false),
    generateUpdateHelper('pre', 'inc', '-1', true),
    generateUpdateHelper('post', 'dec', '1', false),
    generateUpdateHelper('pre', 'dec', '1', true)
  ].join('\n\n');
}

/**
 * Verwendet Subtraktion auch fuer ++, damit ein dynamischer String-Operand
 * numerisch konvertiert und nicht mit "1" verkettet wird.
 */
function generateUpdateHelper(position: 'pre' | 'post', direction: 'inc' | 'dec', offset: string, returnNew: boolean): string {
  const delta = direction === 'inc' ? '+ 1' : '- 1';
  const oldResult = `ps2_model_kind(result) == ps2_model_kind(before) &*& ps2_model_integral(result) == ps2_model_integral(before) &*& ps2_model_int(result) == ps2_model_int(before) &*& ps2_model_real(result) == ps2_model_real(before)`;
  const newResult = `ps2_model_kind(result) == ps2_number_kind &*& ps2_model_integral(result) == ps2_model_integral(before) &*& (ps2_model_integral(before) && ps2_model_kind(before) == ps2_number_kind ? ps2_model_int(result) == ps2_model_int(before) ${delta} : true)`;
  return `static Ps2Value* ps2_${position}_${direction}(Ps2Value** slot)
    //@ requires *slot |-> ?before;
    //@ ensures *slot |-> ?after &*& after != 0 &*& ps2_model_value(after) == true &*& ps2_model_kind(after) == ps2_number_kind &*& ps2_model_integral(after) == ps2_model_integral(before) &*& (ps2_model_integral(before) && ps2_model_kind(before) == ps2_number_kind ? ps2_model_int(after) == ps2_model_int(before) ${delta} : true) &*& result != 0 &*& ps2_model_value(result) == true &*& ${returnNew ? newResult : oldResult};
{
  Ps2Value* old_value = ps2_copy_value(*slot);
  Ps2Value* next_value = ps2_subtract(old_value, ps2_int(${offset}));
  *slot = ps2_copy_value(next_value);
  return ${returnNew ? 'next_value' : 'old_value'};
}`;
}
