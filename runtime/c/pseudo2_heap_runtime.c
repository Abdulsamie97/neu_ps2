#include <limits.h>
#include <stdlib.h>

//@ #include "list.gh"

typedef struct Ps2Value Ps2Value;
typedef struct Ps2Array Ps2Array;
typedef struct Ps2Struct Ps2Struct;

typedef enum {
  PS2_UNDEFINED,
  PS2_NULL,
  PS2_NUM,
  PS2_BOOL,
  PS2_STRING,
  PS2_ARRAY,
  PS2_STRUCT
} Ps2Kind;

struct Ps2Array {
  int length;
  Ps2Value** items;
};

struct Ps2Struct {
  int field_count;
  int defined_count;
  int* field_ids;
  Ps2Value** values;
};

struct Ps2Value {
  Ps2Kind kind;
  Ps2Array* array;
  Ps2Struct* object;
};

/*@
predicate ps2_items(Ps2Value** data, int count; list<Ps2Value*> items) =
  data[0..count] |-> items;

predicate ps2_fields(int* ids, Ps2Value** values, int count;
                     list<pair<int, Ps2Value*> > fields) =
  count == 0 ?
    fields == nil
  :
    0 < count &*& ids[0] |-> ?field_id &*& values[0] |-> ?value &*&
    ps2_fields(ids + 1, values + 1, count - 1, ?tail) &*&
    fields == cons(pair(field_id, value), tail);

fixpoint Ps2Value* ps2_struct_field_lookup(
    int field, list<pair<int, Ps2Value*> > fields) {
  switch (fields) {
    case nil: return 0;
    case cons(entry, rest):
      return fst(entry) == field ? snd(entry) : ps2_struct_field_lookup(field, rest);
  }
}

fixpoint list<pair<int, Ps2Value*> > ps2_struct_field_update(
    int field, Ps2Value* value, list<pair<int, Ps2Value*> > fields) {
  switch (fields) {
    case nil: return nil;
    case cons(entry, rest):
      return fst(entry) == field
        ? cons(pair(field, value), rest)
        : cons(entry, ps2_struct_field_update(field, value, rest));
  }
}

predicate ps2_array_state(Ps2Value* value; list<Ps2Value*> items) =
  value->kind |-> PS2_ARRAY &*& value->array |-> ?array &*&
  value->object |-> _ &*& malloc_block_Ps2Value(value) &*&
  array->length |-> ?count &*& array->items |-> ?data &*&
  malloc_block_Ps2Array(array) &*&
  malloc_block_pointers((void**)data, count + 1) &*&
  ps2_items(data, count, items) &*& count == length(items);

predicate ps2_struct_builder_state(
    Ps2Struct* object; int capacity, list<pair<int, Ps2Value*> > fields) =
  object->field_count |-> capacity &*& object->defined_count |-> ?defined &*&
  object->field_ids |-> ?ids &*&
  object->values |-> ?values &*& malloc_block_Ps2Struct(object) &*&
  0 <= defined &*& defined <= capacity &*&
  malloc_block_ints(ids, capacity + 1) &*&
  malloc_block_pointers((void**)values, capacity + 1) &*&
  ps2_fields(ids, values, defined, fields) &*& defined == length(fields) &*&
  ids[defined..capacity + 1] |-> _ &*&
  values[defined..capacity + 1] |-> _;

predicate ps2_struct_state(
    Ps2Value* value; list<pair<int, Ps2Value*> > fields) =
  value->kind |-> PS2_STRUCT &*& value->array |-> _ &*&
  value->object |-> ?object &*& malloc_block_Ps2Value(value) &*&
  object->field_count |-> ?count &*& object->defined_count |-> count &*&
  object->field_ids |-> ?ids &*&
  object->values |-> ?values &*& malloc_block_Ps2Struct(object) &*&
  malloc_block_ints(ids, count + 1) &*&
  malloc_block_pointers((void**)values, count + 1) &*&
  ps2_fields(ids, values, count, fields) &*&
  ids[count] |-> _ &*& values[count] |-> _;
@*/

