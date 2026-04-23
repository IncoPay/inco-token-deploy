/**
 * Deploy a priv-USDC IncoMint on Solana devnet.
 *
 * Steps:
 *  1. Create new IncoMint (initialize_mint, 6 decimals)
 *  2. create_idempotent ATAs for each of the 5 test users
 *  3. Write TOKEN_MINT to ../.env
 *
 * Airdrop (minting 1000 pUSDC) happens in a separate step: `npm run airdrop`.
 */
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as path from "path";
import {
  INCO_LIGHTNING_PROGRAM_ID,
  loadKeypair,
  makeProvider,
  getIncoAta,
  updateEnvFile,
  USER_KEYS,
} from "./common";

async function main() {
  const issuer = loadKeypair(".keys/issuer.json");
  const { connection, program } = makeProvider(issuer);
  const balance = await connection.getBalance(issuer.publicKey);
  console.log(`issuer: ${issuer.publicKey.toBase58()}  SOL: ${balance / 1e9}`);
  if (balance < 0.05 * 1e9) {
    throw new Error("issuer needs at least 0.05 SOL to deploy. Airdrop first.");
  }

  // 1. new mint
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;
  const decimals = 6;

  console.log("1. initialize_mint ...");
  const initSig = await program.methods
    .initializeMint(decimals, issuer.publicKey, issuer.publicKey)
    .accounts({
      mint,
      payer: issuer.publicKey,
      systemProgram: SystemProgram.programId,
      incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
    } as any)
    .signers([mintKp])
    .rpc();
  console.log(`   sig: ${initSig}`);
  console.log(`   mint: ${mint.toBase58()}`);

  // 2. ATAs
  console.log("2. create_idempotent ATAs for 5 users + recipient");
  const recipient = loadKeypair(".keys/recipient.json").publicKey;
  const allTargets: Array<{ name: string; pubkey: PublicKey }> = [
    ...USER_KEYS.map(([name, p]) => ({
      name,
      pubkey: loadKeypair(p).publicKey,
    })),
    { name: "RECIPIENT", pubkey: recipient },
    { name: "ISSUER", pubkey: issuer.publicKey },
  ];
  for (const { name, pubkey } of allTargets) {
    const ata = getIncoAta(pubkey, mint);
    const sig = await program.methods
      .createIdempotent()
      .accounts({
        payer: issuer.publicKey,
        associatedToken: ata,
        wallet: pubkey,
        mint,
        systemProgram: SystemProgram.programId,
        incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
      } as any)
      .rpc();
    console.log(`   ${name}: ${ata.toBase58()}  (sig ${sig.slice(0, 8)}…)`);
  }

  // 3. write env
  const envPath = path.resolve(process.cwd(), "../.env");
  updateEnvFile(envPath, "TOKEN_MINT", mint.toBase58());
  console.log(`\n✅ deployed. wrote TOKEN_MINT=${mint.toBase58()} to ${envPath}`);
  console.log(`next:  npm run airdrop  (to mint 1000 pUSDC to each user)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
