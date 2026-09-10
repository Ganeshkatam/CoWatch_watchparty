import "@mantine/core/styles.css";
import "./index.css";

import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Redirect } from "react-router-dom";

import type { User } from "@supabase/supabase-js";
import {
  supabase,
  hasCachedSupabaseToken,
  getCachedSupabaseUser,
  safeGetSession,
} from "./utils/supabaseClient";
import { serverPath, resolveProfile } from "./utils/utils";
import { TopBar } from "./components/TopBar/TopBar";
import { Footer } from "./components/Footer/Footer";
import { RequireGuest } from "./components/Auth/RequireGuest";
import { RequireVerifiedEmail } from "./components/Auth/RequireVerifiedEmail";
import config from "./config";
import { DEFAULT_STATE, MetadataContext } from "./MetadataContext";
import { AuthContext } from "./context/AuthContext";
import { AppShell } from "./components/Layout/AppShell";
import { createTheme, MantineProvider, Loader, Center } from "@mantine/core";
import { ThemeProvider, useAppearance } from "./theme/ThemeProvider";
import type { AppearanceMode } from "./theme/types";
import { SpeedInsights } from "@vercel/speed-insights/react";

// Route-level code splitting for rapid initial page loads
const Home = lazy(() => import("./components/Home/Home").then((m) => ({ default: m.Home })));
const App = lazy(() => import("./components/App/App").then((m) => ({ default: m.App })));
const AuthLayout = lazy(() => import("./components/Auth/AuthLayout").then((m) => ({ default: m.AuthLayout })));
const Create = lazy(() => import("./components/Create/Create").then((m) => ({ default: m.Create })));
const Profile = lazy(() => import("./components/Profile/Profile").then((m) => ({ default: m.Profile })));
const MyRooms = lazy(() => import("./components/MyRooms/MyRooms").then((m) => ({ default: m.MyRooms })));
const RoomDetails = lazy(() => import("./components/MyRooms/RoomDetails").then((m) => ({ default: m.RoomDetails })));
const Terms = lazy(() => import("./components/Pages/Pages").then((m) => ({ default: m.Terms })));
const Privacy = lazy(() => import("./components/Pages/Pages").then((m) => ({ default: m.Privacy })));
const FAQ = lazy(() => import("./components/Pages/Pages").then((m) => ({ default: m.FAQ })));
const Login = lazy(() => import("./components/Auth/Login").then((m) => ({ default: m.Login })));
const Signup = lazy(() => import("./components/Auth/Signup").then((m) => ({ default: m.Signup })));
const ForgotPassword = lazy(() => import("./components/Auth/ForgotPassword").then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import("./components/Auth/ResetPassword").then((m) => ({ default: m.ResetPassword })));
const VerifyEmail = lazy(() => import("./components/Auth/VerifyEmail").then((m) => ({ default: m.VerifyEmail })));
const Join = lazy(() => import("./components/Join/Join").then((m) => ({ default: m.Join })));

