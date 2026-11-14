// Pons V2 launchpad on Robinhood Chain (chain id 4663).
// Function and event shapes come from the public Pons / Bitquery docs; selectors were checked against them.
const { createPublicClient, createWalletClient, http, defineChain, decodeFunctionData, parseAbi, parseEther, formatEther } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const crypto = require('crypto');
const { redis } = require('./_redis');

const FACTORY = (process.env.PONS_FACTORY || '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e').toLowerCase();
const RPC = process.env.ROBINHOOD_RPC || 'https://rpc.mainnet.chain.robinhood.com';
const LAUNCH_FEE = process.env.PONS_LAUNCH_FEE_ETH || '0.0005';
const MAX_VALUE = parseEther(process.env.PONS_MAX_VALUE_ETH || '0.002');   // never attach more than this to one launch

const chain = defineChain({ id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const P = '(string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, bytes32 expectedEconomics, bytes32 salt)';
const abi = parseAbi([
  `function launchToken(${P} params, uint256 launchConfigId, address pairToken) payable returns (address token, address curve)`,
  `function launchToken(${P} params, uint256 launchConfigId, address pairToken, address[] snipeTaxExemptions) payable returns (address token, address curve)`,
  `function launchAndBuy(${P} params, uint256 launchConfigId, address pairToken, uint256 quoteIn, uint256 minTokensOut, address recipient, address[] snipeTaxExemptions) payable returns (address token, address curve, uint256 tokensOut)`,
  'event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)'
]);
const launchAbi = [abi[0]];
const factoryReads = parseAbi(['function launchFee() view returns (uint256)']);
const curveAbi = parseAbi([
  'function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)',
  'function realQuoteReserve() view returns (uint256)',
  'function graduationThreshold() view returns (uint256)',
  'function graduated() view returns (bool)'
]);
const SUPPLY = 1e9;   // every Pons token has a fixed supply of 1,000,000,000
const tokenLaunched = abi.find(x => x.type === 'event');

const pub = () => createPublicClient({ chain, transport: http(RPC, { timeout: 15000 }) });
function account() {
  let k = (process.env.LAUNCH_PRIVATE_KEY || '').trim().replace(/^['"]+|['"]+$/g, '').trim();   // pasted with quotes is still fine
  if (!k) { const e = new Error('Launch wallet is not configured'); e.code = 'NO_KEY'; throw e; }
  if (!k.startsWith('0x')) k = '0x' + k;
  const bad = why => { const e = new Error('Launch wallet key is not valid: ' + why); e.code = 'BAD_KEY'; return e; };
  if (!/^0x[0-9a-fA-F]+$/.test(k)) throw bad('it is not a hex private key');
  if (k.length !== 66) throw bad('a private key has 64 hex characters, this has ' + (k.length - 2));
  try { return privateKeyToAccount(k); } catch { throw bad('the key was rejected'); }
}
const noFunds = m => /insufficient funds|exceeds the balance|insufficient balance/i.test(String(m));

// Pons does not publish launchConfigId / expectedEconomics, so copy them from the most recent launch on chain.
async function template(force) {
  if (!force) { const c = await redis('GET', 'gf:pons:tpl'); if (c) return JSON.parse(c); }
  const client = pub();
  const tip = await client.getBlockNumber();
  let seen = 0;
  for (let i = 0; i < 12 && seen < 30; i++) {
    const to = tip - BigInt(i) * 9000n, from = to - 8999n > 0n ? to - 8999n : 0n;
    const logs = await client.getLogs({ address: FACTORY, event: tokenLaunched, fromBlock: from, toBlock: to });
    for (const log of logs.reverse()) {
      if (seen++ >= 30) break;
      const tx = await client.getTransaction({ hash: log.transactionHash });
      let d; try { d = decodeFunctionData({ abi, data: tx.input }); } catch { continue; }
      const [p, launchConfigId, pairToken] = d.args;
      const direct = d.functionName === 'launchToken' && (tx.to || '').toLowerCase() === FACTORY;
      const t = {
        launchConfigId: launchConfigId.toString(), pairToken, expectedEconomics: p.expectedEconomics, buybackEnabled: p.buybackEnabled,
        feeWei: (direct && tx.value > 0n ? tx.value : parseEther(LAUNCH_FEE)).toString(),
        from: { tx: log.transactionHash, fn: d.functionName, block: log.blockNumber.toString(), creatorTaxBps: p.creatorTaxBps, logo: p.logo }
      };
      await redis('SET', 'gf:pons:tpl', JSON.stringify(t), 'EX', 600);
      return t;
    }
    if (from === 0n) break;
  }
  throw new Error('No recent Pons launch found to copy settings from');
}

// Creates the token with no opening buy. Simulates first, so a revert costs nothing.
// dry: stop after the simulation, so a check can run the whole path without sending anything.
async function launch({ name, symbol, logo, description, creatorTaxBps }, dry) {
  const acct = account(), client = pub();
  let t;
  try { t = await template(); } catch (e) { if (!e.code) e.code = 'TPL'; throw e; }
  // Prefer the fee the factory reports right now; fall back to the copied one.
  let value = BigInt(t.feeWei);
  try { value = await client.readContract({ address: FACTORY, abi: factoryReads, functionName: 'launchFee' }); } catch {}
  if (value > MAX_VALUE) throw new Error('Launch fee is higher than the configured limit');
  const params = {
    name, symbol, logo, description,
    socials: { twitter: '', telegram: '', discord: '', website: 'https://giphy.fun', farcaster: '' },
    creatorFeeRecipient: acct.address, creatorTaxBps, buybackEnabled: false,
    expectedEconomics: t.expectedEconomics, salt: '0x' + crypto.randomBytes(32).toString('hex')
  };
  const args = [params, BigInt(t.launchConfigId), t.pairToken];
  let sim;
  try { sim = await client.simulateContract({ account: acct, address: FACTORY, abi: launchAbi, functionName: 'launchToken', args, value }); }
  catch (e) {
    const why = String(e.shortMessage || e.message).slice(0, 200);
    if (noFunds(e.message) || noFunds(why)) { const x = new Error('The launch wallet does not have enough ETH'); x.code = 'FUNDS'; throw x; }
    await redis('DEL', 'gf:pons:tpl').catch(() => {});
    const x = new Error('Pons rejected the launch: ' + why); x.code = 'SIM'; throw x;
  }
  if (dry) return { dry: true, feeEth: formatEther(value), from: acct.address };
  const wallet = createWalletClient({ account: acct, chain, transport: http(RPC, { timeout: 15000 }) });
  let hash;
  try { hash = await wallet.writeContract(sim.request); }
  catch (e) {
    const why = String(e.shortMessage || e.message).slice(0, 200);
    const x = new Error(noFunds(e.message) || noFunds(why) ? 'The launch wallet does not have enough ETH' : 'The chain did not accept the transaction: ' + why);
    x.code = noFunds(e.message) || noFunds(why) ? 'FUNDS' : 'SEND'; throw x;
  }
  let token = sim.result[0], curve = sim.result[1], confirmed = false;
  try {
    const r = await client.waitForTransactionReceipt({ hash, timeout: 40000 });
    if (r.status !== 'success') { const x = new Error('The launch transaction failed on chain'); x.code = 'TX'; x.hash = hash; throw x; }
    confirmed = true;
  } catch (e) { if (e.code === 'TX') throw e; }
  return { hash, token, curve, confirmed };
}

async function walletInfo() {
  const acct = account(); const bal = await pub().getBalance({ address: acct.address });
  return { address: acct.address, balanceEth: formatEther(bal) };
}

// Live numbers for each coin, read from its bonding curve. Prices are in ETH.
// Live curve state for each coin. The public RPC refuses large JSON-RPC batches, so reads go out in small batches,
// a few coins at a time, and a coin whose batch failed is read again on its own before giving up.
async function market(coins, report) {
  const batched = createPublicClient({ chain, transport: http(RPC, { timeout: 8000, retryCount: 1, batch: { batchSize: 8, wait: 5 } }) });
  const single = createPublicClient({ chain, transport: http(RPC, { timeout: 8000, retryCount: 1 }) });
  const out = {}; let failed = 0, lastError = '';
  const read = async (client, c) => {
    const call = fn => client.readContract({ address: c.curve, abi: curveAbi, functionName: fn });
    const [res, real, thr, grad] = await Promise.all([call('getReserves'), call('realQuoteReserve'), call('graduationThreshold'), call('graduated')]);
    if (res[1] === 0n) return;
    const priceEth = Number(res[0]) / Number(res[1]);
    out[c.token.toLowerCase()] = { priceEth, mcapEth: priceEth * SUPPLY, prog: thr > 0n ? Math.min(100, Number(real * 10000n / thr) / 100) : 0, grad };
  };
  const list = coins.filter(c => c.curve);
  for (let i = 0; i < list.length; i += 6) {
    await Promise.all(list.slice(i, i + 6).map(async c => {
      try { await read(batched, c); }
      catch { try { await read(single, c); } catch (e) { failed++; lastError = String(e.shortMessage || e.message || e).slice(0, 160); } }
    }));
  }
  if (report) Object.assign(report, { asked: list.length, ok: Object.keys(out).length, failed, lastError });
  return out;
}

module.exports = { market, launch, template, walletInfo, FACTORY, RPC };
