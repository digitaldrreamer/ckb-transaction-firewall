import type { FirewallReasonCode } from "./types.js";

/** Base class for SDK errors that map to firewall preflight codes. */
export abstract class FirewallSdkError extends Error {
  abstract readonly code: FirewallReasonCode;
}

export class MissingRegistryCellDepError extends FirewallSdkError {
  readonly code = 8 as const;

  constructor() {
    super("MissingRegistryCellDep");
    this.name = "MissingRegistryCellDepError";
  }
}

export class InvalidRegistryDataError extends FirewallSdkError {
  readonly code = 9 as const;

  constructor() {
    super("InvalidRegistryData");
    this.name = "InvalidRegistryDataError";
  }
}

export class RegistryNotSortedError extends FirewallSdkError {
  readonly code = 10 as const;

  constructor() {
    super("RegistryNotSorted");
    this.name = "RegistryNotSortedError";
  }
}

export class AmbiguousRegistryCellDepError extends FirewallSdkError {
  readonly code = 17 as const;

  constructor() {
    super("AmbiguousRegistryCellDep");
    this.name = "AmbiguousRegistryCellDepError";
  }
}

export function isFirewallSdkError(err: unknown): err is FirewallSdkError {
  return err instanceof FirewallSdkError;
}
