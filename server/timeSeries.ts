import config from "./config.ts";
import axios from "axios";
import { metricsRedis } from "./utils/redis.ts";
import { getStats } from "./utils/getStats.ts";

statsTimeSeries();
setInterval(statsTimeSeries, 5 * 60 * 1000);

async function statsTimeSeries() {
  if (metricsRedis.client) {
    console.time("timeSeries");
    try {
      const stats = await getStats();

      const datapoint: AnyDict = {
        time: new Date(),
        currentUsers: stats.counts.currentUsers,

        currentHttp: stats.counts.currentHttp,
        currentScreenShare: stats.counts.currentScreenShare,
        currentFileShare: stats.counts.currentFileShare,
        currentVideoChat: stats.counts.currentVideoChat,
        chatMessages: stats.counts.chatMessages,
        redisUsage: stats.counts.redisUsage,


      };

      await metricsRedis.execute("analytics", "timeSeries", async (c) => {
        await c.lpush("timeSeries", JSON.stringify(datapoint));
        await c.ltrim("timeSeries", 0, 288);
      });
    } catch (e: any) {
      console.warn(`[TIMESERIES] %s when collecting stats`, e.code);
    }
    console.timeEnd("timeSeries");
  }
}
