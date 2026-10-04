#!/bin/sh
# Blocks sandbox containers (10.89.0.0/16) from reaching the Docker host and any
# private/link-local range, while keeping internet egress. Idempotent.
#
# Docker already isolates bridge networks from each other; this adds:
#   - INPUT:       sandbox -> host (API, Postgres, SSH, metadata) dropped
#   - DOCKER-USER: sandbox -> private ranges dropped for new connections
# The API's own address on each user network (.254) may open connections into
# the sandbox subnet so the preview proxy works.
#
# Run on the host as root, or via the `sandbox-firewall` compose service
# (network_mode: host, cap NET_ADMIN).
set -eu

POOL="${SANDBOX_SUBNET_POOL:-10.89.0.0/16}"
BLOCKED="${SANDBOX_BLOCKED_CIDRS:-10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,100.64.0.0/10}"
API_ADDR_MASK="0.0.0.254/0.0.0.255"
CHAIN=AGENT-SANDBOX

iptables -N "$CHAIN" 2>/dev/null || iptables -F "$CHAIN"
iptables -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
# The API (.254 in every user subnet) may connect to sandboxes for previews.
iptables -A "$CHAIN" -s "$API_ADDR_MASK" -d "$POOL" -j RETURN
OLDIFS=$IFS; IFS=,
for cidr in $BLOCKED; do
  iptables -A "$CHAIN" -s "$POOL" -d "$cidr" -j DROP
done
IFS=$OLDIFS
iptables -A "$CHAIN" -j RETURN

# Forwarded traffic (to other containers, LAN).
iptables -N DOCKER-USER 2>/dev/null || true
iptables -C DOCKER-USER -j "$CHAIN" 2>/dev/null || iptables -I DOCKER-USER 1 -j "$CHAIN"

# Traffic to the host itself.
iptables -C INPUT -s "$POOL" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null \
  || iptables -I INPUT 1 -s "$POOL" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -C INPUT -s "$POOL" -j DROP 2>/dev/null || iptables -I INPUT 2 -s "$POOL" -j DROP

echo "sandbox firewall applied for $POOL"
