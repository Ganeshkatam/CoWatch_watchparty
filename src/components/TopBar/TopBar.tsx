import React, { useCallback, useContext, useEffect, useState } from "react";
import { Link, useHistory, useLocation } from "react-router-dom";
import { serverPath } from "../../utils/utils";
import { getAccessToken, supabase } from "../../utils/supabaseClient";
import { Avatar, Burger, Button, Drawer, Menu, Text, Tooltip } from "@mantine/core";
import type { User } from "@supabase/supabase-js";
import appStyles from "../App/App.module.css";
import styles from "./TopBar.module.css";
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
  IconChevronDown,
  IconUsers,
  IconHome,
} from "@tabler/icons-react";
import { useAppearance } from "../../theme/ThemeProvider";
import { TopBarSearch } from "./TopBarSearch";

export const ThemeMenuItems = () => {
  const { appearance, setAppearance } = useAppearance();

  return (
    <>
      <Menu.Label>Theme</Menu.Label>
      <Menu.Item
        onClick={() => setAppearance("system")}
        leftSection={<IconDeviceDesktop size={16} stroke={1.5} />}
        rightSection={
          appearance === "system" ? (
            <IconCheck size={14} stroke={2.5} color="var(--color-violet)" />
          ) : null
        }
      >
        System
      </Menu.Item>
      <Menu.Item
        onClick={() => setAppearance("light")}
        leftSection={<IconSun size={16} stroke={1.5} />}
        rightSection={
          appearance === "light" ? (
            <IconCheck size={14} stroke={2.5} color="var(--color-violet)" />
          ) : null
        }
      >
        Light
      </Menu.Item>
      <Menu.Item
        onClick={() => setAppearance("mantine")}
        leftSection={<IconMoon size={16} stroke={1.5} />}
        rightSection={
          appearance === "mantine" ? (
            <IconCheck size={14} stroke={2.5} color="var(--color-violet)" />
          ) : null
        }
      >
        Dark
      </Menu.Item>
    </>
  );
};

