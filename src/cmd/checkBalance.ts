import chalk from "chalk";
import {getWallet, getAllTokenBalances, load_alchemy, getEthBalance } from "../utils";
import { Alchemy } from "alchemy-sdk";
import {Wallet} from "ethers"

export async function checkWalletBalances() {
  const wallet:Wallet = await getWallet();
  const alchemy:Alchemy = await load_alchemy();
  const result = await getAllTokenBalances(alchemy, wallet.address);
  return result;
}

export async function getEthBalanceOfWallet() {
  const wallet:Wallet = await getWallet();
  const alchemy:Alchemy = await load_alchemy();
  const balance = await getEthBalance(alchemy, wallet.address);
  return balance;
}
