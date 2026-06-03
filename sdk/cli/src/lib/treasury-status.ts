import type { LiveCell } from "./rpc.js";
import { getLiveCellsByLock } from "./rpc.js";
import { bytesToHex, governanceTreasuryLockHash, type GovernanceHeader } from "./blkl.js";
import { occupiedCapacityShannons, parseCapacity } from "./capacity.js";
import { TESTNET_RPC_URL, TESTNET_TREASURY_DONATION_ADDRESS } from "./defaults.js";

const SHANNONS_PER_CKB = 100_000_000n;
export const TREASURY_DONATION_THRESHOLD_PERCENT = 70;

export interface TreasuryStatus {
  lockHash: string;
  lockScript?: { code_hash: string; hash_type: string; args: string };
  donationAddress?: string;
  liveCellCount?: number;
  balanceShannons?: string;
  registryCapacityShannons: string;
  registryOccupiedShannons: string;
  poolCapacityShannons?: string;
  poolUsedPercent?: number;
  donateRecommended: boolean;
  error?: string;
}

export function formatCkb(shannons: bigint): string {
  const whole = shannons / SHANNONS_PER_CKB;
  const frac = shannons % SHANNONS_PER_CKB;
  if (frac === 0n) return `${whole} CKB`;
  const fracText = frac.toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}.${fracText} CKB`;
}

export function knownTreasuryDonationAddress(
  rpcUrl: string,
  lockScript: { code_hash: string; hash_type: string; args: string } | undefined,
): string | undefined {
  if (
    rpcUrl === TESTNET_RPC_URL &&
    lockScript?.code_hash === "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8" &&
    lockScript.hash_type === "type" &&
    lockScript.args === "0x9888a8a74df4e0ce82e7a4604f8fd403fd4622ca"
  ) {
    return TESTNET_TREASURY_DONATION_ADDRESS;
  }
  return undefined;
}

export async function loadTreasuryStatus(
  rpcUrl: string,
  registryCell: LiveCell,
  governanceHeader: GovernanceHeader | null,
): Promise<TreasuryStatus | null> {
  const treasuryLockHash = governanceTreasuryLockHash(governanceHeader);
  if (!treasuryLockHash) return null;

  const registryCapacity = parseCapacity(registryCell.capacity);
  const registryOccupied = occupiedCapacityShannons({
    lock: registryCell.lock,
    type: registryCell.type,
    data: registryCell.data,
  });
  const lockScript = governanceHeader?.treasuryLockScript;
  const donationAddress = knownTreasuryDonationAddress(rpcUrl, lockScript);
  const base: TreasuryStatus = {
    lockHash: bytesToHex(treasuryLockHash),
    ...(lockScript ? { lockScript } : {}),
    ...(donationAddress ? { donationAddress } : {}),
    registryCapacityShannons: registryCapacity.toString(),
    registryOccupiedShannons: registryOccupied.toString(),
    donateRecommended: false,
  };

  if (!lockScript) return base;

  try {
    const treasuryCells = await getLiveCellsByLock(rpcUrl, lockScript, 100);
    const plainTreasuryCells = treasuryCells.filter((c) => !c.type && c.data === "0x");
    const treasuryBalance = plainTreasuryCells.reduce((sum, c) => sum + parseCapacity(c.capacity), 0n);
    const poolCapacity = registryCapacity + treasuryBalance;
    const poolUsedPercent = poolCapacity > 0n
      ? Number((registryOccupied * 10_000n) / poolCapacity) / 100
      : 100;
    return {
      ...base,
      liveCellCount: plainTreasuryCells.length,
      balanceShannons: treasuryBalance.toString(),
      poolCapacityShannons: poolCapacity.toString(),
      poolUsedPercent,
      donateRecommended: poolUsedPercent >= TREASURY_DONATION_THRESHOLD_PERCENT,
    };
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
