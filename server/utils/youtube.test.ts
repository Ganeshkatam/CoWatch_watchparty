import { mapYoutubeResult } from "./youtube.ts";
import type { YoutubeResult } from "../index.d.ts";

async function runTests() {
  console.log("Running youtube defensive mapping tests...");

  // Test 1: Complete YoutubeResult mapping
  const fullItem: YoutubeResult = {
    id: "dQw4w9WgXcQ",
    snippet: {
      title: "Never Gonna Give You Up",
      channelTitle: "Rick Astley",
      thumbnails: {
        high: { url: "https://example.com/high.jpg" },
        medium: { url: "https://example.com/medium.jpg" },
        standard: { url: "https://example.com/standard.jpg" },
        default: { url: "https://example.com/default.jpg" },
      },
    },
  };

  const res1 = mapYoutubeResult(fullItem);
  if (res1.url !== "https://www.youtube.com/watch?v=dQw4w9WgXcQ") {
    throw new Error(`Expected canonical watch URL, got ${res1.url}`);
  }
  if (res1.name !== "Never Gonna Give You Up") {
    throw new Error(`Expected video title, got ${res1.name}`);
  }
  if (res1.channel !== "Rick Astley") {
    throw new Error(`Expected channel name, got ${res1.channel}`);
  }
  if (res1.img !== "https://example.com/high.jpg") {
    throw new Error(`Expected high quality thumbnail first, got ${res1.img}`);
  }

  // Test 2: Thumbnail fallback high absent -> picks medium
  const itemMedium: YoutubeResult = {
    id: "abc12345",
    snippet: {
      title: "Medium Video",
      thumbnails: {
        medium: { url: "https://example.com/medium.jpg" },
        standard: { url: "https://example.com/standard.jpg" },
        default: { url: "https://example.com/default.jpg" },
      },
    },
  };
  const resMedium = mapYoutubeResult(itemMedium);
  if (resMedium.img !== "https://example.com/medium.jpg") {
    throw new Error(`Expected medium thumbnail fallback, got ${resMedium.img}`);
  }

  // Test 3: Thumbnail fallback medium absent -> picks standard
  const itemStandard: YoutubeResult = {
    id: "abc12345",
    snippet: {
      title: "Standard Video",
      thumbnails: {
        standard: { url: "https://example.com/standard.jpg" },
        default: { url: "https://example.com/default.jpg" },
      },
    },
  };
  const resStandard = mapYoutubeResult(itemStandard);
  if (resStandard.img !== "https://example.com/standard.jpg") {
    throw new Error(`Expected standard thumbnail fallback, got ${resStandard.img}`);
  }

  // Test 4: Thumbnail fallback when only default exists
  const itemDefaultOnly: YoutubeResult = {
    id: "abc12345",
    snippet: {
      title: "Default Only Video",
      thumbnails: {
        default: { url: "https://example.com/default.jpg" },
      },
    },
  };
  const resDefault = mapYoutubeResult(itemDefaultOnly);
  if (resDefault.img !== "https://example.com/default.jpg") {
    throw new Error(`Expected default thumbnail fallback, got ${resDefault.img}`);
  }

  // Test 5: Thumbnail fallback when no thumbnail exists
  const itemNoThumb: YoutubeResult = {
    id: "abc12345",
    snippet: {
      title: "No Thumb Video",
    },
  };
  const resNoThumb = mapYoutubeResult(itemNoThumb);
  if (resNoThumb.img !== "") {
    throw new Error(`Expected empty string when no thumbnails exist, got ${resNoThumb.img}`);
  }

  // Test 6: Missing snippet, missing title, missing channel, missing id
  const emptyItem: YoutubeResult = {};
  const resEmpty = mapYoutubeResult(emptyItem);
  if (resEmpty.name !== "YouTube Video") {
    throw new Error(`Expected deterministic fallback title, got ${resEmpty.name}`);
  }
  if (resEmpty.channel !== "YouTube") {
    throw new Error(`Expected fallback channel 'YouTube', got ${resEmpty.channel}`);
  }
  if (resEmpty.url !== "") {
    throw new Error(`Expected empty URL when no videoId, got ${resEmpty.url}`);
  }

  // Test 7: Passing custom videoId override
  const resCustomId = mapYoutubeResult(emptyItem, "customId123");
  if (resCustomId.url !== "https://www.youtube.com/watch?v=customId123") {
    throw new Error(`Expected watch url with custom videoId, got ${resCustomId.url}`);
  }
  if (resCustomId.name !== "customId123") {
    throw new Error(`Expected fallback to videoId if title missing, got ${resCustomId.name}`);
  }

  // Test 8: ID object variation ({ videoId: 'xyz' })
  const searchItem: YoutubeResult = {
    id: { videoId: "searchResultId" },
    snippet: { title: "Search Result" },
  };
  const resSearch = mapYoutubeResult(searchItem);
  if (resSearch.url !== "https://www.youtube.com/watch?v=searchResultId") {
    throw new Error(`Expected watch URL from object id, got ${resSearch.url}`);
  }

  console.log("All youtube defensive mapping tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
