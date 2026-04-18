const path = require("path");

module.exports = {
  apps: [
    {
      name: "soulmate-ai",
      script: "server.ts",
      interpreter: "./node_modules/.bin/tsx",
      interpreter_args: "--env-file=.env.local",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      time: true,
    },
    {
      name: "soulmate-asr",
      script: path.join(__dirname, "asr-service/venv/bin/uvicorn"),
      args: "main:app --host 127.0.0.1 --port 8000 --workers 1",
      cwd: path.join(__dirname, "asr-service"),
      interpreter: "none",
      env: {
        PYTHONUNBUFFERED: "1",
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      max_memory_restart: "1200M",
      time: true,
    },
  ],
};
