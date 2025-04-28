import { Network, Alchemy, TokenBalancesOptionsErc20, TokenBalancesResponseErc20, TokenBalanceType } from "alchemy-sdk";
import { ethers, Wallet, formatEther, AlchemyProvider, ZeroAddress, Contract, parseEther, parseUnits } from "ethers"
import axios from "axios";

import * as dotenv from 'dotenv';
dotenv.config();
const STABLECOINS: Record<string, boolean> = {
  // Mainnet
  '0xdac17f958d2ee523a2206206994597c13d831ec7': true, // USDT
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': true, // USDC
  '0x6b175474e89094c44da98b954eedeac495271d0f': true, // DAI
  '0x4fabb145d64652a948d72533023f6e7a623c7c53': true, // BUSD
};
function isStablecoin(tokenAddress: string): boolean {
  return STABLECOINS[tokenAddress.toLowerCase()] || false;
}
export async function getAllTokenBalances(
  alchemy: Alchemy,
  address: string
): Promise<Array<{
  contractAddress: string;
  name: string;
  symbol: string;
  tokenBalance: string;
  usd?: string;
}>> {
  let allBalances: TokenBalancesResponseErc20['tokenBalances'] = [];
  let pageKey: string | undefined = undefined;

  do {
    const options: TokenBalancesOptionsErc20 = {
      type: TokenBalanceType.ERC20,
      pageKey: pageKey
    };

    const response = await alchemy.core.getTokenBalances(address, options);
    allBalances = allBalances.concat(response.tokenBalances);
    pageKey = response.pageKey;
  } while (pageKey);

  const processedBalances = await Promise.all(
    allBalances.map(async (balance) => {
      const decimalBalance = balance.tokenBalance !== '0x'
        ? BigInt(String(balance.tokenBalance)).toString()
        : '0';

      if (decimalBalance === '0') {
        return {
          contractAddress: balance.contractAddress,
          name: 'Unknown',
          symbol: 'UNKNOWN',
          tokenBalance: '0',
          usd: '0'
        };
      }

      try {
        const metadata = await alchemy.core.getTokenMetadata(balance.contractAddress);
        const decimals = metadata.decimals || 18;
        const normalizedBalance = Number(BigInt(decimalBalance)) / 10 ** decimals;
        const usdPrice = await getTokenPrice(balance.contractAddress, normalizedBalance.toString());

        return {
          contractAddress: balance.contractAddress,
          name: metadata.name || 'Unknown',
          symbol: metadata.symbol || 'UNKNOWN',
          tokenBalance: normalizedBalance.toFixed(3),
          usd: usdPrice
        };
      } catch (error) {
        console.error(`Failed to process ${balance.contractAddress}:`, error);
        return {
          contractAddress: balance.contractAddress,
          name: 'Unknown',
          symbol: 'UNKNOWN',
          tokenBalance: decimalBalance,
          usd: '0'
        };
      }
    })
  );

  return processedBalances.filter(b => b.tokenBalance !== '0' && b.usd !== '0');
}

async function getTokenPrice(contractAddress: string, amount: string): Promise<string> {
  const price = await getRecentPrice(contractAddress) || 0;
  return (parseFloat(amount) * price).toString();
}

const getRecentPrice = async (address: string) => {
  if (isStablecoin(address)) return 1;
  const tokenAddress = address; // Replace with your token address
  const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
  try {
    const response = await axios.get(url);
    // if(tokenAddress === "0x129e5915326ed86f831b0e035acda34b209633d5") console.log(response.data.pairs);
    const priceUsd = response.data.pairs.filter((item: any) => item.chainId === 'ethereum')[0].priceUsd;
    return priceUsd;
  } catch (error) {
    return 0;
  }
};

export async function getWallet(): Promise<Wallet> {
  const privateKey = process.env.PRIVATE_KEY!;
  const wallet = new Wallet(privateKey);
  return wallet;
}

export async function load_alchemy() {
  const config = {
    apiKey: process.env.ALCHEMY_KEY!,
    network: Network.ETH_MAINNET,
  };
  const alchemy = new Alchemy(config);
  return alchemy;
}

export async function getEthBalance(alchemy: Alchemy, address: string) {
  const balance = await alchemy.core.getBalance(address);
  // Convert from wei to ETH
  const ethBalance = formatEther(String(balance));
  return ethBalance;
}

const ERC20_ABI = [
  "function transfer(address to, uint amount) returns (bool)",
  "function decimals() view returns (uint8)"
];

export async function transfer(alchemy: Alchemy, tokenAddress: string, toAddress: string, amount: string): Promise<void> {
  try {
    // 1. Initialize wallet
    const privateKey = process.env.PRIVATE_KEY!;
    const provider = new AlchemyProvider('mainnet', process.env.ALCHEMY_KEY!);
    const wallet = new Wallet(privateKey, provider);
    // 3. Check ETH balance for gas
    const ethBalance = await getEthBalance(alchemy, wallet.address);
    if (Number(ethBalance) < 0.0001) {
      console.log(`Insufficient ETH balance for gas. Please add some ETH to your wallet.`);
      return;
    }
    // 4. Token transfer or ETH transfer?
    if (tokenAddress === ZeroAddress) {
      // ETH Transfer
      console.log(`Sending ${amount} ETH...`);
      const tx = await wallet.sendTransaction({
        to: toAddress,
        value: parseEther(amount)
      });
      console.log(`ETH sent! TX hash: https://etherscan.io/tx/${tx.hash}`);
    } else {
      // ERC-20 Transfer
      const contract = new Contract(tokenAddress, ERC20_ABI, wallet);
      const decimals = await contract.decimals();
      const parsedAmount = parseUnits(amount, decimals);
      console.log(`Sending ${amount} tokens...`);
      const tx = await contract.transfer(toAddress, parsedAmount);
      console.log(`Tokens sent! TX hash: https://etherscan.io/tx/${tx.hash}`);
    }
  } catch (error) {
    throw error; // Re-throw to be caught in transferCommand
  }
}
