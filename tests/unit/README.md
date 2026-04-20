# Unit Tests

Unit tests target deterministic behavior in isolation.

## Coverage Targets

- blacklist encoding/decoding correctness,
- destination extraction from transaction outputs,
- membership checks (hit/miss edge cases),
- dep-selection invariants (zero/one/many registry candidates),
- lock-script error code mapping,
- governance payload validation helpers.

## Fixtures

- minimal valid registry payload,
- malformed registry variants,
- representative safe and blocked destination identifiers.

## Expected Outcome

Unit tests should detect any logic drift before integration or deployment phases.
