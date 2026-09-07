import React, { useCallback, useContext } from "react";
import { Link } from "react-router-dom";
import { serverPath } from "../../utils/utils";
import { getAccessToken, supabase } from "../../utils/supabaseClient";
import { Avatar, Button, Menu, Text } from "@mantine/core";
import type { User } from "@supabase/supabase-js";
import Announce from "../Announce/Announce";
import appStyles from "../App/App.module.css";
import { MetadataContext } from "../../MetadataContext";
import {
  IconCirclePlusFilled,
  IconDatabase,
  IconLogin,
  IconLogout,
  IconX,
  IconSettings,
  IconCheck,
  IconDeviceDesktop,
  IconSun,
  IconMoon,
} from "@tabler/icons-react";
import { useAppearance } from "../../theme/ThemeProvider";

export const ThemeMenuItems = () => {
  const { appearance, setAppearance } = useAppearance();

  return (
    <>
      <Menu.Label>Theme</Menu.Label>
      <Menu.Item
        onClick={() => setAppearance("system")}
        leftSection={<IconDeviceDesktop size={16} stroke={1.5} />}
        rightSection={appearance === "system" ? <IconCheck size={14} stroke={2.5} color="var(--color-violet)" /> : null}
      >
        System
      </Menu.Item>
      <Menu.Item
        onClick={() => setAppearance("light")}
        leftSection={<IconSun size={16} stroke={1.5} />}
        rightSection={appearance === "light" ? <IconCheck size={14} stroke={2.5} color="var(--color-violet)" /> : null}
      >
        Light
      </Menu.Item>
      <Menu.Item
        onClick={() => setAppearance("mantine")}
        leftSection={<IconMoon size={16} stroke={1.5} />}
        rightSection={appearance === "mantine" ? <IconCheck size={14} stroke={2.5} color="var(--color-violet)" /> : null}
      >
        Dark
      </Menu.Item>
    </>
  );
};


export async function createRoom(
  user: User | null | undefined,
  openNewTab: boolean | undefined,
  video: string = "",
  options: {
    roomTitle: string;
    roomDescription?: string;
    passcode?: string;

    isChatDisabled?: boolean;
    lock?: boolean;
    noRedirect?: boolean;
  }
) {
  const uid = user?.id;
  const token = await getAccessToken();
  const response = await fetch(serverPath + "/createRoom", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      uid,
      token,
      video,
      ...options,
    }),
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }
  const { name } = data;
  
  if (options?.noRedirect) {
    return name;
  }
  
  const safeName = name.startsWith("/") ? name.substring(1) : name;
  if (openNewTab) {
    window.open(`/watch/${safeName}`);
  } else {
    window.location.assign(`/watch/${safeName}`);
  }
}

import { useHistory } from "react-router-dom";

export const NewRoomButton = (props: {
  size?: string;
  openNewTab?: boolean;
}) => {
  const context = useContext(MetadataContext);
  const history = useHistory();
  const onClick = useCallback(async () => {
    history.push("/create");
  }, [history]);
  return (
    <Button
      size={props.size}
      variant="gradient"
      onClick={onClick}
      leftSection={<IconCirclePlusFilled />}
    >
      New Room
    </Button>
  );
};

type SignInButtonProps = {};

