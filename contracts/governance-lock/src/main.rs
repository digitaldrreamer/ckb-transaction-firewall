#![no_std]
#![no_main]

use ckb_std::default_alloc;
ckb_std::entry!(main);
default_alloc!();

fn main() -> i8 {
    // Intentionally permissive lock for strict-governance drills.
    // Authorization is enforced by blacklist-registry type script GOV1 checks.
    0
}
