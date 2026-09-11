export const apps = [
  // {
  //   name: 'server',
  //   script: './server/server.ts',
  //   log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  //   interpreter: 'node',
  //   env: {
  //     PORT: 80,
  //   },
  // },
  {
    name: "shard1",
    script: "./server/server.ts",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    interpreter: "node",
    interpreter_args: "--import tsx",
    env: {
      SHARD: 1,
      PORT: 3001,
    },
  },
  {
    name: "shard2",
    script: "./server/server.ts",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    interpreter: "node",
    interpreter_args: "--import tsx",
    env: {
      SHARD: 2,
      PORT: 3002,
    },
  },
  // {
  //   name: 'shard3',
  //   script: './server/server.ts',
  //   log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  //    interpreter: 'node',
  //   env: {
  //     SHARD: 3,
  //     PORT: 3003,
  //   },
  // },
  {
    name: "vmWorker",
    script: "./server/vmWorker.ts",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    interpreter: "node",
    interpreter_args: "--import tsx",
    env: {
      HETZNER_GATEWAY: process.env.HETZNER_GATEWAY,
      HETZNER_SSH_KEYS: process.env.HETZNER_SSH_KEYS,
      HETZNER_IMAGE: process.env.HETZNER_IMAGE,
      SCW_GATEWAY: process.env.SCW_GATEWAY,
      SCW_IMAGE: process.env.SCW_IMAGE,
      DO_GATEWAY: process.env.DO_GATEWAY,
      DO_IMAGE: process.env.DO_IMAGE,
      DO_SSH_KEYS: process.env.DO_SSH_KEYS,
    },
  },
  {
    name: "timeSeries",
    script: "./server/timeSeries.ts",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    interpreter: "node",
    interpreter_args: "--import tsx",
  },
  {
    name: "cleanup",
    script: "./server/cleanup.ts",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    interpreter: "node",
    interpreter_args: "--import tsx",
  },
];
