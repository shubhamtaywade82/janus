import postgres from 'postgres';
const sql = postgres('postgres://janus:change_me_strong_password@127.0.0.1:5436/janus_production');

async function main() {
  const deleted = await sql`
    delete from positions 
    where id = 559 
    returning id;
  `;
  console.log("Deleted open paper position ID:", deleted);
  process.exit(0);
}

main().catch(console.error);