static Ps2Value* ps2_array_create(int length)
  //@ requires 0 <= length &*& length < INT_MAX &*& (length + 1) * sizeof(Ps2Value*) <= INT_MAX;
  //@ ensures ps2_array_state(result, ?items) &*& length(items) == length;
{
  Ps2Array* array = malloc(sizeof(Ps2Array));
  if (array == 0) abort();
  Ps2Value** data = calloc((size_t)(length + 1), sizeof(Ps2Value*));
  if (data == 0) abort();
  //@ chars_to_pointers(data, length + 1);
  //@ pointers_split((void**)data, length);
  array->length = length;
  array->items = data;

  Ps2Value* value = malloc(sizeof(Ps2Value));
  if (value == 0) abort();
  value->kind = PS2_ARRAY;
  value->array = array;
  value->object = 0;
  //@ close ps2_items(data, length, _);
  //@ leak data[length] |-> ?unused;
  return value;
}

static Ps2Value* ps2_array_get_zero_based(Ps2Value* value, int index)
  //@ requires ps2_array_state(value, ?items) &*& 0 <= index &*& index < length(items);
  //@ ensures ps2_array_state(value, items) &*& result == nth(index, items);
{
  //@ open ps2_array_state(value, items);
  //@ open ps2_items(_, _, items);
  Ps2Value* result = value->array->items[index];
  //@ close ps2_items(_, _, items);
  //@ close ps2_array_state(value, items);
  return result;
}

static void ps2_array_set_zero_based(Ps2Value* value, int index, Ps2Value* item)
  //@ requires ps2_array_state(value, ?items) &*& 0 <= index &*& index < length(items);
  //@ ensures ps2_array_state(value, update(index, item, items));
{
  //@ open ps2_array_state(value, items);
  //@ open ps2_items(_, _, items);
  value->array->items[index] = item;
  //@ close ps2_items(_, _, update(index, item, items));
  //@ close ps2_array_state(value, update(index, item, items));
}

static Ps2Struct* ps2_struct_create(int field_count)
  //@ requires 0 <= field_count &*& field_count < INT_MAX &*& 0 <= (field_count + 1) * sizeof(int) &*& (field_count + 1) * sizeof(int) <= INT_MAX &*& 0 <= (field_count + 1) * sizeof(Ps2Value*) &*& (field_count + 1) * sizeof(Ps2Value*) <= INT_MAX;
  //@ ensures ps2_struct_builder_state(result, field_count, nil);
{
  Ps2Struct* object = malloc(sizeof(Ps2Struct));
  if (object == 0) abort();
  int* ids = malloc((size_t)(field_count + 1) * sizeof(int));
  if (ids == 0) abort();
  Ps2Value** values = malloc((size_t)(field_count + 1) * sizeof(Ps2Value*));
  if (values == 0) abort();
  object->field_count = field_count;
  object->defined_count = 0;
  object->field_ids = ids;
  object->values = values;
  //@ close ps2_fields(ids, values, 0, nil);
  return object;
}

/*@
lemma void ps2_fields_append_one(int* ids, Ps2Value** values)
  requires ps2_fields(ids, values, ?count, ?fields) &*&
    ids[count] |-> ?field_id &*& values[count] |-> ?value;
  ensures ps2_fields(ids, values, count + 1,
    append(fields, cons(pair(field_id, value), nil)));
{
  open ps2_fields(ids, values, count, fields);
  if (count == 0) {
    close ps2_fields(ids + 1, values + 1, 0, nil);
  } else {
    ps2_fields_append_one(ids + 1, values + 1);
  }
  close ps2_fields(ids, values, count + 1,
    append(fields, cons(pair(field_id, value), nil)));
}
@*/

static void ps2_struct_define(
    Ps2Struct* object, int index, int field_id, Ps2Value* value)
  //@ requires ps2_struct_builder_state(object, ?capacity, ?fields) &*& index == length(fields) &*& index < capacity;
  //@ ensures ps2_struct_builder_state(object, capacity, append(fields, cons(pair(field_id, value), nil)));
{
  //@ open ps2_struct_builder_state(object, capacity, fields);
  object->field_ids[index] = field_id;
  object->values[index] = value;
  //@ ps2_fields_append_one(object->field_ids, object->values);
  object->defined_count = index + 1;
  //@ close ps2_struct_builder_state(object, capacity, append(fields, cons(pair(field_id, value), nil)));
}

static Ps2Value* ps2_struct_value(Ps2Struct* object)
  //@ requires ps2_struct_builder_state(object, ?capacity, ?fields) &*& length(fields) == capacity;
  //@ ensures ps2_struct_state(result, fields);
{
  //@ open ps2_struct_builder_state(object, capacity, fields);
  Ps2Value* value = malloc(sizeof(Ps2Value));
  if (value == 0) abort();
  value->kind = PS2_STRUCT;
  value->array = 0;
  value->object = object;
  //@ close ps2_struct_state(value, fields);
  return value;
}

