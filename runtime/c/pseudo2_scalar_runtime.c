#include "malloc.h"
#include "stdio.h"
#include "stdlib.h"
#include "string.h"
#include "vf__floating_point.h"

typedef enum {
  PS2_SCALAR_UNDEFINED,
  PS2_SCALAR_NULL,
  PS2_SCALAR_NUMBER,
  PS2_SCALAR_BOOL,
  PS2_SCALAR_STRING
} Ps2ScalarKind;

typedef struct Ps2Scalar {
  Ps2ScalarKind kind;
  double number;
  int boolean;
  char* string;
} Ps2Scalar;

/*@
predicate ps2_scalar(
    Ps2Scalar* value;
    Ps2ScalarKind kind, double number, int boolean, list<char> text) =
  value->kind |-> kind &*&
  value->number |-> number &*&
  value->boolean |-> boolean &*&
  value->string |-> ?stored_string &*&
  malloc_block_Ps2Scalar(value) &*&
  kind == PS2_SCALAR_STRING ?
    stored_string != 0 &*& string(stored_string, text) &*&
    malloc_block_chars(stored_string, length(text) + 1)
  :
    stored_string == 0 &*& text == nil;
@*/

static Ps2Scalar* ps2_scalar_alloc(Ps2ScalarKind kind)
  //@ requires kind != PS2_SCALAR_STRING;
  //@ ensures ps2_scalar(result, kind, ?zero, 0, nil) &*& fp_of_double(zero) == fp_real(0);
{
  Ps2Scalar* value = malloc(sizeof(Ps2Scalar));
  if (value == 0) abort();
  value->kind = kind;
  value->number = 0.0;
  value->boolean = 0;
  value->string = 0;
  //@ close ps2_scalar(value, kind, _, 0, nil);
  return value;
}

static Ps2Scalar* ps2_scalar_number(double number)
  //@ requires true;
  //@ ensures ps2_scalar(result, PS2_SCALAR_NUMBER, number, 0, nil);
{
  Ps2Scalar* value = ps2_scalar_alloc(PS2_SCALAR_NUMBER);
  //@ open ps2_scalar(value, PS2_SCALAR_NUMBER, ?zero, 0, nil);
  value->number = number;
  //@ close ps2_scalar(value, PS2_SCALAR_NUMBER, number, 0, nil);
  return value;
}

static Ps2Scalar* ps2_scalar_bool(int boolean)
  //@ requires true;
  //@ ensures ps2_scalar(result, PS2_SCALAR_BOOL, ?zero, boolean != 0 ? 1 : 0, nil) &*& fp_of_double(zero) == fp_real(0);
{
  Ps2Scalar* value = ps2_scalar_alloc(PS2_SCALAR_BOOL);
  //@ open ps2_scalar(value, PS2_SCALAR_BOOL, ?zero, 0, nil);
  value->boolean = boolean != 0 ? 1 : 0;
  //@ close ps2_scalar(value, PS2_SCALAR_BOOL, zero, boolean != 0 ? 1 : 0, nil);
  return value;
}

static Ps2Scalar* ps2_scalar_string(char* string)
  //@ requires [?fraction]string(string, ?text);
  //@ ensures [fraction]string(string, text) &*& ps2_scalar(result, PS2_SCALAR_STRING, ?zero, 0, text) &*& fp_of_double(zero) == fp_real(0);
{
  char* copied = strdup(string);
  if (copied == 0) abort();
  Ps2Scalar* value = malloc(sizeof(Ps2Scalar));
  if (value == 0) abort();
  value->kind = PS2_SCALAR_STRING;
  value->number = 0.0;
  value->boolean = 0;
  value->string = copied;
  //@ close ps2_scalar(value, PS2_SCALAR_STRING, _, 0, text);
  return value;
}

