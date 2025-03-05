module.exports = {
  apps: [
    {
      name: "aoo-tracker",
      script: "pnpm",
      args: "run dev",
      cwd: "/Users/kr1/aob/sauron/aoo-tracker",
      interpreter: "node",
      autorestart: true,
      watch: true,
      ignore_watch: ["node_modules", ".next", ".git"],
      env: {
        NODE_ENV: "development",
        PORT: 3001,
      },
    },
  ],
};
