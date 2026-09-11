#!/bin/bash

CERTBOT_EMAIL="${CERTBOT_EMAIL:?CERTBOT_EMAIL must be configured}"
DOCKER_HOST="${DOCKER_HOST:?DOCKER_HOST must be configured}"

apt-get update
apt-get install -y curl

# install docker
curl -fsSL https://get.docker.com | sh
# pull vbrowser image
docker pull howardc93/vbrowser
# install certbot
DEBIAN_FRONTEND=noninteractive apt-get install -y certbot
certbot certonly --standalone -n --email "$CERTBOT_EMAIL" --agree-tos -d "$DOCKER_HOST"
chmod -R 755 /etc/letsencrypt/live/
chmod -R 755 /etc/letsencrypt/archive/
