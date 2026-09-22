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
      const isFreePoolFull = (
        await axios.get(
          "http://localhost:" + config.VMWORKER_PORT + "/isFreePoolFull",
        )
      ).data.isFull;
      const datapoint: AnyDict = {
        time: new Date(),
        currentUsers: stats.counts.currentUsers,
        currentVBrowser: stats.counts.currentVBrowser,
        currentVBrowserLarge: stats.counts.currentVBrowserLarge,
        currentHttp: stats.counts.currentHttp,
        currentScreenShare: stats.counts.currentScreenShare,
        currentFileShare: stats.counts.currentFileShare,
        currentVideoChat: stats.counts.currentVideoChat,
        chatMessages: stats.counts.chatMessages,
        redisUsage: stats.counts.redisUsage,
        hetznerApiRemaining: stats.counts.hetznerApiRemaining,
        avgStartMS:
          (stats.vBrowserStartMS || []).map(Number).reduce((a: number, b: number) => a + b, 0) /
          (stats.vBrowserStartMS?.length ?? 1),
        vBrowserStarts: stats.counts.vBrowserStarts,
        vBrowserLaunches: stats.counts.vBrowserLaunches,
        vBrowserFails: stats.counts.vBrowserFails,
        vBrowserStagingFails: stats.counts.vBrowserStagingFails,
        isFreePoolFull: Number(isFreePoolFull),
      };
      Object.keys(stats.vmManagerStats).forEach((key) => {
        if (stats.vmManagerStats[key]) {
          datapoint[key] =
            stats.vmManagerStats[key]?.availableVBrowsers?.length;
        }
      });
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
