

unsafe fn read_lines() -> *const *const str
{
    std::process::abort(); // TODO: Implement
}

unsafe fn write_lines(p: *const *const str)
{
    std::process::abort(); // TODO: Implement
}

fn main()
{
    unsafe {
        let p = read_lines();
        write_lines(p);
    }
}
