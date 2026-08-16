# Fitness Challenge Dashboard

A private, mobile-first PvP dashboard for the eight-week fitness challenge. It has four participants (Ca, Cl, P and G), shared scoring, daily binary logging, a habit stack, weekly/overall leaderboards, and strength or running final bonuses.

The challenge start date is centrally fixed to 17 August 2026. Data is shared through the included Python server and is stored in `data/state.json` on the host.

## Run locally

```sh
python3 server.py --host 0.0.0.0 --port 8888 --data ./data/state.json
```

Open `http://localhost:8888`.

## Proxmox CT deployment

Install the files in `/opt/forge-fit`, then install and enable `forge-fit.service`:

```sh
sudo cp forge-fit.service /etc/systemd/system/forge-fit.service
sudo systemctl daemon-reload
sudo systemctl enable --now forge-fit
```

The service listens on port 8888 for LAN and Tailscale access. It deliberately has no login because it is intended for a private network.
