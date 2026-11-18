# Deployment Notes

## Nginx

This project expects the Node.js app to run on `127.0.0.1:8181`.

The provided nginx site config for `gateway.irengcloud.com` is at:

- `deploy/nginx/gateway.irengcloud.com.conf`

Install it on the server with:

```bash
sudo mkdir -p /etc/nginx/ssl /var/www/certbot
sudo cp deploy/nginx/gateway.irengcloud.com.conf /etc/nginx/sites-available/gateway.irengcloud.com.conf
sudo ln -s /etc/nginx/sites-available/gateway.irengcloud.com.conf /etc/nginx/sites-enabled/gateway.irengcloud.com.conf
sudo nginx -t
sudo systemctl reload nginx
```

## Systemd

The provided systemd unit is at:

- `deploy/systemd/wa-webhook.service`

Requires Node.js 22+ (or Bun) on the host — check with `node -v`. The unit runs `/usr/bin/node`; point `ExecStart` at another binary if needed.

Install it with:

```bash
cp .env.example .env
# edit .env and set at least SESSION_SECRET (data lives in SQLite under ./data)
sudo cp deploy/systemd/wa-webhook.service /etc/systemd/system/wa-webhook.service
sudo systemctl daemon-reload
sudo systemctl enable --now wa-webhook
sudo systemctl status wa-webhook
```

## SSL

The nginx config expects:

- `/etc/nginx/ssl/gateway.irengcloud.com.crt`
- `/etc/nginx/ssl/gateway.irengcloud.com.key`

For a quick self-signed certificate:

```bash
sudo openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/gateway.irengcloud.com.key \
  -out /etc/nginx/ssl/gateway.irengcloud.com.crt \
  -days 365 \
  -subj "/CN=gateway.irengcloud.com"
```
