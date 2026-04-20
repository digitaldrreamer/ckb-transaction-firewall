# Firewall Lock Source

This source folder will contain the lock script implementation for:

- resolving the blacklist registry `cell_dep` by **type script identity** (`code_hash`, `hash_type`, `args`) with deterministic selection: **0** matches → `MissingRegistryCellDep` (`8`), **1** match → proceed, **>1** → `AmbiguousRegistryCellDep` (`17`),
- scanning transaction outputs and matching against blacklist entries (`lock_args` / `type_args` per lock `flags`),
- rejecting invalid transactions with the public error codes in `docs/lock-script-spec.md`.
