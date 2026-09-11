#!/bin/bash

CERTBOT_EMAIL="${CERTBOT_EMAIL:?CERTBOT_EMAIL must be configured}"
DOMAIN="${DOMAIN:?DOMAIN must be configured}"

apt update

DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-dns-cloudflare
certbot certonly --standalone -n --email "$CERTBOT_EMAIL" --agree-tos -d "$DOMAIN"
#certbot certonly --dns-cloudflare --dns-cloudflare-credentials ~/cloudflare.ini -d "$DOMAIN" --preferred-challenges dns-01

apt install -y nginx
apt install -y bind9

echo "events {}
http {
  server {
    listen 443 ssl;
    server_name $DOMAIN;
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    location / {
        resolver 127.0.0.1;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header Host \$host;
        proxy_pass http://\$arg_ip;

        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \"upgrade\";
    }
  }
}" > /etc/nginx/nginx.conf
/etc/init.d/nginx reload

# Update /etc/letsencrypt/cli.ini with renew hook
echo '
deploy-hook = systemctl reload nginx' >> /etc/letsencrypt/cli.ini