# CoWatch Email Service

A standalone Node.js 24 service deployed independently from CoWatch. It owns provider credentials, template rendering, provider routing, and email dispatch.

## Architecture

- The service does not connect to PostgreSQL and does not create a database.
- CoWatch remains the durable source of truth through its existing transactional `email_outbox`.
- The service claims jobs from CoWatch over authenticated HTTPS, sends them through the configured provider, and acknowledges the result over HTTPS.
- CoWatch retains notification policy, recipient resolution, outbox state, suppression records, and provider webhook state.
- The CoWatch deployment includes one authenticated fixed-template endpoint for duplicate-signup security notices. It does not accept arbitrary HTML.

## Run

Use Node.js 24.

```sh
cp .env.example .env
npm ci
npm run typecheck
npm test
npm start
```

Configure both sides with separate high-entropy secrets:

- `HOST_API_SECRET` on this service must equal CoWatch's `EMAIL_SERVICE_WORKER_SECRET`.
- `EMAIL_SERVICE_API_SECRET` on this service must equal CoWatch's `EMAIL_SERVICE_API_SECRET`.

Set CoWatch's `EMAIL_SERVICE_URL` to this service's HTTPS URL. Do not expose the service to browsers. Restrict inbound access to the CoWatch server where possible.

## Provider and sender configuration

Configure all provider credentials and sender identities in this service's deployment environment, never in the CoWatch server environment.

The service supports four delivery profiles: `transactional_default`, `transactional_invitation`, `transactional_security`, and `transactional_system`. Each profile has its own sender address, binding, provider selection, and provider credentials.

For four independent Brevo accounts:

- `BREVO_API_KEY` belongs only to the default profile.
- `BREVO_API_KEY_INVITATIONS` belongs only to the invitation profile.
- `BREVO_API_KEY_SECURITY` belongs only to the security profile.
- `BREVO_API_KEY_SYSTEM` belongs only to the system profile.
- Set the corresponding four sender variables: `EMAIL_FROM_ADDRESS`, `EMAIL_PROFILE_INVITATION_SENDER`, `EMAIL_PROFILE_SECURITY_SENDER`, and `EMAIL_PROFILE_SYSTEM_SENDER`.
- Keep all four profile bindings distinct and all four sender addresses distinct.
- Each Brevo API key must be present and unique. The service fails startup on a missing or reused key; it never falls back to another profile's account.

The profile-specific API-key variable is associated with its profile, even if you customize that profile's binding name. Provider routing remains server-side. A profile explicitly configured for SMTP uses the shared SMTP transport; use Brevo for all four profiles when separate Brevo account isolation is required.

The service validates credential presence and profile isolation at startup. It does not prove that a key is valid with Brevo or that a sender is verified; confirm those in each Brevo account and send a controlled delivery test before production traffic.

## Deployment

Deploy this folder as the service root on a separate machine or hosting service. Install its dependencies from this folder and run `npm start`. Configure the environment variables in the deployment platform; do not commit `.env`. The `templates.ts` registry and the fixed-template security endpoint are project-specific extension points; adapt them for another host application while keeping the delivery engine and provider policy isolated.

The CoWatch server must deploy the matching internal API before the remote worker is enabled. The worker leaves pending jobs in CoWatch's outbox whenever the API is unavailable.
