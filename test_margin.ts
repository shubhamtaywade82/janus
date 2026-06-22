import { db } from "./db/index.ts";
import { tradingAccounts } from "./db/schema.ts";
import { and, eq } from "drizzle-orm";
import Decimal from "decimal.js";

async function main() {
  const account = await db.query.tradingAccounts.findFirst({
    where: and(
      eq(tradingAccounts.userId, 1),
      eq(tradingAccounts.mode, "paper"),
      eq(tradingAccounts.currency, "INR")
    ),
  });
  console.log("account:", account);
  if (account) {
    const requiredMargin = new Decimal("8202.09686418");
    const avail = new Decimal(account.availableBalance);
    console.log("avail:", avail.toNumber());
    console.log("required:", requiredMargin.toNumber());
    console.log("lt?", avail.lt(requiredMargin));
  }
}
main().catch(console.error).finally(() => process.exit(0));