export class SignInButton extends React.Component<SignInButtonProps> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;
  public state = { isLoginOpen: false };

  render() {
    if (this.context.user) {
      return (
        <Menu shadow="xl" width={240} position="bottom-end" offset={8}>
          <Menu.Target>
            <div
              className="topbar-avatar-btn"
              style={{
                margin: "4px",
                minWidth: "40px",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Avatar
                src={this.context.avatarUrl}
                size={36}
                radius="xl"
                style={{
                  border: "2px solid var(--border-subtle)",
                  transition: "border-color 0.2s ease, box-shadow 0.2s ease",
                }}
              />
            </div>
          </Menu.Target>

          <Menu.Dropdown>
            <div
              style={{
                padding: "8px 10px 10px 10px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
              }}
            >
              <Avatar size={36} radius="xl" src={this.context.avatarUrl} />
              <div style={{ overflow: "hidden", flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "13.5px",
                    color: "var(--text-primary)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {this.context.displayName}
                </div>
                <div
                  style={{
                    fontSize: "11.5px",
                    color: "var(--text-muted)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {this.context.user?.email}
                </div>
              </div>
            </div>

            <Menu.Divider />

            <Menu.Label>Account</Menu.Label>
            <Menu.Item
              component={Link}
              to="/profile"
              leftSection={<IconSettings size={16} stroke={1.5} />}
            >
              Settings
            </Menu.Item>
            <Menu.Item
              component={Link}
              to="/rooms"
              leftSection={<IconDatabase size={16} stroke={1.5} />}
            >
              My rooms
            </Menu.Item>

            <Menu.Divider />

            <ThemeMenuItems />

            <Menu.Divider />

            <Menu.Item
              color="red"
              leftSection={<IconLogout size={16} stroke={1.5} />}
              onClick={async () => {
                await supabase.auth.signOut();
              }}
            >
              Sign out
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      );
    }
    return (
      <React.Fragment>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Button
            component={Link}
            to="/login"
            variant="light"
            color="violet"
            leftSection={<IconLogin size={16} />}
          >
            Sign in
          </Button>
          <Menu shadow="md" width={200}>
            <Menu.Target>
              <Button variant="subtle" px={8}>
                <IconSettings size={20} />
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <ThemeMenuItems />
            </Menu.Dropdown>
          </Menu>
        </div>
      </React.Fragment>
    );
  }
}

export const ListRoomsButton = () => {
  const context = useContext(MetadataContext);
  if (!context.user) return null;
  return (
    <Button
      component={Link}
      to="/rooms"
      variant="light"
      color="violet"
      leftSection={<IconDatabase size={16} />}
    >
      My rooms
    </Button>
  );
};

export const TopBar = (props: {
  hideNewRoom?: boolean;
  hideSignin?: boolean;
  hideMyRooms?: boolean;
  showExit?: boolean;
  onOpenSettings?: () => void;
  roomTitle?: string;
  roomDescription?: string;
}) => {
  const context = useContext(MetadataContext);
  return (
    <React.Fragment>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          padding: "4px 8px",
          rowGap: "8px",
          position: "sticky",
          top: 0,
          zIndex: 100,
          backgroundColor: "var(--bg-app)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <a href="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
          <img
            className="cowatch-brand-logo"
            style={{ width: "40px", height: "40px", marginRight: "8px", objectFit: "contain" }}
            src="/logo192.png"
            alt="CoWatch"
          />
          {!props.roomTitle && !props.roomDescription && (
            <div
              style={{
                textTransform: "uppercase",
                fontWeight: 700,
                fontSize: "26px",
                lineHeight: "26px",
                background: "linear-gradient(135deg, #14B8A6, #3B82F6)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              CoWatch
            </div>
          )}
        </a>
        {props.roomTitle || props.roomDescription ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              marginRight: 10,
              marginLeft: 10,
            }}
          >
            <div
              style={{
                fontSize: "30px",
                lineHeight: "30px",
                fontWeight: 700,
                letterSpacing: 1,
              }}
            >
              {props.roomTitle?.toUpperCase()}
            </div>
            <Text size="sm" style={{}}>
              {props.roomDescription}
            </Text>
          </div>
        ) : null}
        <Announce />
        <div
          className={appStyles.mobileStack}
          style={{
            display: "flex",
            marginLeft: "auto",
            alignItems: "center",
            gap: "4px",
          }}
        >
          {!props.hideMyRooms && context.user && <ListRoomsButton />}
          {props.showExit && (
            <Button
              color="red"
              variant="light"
              onClick={() => {
                window.location.assign("/");
              }}
              leftSection={<IconX size={16} />}
            >
              Exit
            </Button>
          )}
          {props.onOpenSettings && (
            <Button
              color="violet"
              variant="light"
              onClick={props.onOpenSettings}
              leftSection={<IconSettings size={16} />}
            >
              Settings
            </Button>
          )}
          {!props.hideSignin && <SignInButton />}
        </div>
      </div>
    </React.Fragment>
  );
};
