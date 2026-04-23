/**
 * Airdrop 1000 pUSDC (encrypted) to each of the 5 test users.
 *
 * Per user we:
 *  1. encrypt mintAmount → ciphertext hex
 *  2. simulate mint_to with dummy remainingAccounts → extract new amount handle
 *  3. derive allowance PDA [handle_le16, issuer_pubkey]
 *  4. submit mint_to with real remainingAccounts
 */
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { Keypair } from "@solana/web3.js";
import {
  INCO_LIGHTNING_PROGRAM_ID,
  INCO_TOKEN_PROGRAM_ID,
  loadKeypair,
  makeProvider,
  getIncoAta,
  getAllowancePda,
  extractAmountHandle,
  USER_KEYS,
} from "./common";

async function main() {
  const issuer = loadKeypair(".keys/issuer.json");
  const { connection, program } = makeProvider(issuer);
  const mintStr = process.env.TOKEN_MINT;
  if (!mintStr) throw new Error("TOKEN_MINT not in env — run `npm run deploy` first");
  const mint = new PublicKey(mintStr);

  const { encryptValue } = (await import("@inco/solana-sdk/encryption")) as any;
  const { hexToBuffer } = (await import("@inco/solana-sdk/utils")) as any;
  const mintAmount = 1000n * 10n ** 6n; // 1000 pUSDC @ 6 decimals
  console.log(`mint: ${mint.toBase58()}, airdrop ${mintAmount} base units per user\n`);

  const targets = USER_KEYS.map(([name, p]) => ({
    name,
    pubkey: loadKeypair(p).publicKey,
  }));

  for (const { name, pubkey } of targets) {
    const ata = getIncoAta(pubkey, mint);
    console.log(`→ ${name} ata=${ata.toBase58()}`);
    const ctHex: string = await encryptValue(mintAmount);
    const ctBuf: Buffer = hexToBuffer(ctHex);

    // 1. simulate bare mint_to → extract handle
    const simIx = await program.methods
      .mintTo(ctBuf, 0)
      .accounts({
        mint,
        account: ata,
        mintAuthority: issuer.publicKey,
        incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .instruction();
    const simTx = new Transaction().add(simIx);
    const { blockhash } = await connection.getLatestBlockhash();
    simTx.recentBlockhash = blockhash;
    simTx.feePayer = issuer.publicKey;
    const sim = await connection.simulateTransaction(simTx, undefined, [ata]);
    if (sim.value.err) {
      throw new Error(
        `sim failed for ${name}: ${JSON.stringify(sim.value.err)}`
      );
    }
    const data = sim.value.accounts?.[0]?.data?.[0];
    if (!data) throw new Error(`no sim data for ${name}`);
    const handle = extractAmountHandle(data);
    const allowancePda = getAllowancePda(handle, issuer.publicKey);

    // 2. real mint_to
    const sig = await program.methods
      .mintTo(ctBuf, 0)
      .accounts({
        mint,
        account: ata,
        mintAuthority: issuer.publicKey,
        incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .remainingAccounts([
        { pubkey: allowancePda, isSigner: false, isWritable: true },
        { pubkey: issuer.publicKey, isSigner: false, isWritable: false },
      ])
      .rpc();
    console.log(`  ✓ minted 1000 pUSDC  sig=${sig.slice(0, 8)}…\n`);
  }

  console.log("all airdrops complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
