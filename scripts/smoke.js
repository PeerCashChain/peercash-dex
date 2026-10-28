// On-chain smoke test (run AFTER deploy, against testnet). Exercises the full
// path: deploy a TestToken, add PEER/TestToken liquidity (which wraps PEER into
// WPEER), then swap PEER->TestToken and assert balances move.
//
//   node scripts/smoke.js
//
// Reads addresses from deployments/<chainId>.json. Needs RPC_URL + PRIVATE_KEY.

import "dotenv/config";
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";
import { root, overrides, loadArtifact, compileLocal, getWallet } from "./lib.js";

const RPC_URL = process.env.RPC_URL;
if (!RPC_URL) throw new Error("Set RPC_URL (see .env.example).");

const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const net = await provider.getNetwork();
  const wallet = await getWallet(provider);

  const dep = JSON.parse(
    fs.readFileSync(path.join(root, "deployments", `${net.chainId}.json`), "utf8")
  );
  console.log(`chainId=${net.chainId}  router=${dep.UniswapV2Router02}  WPEER=${dep.WPEER}`);

  const routerArt = loadArtifact("@uniswap/v2-periphery/build/UniswapV2Router02.json");
  const router = new ethers.Contract(dep.UniswapV2Router02, routerArt.abi, wallet);
  const factoryArt = loadArtifact("@uniswap/v2-core/build/UniswapV2Factory.json");
  const factory = new ethers.Contract(dep.UniswapV2Factory, factoryArt.abi, wallet);

  // 1. Deploy a TestToken.
  const ttArt = compileLocal("TestToken.sol", "TestToken");
  const supply = ethers.parseEther("1000000");
  const tt = await new ethers.ContractFactory(ttArt.abi, ttArt.bytecode, wallet).deploy(
    supply,
    overrides
  );
  await tt.waitForDeployment();
  const ttAddr = await tt.getAddress();
  console.log(`TestToken deployed -> ${ttAddr}`);

  // 2. Approve router, add PEER/TestToken liquidity (wraps PEER -> WPEER).
  const tokenAmount = ethers.parseEther("10000");
  const peerAmount = ethers.parseEther("10");
  await (await new ethers.Contract(ttAddr, ERC20_ABI, wallet).approve(
    dep.UniswapV2Router02,
    tokenAmount,
    overrides
  )).wait();
  const deadline = Math.floor(Date.now() / 1000) + 600;
  await (await router.addLiquidityETH(
    ttAddr,
    tokenAmount,
    0,
    0,
    wallet.address,
    deadline,
    { ...overrides, value: peerAmount }
  )).wait();

  const pairAddr = await factory.getPair(ttAddr, dep.WPEER);
  if (pairAddr === ethers.ZeroAddress) throw new Error("pair not created");
  console.log(`Liquidity added. pair=${pairAddr}`);

  // 3. Swap PEER -> TestToken and assert the balance increased.
  const tokenC = new ethers.Contract(ttAddr, ERC20_ABI, wallet);
  const before = await tokenC.balanceOf(wallet.address);
  await (await router.swapExactETHForTokens(
    0,
    [dep.WPEER, ttAddr],
    wallet.address,
    deadline,
    { ...overrides, value: ethers.parseEther("1") }
  )).wait();
  const after = await tokenC.balanceOf(wallet.address);
  if (after <= before) throw new Error("swap did not increase TestToken balance");
  console.log(`Swap OK: TestToken balance +${ethers.formatEther(after - before)}`);

  console.log("\nSMOKE TEST PASSED: wrap + addLiquidity + swap all work on-chain.");
}

main().catch((e) => {
  console.error("\nSMOKE FAILED:\n" + (e.message ?? e));
  process.exit(1);
});
