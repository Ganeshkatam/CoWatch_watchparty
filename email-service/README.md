# CoWatch Email Service

A standalone Node.js 24 service deployed independently from CoWatch. It owns provider credentials, template rendering, provider routing, and email dispatch.

## Architecture

- The service does not connect to PostgreSQL and does not create a database.
- CoWatch remains the durable source of truth through its existing transactional `email_outbox`.
- The service claims jobs from CoWatch over authenticated HTTPS, sends them through the configured provider, and acknowledges the result over HTTPS.
- CoWatch retains notification policy, recipient resolution, outbox state, suppression records, and provider webhook state.
- The service exposes one authenticated fixed-template endpoint for duplicate-signup security notices. It does not accept arbitrary HTML.

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

## Deployment

Deploy this folder as the service root on a separate machine or hosting service. Install its dependencies from this folder and run `npm start`. Configure the environment variables in the deployment platform; do not commit `.env`.

The CoWatch server must deploy the matching internal API before the remote worker is enabled. The worker leaves pending jobs in CoWatch's outbox whenever the API is unavailable.
