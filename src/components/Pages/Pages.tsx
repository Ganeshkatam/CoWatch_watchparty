import React from "react";
import { Container, Paper, Title, Text, Accordion, List, Anchor, Button } from "@mantine/core";
import { useHistory } from "react-router-dom";
import { IconArrowLeft } from "@tabler/icons-react";

const containerStyle: React.CSSProperties = {
  maxWidth: "840px",
  padding: "24px 20px 64px",
  marginTop: "20px",
  marginBottom: "40px",
};

const paperStyle: React.CSSProperties = {
  backgroundColor: "var(--bg-surface)",
  border: "1px solid var(--border-subtle)",
  padding: "36px",
  borderRadius: "16px",
  boxShadow: "var(--shadow-md)",
  color: "var(--text-primary)",
};

const BackButton = () => {
  const history = useHistory();
  return (
    <Button 
      variant="subtle" 
      color="gray" 
      onClick={() => history.goBack()} 
      leftSection={<IconArrowLeft size={16} />}
      mb="lg"
      px="xs"
      style={{
        color: "var(--text-secondary)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      Go back
    </Button>
  );
};

export const Privacy = () => {
  return (
    <Container style={containerStyle}>
      <BackButton />
      <Paper radius="md" style={paperStyle}>
        <Title order={1} mb="xl" style={{ color: "var(--color-violet)" }}>
          Privacy Policy
        </Title>

        <Title order={2} size="h4" mb="sm">Rooms</Title>
        <List mb="xl" spacing="sm" c="var(--text-secondary)">
          <List.Item>By default, rooms are temporary and expire after one day of inactivity.</List.Item>
          <List.Item>Users have the option of making a room permanent, which can be undone at any time.</List.Item>
          <List.Item>We do not keep logs of the content that users watch.</List.Item>
        </List>

        <Title order={2} size="h4" mb="sm">Personal Information</Title>
        <List mb="xl" spacing="sm" c="var(--text-secondary)">
          <List.Item>You are not required to register to use the service, but you have the option to sign in with an email or authentication provider, which will be used to display your name and picture in the rooms you join.</List.Item>
          <List.Item>If you provide this information, we may use it to contact you regarding your use of the service, or to link your account to a subscription.</List.Item>
          <List.Item>We do not sell personal information to third parties.</List.Item>
          <List.Item>
            You have the right to request deletion of your user data, in accordance with various laws governing data protection. Please contact <Anchor href="mailto:support@cowatch.me" c="var(--color-violet)">support@cowatch.me</Anchor> to request user data deletion.
          </List.Item>
        </List>

        <Title order={2} size="h4" mb="sm">Cookies</Title>
        <List mb="xl" spacing="sm" c="var(--text-secondary)">
          <List.Item>We use services such as Google Analytics to measure usage. These services may set cookies or other information locally on your device.</List.Item>
        </List>

        <Title order={2} size="h4" mb="sm">Virtual Browsers</Title>
        <List mb="xl" spacing="sm" c="var(--text-secondary)">
          <List.Item>Virtual machines are recycled after each session ends and any data on them is destroyed.</List.Item>
          <List.Item>Your commands are encrypted while in-transit to the virtual machine.</List.Item>
        </List>

        <Title order={2} size="h4" mb="sm">YouTube</Title>
        <List mb="sm" spacing="sm" c="var(--text-secondary)">
          <List.Item>
            The service provides the ability to search and play YouTube videos. Google/YouTube may use data provided to the search service in accordance with the <Anchor href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" c="var(--color-violet)">Google Privacy Policy</Anchor>.
          </List.Item>
        </List>
      </Paper>
    </Container>
  );
};

export const Terms = () => {
  return (
    <Container style={containerStyle}>
      <BackButton />
      <Paper radius="md" style={paperStyle}>
        <Title order={1} mb="xl" style={{ color: "var(--color-violet)" }}>
          Terms of Service
        </Title>
        
        <Text mb="md" c="var(--text-primary)" fw={500}>By using this service you agree to the following terms:</Text>
        <List mb="xl" spacing="sm" c="var(--text-secondary)">
          <List.Item>You are over 13 years of age</List.Item>
          <List.Item>Your use of the service may be terminated if you are found to be sharing illegal or infringing content</List.Item>
          <List.Item>The service provides no guarantee of uptime or availability</List.Item>
          <List.Item>You use the service at your own risk of encountering objectionable content, as we do not actively moderate rooms unless content is found to be illegal or infringing</List.Item>
        </List>

        <Title order={2} size="h4" mb="sm">YouTube</Title>
        <Text mb="sm" c="var(--text-secondary)">
          The service provides the ability to search and play YouTube videos. By using the YouTube search you agree to the <Anchor href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" c="var(--color-violet)">YouTube Terms of Service</Anchor>.
        </Text>
      </Paper>
    </Container>
  );
};

export const FAQ = () => {
  return (
    <Container style={containerStyle}>
      <BackButton />
      <Title order={1} mb="xl" style={{ color: "var(--color-violet)", textAlign: "center", fontWeight: 800 }}>
        Frequently Asked Questions
      </Title>
      
      <Accordion variant="separated" styles={{
        item: {
          backgroundColor: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "14px",
          boxShadow: "var(--shadow-sm)",
          transition: "all 0.2s ease",
          marginBottom: "12px",
          overflow: "hidden",
        },
        control: {
          padding: "16px 20px",
          borderRadius: "14px",
          '&:hover': {
            backgroundColor: "var(--surface-hover)",
          },
        },
        label: {
          color: "var(--text-primary)",
        },
        content: {
          color: "var(--text-secondary)",
          lineHeight: 1.7,
          fontSize: "15px",
          padding: "0 20px 20px 20px",
        },
        chevron: {
          color: "var(--text-muted)",
        },
      }}>
        <Accordion.Item value="vbrowser">
          <Accordion.Control>
            <Text fw={600} size="md" c="var(--text-primary)">
              What's a VBrowser?
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            A virtual browser (VBrowser) is a browser running in the cloud that a room's members can connect to. Everyone in the room sees the same thing, so it's a great way to watch videos or collaborate on tasks together.
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="vbrowser-stop">
          <Accordion.Control>
            <Text fw={600} size="md" c="var(--text-primary)">
              Why did my VBrowser session stop?
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            VBrowsers will terminate automatically if no one is in the room for a while.<br/>
            VBrowser sessions are limited to a maximum of 24 hours.
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="vbrowser-not-available">
          <Accordion.Control>
            <Text fw={600} size="md" c="var(--text-primary)">
              How do I access sites that have a "not available" message in the VBrowser?
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            Some sites may block traffic that's detected as coming from the cloud. You may need to install a VPN extension inside the virtual browser.
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="audio-screensharing">
          <Accordion.Control>
            <Text fw={600} size="md" c="var(--text-primary)">
              How come I'm not getting any audio when screensharing?
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            To share audio, you must be using Chrome/Edge and sharing a tab or desktop.
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="room-limit">
          <Accordion.Control>
            <Text fw={600} size="md" c="var(--text-primary)">
              Is there a limit to how many people can be in a room?
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            Currently there isn't a hard limit, although the service hasn't been tested with more than 15 people or so. Screensharing and filesharing rely on one person uploading to everyone else, so it may not work well with large room sizes.
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="cowatch-link">
          <Accordion.Control>
            <Text fw={600} size="md" c="var(--text-primary)">
              I own a website and I'd like to have a link that generates a CoWatch room with a specific video already set. How do I do this?
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            You can link to <Anchor href="https://www.cowatch.me/create?video=URL_HERE" target="_blank" rel="noopener noreferrer" c="var(--color-violet)">https://www.cowatch.me/create?video=URL_HERE</Anchor> to do this!
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Container>
  );
};
