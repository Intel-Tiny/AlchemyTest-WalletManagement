import chalk from "chalk";
import * as readline from "readline";
import { checkWalletBalances, getEthBalanceOfWallet } from "./cmd/checkBalance";
import { transferCommand } from "./cmd/transfer";
import { swapCommand } from "./cmd/swap";
import { getWallet } from "./utils";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function displayMenu() {
  console.log(`
    1. Check Wallet's Tokens
    2. Token Transfer
    3. Token Swap
    4. Exit
    `);
}

async function handleUserInput() {
  displayMenu();

  rl.question("             Enter your choice (1-4): ", async (choice) => {
    try {
      switch (choice) {
        case '1':
          console.log(chalk.yellow("Checking Wallet's Tokens..."));
          const result = await checkWalletBalances();                                       
          console.log(chalk.green(JSON.stringify(result, null, 2)));
          break;
        case '2':
          console.log(chalk.yellow("Token Transfer..."));
          await transferCommand(rl);
          break;
        case '3':
          console.log(chalk.yellow("Token Swap..."));
          await swapCommand(rl);
          break;
        case '4':
          console.log(chalk.green("Goodbye!\n4/28/2025, v2.0.0"));
          rl.close();
          process.exit(0);
        default:
          console.log(chalk.red("Invalid choice"));
      }
    } catch (error) {
      console.log(chalk.red("Error occurred:", error));
    }

    handleUserInput(); // Continue with next command
  });
}

async function main() {
  console.log(
    chalk.green(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║                   Welcome to Asset Manager                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
    `)
  );

  const walletAddress = (await getWallet()).address;
  console.log(chalk.green(`Wallet Address: ${walletAddress}`));
  const ethBalance = await getEthBalanceOfWallet();
  console.log(chalk.green(`Balance: ${ethBalance} ETH` ))
  handleUserInput();
}

main();
