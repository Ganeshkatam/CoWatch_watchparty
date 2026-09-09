/**
 * Picture-in-Picture Lifecycle Manager
 * Handles Document Picture-in-Picture (for YouTube and custom player containers)
 * and falls back to standard HTMLVideoElement Picture-in-Picture for native media.
 */

export type PiPStage = "idle" | "opening" | "active" | "closing";

export interface PiPState {
  stage: PiPStage;
  active: boolean;
  mode: "document" | "native" | null;
  target: HTMLElement | null;
}

interface PiPSession {
  target: HTMLElement;
  placeholder: HTMLElement;
  originalParent: HTMLElement;
  pipWindow: Window;
  pagehideHandler: () => void;
  themeObserver?: MutationObserver;
}

interface NativeSession {
  video: HTMLVideoElement;
  leaveHandler: () => void;
}

class PiPManager {
  private state: PiPState = {
    stage: "idle",
    active: false,
    mode: null,
    target: null,
  };

  private session: PiPSession | null = null;
  private nativeSession: NativeSession | null = null;
  private listeners: Set<(state: PiPState) => void> = new Set();

  public getState(): PiPState {
    return { ...this.state };
  }

  public subscribe = (listener: (state: PiPState) => void): (() => void) => {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  };

  private setState(partial: Partial<PiPState>) {
    this.state = { ...this.state, ...partial };
    const currentState = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(currentState);
      } catch (err) {
        console.error("PiP state listener error:", err);
      }
    });
  }

  /**
   * Checks whether the browser supports the W3C Document Picture-in-Picture API
   * in the current secure browsing context.
   */
  public isDocumentPiPSupported = (): boolean => {
    return (
      typeof window !== "undefined" &&
      Boolean(window.isSecureContext) &&
      "documentPictureInPicture" in window &&
      typeof (window as any).documentPictureInPicture?.requestWindow === "function"
    );
  };

  /**
   * Checks whether standard HTML5 video Picture-in-Picture is supported.
   */
  public isNativePiPSupported = (video?: HTMLVideoElement | null): boolean => {
    if (typeof document === "undefined" || !document.pictureInPictureEnabled) {
      return false;
    }
    if (!video) return true;
    return !video.disablePictureInPicture;
  };

  /**
   * Opens Document Picture-in-Picture and relocates the target DOM node into the floating window.
   */
  public openDocumentPiP = async (
    target: HTMLElement,
    options?: { width?: number; height?: number }
  ): Promise<boolean> => {
    if (!this.isDocumentPiPSupported()) {
      return false;
    }

    if (this.state.stage !== "idle") {
      if (this.state.active && this.state.target === target) {
        await this.restoreAndClose();
        return false;
      }
      // Another target is active or transitioning
      return false;
    }

    const originalParent = target.parentElement;
    if (!originalParent) {
      console.warn("PiP target has no parent element to attach placeholder.");
      return false;
    }

    this.setState({ stage: "opening", active: false, mode: "document", target });

    const width = options?.width || target.clientWidth || 640;
    const height = options?.height || target.clientHeight || 360;

    let pipWindow: Window;
    try {
      pipWindow = await (window as any).documentPictureInPicture.requestWindow({
        width,
        height,
      });
    } catch (err) {
      console.warn("Failed to request Document PiP window:", err);
      this.setState({ stage: "idle", active: false, mode: null, target: null });
      return false;
    }

    // Defensive stylesheet and theme replication
    this.copyStylesheets(pipWindow);
    this.copyThemeAttributes(pipWindow);

    // Build dedicated, bounded container inside the PiP window
    const root = pipWindow.document.createElement("div");
    root.className = "cowatch-pip-root";
    root.style.width = "100%";
    root.style.height = "100%";
    root.style.display = "flex";
    root.style.alignItems = "center";
    root.style.justifyContent = "center";
    root.style.backgroundColor = "var(--bg-video-player, #000)";
    root.style.overflow = "hidden";

    pipWindow.document.body.style.margin = "0";
    pipWindow.document.body.style.padding = "0";
    pipWindow.document.body.style.width = "100%";
    pipWindow.document.body.style.height = "100%";
    pipWindow.document.body.style.overflow = "hidden";
    pipWindow.document.body.style.backgroundColor = "var(--bg-video-player, #000)";
    pipWindow.document.body.appendChild(root);

    // Insert lightweight DOM placeholder before target
    const placeholder = document.createElement("div");
    placeholder.setAttribute("data-pip-placeholder", "true");
    placeholder.style.display = "none";
    originalParent.insertBefore(placeholder, target);

    // Physically relocate target into PiP window
    root.appendChild(target);

    // Setup theme synchronization observer
    let themeObserver: MutationObserver | undefined;
    if (typeof MutationObserver !== "undefined") {
      themeObserver = new MutationObserver(() => {
        this.copyThemeAttributes(pipWindow);
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-mantine-color-scheme", "data-color-scheme", "class"],
      });
    }

    const pagehideHandler = () => {
      this.handleDocumentPiPHide();
    };
    pipWindow.addEventListener("pagehide", pagehideHandler);

    this.session = {
      target,
      placeholder,
      originalParent,
      pipWindow,
      pagehideHandler,
      themeObserver,
    };

    this.setState({
      stage: "active",
      active: true,
      mode: "document",
      target,
    });

    return true;
  };

  private copyStylesheets(pipWindow: Window) {
    [...document.styleSheets].forEach((styleSheet) => {
      try {
        if (styleSheet.href) {
          const newLinkEl = document.createElement("link");
          newLinkEl.rel = "stylesheet";
          newLinkEl.type = styleSheet.type || "text/css";
          newLinkEl.media = styleSheet.media.mediaText || "all";
          newLinkEl.href = styleSheet.href;
          pipWindow.document.head.appendChild(newLinkEl);
        } else if (styleSheet.cssRules) {
          const newStyleEl = document.createElement("style");
          for (const rule of styleSheet.cssRules) {
            newStyleEl.appendChild(document.createTextNode(rule.cssText));
          }
          pipWindow.document.head.appendChild(newStyleEl);
        }
      } catch (e) {
        // Fallback for cross-origin or restricted stylesheets: clone link if href exists
        try {
          if (styleSheet.href) {
            const fallbackLink = document.createElement("link");
            fallbackLink.rel = "stylesheet";
            fallbackLink.href = styleSheet.href;
            pipWindow.document.head.appendChild(fallbackLink);
          }
        } catch (_) {
          // Skip inaccessible sheet
        }
      }
    });
  }

  private copyThemeAttributes(pipWindow: Window) {
    try {
      const srcEl = document.documentElement;
      const targetEl = pipWindow.document.documentElement;

      const mantineScheme = srcEl.getAttribute("data-mantine-color-scheme");
      if (mantineScheme) {
        targetEl.setAttribute("data-mantine-color-scheme", mantineScheme);
      }

      const colorScheme = srcEl.getAttribute("data-color-scheme");
      if (colorScheme) {
        targetEl.setAttribute("data-color-scheme", colorScheme);
      }

      if (srcEl.className) {
        targetEl.className = srcEl.className;
      }
    } catch (e) {
      console.warn("Theme sync to PiP failed:", e);
    }
  }

  private handleDocumentPiPHide = () => {
    if (!this.session) return;
    this.setState({ stage: "closing", active: false, mode: null, target: null });
    this.restoreSessionDOM(this.session);
    this.session.themeObserver?.disconnect();
    this.session = null;
    this.setState({ stage: "idle", active: false, mode: null, target: null });
  };

  private restoreSessionDOM(session: PiPSession) {
    try {
      if (session.placeholder.parentElement) {
        session.placeholder.replaceWith(session.target);
      } else if (session.originalParent) {
        session.originalParent.appendChild(session.target);
      }
    } catch (e) {
      console.warn("Failed to restore PiP target DOM:", e);
    }
  }

  /**
   * Toggles native video Picture-in-Picture with enter/leave event bindings.
   */
  private toggleNativePiP = async (video: HTMLVideoElement): Promise<void> => {
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
        this.nativeSession = null;
        this.setState({ stage: "idle", active: false, mode: null, target: null });
      } else {
        this.setState({ stage: "opening", active: false, mode: "native", target: video });
        const leaveHandler = () => {
          video.removeEventListener("leavepictureinpicture", leaveHandler);
          this.nativeSession = null;
          this.setState({ stage: "idle", active: false, mode: null, target: null });
        };
        video.addEventListener("leavepictureinpicture", leaveHandler);
        await video.requestPictureInPicture();
        this.nativeSession = { video, leaveHandler };
        this.setState({ stage: "active", active: true, mode: "native", target: video });
      }
    } catch (e) {
      console.warn("Failed to toggle native Picture-in-Picture:", e);
      this.nativeSession = null;
      this.setState({ stage: "idle", active: false, mode: null, target: null });
    }
  };

  /**
   * User-activated toggle: Document PiP preferred, with native video fallback.
   */
  public toggle = async (
    target: HTMLElement,
    fallbackVideo?: HTMLVideoElement | null
  ): Promise<void> => {
    if (this.state.active || this.state.stage === "active") {
      await this.restoreAndClose();
      return;
    }

    if (this.state.stage !== "idle") {
      return;
    }

    if (this.isDocumentPiPSupported()) {
      await this.openDocumentPiP(target);
      return;
    }

    const videoEl =
      fallbackVideo || (target instanceof HTMLVideoElement ? target : null);
    if (videoEl && this.isNativePiPSupported(videoEl)) {
      await this.toggleNativePiP(videoEl);
      return;
    }

    console.warn("Picture-in-Picture is not supported for this media in this browser.");
  };

  /**
   * Closes active Document or Native PiP window and restores target element.
   */
  public close = async (): Promise<void> => {
    await this.restoreAndClose();
  };

  /**
   * Explicitly restores DOM before attempting to close the PiP window.
   */
  public restoreAndClose = async (): Promise<void> => {
    if (this.session) {
      const { pipWindow, themeObserver } = this.session;
      this.setState({ stage: "closing", active: false, mode: null, target: null });
      themeObserver?.disconnect();
      this.restoreSessionDOM(this.session);
      this.session = null;
      try {
        if (pipWindow && !pipWindow.closed) {
          pipWindow.close();
        }
      } catch (e) {
        console.warn("Error closing PiP window:", e);
      }
      this.setState({ stage: "idle", active: false, mode: null, target: null });
    } else if (this.nativeSession) {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        }
      } catch (e) {
        console.warn("Error exiting native PiP:", e);
      }
      this.nativeSession = null;
      this.setState({ stage: "idle", active: false, mode: null, target: null });
    }
  };

  /**
   * Synchronous best-effort teardown during component unmount.
   */
  public cleanup = (): void => {
    if (this.session) {
      const { pipWindow, themeObserver } = this.session;
      themeObserver?.disconnect();
      this.restoreSessionDOM(this.session);
      this.session = null;
      try {
        if (pipWindow && !pipWindow.closed) {
          pipWindow.close();
        }
      } catch (e) {
        // best-effort
      }
    }
    if (this.nativeSession) {
      try {
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(() => {});
        }
      } catch (e) {
        // best-effort
      }
      this.nativeSession = null;
    }
    this.setState({ stage: "idle", active: false, mode: null, target: null });
  };
}

export const pipManager = new PiPManager();
