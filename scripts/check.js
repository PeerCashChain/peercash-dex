// Keyless local validation. No private key, no network: proves the deps
// resolve, WPEER + TestToken compile, the canonical artifacts load, and the
// pair init-code-hash is the canonical value the stock router embeds.
//
//   node scripts/check.js

import { ethers } from "ethers";
import { loadArtifact, compileLocal, pairFor, CANONICAL_INIT_CODE_HASH } from "./lib.js";

function ok(label) {
  console.log(`  OK  ${label}`);
}

async function main() {
  console.log("Compiling local contracts...");
  const wpeer = compileLocal("WPEER.sol", "WPEER");
  ok(`WPEER compiled (${wpeer.bytecode.length / 2 - 1} bytes)`);
  const tt = compileLocal("TestToken.sol", "TestToken");
  ok(`TestToken compiled (${tt.bytecode.length / 2 - 1} bytes)`);

  console.log("Loading canonical Uniswap V2 artifacts...");
  const factory = loadArtifact("@uniswap/v2-core/build/UniswapV2Factory.json");
  ok("UniswapV2Factory artifact");
  const router = loadArtifact("@uniswap/v2-periphery/build/UniswapV2Router02.json");
  ok("UniswapV2Router02 artifact");
  const pair = loadArtifact("@uniswap/v2-core/build/UniswapV2Pair.json");
  ok("UniswapV2Pair artifact");

  console.log("Checking pair init-code-hash...");
  const initCodeHash = ethers.keccak256(pair.bytecode);
  console.log(`  computed  ${initCodeHash}`);
  console.log(`  canonical ${CANONICAL_INIT_CODE_HASH}`);
  if (initCodeHash.toLowerCase() !== CANONICAL_INIT_CODE_HASH.toLowerCase()) {
    throw new Error(
      "init-code-hash is NOT canonical. The periphery router (which embeds the " +
        "canonical hash) would route to the wrong pair. Do not deploy until this " +
        "matches or the router's UniswapV2Library hash is patched to this value."
    );
  }
  ok("init-code-hash matches canonical -> stock router will route correctly");

  // sanity: pairFor derivation is deterministic for dummy addresses
  const a = "0x1111111111111111111111111111111111111111";
  const b = "0x2222222222222222222222222222222222222222";
  const f = "0x3333333333333333333333333333333333333333";
  pairFor(f, a, b, initCodeHash);
  ok("pairFor derivation runs");

  console.log("\nAll keyless checks passed. Scaffold is ready for a testnet deploy.");
}

main().catch((e) => {
  console.error("\nCHECK FAILED:\n" + e.message);
  process.exit(1);
});
