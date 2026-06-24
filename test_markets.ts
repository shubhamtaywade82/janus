async function main() {
  const res = await fetch("https://api.coindcx.com/exchange/v1/markets_details");
  const data = await res.json();
  const doge = data.find((m: any) => m.pair === "B-DOGE_USDT");
  console.log(doge);
}
main().catch(console.error).finally(() => process.exit(0));
