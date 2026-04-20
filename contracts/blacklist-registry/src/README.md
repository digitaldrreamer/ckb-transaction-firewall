# Blacklist Registry Source

This folder will hold registry cell protection logic, including:

- proposal execution validation,
- multisig authorization checks,
- update integrity guarantees,
- emergency mode alignment: **temporary add only**, each temporary row carries `expires_at`; type script and lock script enforce policy per `docs/lock-script-spec.md` and `governance/voting.md`.
