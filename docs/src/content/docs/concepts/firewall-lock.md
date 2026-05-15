---
title: Firewall Lock
description: The consensus-layer lock script that checks transaction outputs against the blacklist registry.
---

The firewall lock is a CKB lock script that checks a spend against the blacklist registry during consensus validation.

## What it does

- Loads the registry cell dep that matches the configured registry identity
- Parses the `BLKL` payload from the registry cell data
- Checks each output against the blacklist
- Delegates to the wrapped inner lock if the blacklist check passes

## Output checks

The lock can be configured to check:

- `lock_args`
- `type_args`

Those checks are controlled by the lock-args flag byte.

## Fail-closed behavior

The lock rejects if:

- the registry dep is missing
- more than one matching registry dep exists
- the registry payload is malformed
- the registry entries are not sorted
- an output matches a blacklisted identifier

## Important detail

The lock is not a generic transaction simulator. Its job is to provide a hard consensus floor for a specific blacklist policy.
