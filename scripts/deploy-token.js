// Deploy a token on PeerCash and seed a WPEER/<token> liquidity pool, so the
// swap/pool UIs have something to trade. Reads WPEER + Router from
// deployments/<chainId>.json (run deploy.js first).
//
//   set TOKEN_NAME=PeerCash Purr
//   set TOKEN_SYMBOL=PURR
//   set TOKEN_SUPPLY=1000000      (whole tokens, minted to deployer)
//   set LIQ_TOKEN=100000          (tokens added to the pool)
//   set LIQ_PEER=100              (PEER added to the pool; ratio sets price)
//   node scripts/deploy-token.js
//
// Initial price = LIQ_PEER / LIQ_TOKEN PEER per token.

import "dotenv/config";
import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";
import { root, overrides, loadArtifact, compileLocal, getWallet } from "./lib.js";

const RPC_URL = process.env.RPC_URL;
if (!RPC_URL) throw new Error("Set RPC_URL (see .env.example).");

const NAME = process.env.TOKEN_NAME ?? "PeerCash Purr";
const SYMBOL = process.env.TOKEN_SYMBOL ?? "PURR";
const SUPPLY = process.env.TOKEN_SUPPLY ?? "1000000";
const LIQ_TOKEN = process.env.LIQ_TOKEN ?? "100000";
const LIQ_PEER = process.env.LIQ_PEER ?? "100";

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const net = await provider.getNetwork();
  const wallet = await getWallet(provider);
  const dep = JSON.parse(
    fs.readFileSync(path.join(root, "deployments", `${net.chainId}.json`), "utf8")
  );
  console.log(`chainId=${net.chainId}  deployer=${wallet.address}`);
  console.log(`Deploying ${SYMBOL} ("${NAME}"), supply ${SUPPLY}...`);

  const art = compileLocal("Token.sol", "Token");
  const token = await new ethers.ContractFactory(art.abi, art.bytecode, wallet).deploy(
    NAME,
    SYMBOL,
    ethers.parseEther(SUPPLY),
    overrides
  );
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log(`  ${SYMBOL} -> ${tokenAddr}`);

  const liqToken = ethers.parseEther(LIQ_TOKEN);
  const liqPeer = ethers.parseEther(LIQ_PEER);
  console.log(`Seeding pool: ${LIQ_PEER} PEER + ${LIQ_TOKEN} ${SYMBOL}...`);
  await (await token.approve(dep.UniswapV2Router02, liqToken, overrides)).wait();
  const routerArt = loadArtifact("@uniswap/v2-periphery/build/UniswapV2Router02.json");
  const router = new ethers.Contract(dep.UniswapV2Router02, routerArt.abi, wallet);
  const deadline = Math.floor(Date.now() / 1000) + 1200;
  await (await router.addLiquidityETH(
    tokenAddr,
    liqToken,
    0,
    0,
    wallet.address,
    deadline,
    { ...overrides, value: liqPeer }
  )).wait();

  const price = Number(LIQ_PEER) / Number(LIQ_TOKEN);
  console.log(`  pool seeded. initial price ~${price} PEER per ${SYMBOL}`);

  // record alongside the core deployment
  const file = path.join(root, "deployments", `${net.chainId}.json`);
  dep.tokens = dep.tokens ?? {};
  dep.tokens[SYMBOL] = { address: tokenAddr, name: NAME, decimals: 18 };
  fs.writeFileSync(file, JSON.stringify(dep, null, 2));

  console.log("\nPaste these three fields into the testswap AND testpool CFG block:");
  console.log(`  router: "${dep.UniswapV2Router02}",`);
  console.log(`  wpeer:  "${dep.WPEER}",`);
  console.log(
    `  token:  { symbol: "${SYMBOL}", decimals: 18, letter: "${SYMBOL[0]}", color: "#2a2f33", address: "${tokenAddr}" },`
  );
}

main().catch((e) => {
  console.error("\nTOKEN DEPLOY FAILED:\n" + (e.message ?? e));
  process.exit(1);
});
