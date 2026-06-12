import postgres from 'postgres';
const sql = postgres('postgres://janus:change_me_strong_password@127.0.0.1:5436/janus_production');

async function main() {
  const closedLive = await sql`
    select id, symbol, status, side, entry_price, current_price, size, margin, realized_pnl, exit_reason 
    from positions 
    where status != 'open' and is_paper = false 
    order by id desc 
    limit 5
  `;
  console.log("Closed Live Positions in DB:", JSON.stringify(closedLive, null, 2));
  process.exit(0);
}

main().catch(console.error);
