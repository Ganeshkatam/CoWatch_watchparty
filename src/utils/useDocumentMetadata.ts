import { useEffect } from "react";

export interface DocumentMetadataOptions {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  canonicalUrl?: string;
  type?: string;
  siteName?: string;
  noIndex?: boolean;
}

const DEFAULT_TITLE = "CoWatch - Watch Together with Friends";
const DEFAULT_DESCRIPTION =
  "Watch together with friends. Chat and react in real time to the same stream, whether it's YouTube, your own video, or a virtual browser.";

export function formatDocumentTitle(title?: string): string {
  if (!title || !title.trim()) {
    return DEFAULT_TITLE;
  }
  const trimmed = title.trim();
  if (trimmed.endsWith("CoWatch") || trimmed.endsWith("CoWatch | Watch Party")) {
    return trimmed;
  }
  return `${trimmed} | CoWatch`;
}

function setLinkTag(rel: string, href: string | undefined): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  let el = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  const prevHref = el ? el.getAttribute("href") : null;
  const existedBefore = Boolean(el);

  if (href !== undefined) {
    if (!el) {
      el = document.createElement("link");
      el.setAttribute("rel", rel);
      document.head.appendChild(el);
    }
    el.setAttribute("href", href);
  } else if (el) {
    el.remove();
  }

  return () => {
    if (typeof document === "undefined") return;
    const currentEl = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;

    if (existedBefore && prevHref !== null) {
      if (currentEl) {
        currentEl.setAttribute("href", prevHref);
      } else {
        const restored = document.createElement("link");
        restored.setAttribute("rel", rel);
        restored.setAttribute("href", prevHref);
        document.head.appendChild(restored);
      }
    } else if (currentEl) {
      currentEl.remove();
    }
  };
}

function setMetaTag(
  attrName: "name" | "property",
  attrValue: string,
  content: string | undefined
): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  let el = document.querySelector(
    `meta[${attrName}="${attrValue}"]`
  ) as HTMLMetaElement | null;
  const prevContent = el ? el.getAttribute("content") : null;
  const existedBefore = Boolean(el);

  if (content !== undefined) {
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(attrName, attrValue);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  } else if (el) {
    el.remove();
  }

  return () => {
    if (typeof document === "undefined") return;
    const currentEl = document.querySelector(
      `meta[${attrName}="${attrValue}"]`
    ) as HTMLMetaElement | null;

    if (existedBefore && prevContent !== null) {
      if (currentEl) {
        currentEl.setAttribute("content", prevContent);
      } else {
        const restored = document.createElement("meta");
        restored.setAttribute(attrName, attrValue);
        restored.setAttribute("content", prevContent);
        document.head.appendChild(restored);
      }
    } else if (currentEl) {
      currentEl.remove();
    }
  };
}

/**
 * Imperative helper to set metadata on the active document and return a cleanup function.
 * Useful in class components or event handlers.
 */
export function setDocumentMetadata(options: DocumentMetadataOptions): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const cleanups: (() => void)[] = [];

  // Title
  if (options.title !== undefined) {
    const prevTitle = document.title;
    document.title = formatDocumentTitle(options.title);
    cleanups.push(() => {
      if (typeof document !== "undefined") {
        document.title = prevTitle;
      }
    });
  }

  // Description
  if (options.description !== undefined) {
    cleanups.push(setMetaTag("name", "description", options.description || DEFAULT_DESCRIPTION));
    cleanups.push(setMetaTag("property", "og:description", options.description || DEFAULT_DESCRIPTION));
    cleanups.push(setMetaTag("name", "twitter:description", options.description || DEFAULT_DESCRIPTION));
  }

  // OpenGraph Title & Twitter Title
  if (options.title !== undefined) {
    const formattedTitle = formatDocumentTitle(options.title);
    cleanups.push(setMetaTag("property", "og:title", formattedTitle));
    cleanups.push(setMetaTag("name", "twitter:title", formattedTitle));
  }

  // OpenGraph Image & Twitter Image
  if (options.image !== undefined) {
    cleanups.push(setMetaTag("property", "og:image", options.image));
    cleanups.push(setMetaTag("name", "twitter:image", options.image));
  }

  // OpenGraph URL
  if (options.url !== undefined) {
    cleanups.push(setMetaTag("property", "og:url", options.url));
  }

  // Canonical URL
  if (options.canonicalUrl !== undefined) {
    cleanups.push(setLinkTag("canonical", options.canonicalUrl));
  }

  // OpenGraph Type
  if (options.type !== undefined) {
    cleanups.push(setMetaTag("property", "og:type", options.type));
  }

  // OpenGraph Site Name
  if (options.siteName !== undefined) {
    cleanups.push(setMetaTag("property", "og:site_name", options.siteName));
  }

  // Robots / noIndex
  if (options.noIndex) {
    cleanups.push(setMetaTag("name", "robots", "noindex, nofollow"));
  }

  return () => {
    for (let i = cleanups.length - 1; i >= 0; i--) {
      cleanups[i]();
    }
  };
}

/**
 * Declarative hook for React components.
 */
export function useDocumentMetadata(
  options: DocumentMetadataOptions,
  deps: React.DependencyList = []
): void {
  useEffect(() => {
    const cleanup = setDocumentMetadata(options);
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
