import chalk from "chalk";
import { getWallet, load_alchemy, getEthBalance } from "../utils";
import { Alchemy } from "alchemy-sdk";
import { Wallet, ethers, AlchemyProvider, parseUnits } from "ethers";

const IUniswapV3RouterABI = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
  "function exactInput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)"
];

// Token addresses
const USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const UNISWAP_V3_ROUTER_ADDRESS = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

// Common fee tiers (in hundredths of a bip, i.e., 1e-6)
const UNISWAP_FEE_TIERS = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%
const SLIPPAGE_TOLERANCE = 0.5; // 0.5%

// Add Uniswap Router interface
interface IUniswapV3Router extends ethers.BaseContract {
  exactInputSingle: ethers.ContractMethod<any[], any>;
  exactInput: ethers.ContractMethod<any[], any>;
}

export async function swapCommand(rl: any): Promise<void> {
  return new Promise(async (resolve) => {
    try {
      console.log(chalk.yellow("\nToken Swap to USDT"));

      const wallet = await getWallet();
      const alchemy = await load_alchemy();

      // Get user inputs
      const tokenAddress = await new Promise<string>((res) => 
        rl.question("Enter token address to swap (0x...): ", res));
      const tokenAmount = await new Promise<string>((res) => 
        rl.question(`Enter amount to swap to USDT: `, res));

      console.log(chalk.yellow(`\nSwapping ${tokenAmount} of token ${tokenAddress} to USDT...`));
      await swapTokenToUSDT(alchemy, wallet, tokenAddress, tokenAmount);

      console.log(chalk.green("\nSwap executed successfully!"));
    } catch (error) {
      console.log(chalk.red("Swap error:", error instanceof Error ? error.message : error));
    } finally {
      resolve();
    }
  });
}

async function findBestFeeTier(
  router: IUniswapV3Router,
  tokenIn: string,
  tokenOut: string
): Promise<number | null> {
  for (const fee of UNISWAP_FEE_TIERS) {
    try {
      await router.exactInputSingle.staticCall({
        tokenIn,
        tokenOut,
        fee,
        recipient: ethers.ZeroAddress,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20,
        amountIn: 1, // Minimal amount for check
        amountOutMinimum: 0,
        sqrtPriceLimitX96: 0,
      });
      return fee;
    } catch {
      continue;
    }
  }
  return null;
}

async function getAmountOutMin(
  router: IUniswapV3Router,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  fee: number
): Promise<bigint> {
  try {
    const amountOut = await router.exactInputSingle.staticCall({
      tokenIn,
      tokenOut,
      fee,
      recipient: ethers.ZeroAddress,
      deadline: Math.floor(Date.now() / 1000) + 60 * 20,
      amountIn,
      amountOutMinimum: 0,
      sqrtPriceLimitX96: 0,
    });
    return BigInt(amountOut) * BigInt(10000 - SLIPPAGE_TOLERANCE * 100) / BigInt(10000);
  } catch (error) {
    throw new Error(`Failed to get quote: ${error instanceof Error ? error.message : error}`);
  }
}

