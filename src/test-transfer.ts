/**
 * Diagnose: approve + transfer as facilitator, with full logs.
 * Expects approve already run via test-approve.ts.
 */
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import {
  INCO_LIGHTNING_PROGRAM_ID,
  loadKeypair,
  makeProvider,
  getIncoAta,
  getAllowancePda,
  extractAmountHandle,
} from "./common";

async function main() {
  const user = loadKeypair(".keys/user1.json");
  const facilitator = loadKeypair(".keys/facilitator.json");
  const recipient = loadKeypair(".keys/recipient.json");
  const { connection, program } = makeProvider(facilitator);
  const mint = new PublicKey(process.env.TOKEN_MINT!);
  const sourceAta = getIncoAta(user.publicKey, mint);
  const destAta = getIncoAta(recipient.publicKey, mint);

  const { encryptValue } = (await import("@inco/solana-sdk/encryption")) as any;
  const { hexToBuffer } = (await import("@inco/solana-sdk/utils")) as any;
  const xfer = 1n * 10n ** 6n; // 1 pUSDC
  const ct: Buffer = hexToBuffer(await encryptValue(xfer));

  console.log("1. simulate bare transfer (no remaining_accounts)");
  const bareIx = await program.methods
    .transfer(ct, 0)
    .accounts({
      source: sourceAta,
      destination: destAta,
      authority: facilitator.publicKey,
      incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as any)
    .instruction();
  const tx = new Transaction().add(bareIx);
  tx.feePayer = facilitator.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.partialSign(facilitator);
  const sim = await connection.simulateTransaction(tx, undefined, [
    sourceAta,
    destAta,
  ]);
  console.log("   err:", sim.value.err);
  console.log("   logs:");
  for (const l of sim.value.logs || []) console.log("     " + l);
  if (sim.value.err) return;

  const sData = sim.value.accounts?.[0]?.data?.[0];
  const dData = sim.value.accounts?.[1]?.data?.[0];
  if (!sData || !dData) {
    console.log("   no account data");
    return;
  }
  const srcHandle = extractAmountHandle(sData);
  const dstHandle = extractAmountHandle(dData);
  console.log(`   new srcHandle=0x${srcHandle.toString(16)}`);
  console.log(`   new dstHandle=0x${dstHandle.toString(16)}`);
  const srcAllow = getAllowancePda(srcHandle, user.publicKey);
  const dstAllow = getAllowancePda(dstHandle, recipient.publicKey);
  console.log(`   srcAllow: ${srcAllow.toBase58()}`);
  console.log(`   dstAllow: ${dstAllow.toBase58()}`);

  console.log("\n2. real transfer with remaining_accounts");
  try {
    const sig = await program.methods
      .transfer(ct, 0)
      .accounts({
        source: sourceAta,
        destination: destAta,
        authority: facilitator.publicKey,
        incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .remainingAccounts([
        { pubkey: srcAllow, isSigner: false, isWritable: true },
        { pubkey: user.publicKey, isSigner: false, isWritable: false },
        { pubkey: dstAllow, isSigner: false, isWritable: true },
        { pubkey: recipient.publicKey, isSigner: false, isWritable: false },
      ])
      .rpc();
    console.log(`   ✓ sig: ${sig}`);
  } catch (e) {
    console.log(`   ✗ ${(e as Error).message}`);
    if ((e as any).logs) {
      console.log(`   logs:`);
      for (const l of (e as any).logs.slice(0, 30)) console.log("     " + l);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
