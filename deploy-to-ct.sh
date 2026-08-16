#!/usr/bin/env sh
# Usage: ./deploy-to-ct.sh root@your-ct-tailnet-name
set -eu
TARGET=${1:?"Pass the CT Tailscale host, e.g. root@fitness-ct"}
DEST=/opt/forge-fit
ssh "$TARGET" "mkdir -p '$DEST'"
tar -czf - --exclude='.git' . | ssh "$TARGET" "tar -xzf - -C '$DEST' && cd '$DEST' && docker compose up -d --build"
echo "Deployed: http://${TARGET#*@}:8888"
