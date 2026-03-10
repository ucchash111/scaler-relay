# 🛰️ Scalar Relay

**Scalar Relay** is an architectural bridge designed to decouple sensitive SMTP credentials from your application logic. By utilizing a stateless HTTP-to-SMTP execution model, Scalar eliminates the need for persistent credential storage in distributed n8n, Docker, and CI/CD environments.

![Scalar Relay Dashboard](https://via.placeholder.com/800x450.png?text=Scalar+Relay+Dashboard+Preview)

## 🚀 Key Features

- **Stateless by Design**: Sensitive credentials stay in one place. Your apps just need an API Key.
- **Dashboard Security**: Protected by a login page and password.
- **Setup Wizard**: Sleek onboarding to configure your SMTP settings in seconds.
- **Live Feed Dashboard**: Monitor the last 50 sent emails in real-time (In-memory, RAM-only).
- **Test Console**: Verify your SMTP connection directly from the UI.
- **Gateway Mode**: Allow API requests to override global credentials for complex workflows.
- **Open Source & Extensible**: Built with Node.js, EJS, and Tailwind CSS.

## 🛠️ Quick Start

### Using Docker (Recommended)

```bash
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/config:/app/config \
  --name scalar-relay \
  ucchash/scalar-relay
```

### Deploying to Coolify

1. Create a new **Service** in Coolify.
2. Select **Docker Compose**.
3. Paste the contents of `docker-compose.yml`.
4. Add `SESSION_SECRET` to the environment variables.
5. Deploy. Coolify will automatically detect the health check!

### Deployment & Configuration

1. **Environment Variables**: Clone `.env.example` to `.env` and set your `SESSION_SECRET` and `PORT`.
2. **Docker**: Scalar is optimized for any Docker-based registry. Point your orchestrator to the `/health` endpoint for automated monitoring.

### 🌐 Distribution & Registries

#### 1. Coolify Service Selection
To make Scalar Relay a "Pre-selected" service in Coolify:
- Add `coolify.json` to the root of your repository (already included).
- Submit a PR to the [Coolify Services Repository](https://github.com/coollabsio/coolify/tree/main/templates/compose) with your `docker-compose.yml`.
- Your service will then appear in the "Services" catalog for all Coolify users.

#### 2. Docker Hub (Registry)
To publish your own image:
```bash
docker build -t yourusername/scalar-relay:latest .
docker push yourusername/scalar-relay:latest
```

#### 3. NPM (CLI tool)
You can also distribute Scalar as a global CLI:
- Update `package.json` to include `"bin": { "scalar-relay": "src/index.js" }`.
- Run `npm publish` to make it available via `npm install -g`.
- Users can then run `scalar-relay` directly.

#### 4. GitHub Template
Turn this repository into a **Template** (Settings -> General -> Template Repository) so users can click "Use this template" to start their own instance.

## 🔌 API Usage

### Send an Email

**POST** `/api/send`

**Headers:**
```http
x-api-key: your_master_api_key
Content-Type: application/json
```

**Body:**
```json
{
  "to": "recipient@example.com",
  "subject": "Hello from Scalar",
  "text": "Sent via Scalar Relay bridge.",
  "html": "<b>Sent via Scalar Relay bridge.</b>"
}
```

## 🛡️ Security

Scalar Relay is designed to be self-hosted. Ensure your instance is not exposed to the public internet without proper firewall rules or an auth proxy. The **Master API Key** is generated locally during the first-run setup.

### Gateway Mode (Advanced)
Send via a different SMTP server using request-level overrides:

```json
{
  "to": "recipient@example.com",
  "subject": "Overridden SMTP",
  "smtpOverride": {
    "host": "smtp.sendgrid.net",
    "port": 465,
    "user": "apikey",
    "pass": "SG.secret"
  }
}
```

## 🛠️ Infrastructure

### Docker Compose
```bash
docker-compose up -d
```

### Health Checks
Monitor the instance at `GET /health`.

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) and [LICENSE](LICENSE) for details.

---
Built with ❤️ for the Open Source Community.
