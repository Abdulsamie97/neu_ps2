/**
 * @file c-runtime-implementation.ts
 * @brief Enthält die ausführbare C-Implementierung der Pseudo2-Runtime.
 * @author Abdul
 */

/**
 * Ergänzt jede statische C-Funktion um triviale VeriFast-Verträge.
 *
 * Der Implementierungsmodus dient primär zum Kompilieren und Ausführen.
 * Die konkreten Funktionen besitzen deshalb bewusst nur neutrale
 * `requires true`- und `ensures true`-Klauseln.
 *
 * @param source C-Quelltext der ausführbaren Runtime.
 * @returns C-Quelltext mit trivialen Funktionsverträgen.
 */
function withTrivialVeriFastContracts(source: string): string {
  return source.replace(
    /^(static [^{;\n]+?\([^;\n]*\)) \{/gm,
    '$1\n//@ requires true;\n//@ ensures true;\n{'
  );
}

/**
 * Ausführbare C-Runtime für generierte Pseudo2-Programme.
 *
 * Sie implementiert Werte, Arrays, Structs, Operatoren, Ausgabe und
 * Fehlerbehandlung und wird im Runtime-Modus `implementation` eingebettet.
 */
export const C_RUNTIME_IMPLEMENTATION = withTrivialVeriFastContracts(String.raw`#include <math.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

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
  const char** names;
  Ps2Value** values;
};

struct Ps2Value {
  Ps2Kind kind;
  double number;
  int boolean;
  char* string;
  Ps2Array* array;
  Ps2Struct* object;
};

static void ps2_panic(const char* message) {
  fprintf(stderr, "%s\n", message);
  exit(1);
}

static char* ps2_strdup(const char* source) {
  size_t len = strlen(source);
  char* out = malloc(len + 1);
  if (out == 0) {
    ps2_panic("out of memory");
  }
  memcpy(out, source, len + 1);
  return out;
}

static Ps2Value* ps2_value(Ps2Kind kind) {
  Ps2Value* value = malloc(sizeof(Ps2Value));
  if (value == 0) {
    ps2_panic("out of memory");
  }
  value->kind = kind;
  value->number = 0;
  value->boolean = 0;
  value->string = 0;
  value->array = 0;
  value->object = 0;
  return value;
}

static Ps2Value* ps2_undefined(void) {
  return ps2_value(PS2_UNDEFINED);
}

static Ps2Value* ps2_null(void) {
  return ps2_value(PS2_NULL);
}

static Ps2Value* ps2_num(double number) {
  Ps2Value* value = ps2_value(PS2_NUM);
  value->number = number;
  return value;
}

static Ps2Value* ps2_int(int number) {
  Ps2Value* value = ps2_value(PS2_NUM);
  value->number = number;
  return value;
}

static Ps2Value* ps2_bool(int boolean) {
  Ps2Value* value = ps2_value(PS2_BOOL);
  value->boolean = boolean ? 1 : 0;
  return value;
}

static Ps2Value* ps2_string(const char* string) {
  Ps2Value* value = ps2_value(PS2_STRING);
  value->string = ps2_strdup(string);
  return value;
}

static Ps2Value* ps2_array_value(Ps2Array* array) {
  Ps2Value* value = ps2_value(PS2_ARRAY);
  value->array = array;
  return value;
}

static Ps2Value* ps2_struct_value(Ps2Struct* object) {
  Ps2Value* value = ps2_value(PS2_STRUCT);
  value->object = object;
  return value;
}

static Ps2Value* ps2_copy_value(Ps2Value* value) {
  if (value == 0) {
    return ps2_null();
  }
  switch (value->kind) {
    case PS2_NUM:
      return ps2_num(value->number);
    case PS2_BOOL:
      return ps2_bool(value->boolean);
    case PS2_STRING:
      return ps2_string(value->string);
    case PS2_ARRAY:
    case PS2_STRUCT:
      return value;
    case PS2_UNDEFINED:
      return ps2_undefined();
    case PS2_NULL:
    default:
      return ps2_null();
  }
}

static double ps2_as_num(Ps2Value* value) {
  if (value == 0 || value->kind == PS2_NULL || value->kind == PS2_UNDEFINED) {
    return 0;
  }
  if (value->kind == PS2_NUM) {
    return value->number;
  }
  if (value->kind == PS2_BOOL) {
    return value->boolean ? 1 : 0;
  }
  ps2_panic("expected numeric Pseudo2 value");
  return 0;
}

static int ps2_as_int(Ps2Value* value) {
  return (int)ps2_as_num(value);
}

static int ps2_truthy(Ps2Value* value) {
  if (value == 0 || value->kind == PS2_NULL || value->kind == PS2_UNDEFINED) {
    return 0;
  }
  if (value->kind == PS2_BOOL) {
    return value->boolean;
  }
  if (value->kind == PS2_NUM) {
    return value->number != 0;
  }
  if (value->kind == PS2_STRING) {
    return value->string != 0 && value->string[0] != '\0';
  }
  return 1;
}

static char* ps2_to_cstring(Ps2Value* value) {
  char buffer[64];
  if (value == 0 || value->kind == PS2_NULL) {
    return ps2_strdup("null");
  }
  if (value->kind == PS2_UNDEFINED) {
    return ps2_strdup("undefined");
  }
  if (value->kind == PS2_BOOL) {
    return ps2_strdup(value->boolean ? "true" : "false");
  }
  if (value->kind == PS2_NUM) {
    snprintf(buffer, sizeof(buffer), "%g", value->number);
    return ps2_strdup(buffer);
  }
  if (value->kind == PS2_STRING) {
    return ps2_strdup(value->string);
  }
  if (value->kind == PS2_ARRAY) {
    return ps2_strdup("[array]");
  }
  return ps2_strdup("[struct]");
}

static void ps2_print(Ps2Value* value) {
  char* text = ps2_to_cstring(value);
  printf("%s\n", text);
  free(text);
}

static void ps2_throw(Ps2Value* value) {
  char* text = ps2_to_cstring(value);
  fprintf(stderr, "%s\n", text);
  free(text);
  exit(1);
}

static Ps2Array* ps2_array_alloc(int length) {
  if (length < 0) {
    ps2_panic("negative array length");
  }
  Ps2Array* array = malloc(sizeof(Ps2Array));
  if (array == 0) {
    ps2_panic("out of memory");
  }
  array->length = length;
  array->items = malloc(sizeof(Ps2Value*) * (size_t)length);
  if (length > 0 && array->items == 0) {
    ps2_panic("out of memory");
  }
  for (int i = 0; i < length; i++) {
    array->items[i] = ps2_null();
  }
  return array;
}

static Ps2Value* ps2_array_create(int length) {
  return ps2_array_value(ps2_array_alloc(length));
}

static int ps2_array_length(Ps2Value* value) {
  if (value == 0 || value->kind != PS2_ARRAY || value->array == 0) {
    ps2_panic("expected array");
  }
  return value->array->length;
}

static void ps2_array_set_zero_based(Ps2Value* array_value, int index, Ps2Value* value) {
  if (array_value == 0 || array_value->kind != PS2_ARRAY || array_value->array == 0) {
    ps2_panic("expected array");
  }
  if (index < 0 || index >= array_value->array->length) {
    ps2_panic("array index out of bounds");
  }
  array_value->array->items[index] = ps2_copy_value(value);
}

static Ps2Value* ps2_array_get(Ps2Value* array_value, Ps2Value* source_index) {
  int index = ps2_as_int(source_index) - 1;
  if (array_value == 0 || array_value->kind != PS2_ARRAY || array_value->array == 0) {
    ps2_panic("expected array");
  }
  if (index < 0 || index >= array_value->array->length) {
    ps2_panic("array index out of bounds");
  }
  return array_value->array->items[index];
}

static void ps2_array_set(Ps2Value* array_value, Ps2Value* source_index, Ps2Value* value) {
  ps2_array_set_zero_based(array_value, ps2_as_int(source_index) - 1, value);
}

static Ps2Value* ps2_array_literal(int count, ...) {
  Ps2Value* array_value = ps2_array_create(count);
  va_list args;
  va_start(args, count);
  for (int i = 0; i < count; i++) {
    Ps2Value* item = va_arg(args, Ps2Value*);
    ps2_array_set_zero_based(array_value, i, item);
  }
  va_end(args);
  return array_value;
}

static Ps2Struct* ps2_struct_create(int field_count) {
  Ps2Struct* object = malloc(sizeof(Ps2Struct));
  if (object == 0) {
    ps2_panic("out of memory");
  }
  object->field_count = field_count;
  object->defined_count = 0;
  object->field_ids = malloc(sizeof(int) * (size_t)field_count);
  object->names = malloc(sizeof(const char*) * (size_t)field_count);
  object->values = malloc(sizeof(Ps2Value*) * (size_t)field_count);
  if (field_count > 0 && (object->field_ids == 0 || object->names == 0 || object->values == 0)) {
    ps2_panic("out of memory");
  }
  return object;
}

static void ps2_struct_define(Ps2Struct* object, int index, int field_id, const char* name, Ps2Value* value) {
  if (object == 0 || index < 0 || index >= object->field_count) {
    ps2_panic("invalid struct field definition");
  }
  object->field_ids[index] = field_id;
  object->names[index] = name;
  object->values[index] = ps2_copy_value(value);
  if (object->defined_count <= index) {
    object->defined_count = index + 1;
  }
}

static Ps2Struct* ps2_as_struct(Ps2Value* value) {
  if (value == 0 || value->kind == PS2_NULL) {
    ps2_panic("null pointer while accessing struct");
  }
  if (value->kind != PS2_STRUCT || value->object == 0) {
    ps2_panic("expected struct");
  }
  return value->object;
}

static int ps2_struct_field_index(Ps2Struct* object, const char* field) {
  for (int i = 0; i < object->field_count; i++) {
    if (strcmp(object->names[i], field) == 0) {
      return i;
    }
  }
  ps2_panic("unknown struct field");
  return -1;
}

static int ps2_struct_field_id_index(Ps2Struct* object, int field_id) {
  for (int i = 0; i < object->defined_count; i++) {
    if (object->field_ids[i] == field_id) {
      return i;
    }
  }
  ps2_panic("unknown struct field id");
  return -1;
}

static Ps2Value* ps2_struct_get(Ps2Value* value, const char* field) {
  Ps2Struct* object = ps2_as_struct(value);
  return object->values[ps2_struct_field_index(object, field)];
}

static void ps2_struct_set(Ps2Value* value, const char* field, Ps2Value* new_value) {
  Ps2Struct* object = ps2_as_struct(value);
  object->values[ps2_struct_field_index(object, field)] = ps2_copy_value(new_value);
}

static Ps2Value* ps2_struct_get_model(Ps2Value* value, const char* field, int field_id) {
  (void)field;
  Ps2Struct* object = ps2_as_struct(value);
  return object->values[ps2_struct_field_id_index(object, field_id)];
}

static void ps2_struct_set_model(Ps2Value* value, const char* field, int field_id, Ps2Value* new_value) {
  (void)field;
  Ps2Struct* object = ps2_as_struct(value);
  object->values[ps2_struct_field_id_index(object, field_id)] = ps2_copy_value(new_value);
}

static Ps2Value* ps2_concat(Ps2Value* left, Ps2Value* right) {
  char* l = ps2_to_cstring(left);
  char* r = ps2_to_cstring(right);
  size_t len = strlen(l) + strlen(r);
  char* out = malloc(len + 1);
  if (out == 0) {
    ps2_panic("out of memory");
  }
  strcpy(out, l);
  strcat(out, r);
  Ps2Value* value = ps2_string(out);
  free(out);
  free(l);
  free(r);
  return value;
}

static Ps2Value* ps2_binary_op(const char* op, Ps2Value* left, Ps2Value* right) {
  if (strcmp(op, "+") == 0) {
    if ((left != 0 && left->kind == PS2_STRING) || (right != 0 && right->kind == PS2_STRING)) {
      return ps2_concat(left, right);
    }
    return ps2_num(ps2_as_num(left) + ps2_as_num(right));
  }
  if (strcmp(op, "-") == 0) return ps2_num(ps2_as_num(left) - ps2_as_num(right));
  if (strcmp(op, "*") == 0) return ps2_num(ps2_as_num(left) * ps2_as_num(right));
  if (strcmp(op, "/") == 0) return ps2_num(ps2_as_num(left) / ps2_as_num(right));
  if (strcmp(op, "%") == 0 || strcmp(op, "mod") == 0) return ps2_num(fmod(ps2_as_num(left), ps2_as_num(right)));
  if (strcmp(op, "^") == 0) return ps2_num(pow(ps2_as_num(left), ps2_as_num(right)));
  ps2_panic("unknown operator");
  return ps2_null();
}

static int ps2_compare(const char* op, Ps2Value* left, Ps2Value* right) {
  double l = ps2_as_num(left);
  double r = ps2_as_num(right);
  if (strcmp(op, "<") == 0) return l < r;
  if (strcmp(op, "<=") == 0) return l <= r;
  if (strcmp(op, ">") == 0) return l > r;
  if (strcmp(op, ">=") == 0) return l >= r;
  return 0;
}

static Ps2Value* ps2_add(Ps2Value* left, Ps2Value* right) {
  return ps2_binary_op("+", left, right);
}

static Ps2Value* ps2_subtract(Ps2Value* left, Ps2Value* right) {
  return ps2_binary_op("-", left, right);
}

static Ps2Value* ps2_multiply(Ps2Value* left, Ps2Value* right) {
  return ps2_binary_op("*", left, right);
}

static Ps2Value* ps2_divide(Ps2Value* left, Ps2Value* right) {
  return ps2_binary_op("/", left, right);
}

static Ps2Value* ps2_modulo(Ps2Value* left, Ps2Value* right) {
  return ps2_binary_op("mod", left, right);
}

static Ps2Value* ps2_power(Ps2Value* left, Ps2Value* right) {
  return ps2_binary_op("^", left, right);
}

static int ps2_less(Ps2Value* left, Ps2Value* right) {
  return ps2_compare("<", left, right);
}

static int ps2_less_equal(Ps2Value* left, Ps2Value* right) {
  return ps2_compare("<=", left, right);
}

static int ps2_greater(Ps2Value* left, Ps2Value* right) {
  return ps2_compare(">", left, right);
}

static int ps2_greater_equal(Ps2Value* left, Ps2Value* right) {
  return ps2_compare(">=", left, right);
}

static int ps2_equals(Ps2Value* left, Ps2Value* right) {
  if (left == right) {
    return 1;
  }
  if (left == 0 || right == 0) {
    return 0;
  }
  if (left->kind == PS2_NULL || right->kind == PS2_NULL) {
    return left->kind == right->kind;
  }
  if (left->kind != right->kind) {
    return 0;
  }
  switch (left->kind) {
    case PS2_NUM:
      return left->number == right->number;
    case PS2_BOOL:
      return left->boolean == right->boolean;
    case PS2_STRING:
      return strcmp(left->string, right->string) == 0;
    case PS2_ARRAY:
      return left->array == right->array;
    case PS2_STRUCT:
      return left->object == right->object;
    case PS2_UNDEFINED:
    case PS2_NULL:
    default:
      return 1;
  }
}

static void ps2_preserve_array_ownership(Ps2Value* value) {
  (void)value;
}

static void ps2_preserve_struct_ownership(Ps2Value* value) {
  (void)value;
}`);

