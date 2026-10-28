// PeerCash DEX deploy: WPEER -> UniswapV2Factory -> UniswapV2Router02
//
// Deploys the CANONICAL prebuilt Uniswap V2 artifacts (NOT recompiled). Because
// the Pair bytecode is canonical, its init-code-hash is the canonical
// 0x96e8ac42... that the stock Router already embeds -> they match, so NO
// UniswapV2Library hash patch is needed. Only WPEER is compiled locally, and it
// is token-agnostic so it never enters the pair hash.
//
// Testnet first (chainId 563321). Mainnet (620156) is human-gated: run only
// after a clean testnet pass, and never let the two chains cross.

import "dotenv/config";
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";
import {
  root,
  overrides,
  loadArtifact,
  compileLocal,
  pairFor,
  getWallet,
  CANONICAL_INIT_CODE_HASH,
} from "./lib.js";

const RPC_URL = process.env.RPC_URL;
const EXPECT_CHAIN_ID = BigInt(process.env.EXPECT_CHAIN_ID ?? "563321"); // testnet default
const FEE_TO_SETTER = process.env.FEE_TO_SETTER; // defaults to deployer if unset

if (!RPC_URL) throw new Error("Set RPC_URL (see .env.example).");

async function deploy(wallet, { abi, bytecode }, args, label) {
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(...args, overrides);
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(`  ${label.padEnd(10)} -> ${addr}`);
  return contract;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const net = await provider.getNetwork();
  if (net.chainId !== EXPECT_CHAIN_ID) {
    throw new Error(
      `chainId mismatch: RPC is ${net.chainId}, expected ${EXPECT_CHAIN_ID}. ` +
        `Refusing to deploy (testnet=563321, mainnet=620156 must never cross).`
    );
  }
  const wallet = await getWallet(provider);
  const feeToSetter = FEE_TO_SETTER ?? wallet.address;
  const bal = await provider.getBalance(wallet.address);
  console.log(`Network     chainId=${net.chainId}`);
  console.log(`Deployer    ${wallet.address}`);
  console.log(`Balance     ${ethers.formatEther(bal)} PEER`);
  console.log(`feeToSetter ${feeToSetter}`);
  if (bal === 0n) throw new Error("Deployer has 0 PEER - fund it before deploying.");
  console.log();

  const factoryArt = loadArtifact("@uniswap/v2-core/build/UniswapV2Factory.json");
  const routerArt = loadArtifact("@uniswap/v2-periphery/build/UniswapV2Router02.json");
  const pairArt = loadArtifact("@uniswap/v2-core/build/UniswapV2Pair.json");

  // init-code-hash from the EXACT pair bytecode the factory will CREATE2.
  const initCodeHash = ethers.keccak256(pairArt.bytecode);
  console.log(`Pair init-code-hash ${initCodeHash}`);
  if (initCodeHash.toLowerCase() !== CANONICAL_INIT_CODE_HASH.toLowerCase()) {
    throw new Error(
      `init-code-hash ${initCodeHash} is not canonical - the stock router would ` +
        `misroute. Patch UniswapV2Library to this value (or use canonical artifacts).`
    );
  }
  console.log(`(matches canonical -> stock router routes correctly)\n`);

  console.log("Deploying (order matters: WPEER -> Factory -> Router):");
  const wpeer = await deploy(wallet, compileLocal("WPEER.sol", "WPEER"), [], "WPEER");
  const factory = await deploy(wallet, factoryArt, [feeToSetter], "Factory");
  const router = await deploy(
    wallet,
    routerArt,
    [await factory.getAddress(), await wpeer.getAddress()],
    "Router"
  );

  // ---- GOLDEN CHECK: never skip ----
  // Create a throwaway pair and assert the address our init-code-hash predicts
  // equals factory.getPair. If this fails, the router would route swaps to the
  // wrong (non-existent) pair address -> abort before any liquidity is added.
  const tokenA = await wpeer.getAddress();
  const tokenB = await router.getAddress(); // any distinct nonzero addr; derivation test only
  await (await factory.createPair(tokenA, tokenB, overrides)).wait();
  const onchain = await factory.getPair(tokenA, tokenB);
  const predicted = pairFor(await factory.getAddress(), tokenA, tokenB, initCodeHash);
  if (onchain.toLowerCase() !== predicted.toLowerCase()) {
    throw new Error(
      `GOLDEN CHECK FAILED: factory pair ${onchain} != predicted ${predicted}.\n` +
        `The deployed Pair's init-code-hash does not match what the Router embeds. ABORT.`
    );
  }
  console.log(`\nGolden check OK: pairFor == getPair (${onchain})`);

  const outObj = {
    chainId: Number(net.chainId),
    deployer: wallet.address,
    feeToSetter,
    initCodeHash,
    WPEER: await wpeer.getAddress(),
    UniswapV2Factory: await factory.getAddress(),
    UniswapV2Router02: await router.getAddress(),
    deployedAt: new Date().toISOString(),
  };
  const dir = path.join(root, "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${net.chainId}.json`);
  fs.writeFileSync(file, JSON.stringify(outObj, null, 2));
  console.log(`\nWrote ${file}`);
  console.log("\nFROZEN ADDRESSES (record these, verify source on the explorer):");
  console.log(JSON.stringify(outObj, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
