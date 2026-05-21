# Deployment Notes

## Nginx

This project expects the Node.js app to run on `127.0.0.1:8181`.

The provided nginx site config for `gate.ireng.uk` is at:

- `deploy/nginx/gate.ireng.uk.conf`

Install it on the server with:

```bash
sudo mkdir -p /etc/nginx/ssl /var/www/certbot
sudo cp deploy/nginx/gate.ireng.uk.conf /etc/nginx/sites-available/gate.ireng.uk.conf
sudo ln -s /etc/nginx/sites-available/gate.ireng.uk.conf /etc/nginx/sites-enabled/gate.ireng.uk.conf
sudo nginx -t
sudo systemctl reload nginx
```

## Systemd

The provided systemd unit is at:

- `deploy/systemd/wa-webhook.service`

Install it with:

```bash
cp .env.example .env
# edit .env and set at least MONGODB_URI and SESSION_SECRET
sudo cp deploy/systemd/wa-webhook.service /etc/systemd/system/wa-webhook.service
sudo systemctl daemon-reload
sudo systemctl enable --now wa-webhook
sudo systemctl status wa-webhook
```

## SSL

The nginx config expects:

- `/etc/nginx/ssl/gate.ireng.uk.crt`
- `/etc/nginx/ssl/gate.ireng.uk.key`

For a quick self-signed certificate:

```bash
sudo openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/gate.ireng.uk.key \
  -out /etc/nginx/ssl/gate.ireng.uk.crt \
  -days 365 \
  -subj "/CN=gate.ireng.uk"
```
