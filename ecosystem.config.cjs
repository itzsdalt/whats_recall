module.exports = {
  apps: [{
    name: 'whats-recall',
    script: 'node_modules/.bin/tsx',
    args: 'src/index.ts',
    interpreter: 'node',
    node_args: '--env-file-if-exists=.env',
    env: {
      NODE_ENV: 'production',
      // VERBOSE: 'true',
    },
    restart_delay: 3000,
    max_restarts: 10,
    autorestart: true,
  }],
};
