- Never create TS/JS files to inspect the database. Strictly use the Supabase MCP tools (e.g., execute_sql, list_tables) or plain SQL scripts for database operations.
- Always keep the repository up to date with the remote origin after committing changes.
- Never use window.confirm, window.alert, or native browser prompt dialogs. Always use custom Mantine modals or toasts/notifications for user confirmations and alerts.
- Never auto-confirm users in the database or bypass email verification; users must always confirm their email through the proper verification flow.
- Never delete any file in the repository; instead of deleting files, convert them to our configurations.
- Always write detailed commit messages including a structured summary, architectural rationale, key changes, and verification notes.
- Never show host-only UI, moderation controls, room configuration options, room credentials (such as passcodes), or invitation controls to non-host participants or guests. Non-hosts must never be able to invite users, copy party invite links/messages, unmask passcodes, moderate chat, or alter room playback lock and capacity settings. All host-only UI elements and invitation actions must be conditionally excluded from rendering (not merely disabled or hidden with CSS), and server-side authorization must strictly reject unauthorized invitation requests and host actions from non-hosts.

