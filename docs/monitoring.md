# Precis Web Production Monitoring and Abuse Alerts

This runbook defines the monitoring signals and starter alert thresholds for the public Precis Web deployment. Configure these in Vercel Observability, your database provider dashboard, and any centralized log/metrics sink you use.

## Application log signals

The API emits JSON logs. Metric-like events have `event: "metric"` and a `metric` name. Useful security and reliability signals include:

| Signal | Source | Why it matters | Starter alert |
| --- | --- | --- | --- |
| `image_proxy.request` count | `/api/image-proxy` | Detect hotlinking, scraping, or unexpected image egress | > 300 requests in 5 minutes or > 3x 24-hour baseline |
| `image_proxy.upstream_host` grouped by `host` | `/api/image-proxy` | Detect abuse through unexpected upstream domains | Any unknown host in production, or one host > 80% of traffic unexpectedly |
| `image_proxy.error` grouped by `reason` | `/api/image-proxy` | Detect SSRF probing, SVG attempts, oversized image abuse, or upstream failures | Spike in `host is not allowed`, `private`, `svg_blocked`, `too_large`, or `timeout` |
| `image_proxy.response.bytes` sum | `/api/image-proxy` | Estimate bandwidth/egress pressure | > configured budget or > 3x 24-hour baseline |
| `rate_limit_exceeded` count grouped by `name` | In-process rate limiter | Detect clients exceeding API/image limits | Any sustained rate-limit hits for 10 minutes, or sudden spike |
| `db.query.duration_ms` p95/p99 | DB query wrapper | Detect slow database reads or provider issues | p95 > 500 ms for 10 minutes; p99 > 2 seconds |
| `server_error` count | API error handling | Detect 5xx regressions | > 5 errors in 5 minutes or > 1% of requests |
| `bad_request` count | API validation | Detect malicious/buggy clients | > 5% of requests for 10 minutes |

## Vercel dashboard requirements

Create dashboard panels for:

- Request volume by route, especially `/api/image-proxy`.
- 4xx and 5xx rates by function.
- Function duration p95/p99 and timeout count.
- Bandwidth/egress, especially image proxy responses.
- Top clients/IPs if available through Vercel Firewall/Logs.

Create alerts for:

- `/api/image-proxy` request spikes.
- Function errors and timeouts.
- Egress/bandwidth budget thresholds.
- Repeated rate-limit hits.

## Database provider dashboard requirements

Create dashboard panels for:

- Active connection count.
- Query latency p95/p99.
- CPU/storage/IO pressure if exposed by the provider.

Create alerts for:

- Connection count above 80% of the plan limit for 10 minutes.
- Query p95 latency above 500 ms for 10 minutes.
- Provider-specific CPU/storage/IO thresholds.

## Alert routing

Route production alerts to the maintainer channel used for Vercel/database incidents. At minimum, configure email notifications for the account owner. For team deployments, prefer Slack/PagerDuty/Opsgenie or the team's existing incident channel.

## Validation checklist

- Confirm dashboards show `/api/health`, `/api/articles`, `/api/sites`, `/api/topics`, and `/api/image-proxy` traffic.
- Trigger a safe local/staging 404 or validation error and confirm it is visible as a 4xx/log event.
- Trigger a test rate-limit hit in staging and confirm `rate_limit_exceeded` appears in logs.
- Confirm database latency and connection-count panels are populated.
- Confirm alert recipients receive a test notification.