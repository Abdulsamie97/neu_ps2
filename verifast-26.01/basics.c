#include "stdlib.h"

void foo1()
    //@ requires true;
    //@ ensures false; 
{
}

void foo2()
    //@ requires true;
    //@ ensures true;
{
    int *test = 0;
    *test = 5;  
}

struct cell {
    int value;
};

void foo3()
    //@ requires true;
    //@ ensures true;
{
    struct cell *c = 0;
    c->value = 42; 
}

struct cell *foo4()
    //@ requires true;
    //@ ensures result->value |-> _; 
{
    return 0;
}

void foo5()
    //@ requires true;
    //@ ensures true;
{
    struct cell *c = malloc(sizeof(struct cell));
    if (c == 0) { abort(); }
    free(c);
    c->value = 52; 
}

void foo6(struct cell *c)
    //@ requires c->value |-> _;
    //@ ensures true;
{
    c = 0;
    c->value = 99; 
}

void foo7(struct cell *c)
    //@ requires c->value |-> _;
    /*@
    ensures
        c->value |-> _
        &*&
        c->value |-> _;  
    @*/
{
}

void foo8(struct cell *c)
    //@ requires c == 0 ? true : c->value |-> _;
    //@ ensures c->value |-> _; 
{
}

int foo9(struct cell *c)
    //@ requires true;
    //@ ensures true;
{
    return c->value;  
}

struct node {
    struct node *next;
};

struct node *foo10(struct node *n)
    //@ requires n->next |-> _;
    //@ ensures true;
{
    return n->next->next;  
}
