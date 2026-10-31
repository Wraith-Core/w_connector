# w_connector (v2)

يربط سيرفر FiveM أو RedM بلوحة Wraith، وينفذ أوامر الإدارة ويعرض حالة اللاعبين.
تتوفر قائمة الإدارة داخل اللعبة بالأمر `/wadmin`، وبالمفتاح F10 في FiveM.
تظهر الصفحات والأفعال حسب صلاحيات الحساب؛ إدارة الربط والصلاحيات تبقى من لوحة الموقع.
توجد أيضًا أوامر البلاغات بحسب الإعدادات. يتطلب المورد `oxmysql` وإطارًا مدعومًا.

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

## 2.0.3 — 2026-11-01

- إظهار الإصدار الفعلي للموصل عند التشغيل حتى تتحقق أتمتة النشر من تفعيل التحديث، وتتجنب إعادة تشغيله مرة أخرى بعد اكتمال التوصيل.
- يظهر سطر الإصدار حتى عند نقص إعداد الربط، وتبقى رسالة الإعداد الناقص مستقلة. غياب إصدار المورد يظهر باسم `unknown` ولا يُحسب تأكيدًا لنجاح التحديث.

## 2.0.2 — 2026-11-01

- صلاحيات السكربتات المختارة من دور الموقع تسري داخل اللعبة، حسب هوية ديسكورد التي يبلغها السيرفر.
- تظهر الصلاحيات بالعربي حسب السكربت المشغّل؛ لا يمنح دور الموقع صلاحيات عامة أو رتبة ماستر تلقائيًا.
- تُجدّد المنح كل 15 ثانية، وتنتهي خلال 45 ثانية إذا تعذر التحقق. إزالة الدور أو خروج اللاعب تسحب منح الموصل فقط.
- لا تحفظ المنح كرتب دائمة. يُحفظ سجل تنظيف بأسماء المنح التي أنشأها الموصل لإزالتها عند عودة تشغيله، ولا يعيد منح صلاحيات من هذا السجل.
- إذا رفض السيرفر تنفيذ السحب، يحتفظ الموصل بسجل التنظيف ويعيد المحاولة ويظهر تنبيهًا في الكونسول؛ لا يتجاوز إعدادات صلاحيات السيرفر.
- يلزم سطر `add_ace resource.w_connector command allow` لتطبيق المنح المؤقتة وسحبها. تبقى الرتب اليدوية مستقلة.
- تجربة اللعبة المطلوبة: حساب لديه صلاحية المزرعة فقط، إزالة الصلاحية وهو متصل، ثم تجربة انقطاع الربط وإعادة الدخول.

## 2.0.1 — 2026-10-30

- تعريب التحقق من الدخول والانتظار، مع توضيح أن الدخول يتم تلقائيًا عند توفر مكان.
- تصحيح وصف القائمة `/wadmin` والصلاحيات المطلوبة، وتسمية العربة في RedM.
- تنبيه نشر: هذا المصدر المحلي من فرع 2.0، بينما الإصدار التجاري السابق 1.1.13؛ لا ينشر كترقية نصوص دون مراجعة نطاق v2.
- تجربة اللعبة المطلوبة: انتظار سيرفر ممتلئ وفتح قائمة الإدارة بحساب مسموح وآخر مرفوض.
