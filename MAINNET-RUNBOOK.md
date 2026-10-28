# PeerCash DEX - Mainnet Deploy Runbook

Mainnet (chainId **620156**) mirror of the proven testnet deploy. Human-gated
(RULE 6): you run every step and pull the trigger; keys, custody, and timing stay
with you. Do NOT run this until the testnet rehearsal passed in a browser
(a real PEER->PURR swap + a pool add/remove).

## 0. Pre-flight
- [ ] Testnet swap + pool confirmed working in the browser.
- [ ] A **fresh, dedicated mainnet deployer key** (NOT the testnet account
      `0x03c6...3bbb`). Funded with mainnet PEER for gas (~4 contract-creation
      txs: WPEER, Factory, Router, plus the golden-check createPair).
- [ ] Decide **`FEE_TO_SETTER`** - the address that can later switch on the
      0.05% protocol fee. Prefer a dedicated governance key over the deployer.

## 1. Configure (.env)
```
RPC_URL=https://rpc.peercash.io
EXPECT_CHAIN_ID=620156
KEYSTORE_PATH=C:\path\to\mainnet-deployer.keystore
FEE_TO_SETTER=0x<governance address>
```
Set `WALLET_PASSWORD` in the shell session, not in `.env`.
The script refuses to run unless the RPC's chainId == 620156, so testnet and
mainnet cannot cross.

## 2. Deploy core
```
npm run deploy
```
- Must print `Golden check OK: pairFor == getPair`.
- Writes `deployments/620156.json` (WPEER, Factory, Router, initCodeHash).
- init-code-hash must be the canonical `0x96e8ac42...` (prebuilt artifacts).

## 3. Freeze + verify
- [ ] Record the three addresses from `deployments/620156.json`. Treat them as
      **immutable** - everything will build on them.
- [ ] Verify source on the mainnet explorer. Compiler settings:
      - UniswapV2Factory / Pair: solc 0.5.16, optimizer runs 999999
      - UniswapV2Router02: solc 0.6.6, optimizer runs 999999
      - WPEER: solc 0.8.26, optimizer runs 200, **evmVersion london** (chain is
        pre-Shanghai; PUSH0 is rejected - see memory evm-london-no-push0).
- [ ] Publish the frozen addresses (fair-launch transparency).

## 4. Token + liquidity (deliberate)
```
set TOKEN_NAME=...   set TOKEN_SYMBOL=...   set TOKEN_SUPPLY=...
set LIQ_TOKEN=...     set LIQ_PEER=...
node scripts/deploy-token.js
```
CAUTION: do NOT seed deep real liquidity before a finality/checkpointing story
exists. The chain is cheap to 51%/reorg at current hashrate; a high-TVL pool is a
honeypot. Proof-of-life amounts are fine; large value is not, yet.

## 5. Front-end
- [ ] Deploy a **separate mainnet** swap/pool UI (or a mainnet instance) with the
      620156 CFG: chainIdDec 620156, mainnet RPC/explorer, and the frozen
      WPEER/Factory/Router + token addresses. Never mix testnet and mainnet
      configs in one file/datadir/service.

## Rollback / safety
- Nothing here is reversible on mainnet once blocks are mined. The only "undo" is
  deploying fresh contracts and re-pointing the UI; old addresses stay on-chain
  forever. That's why every address is frozen and published, not changed.
