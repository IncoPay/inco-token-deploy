/**
 * Show SOL + pUSDC balances for all configured accounts.
 * Confidential amounts are shown as their encrypted handle (decrypting requires
 * the user's signMessage — we just display handles here).
 */
import { PublicKey } from "@solana/web3.js";
import * as nacl from "tweetnacl";
import {
  loadKeypair,
  makeProvider,
  getIncoAta,
  USER_KEYS,
} from "./common";

async function main() {
  const issuer = loadKeypair(".keys/issuer.json");
  const { connection, program } = makeProvider(issuer);
  const mintStr = process.env.TOKEN_MINT;
  const mint = mintStr ? new PublicKey(mintStr) : null;

  const targets = [
    { name: "ISSUER", kp: issuer, pubkey: issuer.publicKey },
    {
      name: "RECIPIENT",
      kp: loadKeypair(".keys/recipient.json"),
      pubkey: loadKeypair(".keys/recipient.json").publicKey,
    },
    ...USER_KEYS.map(([name, p]) => {
      const kp = loadKeypair(p);
      return { name, kp, pubkey: kp.publicKey };
    }),
  ];

  const { decrypt } = (await import("@inco/solana-sdk/attested-decrypt")) as any;
  for (const { name, kp, pubkey } of targets) {
    const sol = await connection.getBalance(pubkey);
    let pusdcDesc = "(no mint)";
    if (mint) {
      const ata = getIncoAta(pubkey, mint);
      try {
        const acc: any = await (program.account as any).incoAccount.fetch(ata);
        const handle = BigInt(acc.amount[0].toString());
        try {
          const result = await decrypt([handle.toString(16)], {
            address: pubkey,
            signMessage: async (msg: Uint8Array) =>
              nacl.sign.detached(msg, kp.secretKey),
          });
          const plain = BigInt(result.plaintexts[0]);
          pusdcDesc = `${(Number(plain) / 1e6).toFixed(6)} pUSDC`;
        } catch {
          pusdcDesc = `handle=${handle.toString(16).slice(0, 8)}… (decrypt skipped)`;
        }
      } catch {
        pusdcDesc = "(no ATA)";
      }
    }
    console.log(
      `${name.padEnd(10)} ${pubkey
        .toBase58()
        .padEnd(45)} SOL=${(sol / 1e9).toFixed(4)}  pUSDC=${pusdcDesc}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
