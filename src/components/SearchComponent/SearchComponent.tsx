import React from "react";
import {
  debounce,
  getYouTubeResults,
  getStreamPathResults,
} from "../../utils/utils";
import { Loader, Select } from "@mantine/core";
import {
  YouTubeSearchResult,
  StreamPathSearchResult,
} from "../SearchResult/SearchResult";
import { MetadataContext } from "../../MetadataContext";
import { IconBrandYoutubeFilled, IconMovie } from "@tabler/icons-react";
import { USER_MESSAGES, sanitizeServerErrorMessage } from "../../utils/userMessages";
import { showUserMessage } from "../../utils/toast";

interface SearchComponentProps {
  setMedia: (value: string) => void;
  playlistAdd: (value: string) => void;
  type?: "youtube" | "media" | "stream";
  setShowMultiSelect: (show: boolean) => void;
  setFileSelection: (multi: []) => void;
  disabled?: boolean;
}

export class SearchComponent extends React.Component<SearchComponentProps> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;
  state = {
    results: [] as SearchResult[],
    loading: false,
    lastResultTimestamp: Date.now(),
    inputMedia: undefined,
  };

  doSearch = async (value?: string) => {
    this.setState({ inputMedia: value || "" });
    this.setState({ loading: true });
    let query = value || "";
    let results: SearchResult[] = [];
    let timestamp = Date.now();
    if (this.props.type === "youtube") {
      results = await getYouTubeResults(query);
    } else if (this.props.type === "stream" && this.context.streamPath) {
      results = await getStreamPathResults(this.context.streamPath, query);
    }
    if (timestamp > this.state.lastResultTimestamp) {
      this.setState({
        loading: false,
        results,
        lastResultTimestamp: timestamp,
      });
    }
  };

  onSelectItem = async (result: SearchResult) => {
    try {
      if (!this.context.streamPath || !result.magnet) {
        showUserMessage({ ...USER_MESSAGES.GENERIC_ACTION_FAILED, message: "Invalid stream or torrent source." });
        return;
      }
      this.props.setShowMultiSelect(true);
      const response = await fetch(
        this.context.streamPath +
          "/data?torrent=" +
          encodeURIComponent(result.magnet),
      );
      if (!response.ok) {
        throw new Error("Failed to fetch torrent information.");
      }
      const metadata = (await response.json()) as { files?: Array<{ name: string; length: number; [key: string]: unknown }> };
      if (!metadata || !Array.isArray(metadata.files)) {
        throw new Error("Torrent contains no playable files.");
      }
      const multiStreamSelection = metadata.files.map((file, i: number) => ({
        ...file,
        url:
          this.context.streamPath +
          "/stream?torrent=" +
          encodeURIComponent(result.magnet!) +
          "&fileIndex=" +
          i,
      }));
      this.props.setFileSelection(multiStreamSelection as []);
    } catch (err: unknown) {
      console.error("Torrent metadata fetch failed:", err);
      this.props.setShowMultiSelect(false);
      const raw = err instanceof Error ? err.message : "Failed to load torrent metadata.";
      const sanitized = sanitizeServerErrorMessage(raw);
      showUserMessage({ ...USER_MESSAGES.GENERIC_ACTION_FAILED, message: sanitized });
    }
  };

  render() {
    let placeholder = "Search or enter magnet";
    let icon = <IconMovie />;
    if (this.props.type === "youtube") {
      placeholder = "Search YouTube";
      icon = <IconBrandYoutubeFilled />;
    }
    const renderOption = ({
      option,
    }: {
      option: { value: string; label: string };
    }) => {
      const result = this.state.results.find((r) => r.url === option.value);
      if (!result) {
        return <div>{option.label}</div>;
      }
      if (this.props.type === "youtube") {
        return (
          <YouTubeSearchResult
            key={result.url}
            {...result}
            setMedia={this.props.setMedia}
            playlistAdd={this.props.playlistAdd}
          />
        );
      }
      return (
        <StreamPathSearchResult
          key={result.url}
          onSelectItem={this.onSelectItem}
          {...result}
        />
      );
    };
    return (
      <Select
        maxDropdownHeight={400}
        searchable
        leftSection={this.state.loading ? <Loader size="sm" /> : icon}
        placeholder={placeholder}
        onSearchChange={debounce(this.doSearch, 500)}
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") {
            this.onSelectItem({
              magnet: this.state.inputMedia,
              type: "magnet",
              url: "",
              name: "",
              duration: 0,
            });
          }
        }}
        value={this.state.inputMedia}
        onFocus={() => this.doSearch()}
        disabled={this.props.disabled}
        data={this.state.results.map((r) => r.url)}
        renderOption={renderOption}
        comboboxProps={{ width: 400, position: "bottom-start" }}
        filter={({ options }) => options}
      />
    );
  }
}
