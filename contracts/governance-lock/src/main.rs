#![no_std]
#![no_main]

use ckb_std::default_alloc;
use ckb_std::error::SysError;
use ckb_std::high_level::load_script;
ckb_std::entry!(main);
default_alloc!();

const DRILL_MARKER: &[u8] = b"STRICT_GOV_DRILL_V1";

fn main() -> i8 {
    // Fail closed by default: only accept explicit drill marker args.
    // This preserves drill use while reducing accidental unsafe reuse risk.
    match validate_marker_args() {
        Ok(()) => 0,
        Err(_) => 1,
    }
}

fn validate_marker_args() -> Result<(), SysError> {
    let script = load_script()?;
    if script.args().raw_data().as_ref() == DRILL_MARKER {
        return Ok(());
    }
    Err(SysError::Unknown(1))
}
