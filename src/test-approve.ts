/**
 * Test: approve (via Anchor) user1 → facilitator for cap=5 pUSDC.
 * Mirrors the proven setup-inco-token.ts pattern.
 */
import { PublicKey, SystemProgram, Transaction, Keypair } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import {
  INCO_LIGHTNING_PROGRAM_ID,
  loadKeypair,
  makeProvider,
  getIncoAta,
  getAllowancePda,
} from "./common";

function parseIncoAccount(buf: Buffer) {
  const readU128 = (off: number) => {
    let h = 0n;
    for (let i = 15; i >= 0; i--) h = h * 256n + BigInt(buf[off + i]);
    return h;
  };
  const amount = readU128(72);
  let off = 88;
  const dTag = buf[off];
  off += 1;
  if (dTag === 1) off += 32;
  off += 1; // state
  const iTag = buf[off];
  off += 1;
  if (iTag === 1) off += 8;
  const delegatedAmount = readU128(off);
  return { amount, delegatedAmount, delegateTag: dTag };
}

async function main() {
  const user = loadKeypair(".keys/user1.json");
  const facilitator = loadKeypair(".keys/facilitator.json");
  // User has 0 SOL; facilitator pays fees. Use facilitator as the provider wallet.
  const { connection, program, provider } = makeProvider(facilitator);
  const mint = new PublicKey(process.env.TOKEN_MINT!);
  const sourceAta = getIncoAta(user.publicKey, mint);

  const { encryptValue } = (await import("@inco/solana-sdk/encryption")) as any;
  const { hexToBuffer } = (await import("@inco/solana-sdk/utils")) as any;
  const capBaseUnits = 5n * 10n ** 6n;
  const ctHex: string = await encryptValue(capBaseUnits);
  const ctBuf: Buffer = hexToBuffer(ctHex);

  console.log("1. simulate approve_checked WITHOUT remaining_accounts");
  const simIx = await program.methods
    .approveChecked(ctBuf, 0, 6)
    .accounts({
      source: sourceAta,
      mint,
      delegate: facilitator.publicKey,
      owner: user.publicKey,
      incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as any)
    .instruction();
  const simTx = new Transaction().add(simIx);
  simTx.feePayer = facilitator.publicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  simTx.recentBlockhash = blockhash;
  simTx.partialSign(facilitator); // user didn't sign — see if simulate needs user signature

  // Actually user must sign as `owner: signer`. For simulate we disable verification.
  const sim = await connection.simulateTransaction(simTx, undefined, [sourceAta]);
  console.log("   err:", sim.value.err);
  console.log("   logs:", (sim.value.logs || []).slice(0, 10).join("\n     "));
  if (sim.value.err) {
    console.log("simulate failed — abort");
    return;
  }
  const data = sim.value.accounts?.[0]?.data?.[0];
  if (!data) {
    console.log("no sim data");
    return;
  }
  const view = parseIncoAccount(Buffer.from(data, "base64"));
  console.log(`   amount=0x${view.amount.toString(16)}`);
  console.log(`   delegatedAmount=0x${view.delegatedAmount.toString(16)}`);
  console.log(`   delegateTag=${view.delegateTag}`);
  const allowancePda = getAllowancePda(view.delegatedAmount, facilitator.publicKey);
  console.log(`   allowance PDA: ${allowancePda.toBase58()}`);

  console.log("\n2. real approve_checked WITH remaining_accounts");
  // User must sign. We'll use Anchor's .signers() to add user.
  try {
    const sig = await program.methods
      .approveChecked(ctBuf, 0, 6)
      .accounts({
        source: sourceAta,
        mint,
        delegate: facilitator.publicKey,
        owner: user.publicKey,
        incoLightningProgram: INCO_LIGHTNING_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .remainingAccounts([
        { pubkey: allowancePda, isSigner: false, isWritable: true },
        { pubkey: facilitator.publicKey, isSigner: false, isWritable: false },
      ])
      .signers([user])
      .rpc();
    console.log(`   ✓ sig: ${sig}`);
  } catch (e) {
    console.log(`   ✗ ${(e as Error).message}`);
    if ((e as any).logs) {
      console.log(`   logs:\n     ${(e as any).logs.slice(0, 20).join("\n     ")}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
