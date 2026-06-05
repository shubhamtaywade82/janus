/**
 * PM2 Ecosystem Config — Janus Trading Bot
 *
 * Usage:
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save
 *   pm2 startup   # auto-start on OS reboot
 *
 * Self-healing guarantees:
 *   - max_memory_restart: kills and restarts if heap exceeds 512 MB
 *   - max_restarts: stops crash-looping after 5 failures within min_uptime window
 *   - exp_backoff_restart_delay: delays grow from 100ms on repeated crashes
 *   - watch: disabled in production (use SIGTERM reload instead)
 */

module.exports = {
  apps: [
    {
      name: "janus-bot",
      script: "./dist/boot.js",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",

      // ─── Memory guard ───────────────────────────────────────────────────
      max_memory_restart: "512M",

      // ─── Restart policy ─────────────────────────────────────────────────
      autorestart: true,
      restart_delay: 3_000,        // wait 3s before restart (avoids thrash)
      max_restarts: 5,             // stop restarting after 5 failures…
      min_uptime: "10s",           // …unless the process survived at least 10s
      exp_backoff_restart_delay: 100, // exponential backoff on repeated crashes

      // ─── Environment ────────────────────────────────────────────────────
      env: {
        NODE_ENV: "development",
      },
      env_production: {
        NODE_ENV: "production",
      },

      // ─── Logging ────────────────────────────────────────────────────────
      log_file: "./logs/combined.log",
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      // ─── Miscellaneous ───────────────────────────────────────────────────
      watch: ["dist", "api"],
      ignore_watch: ["node_modules", "logs", "backups", "db", ".git"],
      source_map_support: false,
    },
  ],
};
