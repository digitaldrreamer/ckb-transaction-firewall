use ckb_transaction_firewall_sdk::{
    check_transaction, parse_registry_payload, CellDepLike, FirewallConfig, HashType, RegistrySpec,
    ScriptLike, TxOutputLike, UnsignedTxLike,
};
use serde_json::json;

const RPC_URL: &str = "https://testnet.ckb.dev";
const REGISTRY_CODE_HASH: &str = "493f1700508125b0e281b8fb1d168b03bd5ef71480399dd59221224901a9cd09";
const REGISTRY_TYPE_ID_VALUE: &str =
    "9be0ad6e4e5039a64d9725ff037057c16ef59f126e3bdd9841b802f0e0a112fe";
// Governance key 0 address — not blacklisted, safe to use as clean recipient.
const TESTNET_ACCOUNT_2_LOCK_ARGS: &str = "331cdd72ff9f7f22c53f9710d6639ca46de3ac06";

fn hex_to_vec(hex: &str) -> Result<Vec<u8>, String> {
    let clean = hex.strip_prefix("0x").unwrap_or(hex);
    if clean.len() % 2 != 0 {
        return Err("hex string has odd length".to_string());
    }
    (0..clean.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&clean[i..i + 2], 16).map_err(|err| err.to_string()))
        .collect()
}

fn hex_to_32(hex: &str) -> Result<[u8; 32], String> {
    let bytes = hex_to_vec(hex)?;
    if bytes.len() != 32 {
        return Err(format!("expected 32 bytes, got {}", bytes.len()));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

fn fetch_live_registry() -> Result<(String, u32, CellDepLike), Box<dyn std::error::Error>> {
    let get_cells = ureq::post(RPC_URL)
        .send_json(json!({
            "id": 1,
            "jsonrpc": "2.0",
            "method": "get_cells",
            "params": [{
                "script": {
                    "code_hash": format!("0x{REGISTRY_CODE_HASH}"),
                    "hash_type": "type",
                    "args": "0x02"
                },
                "script_type": "type"
            }, "desc", "0x10"]
        }))?
        .body_mut()
        .read_json::<serde_json::Value>()?;

    let type_id = REGISTRY_TYPE_ID_VALUE.to_ascii_lowercase();
    let objects = get_cells["result"]["objects"]
        .as_array()
        .ok_or("get_cells response did not include result.objects")?;
    let cell = objects
        .iter()
        .find(|object| {
            object["output"]["type"]["args"]
                .as_str()
                .map(|args| {
                    let clean = args.trim_start_matches("0x").to_ascii_lowercase();
                    clean.len() == 132 && clean[68..] == type_id
                })
                .unwrap_or(false)
        })
        .ok_or("no live registry cell found")?;

    let tx_hash = cell["out_point"]["tx_hash"]
        .as_str()
        .ok_or("missing out_point.tx_hash")?
        .to_string();
    let index_hex = cell["out_point"]["index"]
        .as_str()
        .ok_or("missing out_point.index")?;
    let index = u32::from_str_radix(index_hex.trim_start_matches("0x"), 16)?;

    let live = ureq::post(RPC_URL)
        .send_json(json!({
            "id": 1,
            "jsonrpc": "2.0",
            "method": "get_live_cell",
            "params": [{ "tx_hash": tx_hash, "index": format!("0x{index:x}") }, true]
        }))?
        .body_mut()
        .read_json::<serde_json::Value>()?;

    if live["result"]["status"].as_str() != Some("live") {
        return Err("registry cell is not live".into());
    }

    let type_script = &live["result"]["cell"]["output"]["type"];
    let data = live["result"]["cell"]["data"]["content"]
        .as_str()
        .ok_or("missing registry data")?;

    let dep = CellDepLike {
        type_script: Some(ScriptLike {
            code_hash: hex_to_32(
                type_script["code_hash"]
                    .as_str()
                    .ok_or("missing type code_hash")?,
            )?,
            hash_type: HashType::Type,
            args: hex_to_vec(type_script["args"].as_str().ok_or("missing type args")?)?,
        }),
        data: hex_to_vec(data)?,
    };

    Ok((tx_hash, index, dep))
}

fn candidate_tx(dep: CellDepLike, lock_args: &[u8]) -> UnsignedTxLike {
    UnsignedTxLike {
        cell_deps: vec![dep],
        outputs: vec![TxOutputLike {
            lock_args: lock_args.to_vec(),
            type_args: None,
        }],
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let (tx_hash, index, dep) = fetch_live_registry()?;
    let payload = parse_registry_payload(&dep.data)?;
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs();
    let cfg = FirewallConfig {
        registries: vec![RegistrySpec {
            code_hash: hex_to_32(REGISTRY_CODE_HASH)?,
            hash_type: HashType::Type,
            type_id_value: hex_to_32(REGISTRY_TYPE_ID_VALUE)?,
            required: true,
        }],
    };

    println!(
        "Loaded registry {tx_hash}:{index} ({} entries)",
        payload.entries.len()
    );

    let clean_args = hex_to_vec(TESTNET_ACCOUNT_2_LOCK_ARGS)?;
    let tx = candidate_tx(dep.clone(), &clean_args);
    match check_transaction(&cfg, &tx, now_secs) {
        Ok(()) => println!("candidate-payment: accepted for signing"),
        Err(error) => println!(
            "candidate-payment: rejected before signing - {error} ({})",
            error.code()
        ),
    }

    if let Some(entry) = payload
        .entries
        .iter()
        .find(|entry| entry.expires_at == 0 || entry.expires_at > now_secs)
    {
        let tx = candidate_tx(dep.clone(), &entry.identifier);
        match check_transaction(&cfg, &tx, now_secs) {
            Ok(()) => println!("blacklisted-payment: unexpectedly accepted"),
            Err(error) => println!(
                "blacklisted-payment: rejected before signing - {error} ({})",
                error.code()
            ),
        }
    } else {
        println!("blacklisted-payment: unavailable because the live testnet registry has no active entries");
    }

    let missing_dep_tx = UnsignedTxLike {
        cell_deps: vec![],
        outputs: vec![TxOutputLike {
            lock_args: clean_args,
            type_args: None,
        }],
    };
    if let Err(error) = check_transaction(&cfg, &missing_dep_tx, now_secs) {
        println!(
            "missing-registry-dep: rejected fail-closed - {error} ({})",
            error.code()
        );
    }

    Ok(())
}
