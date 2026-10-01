import React from "react";
import {
  Modal,
  Button,
  Radio,
  Switch,
  Title,
  TextInput,
  ActionIcon,
  Divider,
  Alert,
} from "@mantine/core";
import { Socket } from "socket.io-client";
import { openFileSelector, serverPath } from "../../utils/utils";
import config from "../../config";
import { MetadataContext } from "../../MetadataContext";
import {
  IconDownload,
  IconSearch,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { MODAL_SIZES } from "../../utils/designSystem";

export interface SubtitleSearchResult {
  id: string;
  type: string;
  attributes: {
    files?: Array<{ file_id?: string }>;
    release?: string;
    [key: string]: unknown;
  };
}

export class SubtitleModal extends React.Component<{
  closeModal: () => void;
  roomSubtitle: string | undefined;
  haveLock: () => boolean;
  roomMedia: string;
  socket: Socket;
  getMediaDisplayName: (input: string) => string;
  setSubtitleMode: (mode?: TextTrackMode) => void;
  getSubtitleMode: () => TextTrackMode;
}> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;
  state = {
    loading: false,
    isUploading: false,
    uploadError: null as string | null,
    searchError: null as string | null,
    searchResults: [] as SubtitleSearchResult[],
    titleQuery: this.props
      .getMediaDisplayName(this.props.roomMedia)
      .split("/")
      .slice(-1)[0],
  };

  async componentDidMount() {
    if (this.props.roomMedia.includes("/stream?torrent=magnet")) {
      const re = /&fileIndex=(\d+)$/;
      const match = re.exec(this.props.roomMedia);
      if (match) {
        const fileIndex = match[1];
        if (fileIndex) {
          // Fetch title from the data endpoint
          const response = await fetch(
            this.props.roomMedia.replace("/stream", "/data"),
          );
          const data = await response.json();
          this.setState({ titleQuery: data?.files[fileIndex]?.name });
        }
      }
    }
  }

  uploadSubtitle = async () => {
    try {
      this.setState({ uploadError: null });
      const files = await openFileSelector(".srt,.vtt");
      if (!files || files.length === 0) {
        return;
      }
      this.setState({ isUploading: true });
      const file = files[0];
      const reader = new FileReader();
      reader.onerror = () => {
        this.setState({
          uploadError: "Failed to read subtitle file. Please try again.",
          isUploading: false,
        });
      };
      reader.onload = async (event) => {
        try {
          const subData = event.target?.result;
          if (typeof subData !== "string") {
            throw new Error("Invalid file content");
          }
          const resp = await fetch(serverPath + "/subtitle", {
            method: "POST",
            body: subData,
            headers: { "Content-Type": "text/plain" },
          });
          if (!resp.ok) {
            throw new Error(`Upload failed with status ${resp.status}`);
          }
          const json = (await resp.json()) as { hash?: string };
          if (!json?.hash) {
            throw new Error("Server returned invalid subtitle hash");
          }
          this.props.socket.emit(
            "CMD:subtitle",
            serverPath + "/subtitle/" + json.hash,
          );
          this.setState({ isUploading: false, uploadError: null });
        } catch (err) {
          console.error("Failed to upload subtitle file:", err);
          this.setState({
            uploadError: "Failed to upload subtitle file. Please try again.",
            isUploading: false,
          });
        }
      };
      reader.readAsText(file);
    } catch (err) {
      console.error("Subtitle selector error:", err);
      this.setState({
        uploadError: "Failed to open subtitle file.",
        isUploading: false,
      });
    }
  };
  render() {
    const { closeModal } = this.props;
    return (
      <Modal
        opened
        onClose={closeModal}
        centered
        title="Subtitles"
        size={MODAL_SIZES.lg}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <Switch
            checked={this.props.getSubtitleMode() === "showing"}
            label="Toggle subtitles for myself"
            onClick={() => {
              this.props.setSubtitleMode();
            }}
          />
          <Divider my="lg" />
          <Title order={6}>Room subtitles</Title>
          <div style={{ display: "flex", gap: "4px", flexDirection: "column" }}>
            <TextInput
              placeholder="Subtitle URL"
              value={this.props.roomSubtitle}
              disabled={!this.props.haveLock()}
              onChange={(e) =>
                this.props.socket.emit("CMD:subtitle", e.target.value)
              }
              rightSection={
                <ActionIcon
                  color="red"
                  disabled={!this.props.haveLock()}
                  onClick={() => {
                    this.props.socket.emit("CMD:subtitle", "");
                  }}
                >
                  <IconX />
                </ActionIcon>
              }
            />
            <Button
              color="violet"
              loading={this.state.isUploading}
              onClick={() => this.uploadSubtitle()}
              disabled={!this.props.haveLock()}
              leftSection={<IconUpload />}
            >
              Upload (.srt / .vtt)
            </Button>
            {this.state.uploadError && (
              <Alert color="red" variant="light" mt="xs">
                {this.state.uploadError}
              </Alert>
            )}
            <Divider my="lg" />
            <Title order={6}>OpenSubtitles</Title>
            <TextInput
              value={this.state.titleQuery}
              onChange={(e) => this.setState({ titleQuery: e.target.value })}
              disabled={!this.props.haveLock()}
              rightSectionWidth={230}
              rightSection={
                <div style={{ display: "flex", gap: "4px" }}>
                  <Button
                    loading={this.state.loading}
                    color="green"
                    disabled={!this.props.haveLock()}
                    onClick={async () => {
                      try {
                        this.setState({ loading: true, searchError: null });
                        const resp = await fetch(
                          serverPath +
                            "/searchSubtitles?title=" +
                            encodeURIComponent(this.state.titleQuery),
                        );
                        if (!resp.ok) throw new Error("Search failed");
                        const json = await resp.json();
                        this.setState({
                          searchResults: Array.isArray(json) ? json : [],
                          loading: false,
                        });
                      } catch (err) {
                        console.error("Search subtitles by title failed:", err);
                        this.setState({
                          searchError: "Failed to search subtitles. Please try again.",
                          loading: false,
                        });
                      }
                    }}
                    leftSection={<IconSearch />}
                  >
                    By title
                  </Button>
                  <Button
                    loading={this.state.loading}
                    color="blue"
                    disabled={!this.props.haveLock()}
                    onClick={async () => {
                      try {
                        this.setState({ loading: true, searchError: null });
                        const resp = await fetch(
                          serverPath +
                            "/searchSubtitles?url=" +
                            encodeURIComponent(this.props.roomMedia),
                        );
                        if (!resp.ok) throw new Error("Search failed");
                        const json = await resp.json();
                        this.setState({
                          searchResults: Array.isArray(json) ? json : [],
                          loading: false,
                        });
                      } catch (err) {
                        console.error("Search subtitles by hash failed:", err);
                        this.setState({
                          searchError: "Failed to search subtitles. Please try again.",
                          loading: false,
                        });
                      }
                    }}
                    leftSection={<IconSearch />}
                  >
                    By hash
                  </Button>
                </div>
              }
            ></TextInput>
            {this.state.searchError && (
              <Alert color="red" variant="light" mt="xs">
                {this.state.searchError}
              </Alert>
            )}
            <div
              style={{ display: "flex", flexDirection: "column", gap: "4px" }}
            >
              {this.state.searchResults.map(
                (result: SubtitleSearchResult) => (
                  <div key={result.id} style={{ display: "flex", gap: "4px" }}>
                    <ActionIcon
                      disabled={!this.props.haveLock()}
                      onClick={async () => {
                        const fileId = result.attributes.files?.[0]?.file_id;
                        if (!fileId) return;
                        try {
                          const resp = await fetch(
                            serverPath +
                              "/downloadSubtitles?file_id=" +
                              encodeURIComponent(fileId),
                          );
                          if (!resp.ok) throw new Error("Download failed");
                          const data = await resp.json();
                          if (data?.link) {
                            this.props.socket.emit(
                              "CMD:subtitle",
                              serverPath + data.link,
                            );
                          }
                        } catch (err) {
                          console.error("Download subtitle failed:", err);
                          this.setState({
                            searchError: "Failed to download subtitle.",
                          });
                        }
                      }}
                    >
                      <IconDownload />
                    </ActionIcon>
                    <span>{result.attributes.release}</span>
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      </Modal>
    );
  }
}