const RouteFallback = () => (
  <Center style={{ minHeight: "60vh", width: "100%" }}>
    <Loader color="violet" size="md" />
  </Center>
);

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
      defaultProps: {
        radius: "md",
      },
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
      defaultProps: {
        radius: "md",
      },
      styles: {
        input: {
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
          color: "var(--text-primary)",
        },
      },
    },
    PasswordInput: {
      defaultProps: {
        radius: "md",
      },
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

const cachedUser = getCachedSupabaseUser();
let cachedProfileData: { displayName?: string; avatarUrl?: string | null; pref_appearance_mode?: AppearanceMode } = {};
try {
  const raw = typeof window !== "undefined" ? window.localStorage.getItem("cowatch-cached-profile") : null;
  if (raw) {
    cachedProfileData = JSON.parse(raw);
  }
} catch (e) { }

const initialResolved = cachedUser ? resolveProfile(null, cachedUser) : null;
const initialDisplayName = cachedProfileData.displayName || initialResolved?.displayName || "Guest";
const initialAvatarUrl = cachedProfileData.avatarUrl !== undefined ? cachedProfileData.avatarUrl : (initialResolved?.avatarUrl || null);

const getInitialAppearance = (): AppearanceMode => {
  if (typeof window !== "undefined") {
    const local = window.localStorage.getItem("cowatch-appearance");
    if (local === "light" || local === "mantine" || local === "system") {
      return local as AppearanceMode;
    }
  }
  return (cachedProfileData.pref_appearance_mode || "system") as AppearanceMode;
};

const initialAppearance = getInitialAppearance();

class CoWatch extends React.Component {
  public state = {
    ...DEFAULT_STATE,
    user: (cachedUser ?? (hasCachedSupabaseToken() ? undefined : null)) as User | null | undefined,
    displayName: initialDisplayName,
    avatarUrl: initialAvatarUrl,
    userAppearance: initialAppearance,
    setMetadata: (data: any) => {
      this.setState(data);
    },
  };

  handleAppearanceChange = async (appearance: AppearanceMode) => {
    this.setState({ userAppearance: appearance });
    try {
      window.localStorage.setItem("cowatch-appearance", appearance);
      const cached = window.localStorage.getItem("cowatch-cached-profile");
      const parsed = cached ? JSON.parse(cached) : {};
      parsed.pref_appearance_mode = appearance;
      window.localStorage.setItem("cowatch-cached-profile", JSON.stringify(parsed));
    } catch (e) { }

    const { user } = this.state;
    if (user) {
      try {
        await supabase
          .from("profiles")
          .update({ pref_appearance_mode: appearance })
          .eq("id", user.id);
      } catch (err) {
        console.warn("Failed to persist appearance preference to Supabase:", err);
      }
    }
  };

  private authSubscription: { unsubscribe: () => void } | null = null;
  private authTimeout: any = null;
  private lastSessionToken: string | null | undefined = undefined;

  componentWillUnmount() {
    if (this.authTimeout) {
      clearTimeout(this.authTimeout);
    }
    this.authSubscription?.unsubscribe();
  }

  async componentDidMount() {
    // Purge legacy profile keys from users' browsers
    window.localStorage.removeItem("cowatch-username");
    window.localStorage.removeItem("cowatch-avatar");

    if (supabaseUrl && config.VITE_SUPABASE_PUBLISHABLE_KEY) {
      const handleSession = async (session: any) => {
        const user = session?.user;
        const token = session?.access_token;

        if (this.lastSessionToken === token && user && this.state.user) {
          return;
        }
        this.lastSessionToken = token;

        if (this.authTimeout) {
          clearTimeout(this.authTimeout);
          this.authTimeout = null;
        }

        try {
          if (user) {
            // Eagerly set user so auth guards immediately resolve
            this.setState({ user });

            const fetchMetadataPromise = window
              .fetch(serverPath + `/metadata?uid=${user.id}&token=${token}`, {
                signal: AbortSignal.timeout(1500),
              })
              .then((res) => (res.ok ? res.json() : {}))
              .catch((err) => {
                console.warn("Backend server unreachable or timed out, skipping metadata:", err);
                return {};
              });

            const fetchProfilePromise = (async () => {
              try {
                const profilePromise = supabase
                  .from("profiles")
                  .select(
                    "display_name, username, avatar_url, pref_show_chat_column, pref_show_people_column, pref_disable_chat_sound, pref_camera_on, pref_mic_on, pref_appearance_mode"
                  )
                  .eq("id", user.id)
                  .maybeSingle();

                const timeoutPromise = new Promise<{ data: null }>((resolve) =>
                  setTimeout(() => resolve({ data: null }), 1500)
                );

                const { data } = await Promise.race([profilePromise, timeoutPromise]);
                return data;
              } catch (err) {
                console.warn("Profile fetch error:", err);
                return null;
              }
            })();

            const [metadataResult, profileResult] = await Promise.allSettled([
              fetchMetadataPromise,
              fetchProfilePromise,
            ]);

            const metadata: any = metadataResult.status === "fulfilled" ? metadataResult.value : {};
            let profile: any = profileResult.status === "fulfilled" ? profileResult.value : null;

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

              try {
                const upsertPromise = supabase
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
                  .select(
                    "display_name, username, avatar_url, pref_show_chat_column, pref_show_people_column, pref_disable_chat_sound, pref_camera_on, pref_mic_on, pref_appearance_mode"
                  )
                  .maybeSingle();

                const timeoutPromise = new Promise<{ data: null }>((resolve) =>
                  setTimeout(() => resolve({ data: null }), 1500)
                );

                const { data: newProfile } = await Promise.race([upsertPromise, timeoutPromise]);
                if (newProfile) {
                  profile = newProfile;
                }
              } catch (upsertErr) {
                console.warn("Profile auto-creation failed:", upsertErr);
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

            const activeAppearance = (() => {
              if (typeof window !== "undefined") {
                const local = window.localStorage.getItem("cowatch-appearance");
                if (local === "light" || local === "mantine" || local === "system") {
                  return local as AppearanceMode;
                }
              }
              return (profile?.pref_appearance_mode || "system") as AppearanceMode;
            })();

            try {
              window.localStorage.setItem(
                "cowatch-cached-profile",
                JSON.stringify({
                  displayName,
                  avatarUrl,
                  pref_appearance_mode: activeAppearance,
                })
              );
              window.localStorage.setItem("cowatch-appearance", activeAppearance);
            } catch (e) { }

            if (profile && user && activeAppearance && profile.pref_appearance_mode !== activeAppearance) {
              Promise.resolve(
                supabase
                  .from("profiles")
                  .update({ pref_appearance_mode: activeAppearance })
                  .eq("id", user.id)
              ).catch((e: any) => console.warn("Could not sync appearance to DB:", e));
            }

            this.setState({
              user,
              profile,
              displayName,
              avatarUrl,
              streamPath: metadata?.streamPath,
              convertPath: metadata?.convertPath,
              beta: metadata?.beta,
              capabilities: metadata?.capabilities || DEFAULT_STATE.capabilities,
              userAppearance: activeAppearance,
            });
          } else {
            try {
              window.localStorage.removeItem("cowatch-cached-profile");
            } catch (e) { }
            this.setState({ user: null, profile: null, displayName: "Guest", avatarUrl: null });
            window
              .fetch(serverPath + "/metadata", {
                signal: AbortSignal.timeout(1500),
              })
              .then((res) => (res.ok ? res.json() : {}))
              .then((guestMeta: any) => {
                if (guestMeta?.capabilities) {
                  this.setState({ capabilities: guestMeta.capabilities });
                }
              })
              .catch(() => { });
          }
        } catch (fatalErr) {
          console.error("Critical error in handleSession:", fatalErr);
          this.setState({ user: null, profile: null, displayName: "Guest", avatarUrl: null });
        }
      };

      // Failsafe timeout: if auth takes longer than 4s, fall back safely without hanging
      this.authTimeout = setTimeout(() => {
        if (this.state.user === undefined) {
          if (hasCachedSupabaseToken() && cachedUser) {
            this.setState({ user: cachedUser });
          } else {
            console.warn("Auth initialization timed out, falling back to unauthenticated guest mode.");
            this.setState({ user: null, profile: null, displayName: "Guest", avatarUrl: null });
          }
        }
      }, 4000);

      // Listen for changes. Defer handleSession via setTimeout(0) to prevent GoTrue mutex deadlock.
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT") {
          setTimeout(() => {
            handleSession(null);
          }, 0);
          return;
        }
        setTimeout(() => {
          handleSession(session);
        }, 0);
      });
      this.authSubscription = subscription;

      // Fetch initial session with safe fallback that preserves cached session on refresh
      safeGetSession(4000)
        .then(({ data, error }: any) => {
          if (error) {
            console.warn("Initial session check warning:", error);
            // Do not clear user if an authenticated token is present in localStorage
            if (hasCachedSupabaseToken() && this.state.user) {
              return;
            }
          }
          if (data?.session) {
            setTimeout(() => {
              handleSession(data.session);
            }, 0);
          } else if (!hasCachedSupabaseToken()) {
            setTimeout(() => {
              handleSession(null);
            }, 0);
          }
        })
        .catch(err => {
          console.warn("Failed to get initial session:", err);
          if (!hasCachedSupabaseToken() && this.state.user === undefined) {
            this.setState({ user: null, profile: null, displayName: "Guest", avatarUrl: null });
          }
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
                <AuthContext.Provider
                  value={{
                    user: this.state.user,
                    isAuthenticated: Boolean(this.state.user),
                    isLoading: this.state.user === undefined,
                  }}
                >
                  <BrowserRouter>
                    <AppShell>
                      <Suspense fallback={<RouteFallback />}>
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
                          path={["/join", "/join/:roomId"]}
                          exact
                          component={Join}
                        />
                        <Route
                          path="/create"
                          exact
                          render={() => {
                            return (
                              <RequireVerifiedEmail>
                                <TopBar />
                                <Create />
                              </RequireVerifiedEmail>
                            );
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
                        <Route path={["/account", "/account/:tab*"]}>
                          <RequireVerifiedEmail>
                            <TopBar />
                            <Profile />
                          </RequireVerifiedEmail>
                        </Route>
                        <Route path="/profile" exact>
                          <Redirect to="/account/profile" />
                        </Route>
                        <Route path="/rooms" exact>
                          <RequireVerifiedEmail>
                            <TopBar />
                            <MyRooms />
                          </RequireVerifiedEmail>
                        </Route>
                        <Route path="/rooms/:roomId">
                          <RequireVerifiedEmail>
                            <TopBar />
                            <RoomDetails />
                          </RequireVerifiedEmail>
                        </Route>
                        <Route path="/debug">
                          <>
                            <TopBar />
                            <Debug />
                          </>
                        </Route>
                      </Suspense>
                    </AppShell>
                  </BrowserRouter>
                </AuthContext.Provider>
              </MetadataContext.Provider>
              <SpeedInsights />
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
