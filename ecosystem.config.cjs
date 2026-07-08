module.exports = {
  apps: [
    {
      name: "aoo-tracker",
      script: "pnpm",
      args: "run dev",
      cwd: "/Users/kr1/aom/aoo-tracker",
      interpreter: "node",
      autorestart: true,
      watch: ["app/**/*", "prisma/**/*", "public/**/*"],
      ignore_watch: [
        "node_modules",
        ".next",
        ".git",
        "*.log",
        "public/assets/**/*",
        "*.sqlite",
        "*.db"
      ],
      watch_delay: 1000,
      watch_options: {
        followSymlinks: false,
        usePolling: true
      },
      env: {
        NODE_ENV: "development",
        PORT: 3001,
      },
    },
  ],
};
