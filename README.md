# Token Swap CLI

A command-line interface for managing assets on ethereum mainnet.

## Prerequisites

- Node.js (v18 or higher)
- Yarn or npm
- Alchemy API key
- Ethereum wallet with:
  - ETH for gas fees
  - Tokens you want to swap

## Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-repo/token-swap-cli.git
   cd token-swap-cli
2. **Install dependencies**
   ```bash
   yarn install
3. **Create environment file**
   ```bash
   ALCHEMY_KEY=your_alchemy_api_key_here
   PRIVATE_KEY=your_wallet_private_key_here
Never commit your .env file to version control!

## USage
Run the CLI tool:
```bash
npx ts-node src/index.ts


