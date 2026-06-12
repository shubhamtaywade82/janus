import postgres from "postgres";

const queryClient = postgres({
  host: "/var/run/postgresql",
  database: "janus_development",
  username: "nemesis",
});

async function main() {
  const res1 = await queryClient`SELECT is_paper, status, count(*) FROM positions GROUP BY is_paper, status`;
  console.log("Raw SQL:", res1);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
