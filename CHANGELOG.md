## August 2026

- **Rebranded as CoWatch:** Completely rebranded the application from WatchParty to CoWatch.
- **Supabase Migration:** Fully migrated backend authentication from Firebase/Discord to Supabase Auth.
- **Midnight Violet Design System:** Overhauled the entire UI with a modern, high-contrast SaaS-style theme (Midnight Violet).
- **Landing Page Redesign:** Rebuilt the landing page (`Home.tsx`) and Footer with responsive Mantine grids, native CSS design tokens, and a clean typography hierarchy.
- **Self-Hosted Avatars:** Removed third-party tracking avatars (Gravatar, Facebook).
- **Custom Profile Pictures:** Implemented a new profile picture upload feature utilizing a secure Supabase Storage bucket with strict Row Level Security (RLS).
- **Accessibility Improvements:** Added strict respect for `@media (prefers-reduced-motion: reduce)` globally.

## April 2023

- Added support for looping the same video
- Player now shows the buffered/downloaded ranges of video available
- Added a 3x speed playback option
- HLS/m3u8 live vs. non-live streams are now handled properly
- Improved HLS playback experience on Safari and Android Chrome
- Pasting Reddit links with video media is now supported
- Twitch links (streams and VODs) are now supported