async function swapTokenToUSDT(
  alchemy: Alchemy,
  wallet: Wallet,
  tokenAddress: string,
  amount: string
): Promise<void> {
  try {
    // Setup provider and signer
    const provider = new AlchemyProvider("mainnet", process.env.ALCHEMY_KEY!);
    const signer = new Wallet(process.env.PRIVATE_KEY!, provider);

    // Check ETH balance for gas
    const ethBalance = await getEthBalance(alchemy, wallet.address);
    if (Number(ethBalance) < 0.001) {
      throw new Error("Insufficient ETH for gas. Please add at least 0.001 ETH to your wallet.");
    }

    // Get token metadata and setup contract
    const tokenMetadata = await alchemy.core.getTokenMetadata(tokenAddress);
    if (!tokenMetadata) throw new Error("Could not fetch token metadata");

    const erc20Abi = [
      "function approve(address spender, uint256 amount) external returns (bool)",
      "function balanceOf(address account) external view returns (uint256)",
      "function decimals() external view returns (uint8)"
    ];
    
    const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, signer);
    const tokenDecimals = await tokenContract.decimals();
    const parsedAmount = parseUnits(amount, tokenDecimals);

    // Check token balance
    const tokenBalance = await tokenContract.balanceOf(wallet.address);
    if (tokenBalance < parsedAmount) {
      throw new Error(`Insufficient token balance. You have ${ethers.formatUnits(tokenBalance, tokenDecimals)} tokens.`);
    }

    // Approve Uniswap Router
    console.log(chalk.yellow("Approving Uniswap Router to spend tokens..."));
    const approveTx = await tokenContract.approve(UNISWAP_V3_ROUTER_ADDRESS, parsedAmount);
    await approveTx.wait();
    console.log(chalk.green("Approval confirmed!"));

    // Setup Router and find best path
    const uniswapRouter: IUniswapV3Router = new ethers.Contract(
      UNISWAP_V3_ROUTER_ADDRESS,
      IUniswapV3RouterABI,
      signer
    ) as unknown as IUniswapV3Router;

    const bestDirectFee = await findBestFeeTier(uniswapRouter, tokenAddress, USDT_ADDRESS);
    const bestEthFee = await findBestFeeTier(uniswapRouter, tokenAddress, WETH_ADDRESS);
    const bestUsdtFee = await findBestFeeTier(uniswapRouter, WETH_ADDRESS, USDT_ADDRESS);

    if (!bestDirectFee && (!bestEthFee || !bestUsdtFee)) {
      throw new Error("No available liquidity pools found for this token");
    }

    // Prepare swap parameters
    let swapFunction: "exactInputSingle" | "exactInput";
    let params: any;
    let gasLimit: number;

    if (bestDirectFee) {
      console.log(chalk.yellow(`Found direct pool with ${bestDirectFee/10000}% fee`));
      swapFunction = "exactInputSingle";
      params = {
        tokenIn: tokenAddress,
        tokenOut: USDT_ADDRESS,
        fee: bestDirectFee,
        recipient: wallet.address,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20,
        amountIn: parsedAmount,
        amountOutMinimum: await getAmountOutMin(uniswapRouter, tokenAddress, USDT_ADDRESS, parsedAmount, bestDirectFee),
        sqrtPriceLimitX96: 0,
      };
      gasLimit = 300000;
    } else {
      console.log(chalk.yellow(`Routing through WETH with fees ${bestEthFee!/10000}% and ${bestUsdtFee!/10000}%`));
      swapFunction = "exactInput";
      
      const amountOutMin = await getAmountOutMin(
        uniswapRouter, 
        WETH_ADDRESS, 
        USDT_ADDRESS, 
        await getAmountOutMin(
          uniswapRouter,
          tokenAddress,
          WETH_ADDRESS,
          parsedAmount,
          bestEthFee!
        ),
        bestUsdtFee!
      );

      params = {
        path: ethers.solidityPacked(
          ["address", "uint24", "address", "uint24", "address"],
          [tokenAddress, bestEthFee!, WETH_ADDRESS, bestUsdtFee!, USDT_ADDRESS]
        ),
        recipient: wallet.address,
        deadline: Math.floor(Date.now() / 1000) + 60 * 20,
        amountIn: parsedAmount,
        amountOutMinimum: amountOutMin,
      };
      gasLimit = 500000;
    }

    // Execute swap
    console.log(chalk.yellow("Executing swap..."));
    const swapTx = await uniswapRouter[swapFunction](params, { gasLimit });
    const receipt = await swapTx.wait();
    console.log(chalk.green(`Swap successful! Transaction hash: https://etherscan.io/tx/${receipt.hash}`));

    // Check USDT balance
    const usdtContract = new ethers.Contract(USDT_ADDRESS, erc20Abi, provider);
    const usdtBalance = await usdtContract.balanceOf(wallet.address);
    const usdtDecimals = await usdtContract.decimals();
    console.log(chalk.blue(`New USDT balance: ${ethers.formatUnits(usdtBalance, usdtDecimals)}`));
    
  } catch (error) {
    console.error(chalk.red("Swap failed:", error instanceof Error ? error.message : error));
    throw error;
  }
}