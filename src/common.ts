import * as fs from "fs";
import * as path from "path";
import { config as loadDotenv } from "dotenv";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

loadDotenv({ path: path.resolve(process.cwd(), "../.env") });
loadDotenv({ path: path.resolve(process.cwd(), ".env"), override: true });

export const INCO_TOKEN_PROGRAM_ID = new PublicKey(
  "9Cir3JKBcQ1mzasrQNKWMiGVZvYu3dxvfkGeQ6mohWWi"
);
export const INCO_LIGHTNING_PROGRAM_ID = new PublicKey(
  "5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj"
);

export const RPC_URL =
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

export function loadKeypair(relPath: string): Keypair {
  const candidates = [
    path.resolve(process.cwd(), relPath),
    path.resolve(process.cwd(), "..", relPath),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const secret = JSON.parse(fs.readFileSync(p, "utf-8")) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(secret));
    }
  }
  throw new Error(`keypair not found: ${relPath} (tried ${candidates.join(", ")})`);
}

export function loadIncoTokenIdl(): anchor.Idl {
  const candidates = [
    path.resolve(process.cwd(), "../inco-test/idl/inco_token.json"),
    path.resolve(process.cwd(), "inco-test/idl/inco_token.json"),
    path.resolve(process.cwd(), "idl/inco_token.json"),
    path.resolve(
      process.cwd(),
      "../IncoPay/public/idl/inco_token.json"
    ),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const idl = JSON.parse(fs.readFileSync(p, "utf-8")) as anchor.Idl;
      if (!(idl as any).address)
        (idl as any).address = INCO_TOKEN_PROGRAM_ID.toBase58();
      return idl;
    }
  }
  throw new Error("inco_token.json IDL not found");
}

export function makeProvider(payer: Keypair): {
  connection: Connection;
  provider: anchor.AnchorProvider;
  program: anchor.Program;
} {
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = {
    publicKey: payer.publicKey,
    signTransaction: async (tx: Transaction) => {
      tx.partialSign(payer);
      return tx;
    },
    signAllTransactions: async (txs: Transaction[]) => {
      return txs.map((t) => {
        t.partialSign(payer);
        return t;
      });
    },
  };
  const provider = new anchor.AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const idl = loadIncoTokenIdl();
  const program = new anchor.Program(idl, provider);
  return { connection, provider, program };
}

export function getIncoAta(wallet: PublicKey, mint: PublicKey): PublicKey {
  const [addr] = PublicKey.findProgramAddressSync(
    [wallet.toBuffer(), INCO_TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    INCO_TOKEN_PROGRAM_ID
  );
  return addr;
}

export function getAllowancePda(
  handle: bigint,
  allowedAddress: PublicKey
): PublicKey {
  const buf = Buffer.alloc(16);
  let h = handle;
  for (let i = 0; i < 16; i++) {
    buf[i] = Number(h & BigInt(0xff));
    h >>= BigInt(8);
  }
  const [pda] = PublicKey.findProgramAddressSync(
    [buf, allowedAddress.toBuffer()],
    INCO_LIGHTNING_PROGRAM_ID
  );
  return pda;
}

export function extractAmountHandle(base64Data: string): bigint {
  const buf = Buffer.from(base64Data, "base64");
  const bytes = buf.slice(72, 88);
  let h = 0n;
  for (let i = 15; i >= 0; i--) h = h * 256n + BigInt(bytes[i]);
  return h;
}

/** write or replace a KEY=VAL line in the given .env file */
export function updateEnvFile(envPath: string, key: string, value: string): void {
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
  const line = `${key}=${value}`;
  if (content.match(new RegExp(`^${key}=.*`, "m"))) {
    content = content.replace(new RegExp(`^${key}=.*`, "m"), line);
  } else {
    content = content.trimEnd() + "\n" + line + "\n";
  }
  fs.writeFileSync(envPath, content);
}

export const USER_KEYS: Array<[string, string]> = [
  ["USER1", ".keys/user1.json"],
  ["USER2", ".keys/user2.json"],
  ["USER3", ".keys/user3.json"],
  ["USER4", ".keys/user4.json"],
  ["USER5", ".keys/user5.json"],
];