static Ps2Scalar* ps2_scalar_copy(Ps2Scalar* source)
  //@ requires ps2_scalar(source, ?kind, ?number, ?boolean, ?text);
  //@ ensures ps2_scalar(source, kind, number, boolean, text) &*& ps2_scalar(result, kind, number, boolean, text);
{
  //@ open ps2_scalar(source, kind, number, boolean, text);
  Ps2Scalar* result = malloc(sizeof(Ps2Scalar));
  if (result == 0) abort();
  result->kind = source->kind;
  result->number = source->number;
  result->boolean = source->boolean;
  if (source->kind == PS2_SCALAR_STRING) {
    result->string = strdup(source->string);
    if (result->string == 0) abort();
  } else {
    result->string = 0;
  }
  //@ close ps2_scalar(source, kind, number, boolean, text);
  //@ close ps2_scalar(result, kind, number, boolean, text);
  return result;
}

static double ps2_scalar_as_number(Ps2Scalar* value)
  //@ requires ps2_scalar(value, PS2_SCALAR_NUMBER, ?number, 0, nil);
  //@ ensures ps2_scalar(value, PS2_SCALAR_NUMBER, number, 0, nil) &*& fp_of_double(result) == fp_of_double(number);
{
  //@ open ps2_scalar(value, PS2_SCALAR_NUMBER, number, 0, nil);
  double result = value->number;
  //@ close ps2_scalar(value, PS2_SCALAR_NUMBER, number, 0, nil);
  return result;
}

static int ps2_scalar_string_equals(Ps2Scalar* left, Ps2Scalar* right)
  //@ requires ps2_scalar(left, PS2_SCALAR_STRING, ?left_number, 0, ?left_text) &*& ps2_scalar(right, PS2_SCALAR_STRING, ?right_number, 0, ?right_text);
  //@ ensures ps2_scalar(left, PS2_SCALAR_STRING, left_number, 0, left_text) &*& ps2_scalar(right, PS2_SCALAR_STRING, right_number, 0, right_text) &*& (result != 0) == (left_text == right_text);
{
  //@ open ps2_scalar(left, PS2_SCALAR_STRING, left_number, 0, left_text);
  //@ open ps2_scalar(right, PS2_SCALAR_STRING, right_number, 0, right_text);
  int result = strcmp(left->string, right->string) == 0;
  //@ close ps2_scalar(left, PS2_SCALAR_STRING, left_number, 0, left_text);
  //@ close ps2_scalar(right, PS2_SCALAR_STRING, right_number, 0, right_text);
  return result;
}

static void ps2_scalar_print_string(Ps2Scalar* value)
  //@ requires ps2_scalar(value, PS2_SCALAR_STRING, ?number, 0, ?text);
  //@ ensures ps2_scalar(value, PS2_SCALAR_STRING, number, 0, text);
{
  //@ open ps2_scalar(value, PS2_SCALAR_STRING, number, 0, text);
  puts(value->string);
  //@ close ps2_scalar(value, PS2_SCALAR_STRING, number, 0, text);
}

static int ps2_scalar_read_char(void)
  //@ requires true;
  //@ ensures true;
{
  return getchar();
}

static void ps2_scalar_dispose(Ps2Scalar* value)
  //@ requires ps2_scalar(value, ?kind, ?number, ?boolean, ?text);
  //@ ensures true;
{
  //@ open ps2_scalar(value, kind, number, boolean, text);
  if (value->kind == PS2_SCALAR_STRING) {
    //@ string_to_chars(value->string);
    free(value->string);
  }
  free(value);
}

int main(void)
  //@ requires true;
  //@ ensures true;
{
  Ps2Scalar* number = ps2_scalar_number(3.5);
  Ps2Scalar* number_copy = ps2_scalar_copy(number);
  double copied_number = ps2_scalar_as_number(number_copy);
  (void)copied_number;

  Ps2Scalar* boolean = ps2_scalar_bool(1);
  Ps2Scalar* text = ps2_scalar_string("Pseudo2");
  Ps2Scalar* text_copy = ps2_scalar_copy(text);
  int equal = ps2_scalar_string_equals(text, text_copy);
  //@ assert equal != 0;
  ps2_scalar_print_string(text_copy);

  ps2_scalar_dispose(text_copy);
  ps2_scalar_dispose(text);
  ps2_scalar_dispose(boolean);
  ps2_scalar_dispose(number_copy);
  ps2_scalar_dispose(number);
  return 0;
}
