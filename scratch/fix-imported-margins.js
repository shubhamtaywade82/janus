import postgres from 'postgres';
const sql = postgres('postgres://janus:change_me_strong_password@127.0.0.1:5436/janus_production');

async function main() {
  // Select all closed positions with 0 margin
  const rows = await sql`
    select id, symbol, side, entry_price, size, leverage, margin 
    from positions 
    where margin = '0.00000000'
  `;
  console.log(`Found ${rows.length} rows to fix.`);

  let updatedCount = 0;
  for (const r of rows) {
    const entryPrice = parseFloat(r.entry_price);
    const size = parseFloat(r.size);
    const leverage = r.leverage || 1;
    if (entryPrice > 0 && size > 0) {
      const calculatedMargin = (size * entryPrice) / leverage;
      await sql`
        update positions 
        set margin = ${calculatedMargin.toFixed(8)} 
        where id = ${r.id}
      `;
      updatedCount++;
    }
  }

  console.log(`Successfully updated margin for ${updatedCount} positions.`);
  process.exit(0);
}

main().catch(console.error);
