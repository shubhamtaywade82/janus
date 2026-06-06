import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'path';

// Load env variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const dbUrl = process.env.DATABASE_URL || '';

console.log('Database URL from env:', dbUrl);

async function main() {
  const sql = dbUrl.includes("run/postgresql")
    ? postgres({
        host: "/var/run/postgresql",
        database: "janus_development",
        username: "nemesis",
      })
    : postgres(dbUrl);

  // 1. Fetch paper trading account for user 1
  const accounts = await sql`
    SELECT id, wallet_balance, available_balance, locked_margin, equity
    FROM trading_accounts
    WHERE user_id = 1 AND mode = 'paper'
    LIMIT 1
  `;

  if (accounts.length === 0) {
    console.log("No paper trading account found.");
    await sql.end();
    return;
  }

  const account = accounts[0];
  console.log("Current account state:", account);

  // 2. Fetch any open paper positions
  const openPositions = await sql`
    SELECT id FROM positions
    WHERE user_id = 1 AND is_paper = true AND status = 'open'
  `;

  console.log(`Found ${openPositions.length} open paper positions.`);

  if (openPositions.length === 0) {
    console.log("No open paper positions. Fixing lockedMargin desync...");
    const walletBalanceVal = parseFloat(account.wallet_balance);

    await sql`
      UPDATE trading_accounts
      SET
        locked_margin = 0,
        used_margin = 0,
        available_balance = ${walletBalanceVal},
        free_margin = ${walletBalanceVal},
        equity = ${walletBalanceVal},
        updated_at = NOW()
      WHERE id = ${account.id}
    `;

    console.log("Successfully set locked_margin to 0 and synchronized balances.");
  } else {
    console.log("Abort: open paper positions exist in the database.");
  }

  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to run margin fix script:", err);
    process.exit(1);
  });
