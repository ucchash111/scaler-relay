# API Reference | Scalar Relay

Scalar Relay provides a secure HTTP interface to your SMTP server.

## 📡 Endpoints Summary

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | None | System health status |
| GET | `/api/info` | None | Instance metadata |
| POST | `/api/send` | Key | Send email via bridge |
| GET | `/api/logs` | Master | Fetch recent relay logs |
| GET | `/api/config` | Master | Fetch safe configuration |
| POST | `/api/keys` | Master | Generate new API keys |

---

## 🚀 Send Email
`POST /api/send`

Relay an email through the bridge.

### Headers
| Name | Required | Description |
|------|----------|-------------|
| `x-api-key` | Yes | Valid API Key |

### Body Parameters
| Name | Type | Description |
|------|------|-------------|
| `to` | String | Recipient email address |
| `subject` | String | Email subject line |
| `text` | String | Plain text version |
| `html` | String | HTML version |
| `fromOverride` | String | (Optional) Custom From address |

---

## 🔑 Key Management
`POST /api/keys`

Generate a new API key for a tenant/service.

### Headers
| Name | Required | Description |
|------|----------|-------------|
| `x-api-key` | Yes | **Master Key** only |

### Body Parameters
| Name | Type | Description |
|------|------|-------------|
| `label` | String | Required label for the key |

---

## 📦 System Health & Info
- `GET /health`: Returns `{ status: "UP" }`.
- `GET /api/info`: Returns engine version, uptime, and environment.
