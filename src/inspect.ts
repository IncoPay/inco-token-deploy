/**
 * Inspect a user's IncoAccount raw bytes + Anchor-decoded view.
 * Cross-check that our delegated_amount offset is correct.
 */
import { PublicKey } from "@solana/web3.js";
import {
  loadKeypair,
  makeProvider,
  getIncoAta,
} from "./common";

function readU128LE(buf: Buffer, off: number): bigint {
  let h = 0n;
  for (let i = 15; i >= 0; i--) h = h * 256n + BigInt(buf[off + i]);
  return h;
}

async function main() {
  const issuer = loadKeypair(".keys/issuer.json");
  const user = loadKeypair(".keys/user1.json");
  const { connection, program } = makeProvider(issuer);
  const mint = new PublicKey(process.env.TOKEN_MINT!);
  const ata = getIncoAta(user.publicKey, mint);

  console.log("user ata:", ata.toBase58());
  const info = await connection.getAccountInfo(ata);
  if (!info) {
    console.log("no account data");
    return;
  }
  console.log("raw data length:", info.data.length, "bytes");
  console.log("hex:", info.data.toString("hex"));

  // Anchor-decoded view
  try {
    const acc: any = await (program.account as any).incoAccount.fetch(ata);
    console.log("\nAnchor decoded:");
    console.log(JSON.stringify(acc, (_k, v) => typeof v === "bigint" ? v.toString() : v?._bn?.toString ? v.toString() : v, 2));
  } catch (e) {
    console.log("anchor decode failed:", (e as Error).message);
  }

  // Byte-level parse
  const buf = info.data;
  const amount = readU128LE(buf, 72);
  console.log("\nByte parse:");
  console.log(`  amount @72..88: 0x${amount.toString(16)}`);

  // delegate starts at 88
  const dTag = buf[88];
  console.log(`  delegate tag @88: ${dTag}`);
  let off = 89;
  if (dTag === 1) {
    const d = new PublicKey(buf.slice(89, 121));
    console.log(`  delegate @89..121: ${d.toBase58()}`);
    off = 121;
  }
  const stateTag = buf[off];
  console.log(`  state @${off}: ${stateTag}`);
  off += 1;
  const inTag = buf[off];
  console.log(`  is_native tag @${off}: ${inTag}`);
  off += 1;
  if (inTag === 1) off += 8;
  const delegatedAmount = readU128LE(buf, off);
  console.log(`  delegated_amount @${off}..${off + 16}: 0x${delegatedAmount.toString(16)}`);
  off += 16;
  const caTag = buf[off];
  console.log(`  close_authority tag @${off}: ${caTag}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
