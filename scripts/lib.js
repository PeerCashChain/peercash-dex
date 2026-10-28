// Shared helpers for the PeerCash DEX scripts.
import { ethers } from "ethers";
import solc from "solc";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(__dirname, "..");

// RULE 3: explicit fees. Base fee on this chain is ~7 wei; auto-estimation
// produces un-mineable txs. 1 gwei priority / 2 gwei max is safe and ample.
export const overrides = {
  maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
  maxFeePerGas: ethers.parseUnits("2", "gwei"),
};

export function loadArtifact(pkgRelPath) {
  const p = path.join(root, "node_modules", pkgRelPath);
  const art = JSON.parse(fs.readFileSync(p, "utf8"));
  let bytecode = art.bytecode ?? art.evm?.bytecode?.object;
  if (bytecode && !bytecode.startsWith("0x")) bytecode = "0x" + bytecode;
  return { abi: art.abi, bytecode };
}

// Compile a single contract from contracts/<file> and return {abi, bytecode}.
export function compileLocal(file, contractName) {
  const source = fs.readFileSync(path.join(root, "contracts", file), "utf8");
  const input = {
    language: "Solidity",
    sources: { [file]: { content: source } },
    settings: {
      // PeerCash is on the London fork (pre-Shanghai): the EVM rejects the
      // PUSH0 opcode (0x5f) that solc >=0.8.20 emits by default. Target London
      // so no PUSH0 is produced. Revisit only after the Shanghai hard fork.
      evmVersion: "london",
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const fatal = (out.errors ?? []).filter((e) => e.severity === "error");
  if (fatal.length) {
    throw new Error(`${file} compile failed:\n` + fatal.map((e) => e.formattedMessage).join("\n"));
  }
  const c = out.contracts[file][contractName];
  return { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };
}

// Off-chain UniswapV2Library.pairFor - proves the factory's CREATE2 pairs match
// the init-code-hash the router embeds.
export function pairFor(factoryAddr, tokenA, tokenB, initCodeHash) {
  const [t0, t1] =
    tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
  const salt = ethers.keccak256(ethers.solidityPacked(["address", "address"], [t0, t1]));
  return ethers.getCreate2Address(factoryAddr, salt, initCodeHash);
}

export const CANONICAL_INIT_CODE_HASH =
  "0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f";

// Resolve the signing wallet. Prefers an encrypted geth keystore (key stays
// encrypted on disk, decrypted only in memory) over a raw PRIVATE_KEY.
//   KEYSTORE_PATH + WALLET_PASSWORD  (recommended), or
//   PRIVATE_KEY                      (fallback)
export async function getWallet(provider) {
  const ksPath = process.env.KEYSTORE_PATH;
  if (ksPath) {
    const pw = process.env.WALLET_PASSWORD;
    if (!pw) throw new Error("KEYSTORE_PATH set but WALLET_PASSWORD is empty.");
    const json = fs.readFileSync(ksPath, "utf8");
    const w = await ethers.Wallet.fromEncryptedJson(json, pw);
    return w.connect(provider);
  }
  if (process.env.PRIVATE_KEY) return new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  throw new Error("Set KEYSTORE_PATH (+WALLET_PASSWORD) or PRIVATE_KEY. See .env.example.");
}
