import { fetchPortfolioData } from "../api/routers/trading-router.ts";
import * as dotenv from "dotenv";

dotenv.config();

async function test() {
  console.log("Calling fetchPortfolioData(1)...");
  try {
    const data = await fetchPortfolioData(1);
    console.log("Returned Data:", JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error("Error in fetchPortfolioData:", err);
  }
}

test().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
