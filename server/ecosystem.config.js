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