static Ps2Value* ps2_fields_get(
    int* ids, Ps2Value** values, int count, int field_id)
  //@ requires ps2_fields(ids, values, count, ?fields) &*& ps2_struct_field_lookup(field_id, fields) != 0;
  //@ ensures ps2_fields(ids, values, count, fields) &*& result == ps2_struct_field_lookup(field_id, fields);
{
  //@ open ps2_fields(ids, values, count, fields);
  if (ids[0] == field_id) {
    Ps2Value* result = values[0];
    //@ close ps2_fields(ids, values, count, fields);
    return result;
  }
  //@ integer_limits(ids);
  //@ pointer_limits(values);
  Ps2Value* result = ps2_fields_get(ids + 1, values + 1, count - 1, field_id);
  //@ close ps2_fields(ids, values, count, fields);
  return result;
}

static void ps2_fields_set(
    int* ids, Ps2Value** values, int count, int field_id, Ps2Value* new_value)
  //@ requires ps2_fields(ids, values, count, ?fields) &*& ps2_struct_field_lookup(field_id, fields) != 0;
  //@ ensures ps2_fields(ids, values, count, ps2_struct_field_update(field_id, new_value, fields));
{
  //@ open ps2_fields(ids, values, count, fields);
  if (ids[0] == field_id) {
    values[0] = new_value;
  } else {
    //@ integer_limits(ids);
    //@ pointer_limits(values);
    ps2_fields_set(ids + 1, values + 1, count - 1, field_id, new_value);
  }
  //@ close ps2_fields(ids, values, count, ps2_struct_field_update(field_id, new_value, fields));
}

static Ps2Value* ps2_struct_get_model(Ps2Value* value, int field_id)
  //@ requires ps2_struct_state(value, ?fields) &*& ps2_struct_field_lookup(field_id, fields) != 0;
  //@ ensures ps2_struct_state(value, fields) &*& result == ps2_struct_field_lookup(field_id, fields);
{
  //@ open ps2_struct_state(value, fields);
  Ps2Struct* object = value->object;
  Ps2Value* result = ps2_fields_get(
    object->field_ids, object->values, object->field_count, field_id);
  //@ close ps2_struct_state(value, fields);
  return result;
}

static void ps2_struct_set_model(
    Ps2Value* value, int field_id, Ps2Value* new_value)
  //@ requires ps2_struct_state(value, ?fields) &*& ps2_struct_field_lookup(field_id, fields) != 0;
  //@ ensures ps2_struct_state(value, ps2_struct_field_update(field_id, new_value, fields));
{
  //@ open ps2_struct_state(value, fields);
  Ps2Struct* object = value->object;
  ps2_fields_set(
    object->field_ids, object->values, object->field_count, field_id, new_value);
  //@ close ps2_struct_state(value, ps2_struct_field_update(field_id, new_value, fields));
}

int main(void)
  //@ requires true;
  //@ ensures true;
{
  Ps2Value* first = malloc(sizeof(Ps2Value));
  if (first == 0) abort();
  Ps2Value* second = malloc(sizeof(Ps2Value));
  if (second == 0) abort();

  Ps2Value* array = ps2_array_create(2);
  ps2_array_set_zero_based(array, 0, first);
  ps2_array_set_zero_based(array, 1, second);
  Ps2Value* item = ps2_array_get_zero_based(array, 1);
  //@ assert item == second;

  Ps2Struct* builder = ps2_struct_create(2);
  ps2_struct_define(builder, 0, 10, first);
  ps2_struct_define(builder, 1, 20, second);
  Ps2Value* object = ps2_struct_value(builder);
  item = ps2_struct_get_model(object, 20);
  //@ assert item == second;
  ps2_struct_set_model(object, 20, first);
  item = ps2_struct_get_model(object, 20);
  //@ assert item == first;

  //@ leak ps2_array_state(array, _);
  //@ leak ps2_struct_state(object, _);
  //@ leak first->kind |-> _ &*& first->array |-> _ &*& first->object |-> _ &*& malloc_block_Ps2Value(first);
  //@ leak second->kind |-> _ &*& second->array |-> _ &*& second->object |-> _ &*& malloc_block_Ps2Value(second);
  return 0;
}
