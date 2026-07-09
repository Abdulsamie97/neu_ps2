
int main()
//@ requires true;
//@ ensures true; 
{
    int i = 0;

    while (i < 5) 
    //@ invariant i <= 3;
	{
        i++;
    }
    return 0;
}