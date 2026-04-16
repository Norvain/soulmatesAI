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
  ],
};
