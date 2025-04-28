import chalk from "chalk";
import { getWallet, getAllTokenBalances, load_alchemy, getEthBalance, transfer } from "../utils";
import { Alchemy } from "alchemy-sdk";
import { Wallet } from "ethers"

export async function transferTokens(tokenAddress: string, toAddress: string, amount: string) {
  const alchemy: Alchemy = await load_alchemy();
  await transfer(alchemy, tokenAddress, toAddress, amount);
}

export async function transferCommand(rl: any): Promise<void> {
  return new Promise(async (resolve) => {
    try {
      const tokenAddress = await new Promise<string>((res) => 
        rl.question("Enter token address (0x... for ERC20, blank for ETH): ", res));
      
      const toAddress = await new Promise<string>((res) => 
        rl.question("Enter recipient address: ", res));
      
      const tokenAmount = await new Promise<string>((res) => 
        rl.question("Enter token amount to transfer: ", res));

      await transferTokens(tokenAddress, toAddress, tokenAmount);
    } catch (error) {
      console.log(chalk.red("Transfer error:", error instanceof Error ? error.message : error));
    } finally {
      resolve(); // This ensures we always continue to handleUserInput
    }
  });
}