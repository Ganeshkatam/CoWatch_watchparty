import "@mantine/core/styles.css";
import "./index.css";

import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route } from "react-router-dom";

import { supabase } from "./utils/supabaseClient";
import { serverPath, resolveProfile } from "./utils/utils";
import { Home } from "./components/Home/Home";
import { App } from "./components/App/App";
import { TopBar } from "./components/TopBar/TopBar";
import { Footer } from "./components/Footer/Footer";
import { AuthLayout } from "./components/Auth/AuthLayout";
import { Create } from "./components/Create/Create";
import { Profile } from "./components/Profile/Profile";
import { MyRooms } from "./components/MyRooms/MyRooms";
import { RoomDetails } from "./components/MyRooms/RoomDetails";
import { Terms, Privacy, FAQ } from "./components/Pages/Pages";
import { Login } from "./components/Auth/Login";
import { Signup } from "./components/Auth/Signup";
import { ForgotPassword } from "./components/Auth/ForgotPassword";
import { ResetPassword } from "./components/Auth/ResetPassword";
import { RequireGuest } from "./components/Auth/RequireGuest";
import { RequireVerifiedEmail } from "./components/Auth/RequireVerifiedEmail";
import { VerifyEmail } from "./components/Auth/VerifyEmail";
import config from "./config";
import { DEFAULT_STATE, MetadataContext } from "./MetadataContext";
import { createTheme, MantineProvider } from "@mantine/core";
import { ThemeProvider, useAppearance } from "./theme/ThemeProvider";
import type { AppearanceMode } from "./theme/types";

const theme = createTheme({
  /** Your theme override here */
  fontFamily: "Inter, sans-serif",
  primaryColor: "violet",
  defaultGradient: {
    from: "#8B5CF6",
    to: "#EC4899",
    deg: 135,
  },
  colors: {
    dark: [
      "#F5F3FF", // 0 text
      "#D1CEDB", // 1
      "#A7A3B8", // 2 muted text
      "#7E7896", // 3
      "#544D73", // 4 border
      "#2A2447", // 5
      "#171B2A", // 6 elevated surface
      "#111522", // 7 surface
      "#0A0D14", // 8 background
      "#05070B", // 9
    ],
  },
  headings: {
    fontFamily: "Inter, sans-serif",
    sizes: {
      h1: { fontSize: "32px", fontWeight: "700" },
      h2: { fontSize: "20px", fontWeight: "600" },
      h3: { fontSize: "18px", fontWeight: "600" },
    },
  },
  components: {
    Button: {
      styles: (theme: any, params: any) => {
        if (params.variant === "default") {
          return {
            root: {
              backgroundColor: "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-primary)",
            },
          };
        }
        return {};
      },
    },
    TextInput: {
      styles: {
        input: {
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
          color: "var(--text-primary)",
        },
      },
    },
    PasswordInput: {
      styles: {
        input: {
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
          color: "var(--text-primary)",
        },
      },
    },
  },
});

const Debug = lazy(() => import("./components/Debug/Debug"));

const supabaseUrl = config.VITE_SUPABASE_URL;

