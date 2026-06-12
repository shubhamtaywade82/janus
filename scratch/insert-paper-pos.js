import postgres from 'postgres';
const sql = postgres('postgres://janus:change_me_strong_password@127.0.0.1:5436/janus_production');

async function main() {
  const [inserted] = await sql`
    insert into positions (
      user_id, symbol, side, entry_price, current_price, size, leverage, margin, status, is_paper, created_at, updated_at
    ) values (
      1, 'BTCUSDT', 'long', '60000.00', '60100.00', '0.1', 10, '600.00', 'open', true, now(), now()
    ) returning id;
  `;
  console.log("Inserted open paper position ID:", inserted.id);
  process.exit(0);
}

main().catch(console.error);
