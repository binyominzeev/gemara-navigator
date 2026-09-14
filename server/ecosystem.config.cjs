module.exports = {
  apps: [{
    name: 'gemara-navigator-api',
    script: 'src/index.js',
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
      PORT: 4000
    },
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '128M',
    time: true
  }]
};
