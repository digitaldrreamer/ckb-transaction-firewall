export interface CellDepJson {
  out_point: { tx_hash: string; index: string };
  dep_type: "code" | "dep_group";
}

export function parseCellDepList(values: string[] | undefined, name: string): CellDepJson[] {
  return (values ?? []).map((value) => {
    const raw = value.trim();
    const match = /^(0x[0-9a-fA-F]{64})(?::|#)(\d+)(?::(code|dep_group))?$/.exec(raw);
    if (!match) {
      throw new Error(`${name} must be formatted as <tx-hash>:<index>[:code|dep_group]. Got "${value}".`);
    }
    const index = Number.parseInt(match[2]!, 10);
    return {
      out_point: { tx_hash: match[1]!, index: `0x${index.toString(16)}` },
      dep_type: (match[3] ?? "code") as "code" | "dep_group",
    };
  });
}
