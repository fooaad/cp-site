//! Runs a wasm32-wasi program in the wasmi interpreter. wasmi keeps the program's call stack in
//! its own memory instead of the browser's native stack, so recursion can go millions of levels
//! deep, at the cost of speed.
//!
//! JavaScript calls `alloc` to pass the program and stdin in, then `run`. Output goes out through
//! the `host.write` import as it is written. Only the WASI calls that compiled C++ programs use
//! are implemented.

use std::cell::{Cell, RefCell};
use wasmi::{Caller, CompilationMode, Config, Engine, Error, Extern, Linker, Memory, Module, Store};

#[link(wasm_import_module = "host")]
unsafe extern "C" {
    fn write(fd: u32, ptr: *const u8, len: usize);
    fn monotonic_ns() -> u64;
    fn realtime_ns() -> u64;
    fn random_fill(ptr: *mut u8, len: usize);
}

const ERRNO_SUCCESS: i32 = 0;
const ERRNO_BADF: i32 = 8;
const ERRNO_FAULT: i32 = 21;
const ERRNO_NOTSUP: i32 = 58;
const ERRNO_SPIPE: i32 = 70;

const FILETYPE_REGULAR_FILE: u8 = 4;
const RIGHTS_FD_READ: u64 = 1 << 1;
const RIGHTS_FD_WRITE: u64 = 1 << 6;

// Call depth and value-stack size for the interpreted program. Frames live in this module's own
// memory, so these are memory limits, not native stack limits.
const MAX_RECURSION_DEPTH: usize = 20_000_000;
const MAX_VALUE_STACK_BYTES: usize = 1 << 30;

struct Wasi {
    stdin: Vec<u8>,
    stdin_pos: usize,
}

