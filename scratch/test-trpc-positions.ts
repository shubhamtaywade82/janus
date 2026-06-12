import { tradingRouter } from "../api/routers/trading-router.ts";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  // Mock context with user ID 1
  const ctx = {
    user: {
      id: 1,
      name: "Local Administrator",
      role: "admin"
    }
  } as any;

  // Call the positions endpoint for paper closed positions
  const caller = tradingRouter.createCaller(ctx);
  
  const paperClosed = await caller.positions({
    status: "closed",
    isPaper: true
  });
  
  console.log("tRPC positions (isPaper: true) count:", paperClosed.length);
  if (paperClosed.length > 0) {
    console.log("Sample Paper:", paperClosed[0]);
  }

  const liveClosed = await caller.positions({
    status: "closed",
    isPaper: false
  });
  console.log("tRPC positions (isPaper: false) count:", liveClosed.length);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
