import React from "react";
import {
  Modal,
  Button,
  Alert,
  Select,
  Avatar,
  Group,
  Text,
  Stack,
  Card,
  Badge,
} from "@mantine/core";
import { SignInButton } from "../TopBar/TopBar";
import { serverPath } from "../../utils/utils";
import config from "../../config";
import { MetadataContext } from "../../MetadataContext";
import { IconHourglass, IconWorld, IconDeviceDesktop } from "@tabler/icons-react";

export class VBrowserModal extends React.Component<{
  closeModal: () => void;
  startVBrowser: (options: { size: string; region: string }) => void;
}> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;
  state = {
    isFreePoolFull: false,
    region: "any",
  };

  async componentDidMount() {
    try {
      const resp = await fetch(serverPath + "/metadata");
      const metadata = await resp.json();
      this.setState({ isFreePoolFull: metadata.isFreePoolFull });
    } catch (e) {
      console.warn("Failed to fetch metadata", e);
    }
  }

  render() {
    const regionOptions = [
      {
        label: "Any available",
        value: "any",
        image: { avatar: false, src: "" },
      },
      {
        label: "US East",
        value: "US",
        image: { avatar: false, src: "/flag-united-states.png" },
      },
      {
        label: "US West",
        value: "USW",
        image: { avatar: false, src: "/flag-united-states.png" },
      },
      {
        label: "Europe",
        value: "EU",
        image: { avatar: false, src: "/flag-european-union.png" },
      },
    ];

    const { closeModal, startVBrowser } = this.props;

    const vmPoolFullMessage = (
      <Alert
        color="red"
        icon={<IconHourglass />}
        title="Virtual Browsers Currently Busy"
      >
        All virtual browsers are currently being used. Please try again in a few moments.
      </Alert>
    );

    const canLaunch = Boolean(this.context.user || !config.VITE_SUPABASE_URL);

    return (
      <Modal
        opened
        onClose={closeModal}
        title="Launch Virtual Browser"
        centered
        size="md"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Launch a shared cloud browser in this room to stream websites, watch video platforms, and browse the web together.
          </Text>

          <Card withBorder padding="sm" radius="md" style={{ background: "var(--bg-surface)" }}>
            <Stack gap="xs">
              <Group justify="space-between">
                <Group gap="xs">
                  <IconDeviceDesktop size={18} color="var(--accent-primary)" />
                  <Text size="sm" fw={600}>Browser Specifications</Text>
                </Group>
                <Badge color="violet" variant="light">Cloud VBrowser</Badge>
              </Group>

              <Group justify="space-between" mt="xs">
                <Text size="xs" c="dimmed">Resolution</Text>
                <Text size="xs" fw={500}>Full HD (1080p)</Text>
              </Group>

              <Group justify="space-between">
                <Text size="xs" c="dimmed">Max Session Duration</Text>
                <Text size="xs" fw={500}>Up to 24 hours</Text>
              </Group>

              <Group justify="space-between">
                <Text size="xs" c="dimmed">Supported Viewers</Text>
                <Text size="xs" fw={500}>Up to 30 people</Text>
              </Group>
            </Stack>
          </Card>

          <Select
            label="Server Region"
            description="Select the closest server location for optimal latency"
            leftSection={<IconWorld size={16} />}
            onChange={(value) => this.setState({ region: value || "any" })}
            value={this.state.region}
            data={regionOptions}
            renderOption={({ option }: { option: any }) => (
              <div
                key={option.value}
                style={{
                  display: "flex",
                  gap: "8px",
                  alignItems: "center",
                }}
              >
                {option.image?.src ? (
                  <Avatar radius="xs" size="sm" src={option.image.src} />
                ) : null}
                <span>{option.label}</span>
              </div>
            )}
          />

          {this.state.isFreePoolFull && vmPoolFullMessage}

          <Group justify="flex-end" gap="xs" mt="sm">
            <Button variant="default" onClick={closeModal}>
              Cancel
            </Button>
            {canLaunch ? (
              <Button
                color="violet"
                disabled={this.state.isFreePoolFull}
                onClick={() => {
                  startVBrowser({
                    size: "large",
                    region: this.state.region === "any" ? "" : this.state.region,
                  });
                  closeModal();
                }}
              >
                Launch VBrowser
              </Button>
            ) : (
              <SignInButton />
            )}
          </Group>
        </Stack>
      </Modal>
    );
  }
}