export const ThemeToggleQuickButton = () => {
  const { appearance, setAppearance } = useAppearance();
  const isDark =
    appearance === "mantine" ||
    (appearance === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  const handleToggle = () => {
    setAppearance(isDark ? "light" : "mantine");
  };

  return (
    <Tooltip
      label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      withArrow
    >
      <button
        type="button"
        className={styles.themeToggleBtn}
        onClick={handleToggle}
        aria-label="Toggle theme"
      >
        {isDark ? (
          <IconSun size={18} stroke={1.5} />
        ) : (
          <IconMoon size={18} stroke={1.5} />
        )}
      </button>
    </Tooltip>
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
    isPermanent?: boolean;
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

export const NewRoomButton = (props: {
  size?: string;
  openNewTab?: boolean;
}) => {
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

export const JoinRoomButton = (props: { size?: string }) => {
  return (
    <Button
      component={Link}
      to="/join"
      size={props.size || "sm"}
      variant="default"
      leftSection={<IconUsers size={16} />}
    >
      Join
    </Button>
  );
};

export class SignInButton extends React.Component<{}> {
  static contextType = MetadataContext;
  declare context: React.ContextType<typeof MetadataContext>;
  public state = { isLoginOpen: false };

  render() {
    if (this.context.user) {
      return (
        <Tooltip label="Settings" withArrow>
          <Link
            to="/account/profile"
            className={styles.avatarButton}
            aria-label="Settings"
          >
            <Avatar
              src={this.context.avatarUrl}
              size={34}
              radius="xl"
            />
          </Link>
        </Tooltip>
      );
    }
    return (
      <Button
        component={Link}
        to="/login"
        variant="light"
        color="violet"
        leftSection={<IconLogin size={16} />}
      >
        Sign in
      </Button>
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

export const GetStartedButton = (props: { size?: string }) => {
  const context = useContext(MetadataContext);
  const target = context.user ? "/create" : "/signup";
  return (
    <Button
      component={Link}
      to={target}
      size={props.size || "sm"}
      variant="gradient"
      style={{ fontWeight: 600 }}
    >
      Get Started
    </Button>
  );
};

export const TopBar = (props: {
  hideNewRoom?: boolean;
  hideSignin?: boolean;
  hideMyRooms?: boolean;
  hideJoinRoom?: boolean;
  hideGetStarted?: boolean;
  showExit?: boolean;
  onOpenSettings?: () => void;
  roomTitle?: string;
  roomDescription?: string;
}) => {
  const context = useContext(MetadataContext);
  const [drawerOpened, setDrawerOpened] = useState(false);
  const location = useLocation();
  const { appearance, setAppearance } = useAppearance();

  useEffect(() => {
    setDrawerOpened(false);
  }, [location.pathname]);

  return (
    <div className={styles.topBar}>
      <Link to="/" className={styles.brandGroup}>
        <img
          className={`cowatch-brand-logo ${styles.logo}`}
          src="/logo192.png"
          alt="CoWatch"
        />
        {!props.roomTitle && !props.roomDescription && (
          <div className={styles.brandName}>CoWatch</div>
        )}
      </Link>
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
              fontSize: "24px",
              lineHeight: "26px",
              fontWeight: 700,
              letterSpacing: 0.5,
              color: "var(--text-primary)",
            }}
          >
            {props.roomTitle?.toUpperCase()}
          </div>
          {props.roomDescription && (
            <Text size="sm" c="dimmed">
              {props.roomDescription}
            </Text>
          )}
        </div>
      ) : null}

      {/* Middle Navigation */}
      {!props.roomTitle && !props.roomDescription && (
        <nav className={styles.middleNav} aria-label="Main navigation">
          <Link
            to="/"
            className={`${styles.middleNavLink} ${location.pathname === "/" ? styles.middleNavLinkActive : ""
              }`}
          >
            Home
          </Link>
          {!props.hideMyRooms && context.user && (
            <Link
              to="/rooms"
              className={`${styles.middleNavLink} ${location.pathname === "/rooms" ? styles.middleNavLinkActive : ""
                }`}
            >
              My rooms
            </Link>
          )}
          {!props.hideNewRoom && (
            <Link
              to="/create"
              className={`${styles.middleNavLink} ${location.pathname === "/create" ? styles.middleNavLinkActive : ""
                }`}
            >
              Create
            </Link>
          )}
          {!props.hideJoinRoom && (
            <Link
              to="/join"
              className={`${styles.middleNavLink} ${location.pathname.startsWith("/join")
                  ? styles.middleNavLinkActive
                  : ""
                }`}
            >
              Join
            </Link>
          )}
        </nav>
      )}

      {/* Actions Group */}
      <div className={styles.actionsGroup}>
        {/* Quick Search */}
        <TopBarSearch />

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
        {!props.hideGetStarted && !context.user && <GetStartedButton />}

        {/* User Avatar linking to Settings or Sign in button */}
        {!props.hideSignin && <SignInButton />}

        {/* Separate Hamburger for remaining things */}
        <Tooltip label="Menu" withArrow>
          <Burger
            opened={drawerOpened}
            onClick={() => setDrawerOpened((o) => !o)}
            size="sm"
            color="var(--text-primary)"
            aria-label="Toggle navigation menu"
            className={styles.hamburger}
          />
        </Tooltip>
      </div>

      {/* Mobile Navigation Drawer */}
      <Drawer
        opened={drawerOpened}
        onClose={() => setDrawerOpened(false)}
        position="right"
        size={310}
        title={
          <div className={styles.drawerBrand}>
            <img src="/logo192.png" alt="CoWatch" className={styles.drawerLogo} />
            <span className={styles.drawerBrandText}>CoWatch</span>
          </div>
        }
        classNames={{
          content: styles.drawerContent,
          header: styles.drawerHeader,
          body: styles.drawerBody,
        }}
      >
        {/* User Card or Guest Welcome */}
        {context.user ? (
          <div className={styles.userCard}>
            <Avatar src={context.avatarUrl} size={42} radius="xl" />
            <div className={styles.userCardInfo}>
              <div className={styles.userCardName}>
                {context.displayName || "Account"}
              </div>
              <div className={styles.userCardEmail}>{context.user.email}</div>
            </div>
          </div>
        ) : (
          <div className={styles.guestBanner}>
            <div className={styles.guestTitle}>Welcome to CoWatch</div>
            <div className={styles.guestSubtitle}>
              Stream videos together in perfect real-time sync with friends.
            </div>
            <div className={styles.guestCtaGroup}>
              <Button
                component={Link}
                to="/login"
                variant="light"
                color="violet"
                fullWidth
                size="xs"
                onClick={() => setDrawerOpened(false)}
              >
                Sign in
              </Button>
              <Button
                component={Link}
                to="/signup"
                variant="gradient"
                fullWidth
                size="xs"
                onClick={() => setDrawerOpened(false)}
              >
                Get Started
              </Button>
            </div>
          </div>
        )}

        {/* Navigation Section */}
        <div className={styles.navSection}>
          <div className={styles.navSectionTitle}>Navigation</div>
          <Link
            to="/"
            className={styles.drawerNavLink}
            onClick={() => setDrawerOpened(false)}
          >
            <IconHome size={18} stroke={1.5} />
            <span>Home</span>
          </Link>
          <Link
            to="/join"
            className={styles.drawerNavLink}
            onClick={() => setDrawerOpened(false)}
          >
            <IconUsers size={18} stroke={1.5} />
            <span>Join a room</span>
          </Link>
          {context.user && (
            <>
              <Link
                to="/create"
                className={styles.drawerNavLink}
                onClick={() => setDrawerOpened(false)}
              >
                <IconCirclePlusFilled size={18} stroke={1.5} />
                <span>Create room</span>
              </Link>
              <Link
                to="/rooms"
                className={styles.drawerNavLink}
                onClick={() => setDrawerOpened(false)}
              >
                <IconDatabase size={18} stroke={1.5} />
                <span>My rooms</span>
              </Link>
              <Link
                to="/account/profile"
                className={styles.drawerNavLink}
                onClick={() => setDrawerOpened(false)}
              >
                <IconSettings size={18} stroke={1.5} />
                <span>Settings</span>
              </Link>
            </>
          )}
        </div>

        {/* In-room actions if applicable */}
        {(props.showExit || props.onOpenSettings) && (
          <div className={styles.navSection}>
            <div className={styles.navSectionTitle}>Room Controls</div>
            {props.onOpenSettings && (
              <button
                type="button"
                className={styles.drawerNavLink}
                style={{
                  background: "none",
                  border: "none",
                  width: "100%",
                  textAlign: "left",
                  cursor: "pointer",
                }}
                onClick={() => {
                  setDrawerOpened(false);
                  props.onOpenSettings?.();
                }}
              >
                <IconSettings size={18} stroke={1.5} />
                <span>Room Settings</span>
              </button>
            )}
            {props.showExit && (
              <button
                type="button"
                className={styles.drawerNavLink}
                style={{
                  background: "none",
                  border: "none",
                  width: "100%",
                  textAlign: "left",
                  cursor: "pointer",
                  color: "var(--color-danger, #ef4444)",
                }}
                onClick={() => {
                  window.location.assign("/");
                }}
              >
                <IconX size={18} stroke={1.5} />
                <span>Exit Room</span>
              </button>
            )}
          </div>
        )}

        {/* Theme Appearance Section */}
        <div className={styles.navSection}>
          <div className={styles.navSectionTitle}>Appearance</div>
          <div className={styles.themeOptionRow}>
            <button
              type="button"
              className={`${styles.themeOptionBtn} ${appearance === "system" ? styles.themeOptionBtnActive : ""
                }`}
              onClick={() => setAppearance("system")}
            >
              <IconDeviceDesktop size={18} stroke={1.5} />
              <span>System</span>
            </button>
            <button
              type="button"
              className={`${styles.themeOptionBtn} ${appearance === "light" ? styles.themeOptionBtnActive : ""
                }`}
              onClick={() => setAppearance("light")}
            >
              <IconSun size={18} stroke={1.5} />
              <span>Light</span>
            </button>
            <button
              type="button"
              className={`${styles.themeOptionBtn} ${appearance === "mantine" ? styles.themeOptionBtnActive : ""
                }`}
              onClick={() => setAppearance("mantine")}
            >
              <IconMoon size={18} stroke={1.5} />
              <span>Dark</span>
            </button>
          </div>
        </div>

        {/* Sign Out (Authenticated) */}
        {context.user && (
          <div style={{ marginTop: "auto", paddingTop: "12px" }}>
            <Button
              variant="subtle"
              color="red"
              fullWidth
              leftSection={<IconLogout size={16} stroke={1.5} />}
              onClick={async () => {
                setDrawerOpened(false);
                await supabase.auth.signOut();
              }}
            >
              Sign out
            </Button>
          </div>
        )}
      </Drawer>
    </div>
  );
};
