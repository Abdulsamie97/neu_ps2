#include "stdlib.h"

int f()
//@ requires true;
//@ ensures result == 0;
{
    return 1;
}

int main()
//@ requires true;
//@ ensures true;
{
    f();
    return 0;
}