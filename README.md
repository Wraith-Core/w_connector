# w_connector

1.1.2 (2026-10-21): عضوية VIP (المورد `w_vip`) صارت مصدرًا آخر لأولوية الطابور حسب الرتبة: برونزي 100، فضي 250، ذهبي 450، بلاتيني 700، ماسي 950 (الإدارة 1000). اللاعب يُعرف بحساب Cfx.re (`fivem:`) لأنه لا يملك رقم سيرفر وقت الدخول. عضو VIP **ليس** من الإدارة: لا يتجاوز الإغلاق ولا القائمة البيضاء. إذا لم يعمل w_vip فلا شيء يتغير. المصدر يظهر في الموقع `vip:<الرتبة>`.

1.1.1: إعطاء الخبرة وسحبها من الموقع يذهب إلى مستوى اللاعب في `w_level` (إذا كان يعمل) بالمقدار نفسه، بدل حقل `xp` في الشخصية الذي كان يكسر خبرات المهارات. اللاعب غير المتصل يُرفض (استعمل `/addxp` في اللعبة).

The Wraith connector for RedM. It links your game server to your Wraith control panel and does
nothing else.

There is no menu, no keybind and no command. Everything you manage — players, bans, whitelist,
staff, reports, roles, statistics, the live map, your store — you manage from the website. This
resource is what carries out what you click.

---

## Install

**1. Requirements**

- RedM with **VORP** (`vorp_core`)
- **oxmysql**

**2. Copy the folder**

Put `w_connector` in your `resources` folder.

**3. Add it to `server.cfg`**

```cfg
ensure w_connector
```

It must start **after** `vorp_core` and `oxmysql`.

**4. Paste your key**

Open your RedM panel on the website, copy the server key, and add one line to `server.cfg`:

```cfg
set wraith_apikey "fvm_your_key_here"
```

**5. Restart the server**

You should see:

```
[w_connector] schema ready.
[w_connector] VORP core acquired.
[w_connector] linked — long-polling https://wraith7.com/api/fivem/devadmin
```

Within about ten seconds the panel will show your server as **connected**.

---

## First administrator

There is no in-game panel, so there is no in-game way to make the first administrator. Name them in
`server.cfg`:

```cfg
set w_connector_owners "steam:110000112345678"
```

Several are allowed, separated by commas. They are created as `owner` on the next restart, and from
then on you can manage staff from the website.

---

## Optional settings

Everything below is optional. `w_connector` runs without any of it.

| Setting | What it does |
|---|---|
| `set w_connector_whitelist "true"` | Only players on your whitelist may join. **Add yourself first.** |
| `set w_connector_owners "steam:...,steam:..."` | Who starts as owner |
| `set w_connector_warn_kick_at "3"` | Warnings before an automatic kick. `0` turns it off |
| `set w_connector_inventory "..."` | Only if your inventory resource uses a name other than `vorp_inventory` or `w_inventory` — both are detected automatically |
| `set w_connector_show_ip "true"` | Include player IP addresses in logs and the players page. Off by default — it is personal data |
| `set w_connector_discord_token "..."` | Lets the panel show Discord avatars and sync Discord roles |
| `set w_connector_discord_guild "..."` | Your Discord server id, needed with the token above |
| `set w_connector_steam_key "..."` | Steam avatars, used when Discord has none |
| `set w_connector_webhook_player "https://discord.com/api/webhooks/..."` | Mirror player actions to a Discord channel |
| `set w_connector_webhook_admin "..."` | Staff actions |
| `set w_connector_webhook_server "..."` | Server events |
| `set w_connector_webhook_security "..."` | Security events |
| `set w_connector_webhook_economy "..."` | Money and XP |
| `set w_connector_webhook_system "..."` | Everything else |

Keys and tokens belong in `server.cfg` and nowhere else. Nothing in this folder contains a
credential, and nothing should be edited to add one.

---

## Weather and time

The weather and time controls in the panel forward to a `weathersync` resource. If your server does
not run one, those buttons will tell you so rather than pretending to work.

---

## Its own tables

On first start it creates its own tables, all beginning with `wc_`. It does not read or change any
table belonging to another resource, and it never alters VORP's own tables — it reads `characters`,
`users`, `items`, `character_inventories` and `loadout`, and writes to a character only when you ask
it to from the panel.

If you were running `w_admin` before and want your old bans, staff, reports and whitelist, run
`sql/import_from_w_admin.sql` **once**, by hand, after the first start. Take a backup first. It does
not delete or change anything in the old tables.

---

## Common problems

**The panel says "not connected".**
Check the console for `[w_connector] linked`. If it says `no wraith_apikey set`, the key line is
missing from `server.cfg` or was added after the last restart.

**"unknown_group" when I click something.**
The role you hold on the website does not exist in the server's role list. Open the Roles page and
create it, or ask an owner to change your role.

**The players page is empty.**
`vorp_core` did not start before `w_connector`. Check the start order in `server.cfg` — you should
see `[w_connector] VORP core acquired` in the console.

**The item picker is empty.**
The `items` table could not be read. The console prints a line explaining why on startup.

**Avatars are all the same grey image.**
Normal without a Discord token or Steam key. Set either one and they fill in within a minute.

---

## Privacy

The connector sends your server your panel already needs: who is online, their character name, job,
money and playtime, and your server name and player limit. Player IP addresses are **not** sent
unless you turn on `w_connector_show_ip`.

It opens no port. All traffic is outbound to the address in `wraith_site_endpoint`, so it works
behind any firewall without a rule.

## الإعلانات (1.1.0)

إعلان الموقع (`adminpanel:sendAnnouncement`، ويقبل `seconds` اختياريًا) وتنبيه الريستارت وفتح/إغلاق السيرفر
تظهر الآن أعلى الشاشة تحت البوصلة عبر `exports.w_hud:Announce` (الدالة `ConnectorAnnounce` في
`server/handlers/server.lua`)، وسطر الشات باقٍ. إن كان `w_hud` متوقفًا يرجع الإشعار القديم.