thread_local! {
    static ERROR: RefCell<String> = const { RefCell::new(String::new()) };
    static MEMORY_PAGES: Cell<u32> = const { Cell::new(0) };
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Error message of the last `run` that returned -1.
#[unsafe(no_mangle)]
pub extern "C" fn error_ptr() -> *const u8 {
    ERROR.with(|e| e.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn error_len() -> usize {
    ERROR.with(|e| e.borrow().len())
}

/// Size of the program's memory at the end of the last `run`, in 64 KiB pages.
#[unsafe(no_mangle)]
pub extern "C" fn memory_pages() -> u32 {
    MEMORY_PAGES.with(Cell::get)
}

/// Runs the program. Returns its exit code, or -1 if it trapped or failed to load
/// (message in `error_ptr`/`error_len`). Takes ownership of both buffers.
#[unsafe(no_mangle)]
pub extern "C" fn run(wasm_ptr: *mut u8, wasm_len: usize, stdin_ptr: *mut u8, stdin_len: usize) -> i32 {
    let wasm = unsafe { Vec::from_raw_parts(wasm_ptr, wasm_len, wasm_len) };
    let stdin = unsafe { Vec::from_raw_parts(stdin_ptr, stdin_len, stdin_len) };
    match execute(&wasm, stdin) {
        Ok(code) => code,
        Err(message) => {
            ERROR.with(|e| *e.borrow_mut() = message);
            -1
        }
    }
}

fn execute(wasm: &[u8], stdin: Vec<u8>) -> Result<i32, String> {
    let mut config = Config::default();
    config.set_max_recursion_depth(MAX_RECURSION_DEPTH);
    config.set_max_stack_height(MAX_VALUE_STACK_BYTES);
    // Validate and translate functions only when first called: the program comes from our own
    // compiler, and most of the linked library is never executed.
    config.compilation_mode(CompilationMode::Lazy);
    let engine = Engine::new(&config);
    let module = Module::new(&engine, wasm).map_err(|e| format!("could not load program: {e}"))?;
    let mut store = Store::new(&engine, Wasi { stdin, stdin_pos: 0 });
    let mut linker = Linker::<Wasi>::new(&engine);
    add_wasi(&mut linker).map_err(|e| e.to_string())?;

    let instance = linker
        .instantiate_and_start(&mut store, &module)
        .map_err(|e| format!("could not start program: {e}"))?;
    let start = instance
        .get_typed_func::<(), ()>(&store, "_start")
        .map_err(|e| format!("program has no _start: {e}"))?;
    let result = start.call(&mut store, ());
    if let Some(memory) = instance.get_memory(&store, "memory") {
        MEMORY_PAGES.with(|p| p.set(memory.size(&store) as u32));
    }
    match result {
        Ok(()) => Ok(0),
        Err(e) => match e.i32_exit_status() {
            Some(code) => Ok(code),
            None => Err(e.to_string()),
        },
    }
}

fn memory(caller: &Caller<'_, Wasi>) -> Memory {
    match caller.get_export("memory") {
        Some(Extern::Memory(m)) => m,
        _ => panic!("program exports no memory"),
    }
}

fn read_u32(mem: &[u8], at: u32) -> Option<u32> {
    let at = at as usize;
    Some(u32::from_le_bytes(mem.get(at..at + 4)?.try_into().ok()?))
}

fn write_bytes(mem: &mut [u8], at: u32, bytes: &[u8]) -> bool {
    let at = at as usize;
    match mem.get_mut(at..at + bytes.len()) {
        Some(dst) => {
            dst.copy_from_slice(bytes);
            true
        }
        None => false,
    }
}

fn add_wasi(linker: &mut Linker<Wasi>) -> Result<(), Error> {
    const M: &str = "wasi_snapshot_preview1";

    linker.func_wrap(M, "args_sizes_get", |mut caller: Caller<'_, Wasi>, argc: u32, size: u32| -> i32 {
        let mem = memory(&caller).data_mut(&mut caller);
        let ok = write_bytes(mem, argc, &1u32.to_le_bytes()) && write_bytes(mem, size, &5u32.to_le_bytes());
        if ok { ERRNO_SUCCESS } else { ERRNO_FAULT }
    })?;
    linker.func_wrap(M, "args_get", |mut caller: Caller<'_, Wasi>, argv: u32, buf: u32| -> i32 {
        let mem = memory(&caller).data_mut(&mut caller);
        let ok = write_bytes(mem, argv, &buf.to_le_bytes()) && write_bytes(mem, buf, b"main\0");
        if ok { ERRNO_SUCCESS } else { ERRNO_FAULT }
    })?;
    linker.func_wrap(M, "environ_sizes_get", |mut caller: Caller<'_, Wasi>, count: u32, size: u32| -> i32 {
        let mem = memory(&caller).data_mut(&mut caller);
        let ok = write_bytes(mem, count, &0u32.to_le_bytes()) && write_bytes(mem, size, &0u32.to_le_bytes());
        if ok { ERRNO_SUCCESS } else { ERRNO_FAULT }
    })?;
    linker.func_wrap(M, "environ_get", |_: Caller<'_, Wasi>, _: u32, _: u32| -> i32 { ERRNO_SUCCESS })?;

    linker.func_wrap(M, "clock_res_get", |mut caller: Caller<'_, Wasi>, _id: u32, res: u32| -> i32 {
        let mem = memory(&caller).data_mut(&mut caller);
        if write_bytes(mem, res, &1000u64.to_le_bytes()) { ERRNO_SUCCESS } else { ERRNO_FAULT }
    })?;
    linker.func_wrap(M, "clock_time_get", |mut caller: Caller<'_, Wasi>, id: u32, _precision: u64, time: u32| -> i32 {
        // 0 = realtime; monotonic and the CPU-time clocks all use the monotonic clock.
        let now = unsafe { if id == 0 { realtime_ns() } else { monotonic_ns() } };
        let mem = memory(&caller).data_mut(&mut caller);
        if write_bytes(mem, time, &now.to_le_bytes()) { ERRNO_SUCCESS } else { ERRNO_FAULT }
    })?;
    linker.func_wrap(M, "random_get", |mut caller: Caller<'_, Wasi>, buf: u32, len: u32| -> i32 {
        let mem = memory(&caller).data_mut(&mut caller);
        match mem.get_mut(buf as usize..buf as usize + len as usize) {
            Some(dst) => {
                unsafe { random_fill(dst.as_mut_ptr(), dst.len()) };
                ERRNO_SUCCESS
            }
            None => ERRNO_FAULT,
        }
    })?;

    linker.func_wrap(M, "fd_fdstat_get", |mut caller: Caller<'_, Wasi>, fd: u32, buf: u32| -> i32 {
        // Report stdio as files, not a terminal, so wasi-libc buffers output in blocks.
        let rights = match fd {
            0 => RIGHTS_FD_READ,
            1 | 2 => RIGHTS_FD_WRITE,
            _ => return ERRNO_BADF,
        };
        let mut stat = [0u8; 24];
        stat[0] = FILETYPE_REGULAR_FILE;
        stat[8..16].copy_from_slice(&rights.to_le_bytes());
        let mem = memory(&caller).data_mut(&mut caller);
        if write_bytes(mem, buf, &stat) { ERRNO_SUCCESS } else { ERRNO_FAULT }
    })?;
    linker.func_wrap(M, "fd_filestat_get", |mut caller: Caller<'_, Wasi>, fd: u32, buf: u32| -> i32 {
        if fd > 2 {
            return ERRNO_BADF;
        }
        let mut stat = [0u8; 64];
        stat[16] = FILETYPE_REGULAR_FILE;
        let mem = memory(&caller).data_mut(&mut caller);
        if write_bytes(mem, buf, &stat) { ERRNO_SUCCESS } else { ERRNO_FAULT }
    })?;
    linker.func_wrap(M, "fd_prestat_get", |_: Caller<'_, Wasi>, _: u32, _: u32| -> i32 { ERRNO_BADF })?;
    linker.func_wrap(M, "fd_prestat_dir_name", |_: Caller<'_, Wasi>, _: u32, _: u32, _: u32| -> i32 { ERRNO_BADF })?;
    linker.func_wrap(M, "fd_close", |_: Caller<'_, Wasi>, _: u32| -> i32 { ERRNO_SUCCESS })?;
    linker.func_wrap(M, "fd_seek", |_: Caller<'_, Wasi>, _: u32, _: i64, _: u32, _: u32| -> i32 { ERRNO_SPIPE })?;
    linker.func_wrap(M, "fd_sync", |_: Caller<'_, Wasi>, _: u32| -> i32 { ERRNO_SUCCESS })?;
    linker.func_wrap(M, "poll_oneoff", |_: Caller<'_, Wasi>, _: u32, _: u32, _: u32, _: u32| -> i32 { ERRNO_NOTSUP })?;
    linker.func_wrap(M, "sched_yield", |_: Caller<'_, Wasi>| -> i32 { ERRNO_SUCCESS })?;

    linker.func_wrap(M, "fd_write", |mut caller: Caller<'_, Wasi>, fd: u32, iovs: u32, iovs_len: u32, nwritten: u32| -> i32 {
        if fd != 1 && fd != 2 {
            return ERRNO_BADF;
        }
        let mem = memory(&caller).data_mut(&mut caller);
        let mut total: u32 = 0;
        for i in 0..iovs_len {
            let (Some(ptr), Some(len)) = (read_u32(mem, iovs + i * 8), read_u32(mem, iovs + i * 8 + 4)) else {
                return ERRNO_FAULT;
            };
            let Some(bytes) = mem.get(ptr as usize..ptr as usize + len as usize) else {
                return ERRNO_FAULT;
            };
            unsafe { write(fd, bytes.as_ptr(), bytes.len()) };
            total += len;
        }
        if write_bytes(mem, nwritten, &total.to_le_bytes()) { ERRNO_SUCCESS } else { ERRNO_FAULT }
    })?;

    linker.func_wrap(M, "fd_read", |mut caller: Caller<'_, Wasi>, fd: u32, iovs: u32, iovs_len: u32, nread: u32| -> i32 {
        if fd != 0 {
            return ERRNO_BADF;
        }
        let (mem, state) = memory(&caller).data_and_store_mut(&mut caller);
        let mut total: u32 = 0;
        for i in 0..iovs_len {
            let (Some(ptr), Some(len)) = (read_u32(mem, iovs + i * 8), read_u32(mem, iovs + i * 8 + 4)) else {
                return ERRNO_FAULT;
            };
            let rest = &state.stdin[state.stdin_pos..];
            let n = rest.len().min(len as usize);
            if !write_bytes(mem, ptr, &rest[..n]) {
                return ERRNO_FAULT;
            }
            state.stdin_pos += n;
            total += n as u32;
            if n < len as usize {
                break;
            }
        }
        if write_bytes(mem, nread, &total.to_le_bytes()) { ERRNO_SUCCESS } else { ERRNO_FAULT }
    })?;

    linker.func_wrap(M, "proc_exit", |_: Caller<'_, Wasi>, code: i32| -> Result<(), Error> { Err(Error::i32_exit(code)) })?;

    Ok(())
}
