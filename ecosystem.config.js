export const apps = [
  {
    name: 'wa-webhook',
    script: 'app.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    node_args: '--max-old-space-size=512',
    env: {
      NODE_ENV: 'production',
      PORT: 8181
    },
    env_development: {
      NODE_ENV: 'development',
      PORT: 8181
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    merge_logs: true
  }
];