// Redirect old-style URLs, but ignore Supabase auth hashes
if (window.location.hash && window.location.pathname === "/") {
  if (!window.location.hash.startsWith("#access_token=") && !window.location.hash.startsWith("#error=")) {
    const hashRoomId = window.location.hash.substring(1).replace(/^\//, '');
    window.location.href = "/watch/" + hashRoomId;
  }
}

const ThemeConsumer = ({ children }: { children: (resolvedColorScheme: "light" | "dark") => React.ReactNode }) => {
  const { resolvedColorScheme } = useAppearance();
  return <>{children(resolvedColorScheme)}</>;
};

class CoWatch extends React.Component {
  public state = {
    ...DEFAULT_STATE,
    setMetadata: (data: any) => {
      this.setState(data);
    }
  };

  handleAppearanceChange = async (appearance: AppearanceMode) => {
    this.setState({ userAppearance: appearance });
    const { user } = this.state;
    if (user) {
      await supabase
        .from("profiles")
        .update({ pref_appearance_mode: appearance })
        .eq("id", user.id);
    }
  };

  async componentDidMount() {
    // Purge legacy profile keys from users' browsers
    window.localStorage.removeItem("cowatch-username");
    window.localStorage.removeItem("cowatch-avatar");

    if (supabaseUrl && config.VITE_SUPABASE_PUBLISHABLE_KEY) {
      const handleSession = async (session: any) => {
        const user = session?.user;
        if (user) {
          this.setState({ user });
          const token = session.access_token;
          const fetchPromise = window.fetch(serverPath + `/metadata?uid=${user.id}&token=${token}`)
            .then(res => res.json())
            .catch(err => {
              console.warn("Backend server unreachable, skipping metadata:", err);
              return {};
            });

          const profilePromise = supabase
            .from("profiles")
            .select("display_name, username, avatar_url, pref_show_chat_column, pref_show_people_column, pref_disable_chat_sound, pref_camera_on, pref_mic_on, pref_appearance_mode")
            .eq("id", user.id)
            .single();

          const [data, { data: profileData }] = await Promise.all([fetchPromise, profilePromise]);
          let profile = profileData;

          // Self-heal: if profile does not exist in DB, create one
          if (!profile && user) {
            const defaultName =
              user.user_metadata?.display_name?.trim() ||
              user.user_metadata?.username?.trim() ||
              user.user_metadata?.full_name?.trim() ||
              user.user_metadata?.name?.trim() ||
              user.email?.split("@")[0] ||
              "User";
            const defaultAvatar =
              user.user_metadata?.avatar_url ||
              user.user_metadata?.picture ||
              null;

            const { data: newProfile } = await supabase
              .from("profiles")
              .upsert(
                {
                  id: user.id,
                  display_name: defaultName,
                  username: defaultName,
                  avatar_url: defaultAvatar,
                },
                { onConflict: "id" }
              )
              .select("display_name, username, avatar_url, pref_show_chat_column, pref_show_people_column, pref_disable_chat_sound, pref_camera_on, pref_mic_on, pref_appearance_mode")
              .single();

            if (newProfile) {
              profile = newProfile;
            }
          }

          const resolved = resolveProfile(profile, user);
          const displayName = resolved.displayName;
          const avatarUrl = resolved.avatarUrl;
          if (profile) {
            window.localStorage.setItem("cowatch-showchatcolumn", profile.pref_show_chat_column ? "1" : "0");
            window.localStorage.setItem("cowatch-showpeoplecolumn", profile.pref_show_people_column ? "1" : "0");

            const settingsStr = window.localStorage.getItem("cowatch-setting") || "{}";
            try {
              const settings = JSON.parse(settingsStr);
              settings.disableChatSound = profile.pref_disable_chat_sound;
              window.localStorage.setItem("cowatch-setting", JSON.stringify(settings));
            } catch (e) { }
          }

          this.setState({
            user,
            profile,
            displayName,
            avatarUrl,
            streamPath: data.streamPath,
            convertPath: data.convertPath,
            beta: data.beta,
            userAppearance: profile?.pref_appearance_mode || "system",
          });
        } else {
          this.setState({ user: null, profile: null, displayName: "Guest", avatarUrl: null });
        }
      };

      // Fetch initial session
      supabase.auth.getSession().then(({ data: { session } }) => {
        handleSession(session);
      });

      // Listen for changes
      supabase.auth.onAuthStateChange(async (event, session) => {
        handleSession(session);
      });
    } else {
      // Authentication is optional; allow the app to render guest routes without it.
      this.setState({ user: null, profile: null, displayName: "Guest", avatarUrl: null });
    }
  }

  render() {
    return (
      // <React.StrictMode>
      <ThemeProvider
        userAppearance={this.state.userAppearance}
        onAppearanceChange={this.handleAppearanceChange}
      >
        <ThemeConsumer>
          {(resolvedColorScheme) => (
            <MantineProvider theme={theme} forceColorScheme={resolvedColorScheme}>
              <MetadataContext.Provider value={this.state}>
                <BrowserRouter>
                  <Route
                    path="/"
                    exact
                    render={(props) => {
                      return (
                        <React.Fragment>
                          <TopBar hideNewRoom />
                          <Home />
                          <Footer />
                        </React.Fragment>
                      );
                    }}
                  />
                  <Route path={["/login", "/signup", "/forgot-password", "/reset-password"]}>
                    <RequireGuest>
                      <AuthLayout>
                        <Route path="/login" exact component={Login} />
                        <Route path="/signup" exact component={Signup} />
                        <Route path="/forgot-password" exact component={ForgotPassword} />
                        <Route path="/reset-password" exact component={ResetPassword} />
                      </AuthLayout>
                    </RequireGuest>
                  </Route>
                  <Route path="/verify-email" exact component={VerifyEmail} />
                  <Route
                    path="/create"
                    exact
                    render={() => {
                      return <RequireVerifiedEmail><Create /></RequireVerifiedEmail>;
                    }}
                  />
                  <Route
                    path="/watch/:roomId"
                    exact
                    render={(props) => {
                      return <RequireVerifiedEmail><App urlRoomId={props.match.params.roomId} /></RequireVerifiedEmail>;
                    }}
                  />

                  <Route path="/terms">
                    <>
                      <TopBar />
                      <Terms />
                    </>
                  </Route>
                  <Route path="/privacy">
                    <>
                      <TopBar />
                      <Privacy />
                    </>
                  </Route>
                  <Route path="/faq">
                    <>
                      <TopBar />
                      <FAQ />
                    </>
                  </Route>
                  <Route path="/profile">
                    <RequireVerifiedEmail>
                      <TopBar hideNewRoom />
                      <Profile />
                    </RequireVerifiedEmail>
                  </Route>
                  <Route path="/rooms" exact>
                    <RequireVerifiedEmail>
                      <TopBar hideNewRoom hideMyRooms />
                      <MyRooms />
                    </RequireVerifiedEmail>
                  </Route>
                  <Route path="/rooms/:roomId">
                    <RequireVerifiedEmail>
                      <TopBar hideNewRoom hideMyRooms />
                      <RoomDetails />
                    </RequireVerifiedEmail>
                  </Route>
                  <Route path="/debug">
                    <>
                      <TopBar />
                      <Suspense fallback={null}>
                        <Debug />
                      </Suspense>
                    </>
                  </Route>
                </BrowserRouter>
              </MetadataContext.Provider>
            </MantineProvider>
          )}
        </ThemeConsumer>
      </ThemeProvider>
      // </React.StrictMode>
    );
  }
}
const container = document.getElementById("root");
const root = createRoot(container!);
root.render(<CoWatch />);
