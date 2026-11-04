# Environment variables used by Agiki / Piitrade

`NEXT_PUBLIC_*` are inlined into the browser bundle at **build time** (set them as build variables, then rebuild).
Required = the app will not start or a feature is unusable without it. Everything else has a default or is optional.

## Backend

### Core
| Variable | Req. | Default / notes |
|---|---|---|
| `DATABASE_URL` | yes* | PostgreSQL URL. *Either this or `DATABASE_PRIVATE_URL`. |
| `DATABASE_PRIVATE_URL` | — | Railway private-network URL; preferred over `DATABASE_URL` when set |
| `JWT_SECRET` | yes | Access-token signing secret |
| `JWT_REFRESH_SECRET` | yes | Refresh-token signing secret |
| `JWT_EXPIRES_IN` | — | `70d` |
| `JWT_REFRESH_EXPIRES_IN` | — | `3650d` |
| `PORT` | — | `5000` |
| `NODE_ENV` | — | `production` enables strict checks (e.g. admin password rules) |
| `CORS_ORIGIN` | yes (prod) | Allowed browser origin(s), e.g. `https://piitrade.com` |
| `FRONTEND_URL` | — | `https://piitrade.com`; used in links inside emails/notifications |
| `API_BASE_URL` | — | Public backend URL (MoMo sandbox helper scripts) |
| `RATE_LIMIT_MAX` | — | `500` requests per window |
| `RATE_LIMIT_WINDOW_MS` | — | `900000` (15 min) |
| `AUTO_MIGRATE_ON_START` | — | Run migrations on boot when set |
| `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID` | — | Set by Railway; detected, not configured by you |

### Admin & accounts
| Variable | Req. | Notes |
|---|---|---|
| `ADMIN_PASSWORD` | prod | ≥ 12 chars, must not contain "change"/"admin@123" in production (seed/db-setup) |
| `ADMIN_SECRET` | — | Shared secret expected by the admin-registration endpoint |
| `ENABLE_ADMIN_REGISTER` | — | `true` to allow admin self-registration (keep off in production) |
| `ORDINARY_USER_MAX_LISTINGS` | — | Cap on listings for ordinary users |
| `FARMER_MARKETPLACE_DEMO_DATA` | — | Must be `true` to seed demo data in production |

### File storage (S3-compatible; unset = local `uploads/` folder)
| Variable | Notes |
|---|---|
| `ENDPOINT` | S3 endpoint URL |
| `ACCESS_KEY_ID` | S3 key id |
| `SECRET_ACCESS_KEY` | S3 secret |
| `BUCKET` | Bucket name |

### Admin Backup & Restore (new, all optional)
| Variable | Default |
|---|---|
| `BACKUP_MAX_UPLOAD_MB` | `1024` |
| `BACKUP_MAX_MEDIA_UPLOAD_MB` | `4096` |
| `BACKUP_RATE_LIMIT_PER_HOUR` | `20` |

### Email & push
| Variable | Notes |
|---|---|
| `RESEND_API_KEY` | Resend email API key |
| `RESEND_FROM_EMAIL` | Sender; falls back to `SMTP_FROM`, then `support@piitrade.com` |
| `SMTP_HOST`, `SMTP_PORT` (`587`), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | SMTP fallback |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web-push keys |
| `VAPID_SUBJECT` | `mailto:support@piitrade.com` |

### WhatsApp (Meta Cloud API)
`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (required to enable), `WHATSAPP_TEMPLATE_NAME` (`piitrade_alert`),
`WHATSAPP_AUTH_TEMPLATE_NAME` (`piitrade_verification`), `WHATSAPP_AUTH_TEMPLATE_COPY_CODE` (`false` hides the copy-code button),
`WHATSAPP_TEMPLATE_LANG` (`en`), `WHATSAPP_API_VERSION` (`v21.0`), `WHATSAPP_API_BASE` (`https://graph.facebook.com`).

### Payments
| Variable | Notes |
|---|---|
| `MTN_ENABLED` | `true` to turn on MTN MoMo |
| `MTN_ENVIRONMENT` | `production` or sandbox (default) |
| `MTN_BASE_URL` | Defaults to the MTN sandbox URL |
| `MTN_SUBSCRIPTION_KEY` | MTN API subscription key |
| `MTN_CALLBACK_URL` | Public webhook URL MTN calls back |
| `CV_PAYMENT_WEBHOOK_SECRET` | Secret for the CV-payment webhook |
| `CV_MAX_DOWNLOADS_PER_TOKEN` | `3` (1–10) |

### AI / moderation
| Variable | Notes |
|---|---|
| `LLM_PROVIDER` | Explicit provider; otherwise auto-picks `huggingface` (if `HF_API_TOKEN`) or `openai` (if `OPENAI_API_KEY`) |
| `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL` | Custom OpenAI-compatible endpoint |
| `HF_API_TOKEN` | Hugging Face token |
| `OPENAI_API_KEY` | OpenAI key |
| `IMAGE_AI_URL` | Image-AI worker; falls back to `NEXT_PUBLIC_IMAGE_AI_URL`, then the shared worker |
| `IMAGE_SAFETY_STRICT` | `true` = reject when the safety check is unavailable |
| `MODERATION_AUTO_REJECT_THRESHOLD` | `0.9` |

### Docker / tests only
`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` (docker-compose database), `TEST_DATABASE_URL` (integration tests; **tables are truncated**), `HOME`/`PATH` (read by a test).
Unit tests (`npm test`) need no database variables: `vitest.config.mts` supplies a placeholder.

## Frontend
| Variable | Req. | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | yes (build) | Public backend URL; the build refuses an unfilled `<…>` placeholder |
| `NEXT_PUBLIC_SITE_URL` | — | `https://piitrade.com`; canonical URLs, sitemap, robots, structured data |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | — | **New.** Search Console HTML-tag token |
| `BACKEND_INTERNAL_URL` | — | Server-side API URL (e.g. `http://backend:5000`); falls back to `NEXT_PUBLIC_API_URL` |
| `NEXT_IMAGE_HOSTS` | — | Comma-separated host allow-list for `/_next/image` (unset = any https host) |
| `NEXT_PUBLIC_IMAGE_AI_URL` | — | Image-AI worker used by "Auto-fill from photo" |
| `NEXT_PUBLIC_SHOW_ADMIN_REGISTER` | — | `true` shows the admin-register form in production |
| `SKIP_API_URL_CHECK` | — | Bypasses the build-time API URL check |
| `NODE_ENV` | — | Set by Next |
| Docker build args | — | `BUILD_MAX_OLD_SPACE_MB`, `NEXT_TELEMETRY_DISABLED`, `NODE_OPTIONS` |
