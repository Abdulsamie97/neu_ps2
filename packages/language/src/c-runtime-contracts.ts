/**
 * @file c-runtime-contracts.ts
 * @brief Enthält die abstrakte C-Runtime mit präzisen VeriFast-Verträgen.
 * @author Abdul
 */

/**
 * Ergänzt bei allen Runtime-Deklarationen mit Nachbedingung eine
 * Terminierungszusage. Dadurch können generierte Funktionen die abstrakten
 * Runtime-Operationen in terminierenden VeriFast-Beweisen verwenden.
 *
 * @param source C-Quelltext der abstrakten Runtime.
 * @returns C-Quelltext mit ergänzten `terminates`-Klauseln.
 */
function withTerminatingVeriFastContracts(source: string): string {
  return source.replace(
    /(    \/\/@ ensures [^\n]+;)/g,
    '$1\n    //@ terminates;'
  );
}

/**
 * Abstrakte C-Runtime für die Verifikation generierter Pseudo2-Programme.
 *
 * Die Deklarationen modellieren skalare Werte, Arrays und Structs über
 * Fixpunkte und Heap-Prädikate. Sie enthalten keine ausführbare
 * Implementierung und werden im Runtime-Modus `contracts` eingebettet.
 */
export const C_RUNTIME_CONTRACTS = withTerminatingVeriFastContracts(String.raw`#include <math.h>
//@ #include "nat.gh"
//@ #include "list.gh"
#include "vf__floating_point.h"

typedef struct Ps2Value { int _; } Ps2Value;
typedef struct Ps2Array { int _; } Ps2Array;
typedef struct Ps2Struct { int _; } Ps2Struct;

/*@
inductive Ps2ModelKind = ps2_undefined_kind | ps2_null_kind | ps2_number_kind | ps2_bool_kind | ps2_string_kind | ps2_array_kind | ps2_struct_kind;
fixpoint Ps2ModelKind ps2_model_kind(Ps2Value* value);
fixpoint bool ps2_model_value(Ps2Value* value);
fixpoint bool ps2_model_array(Ps2Value* value);
fixpoint bool ps2_model_struct(Ps2Value* value);
fixpoint bool ps2_model_bool(Ps2Value* value);
fixpoint bool ps2_model_string(Ps2Value* value);
fixpoint list<int> ps2_model_string_content(Ps2Value* value);
fixpoint list<int> ps2_model_to_string_content(Ps2Value* value);
fixpoint bool ps2_model_null(Ps2Value* value);
fixpoint bool ps2_model_undefined(Ps2Value* value);
fixpoint int ps2_model_array_length(Ps2Value* value);
fixpoint int ps2_model_int(Ps2Value* value);
fixpoint real ps2_model_real(Ps2Value* value);
fixpoint bool ps2_model_integral(Ps2Value* value);
fixpoint real ps2_model_real_divide(real left, real right);
fixpoint Ps2Value* ps2_model_array_item(Ps2Value* value, int index);
fixpoint Ps2Value* ps2_model_struct_field(Ps2Value* value, int field);
fixpoint list<Ps2Value*> ps2_repeat_value(nat count, Ps2Value* value) {
    switch (count) {
        case zero: return nil;
        case succ(rest): return cons(value, ps2_repeat_value(rest, value));
    }
}
lemma void ps2_repeat_update_prefix(list<Ps2Value*> items, int index, Ps2Value* value)
    requires 0 <= index &*& index < length(items) &*& take(index, items) == ps2_repeat_value(nat_of_int(index), value);
    ensures take(index + 1, update(index, value, items)) == ps2_repeat_value(nat_of_int(index + 1), value);
{
    switch (items) {
        case nil:
        case cons(head, tail):
            if (index > 0) {
                succ_int(index - 1);
                assert head == value;
                assert take(index - 1, tail) == ps2_repeat_value(nat_of_int(index - 1), value);
                ps2_repeat_update_prefix(tail, index - 1, value);
            }
            succ_int(index);
    }
}
predicate ps2_array_state(Ps2Value* value; list<Ps2Value*> items);
predicate ps2_struct_builder_state(Ps2Struct* value; int capacity, list<pair<int, Ps2Value*> > fields);
predicate ps2_struct_state(Ps2Value* value; list<pair<int, Ps2Value*> > fields);
fixpoint Ps2Value* ps2_struct_field_lookup(int field, list<pair<int, Ps2Value*> > fields) {
    switch (fields) {
        case nil: return 0;
        case cons(entry, rest): return fst(entry) == field ? snd(entry) : ps2_struct_field_lookup(field, rest);
    }
}
fixpoint list<pair<int, Ps2Value*> > ps2_struct_field_update(int field, Ps2Value* value, list<pair<int, Ps2Value*> > fields) {
    return cons(pair(field, value), fields);
}
lemma_auto void ps2_struct_field_lookup_update_same(int field, Ps2Value* value, list<pair<int, Ps2Value*> > fields)
    requires true;
    ensures ps2_struct_field_lookup(field, ps2_struct_field_update(field, value, fields)) == value;
{
}
fixpoint int ps2_model_power(int base, int exponent) {
    return exponent < 0 ? 0 : pow_nat(base, nat_of_int(exponent));
}
@*/

void ps2_preserve_array_ownership(Ps2Value* value);
    //@ requires ps2_array_state(value, ?items);
    //@ ensures ps2_array_state(value, items);

void ps2_preserve_struct_ownership(Ps2Value* value);
    //@ requires ps2_struct_state(value, ?fields);
    //@ ensures ps2_struct_state(value, fields);

Ps2Value* ps2_undefined(void);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_kind(result) == ps2_undefined_kind &*& ps2_model_undefined(result) == true;

Ps2Value* ps2_null(void);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_kind(result) == ps2_null_kind &*& ps2_model_null(result) == true;

Ps2Value* ps2_num(double number);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_kind(result) == ps2_number_kind;

Ps2Value* ps2_int(int number);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_kind(result) == ps2_number_kind &*& ps2_model_integral(result) == true &*& ps2_model_int(result) == number &*& ps2_model_real(result) == real_of_int(number);

Ps2Value* ps2_bool(int boolean);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_kind(result) == ps2_bool_kind &*& ps2_model_bool(result) == (boolean == 0 ? false : true);

Ps2Value* ps2_string(const char* string);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_kind(result) == ps2_string_kind &*& ps2_model_string(result) == true;

Ps2Value* ps2_copy_value(Ps2Value* value);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_kind(result) == ps2_model_kind(value) &*& (ps2_model_array(value) == true ? result == value &*& ps2_model_array(result) == true &*& ps2_model_array_length(result) == ps2_model_array_length(value) : true) &*& (ps2_model_struct(value) == true ? result == value &*& ps2_model_struct(result) == true : true) &*& ps2_model_integral(result) == ps2_model_integral(value) &*& ps2_model_int(result) == ps2_model_int(value) &*& ps2_model_real(result) == ps2_model_real(value) &*& ps2_model_bool(result) == ps2_model_bool(value) &*& ps2_model_string(result) == ps2_model_string(value) &*& ps2_model_string_content(result) == ps2_model_string_content(value) &*& ps2_model_to_string_content(result) == ps2_model_to_string_content(value) &*& ps2_model_null(result) == ps2_model_null(value) &*& ps2_model_undefined(result) == ps2_model_undefined(value);

double ps2_as_num(Ps2Value* value);
    //@ requires true;
    //@ ensures true;

int ps2_as_int(Ps2Value* value);
    //@ requires true;
    //@ ensures result == ps2_model_int(value);

int ps2_truthy(Ps2Value* value);
    //@ requires true;
    //@ ensures result == (ps2_model_kind(value) == ps2_undefined_kind || ps2_model_kind(value) == ps2_null_kind ? 0 : ps2_model_kind(value) == ps2_bool_kind ? (ps2_model_bool(value) ? 1 : 0) : ps2_model_kind(value) == ps2_number_kind ? (ps2_model_real(value) != 0 ? 1 : 0) : ps2_model_kind(value) == ps2_string_kind ? (ps2_model_string_content(value) != nil ? 1 : 0) : 1);

void ps2_print(Ps2Value* value);
    //@ requires true;
    //@ ensures true;

void ps2_throw(Ps2Value* value);
    //@ requires true;
    //@ ensures false;

Ps2Value* ps2_array_create(int length);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_kind(result) == ps2_array_kind &*& ps2_model_array(result) == true &*& ps2_model_array_length(result) == length &*& ps2_array_state(result, ?items) &*& length(items) == length;

int ps2_array_length(Ps2Value* value);
    //@ requires true;
    //@ ensures result == ps2_model_array_length(value);

void ps2_array_set_zero_based(Ps2Value* array_value, int index, Ps2Value* value);
    //@ requires ps2_array_state(array_value, ?items) &*& 0 <= index &*& index < length(items);
    //@ ensures ps2_array_state(array_value, update(index, value, items));

Ps2Value* ps2_array_get(Ps2Value* array_value, Ps2Value* source_index);
    //@ requires ps2_array_state(array_value, ?items) &*& 1 <= ps2_model_int(source_index) &*& ps2_model_int(source_index) <= length(items);
    //@ ensures ps2_array_state(array_value, items) &*& result != 0 &*& ps2_model_value(result) == true &*& ps2_model_kind(result) == ps2_model_kind(nth(ps2_model_int(source_index) - 1, items)) &*& (ps2_model_kind(result) == ps2_array_kind || ps2_model_kind(result) == ps2_struct_kind ? result == nth(ps2_model_int(source_index) - 1, items) : true) &*& ps2_model_integral(result) == ps2_model_integral(nth(ps2_model_int(source_index) - 1, items)) &*& ps2_model_int(result) == ps2_model_int(nth(ps2_model_int(source_index) - 1, items)) &*& ps2_model_real(result) == ps2_model_real(nth(ps2_model_int(source_index) - 1, items)) &*& ps2_model_bool(result) == ps2_model_bool(nth(ps2_model_int(source_index) - 1, items)) &*& ps2_model_string(result) == ps2_model_string(nth(ps2_model_int(source_index) - 1, items)) &*& ps2_model_string_content(result) == ps2_model_string_content(nth(ps2_model_int(source_index) - 1, items)) &*& ps2_model_null(result) == ps2_model_null(nth(ps2_model_int(source_index) - 1, items)) &*& ps2_model_undefined(result) == ps2_model_undefined(nth(ps2_model_int(source_index) - 1, items));

void ps2_array_set(Ps2Value* array_value, Ps2Value* source_index, Ps2Value* value);
    //@ requires ps2_array_state(array_value, ?items) &*& 1 <= ps2_model_int(source_index) &*& ps2_model_int(source_index) <= length(items);
    //@ ensures ps2_array_state(array_value, update(ps2_model_int(source_index) - 1, value, items));

Ps2Value* ps2_array_literal(int count, ...);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_array(result) == true &*& ps2_model_array_length(result) == count;

Ps2Struct* ps2_struct_create(int field_count);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_struct_builder_state(result, field_count, nil);

void ps2_struct_define(Ps2Struct* object, int index, int field_id, const char* name, Ps2Value* value);
    //@ requires ps2_struct_builder_state(object, ?capacity, ?fields) &*& index == length(fields) &*& index < capacity;
    //@ ensures ps2_struct_builder_state(object, capacity, append(fields, cons(pair(field_id, value), nil)));

Ps2Value* ps2_struct_value(Ps2Struct* object);
    //@ requires ps2_struct_builder_state(object, ?capacity, ?fields) &*& length(fields) == capacity;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_kind(result) == ps2_struct_kind &*& ps2_model_struct(result) == true &*& ps2_struct_state(result, fields);

Ps2Value* ps2_struct_get(Ps2Value* value, const char* field);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true;

void ps2_struct_set(Ps2Value* value, const char* field, Ps2Value* new_value);
    //@ requires true;
    //@ ensures true;

Ps2Value* ps2_struct_get_model(Ps2Value* value, const char* field, int field_id);
    //@ requires ps2_struct_state(value, ?fields);
    //@ ensures ps2_struct_state(value, fields) &*& result != 0 &*& ps2_model_value(result) == true &*& ps2_model_kind(result) == ps2_model_kind(ps2_struct_field_lookup(field_id, fields)) &*& (ps2_model_kind(result) == ps2_array_kind || ps2_model_kind(result) == ps2_struct_kind ? result == ps2_struct_field_lookup(field_id, fields) : true) &*& ps2_model_integral(result) == ps2_model_integral(ps2_struct_field_lookup(field_id, fields)) &*& ps2_model_int(result) == ps2_model_int(ps2_struct_field_lookup(field_id, fields)) &*& ps2_model_real(result) == ps2_model_real(ps2_struct_field_lookup(field_id, fields)) &*& ps2_model_bool(result) == ps2_model_bool(ps2_struct_field_lookup(field_id, fields)) &*& ps2_model_string(result) == ps2_model_string(ps2_struct_field_lookup(field_id, fields)) &*& ps2_model_string_content(result) == ps2_model_string_content(ps2_struct_field_lookup(field_id, fields)) &*& ps2_model_null(result) == ps2_model_null(ps2_struct_field_lookup(field_id, fields)) &*& ps2_model_undefined(result) == ps2_model_undefined(ps2_struct_field_lookup(field_id, fields));

void ps2_struct_set_model(Ps2Value* value, const char* field, int field_id, Ps2Value* new_value);
    //@ requires ps2_struct_state(value, ?fields);
    //@ ensures ps2_struct_state(value, ps2_struct_field_update(field_id, new_value, fields)) &*& ps2_struct_field_lookup(field_id, ps2_struct_field_update(field_id, new_value, fields)) == new_value;

Ps2Value* ps2_add(Ps2Value* left, Ps2Value* right);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& (ps2_model_kind(left) == ps2_string_kind || ps2_model_kind(right) == ps2_string_kind ? ps2_model_kind(result) == ps2_string_kind &*& ps2_model_string(result) == true &*& ps2_model_string_content(result) == append(ps2_model_to_string_content(left), ps2_model_to_string_content(right)) &*& ps2_model_to_string_content(result) == ps2_model_string_content(result) : ps2_model_kind(result) == ps2_number_kind &*& ps2_model_integral(result) == (ps2_model_integral(left) && ps2_model_integral(right)) &*& (ps2_model_integral(left) && ps2_model_integral(right) ? ps2_model_int(result) == ps2_model_int(left) + ps2_model_int(right) : true) &*& ps2_model_real(result) == ps2_model_real(left) + ps2_model_real(right));

Ps2Value* ps2_subtract(Ps2Value* left, Ps2Value* right);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_kind(result) == ps2_number_kind &*& ps2_model_integral(result) == (ps2_model_integral(left) && ps2_model_integral(right)) &*& (ps2_model_integral(left) && ps2_model_integral(right) ? ps2_model_int(result) == ps2_model_int(left) - ps2_model_int(right) : true) &*& ps2_model_real(result) == ps2_model_real(left) - ps2_model_real(right);

Ps2Value* ps2_multiply(Ps2Value* left, Ps2Value* right);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_kind(result) == ps2_number_kind &*& ps2_model_integral(result) == (ps2_model_integral(left) && ps2_model_integral(right)) &*& (ps2_model_integral(left) && ps2_model_integral(right) ? ps2_model_int(result) == ps2_model_int(left) * ps2_model_int(right) : true) &*& ps2_model_real(result) == ps2_model_real(left) * ps2_model_real(right);

Ps2Value* ps2_divide(Ps2Value* left, Ps2Value* right);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_kind(result) == ps2_number_kind &*& ps2_model_integral(result) == (ps2_model_integral(left) && ps2_model_integral(right) && ps2_model_int(right) != 0 && ps2_model_int(left) % ps2_model_int(right) == 0) &*& ps2_model_real(result) == ps2_model_real_divide(ps2_model_real(left), ps2_model_real(right)) &*& (ps2_model_integral(result) ? ps2_model_int(result) == ps2_model_int(left) / ps2_model_int(right) : true);

Ps2Value* ps2_modulo(Ps2Value* left, Ps2Value* right);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_kind(result) == ps2_number_kind &*& ps2_model_integral(result) == (ps2_model_integral(left) && ps2_model_integral(right) && ps2_model_int(right) != 0) &*& (ps2_model_integral(result) ? ps2_model_int(result) == ps2_model_int(left) % ps2_model_int(right) &*& ps2_model_real(result) == real_of_int(ps2_model_int(result)) : true);

Ps2Value* ps2_power(Ps2Value* left, Ps2Value* right);
    //@ requires true;
    //@ ensures result != 0 &*& ps2_model_value(result) == true &*& ps2_model_kind(result) == ps2_number_kind &*& ps2_model_integral(result) == (ps2_model_integral(left) && ps2_model_integral(right) && 0 <= ps2_model_int(right)) &*& (ps2_model_integral(result) ? ps2_model_int(result) == ps2_model_power(ps2_model_int(left), ps2_model_int(right)) &*& ps2_model_real(result) == real_of_int(ps2_model_int(result)) : true);

int ps2_less(Ps2Value* left, Ps2Value* right);
    //@ requires true;
    //@ ensures result == (ps2_model_integral(left) && ps2_model_integral(right) ? (ps2_model_int(left) < ps2_model_int(right) ? 1 : 0) : (ps2_model_real(left) < ps2_model_real(right) ? 1 : 0));

int ps2_less_equal(Ps2Value* left, Ps2Value* right);
    //@ requires true;
    //@ ensures result == (ps2_model_integral(left) && ps2_model_integral(right) ? (ps2_model_int(left) <= ps2_model_int(right) ? 1 : 0) : (ps2_model_real(left) <= ps2_model_real(right) ? 1 : 0));

int ps2_greater(Ps2Value* left, Ps2Value* right);
    //@ requires true;
    //@ ensures result == (ps2_model_integral(left) && ps2_model_integral(right) ? (ps2_model_int(left) > ps2_model_int(right) ? 1 : 0) : (ps2_model_real(left) > ps2_model_real(right) ? 1 : 0));

int ps2_greater_equal(Ps2Value* left, Ps2Value* right);
    //@ requires true;
    //@ ensures result == (ps2_model_integral(left) && ps2_model_integral(right) ? (ps2_model_int(left) >= ps2_model_int(right) ? 1 : 0) : (ps2_model_real(left) >= ps2_model_real(right) ? 1 : 0));

int ps2_equals(Ps2Value* left, Ps2Value* right);
    //@ requires true;
    //@ ensures result == (ps2_model_kind(left) != ps2_model_kind(right) ? 0 : ps2_model_kind(left) == ps2_number_kind ? (ps2_model_integral(left) && ps2_model_integral(right) ? (ps2_model_int(left) == ps2_model_int(right) ? 1 : 0) : (ps2_model_real(left) == ps2_model_real(right) ? 1 : 0)) : ps2_model_kind(left) == ps2_bool_kind ? (ps2_model_bool(left) == ps2_model_bool(right) ? 1 : 0) : ps2_model_kind(left) == ps2_string_kind ? (ps2_model_string_content(left) == ps2_model_string_content(right) ? 1 : 0) : ps2_model_kind(left) == ps2_array_kind || ps2_model_kind(left) == ps2_struct_kind ? (left == right ? 1 : 0) : 1);`);

