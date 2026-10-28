# w_connector (v2)

Links a FiveM or RedM server to its Wraith control panel. Everything you manage lives on the website;
this resource carries out what the panel asks and reports who is online. It has no menu, no commands
and no in-game interface.

> This is v2, shipped under the name `w_connector` so the Wraith systems (which answer only that
> name) work unchanged. It replaces v1, whose source is kept in `game/w_connector_v1` for rollback:
> put the v1 folder back and start it. Design: `docs/admin-platform/03-connector-v2.md`.

## Install

1. Requirements: `oxmysql`, and one supported framework.
2. Put `w_connector` in `resources/`.
3. On your panel, create the connector token, then add to `server.cfg`:

```cfg
set wraith_token "wc2.k…"
ensure w_connector
```

Start it **after** your framework and inventory.

## Supported

| Framework | Inventory |
|---|---|
| Wraith Core (`w_core`) | Wraith (`w_inventory`) |
| VORP (`vorp_core`) | `vorp_inventory`, `ox_inventory` (RedM) |
| RSG (`rsg-core`) | `rsg-inventory` |
| ESX (`es_extended`) | `ox_inventory`, or ESX's own |
| QBCore (`qb-core`) | `qb-inventory` |
| Qbox (`qbx_core`) | `ox_inventory` |

Detected automatically. To force one: `set wraith_framework "vorp"` / `set wraith_inventory "ox_inventory"`.

## Security

- The token belongs to this one server and this one product. Keep `server.cfg` private; if it leaks,
  create a new token on the panel — the old one stops working.
- Every request is signed (HMAC-SHA256, timestamp and one-time nonce) and goes out over HTTPS. The
  server opens no port.
- The token cannot change who has access to your panel.
