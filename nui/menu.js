/* The in-game Wraith menu (docs/admin-platform/08-ingame-menu.md). Vanilla JS, no build, no network.
 *
 * The page only shows. Permissions arrive with menu:open and decide which tabs and buttons appear; every
 * action goes to the client script (cl_menu.lua) by name, then to the server and the website, which
 * authorise it again. Text from the game (names, reasons, chat) is only ever set with textContent.
 * Nothing runs while the menu is closed; staff chat refreshes only while its tab is open.
 */
(function () {
    "use strict";

    var RES = (typeof GetParentResourceName === "function" && GetParentResourceName()) || "w_connector";
    var root = document.getElementById("wm-root");
    var toasts = document.getElementById("wm-toasts");

    // ── text ──────────────────────────────────────────────────────────────────────────────────────
    var T = {
        en: {
            players: "Players", self: "Me", vehicle: "Vehicle", server: "Server", reports: "Reports", bans: "Bans", chat: "Staff chat", logs: "Logs",
            search: "Search name or ID…", none: "Nothing here.", loading: "Loading…", page: "Page", close: "Close",
            info: "Info", inventory: "Inventory", history: "History", identifiers: "Identifiers",
            goto: "Go to", bring: "Bring", freeze: "Freeze", unfreeze: "Unfreeze", spectate: "Spectate", revive: "Revive", heal: "Heal",
            message: "Message", warn: "Warn", kick: "Kick", ban: "Ban", whitelist: "Whitelist",
            reason: "Reason", text: "Message", duration: "Duration", permanent: "Permanent", confirm: "Confirm", cancel: "Cancel",
            noclip: "NoClip", godmode: "God mode", freezeSelf: "Freeze me", ids: "Player IDs",
            tpWaypoint: "Teleport to waypoint", tpCoords: "Teleport to coordinates", tpBack: "Return to previous location", go: "Go",
            model: "Vehicle model", spawn: "Spawn", repair: "Repair current vehicle", del: "Delete current vehicle",
            status: "Status", playersOnline: "Players", uptime: "Uptime", framework: "Framework", connector: "Connector", restarts: "Scheduled restarts",
            resources: "Resources", start: "Start", stop: "Stop", restart: "Restart", announce: "Announcement", send: "Send", fps: "Your FPS",
            world: "Time and weather", weather: "Weather", time: "Time", set: "Set", modules: "Modules", entry: "Entry",
            whitelistOn: "Whitelist on", closed: "Closed", open: "Open",
            claim: "Claim", resolve: "Resolve", reopen: "Reopen", unban: "Unban", expires: "Expires", by: "By",
            all: "All", kind: "Kind", job: "Job", ping: "Ping", money: "Money", warnings: "Warnings", item: "Item", count: "Count",
            sure: "Are you sure?", done: "Done.", sent: "Sent.",
            confirmKick: "Kick {name}?", confirmBan: "Ban {name}?", confirmUnban: "Revoke ban #{id}?", confirmStop: "{action} {name}?", confirmDelete: "Delete the vehicle you are in?",
            spectate_hint: "Spectating — press Backspace or /wadmin to stop.", spectate_lost: "The player left; spectate ended.",
            err_spectate_failed: "Could not reach that player to spectate.",
            m5: "5 minutes", h1: "1 hour", d1: "1 day", w1: "1 week", mo1: "30 days",
        },
        ar: {
            players: "اللاعبون", self: "أنا", vehicle: "المركبة", server: "السيرفر", reports: "البلاغات", bans: "الحظر", chat: "دردشة الطاقم", logs: "السجلات",
            search: "ابحث بالاسم أو الرقم…", none: "لا يوجد شيء.", loading: "جارٍ التحميل…", page: "صفحة", close: "إغلاق",
            info: "المعلومات", inventory: "الحقيبة", history: "السوابق", identifiers: "المعرّفات",
            goto: "اذهب إليه", bring: "أحضره", freeze: "تجميد", unfreeze: "فك التجميد", spectate: "مراقبة", revive: "إنعاش", heal: "علاج",
            message: "رسالة", warn: "إنذار", kick: "طرد", ban: "حظر", whitelist: "القائمة البيضاء",
            reason: "السبب", text: "الرسالة", duration: "المدة", permanent: "دائم", confirm: "تأكيد", cancel: "إلغاء",
            noclip: "الطيران", godmode: "عدم الموت", freezeSelf: "جمّدني", ids: "أرقام اللاعبين",
            tpWaypoint: "انتقل إلى العلامة", tpCoords: "انتقل إلى إحداثيات", tpBack: "ارجع إلى المكان السابق", go: "انتقل",
            model: "طراز المركبة", spawn: "استدعاء", repair: "إصلاح مركبتي", del: "حذف مركبتي",
            status: "الحالة", playersOnline: "اللاعبون", uptime: "مدة التشغيل", framework: "الإطار", connector: "الموصل", restarts: "إعادة التشغيل المجدولة",
            resources: "الموارد", start: "تشغيل", stop: "إيقاف", restart: "إعادة تشغيل", announce: "إعلان", send: "إرسال", fps: "إطاراتك",
            world: "الوقت والطقس", weather: "الطقس", time: "الوقت", set: "تعيين", modules: "الأنظمة", entry: "الدخول",
            whitelistOn: "القائمة البيضاء مفعلة", closed: "مغلق", open: "مفتوح",
            claim: "استلام", resolve: "إغلاق", reopen: "إعادة فتح", unban: "فك الحظر", expires: "ينتهي", by: "بواسطة",
            all: "الكل", kind: "النوع", job: "الوظيفة", ping: "الاستجابة", money: "المال", warnings: "الإنذارات", item: "الغرض", count: "العدد",
            sure: "هل أنت متأكد؟", done: "تم.", sent: "أُرسل.",
            confirmKick: "طرد {name}؟", confirmBan: "حظر {name}؟", confirmUnban: "فك الحظر رقم {id}؟", confirmStop: "{action} {name}؟", confirmDelete: "حذف المركبة التي أنت فيها؟",
            spectate_hint: "أنت تراقب — اضغط Backspace أو ‎/wadmin للخروج.", spectate_lost: "غادر اللاعب؛ انتهت المراقبة.",
            err_spectate_failed: "تعذر الوصول إلى اللاعب للمراقبة.",
            m5: "٥ دقائق", h1: "ساعة", d1: "يوم", w1: "أسبوع", mo1: "٣٠ يومًا",
        },
    };
    var ERR = {
        en: {
            no_permission: "You do not have permission for that.", no_access: "You have no access to the Wraith menu.", no_discord: "Link Discord to FiveM/RedM to use the Wraith menu.",
            offline: "The server is not linked to Wraith right now.", timeout: "No answer in time.", rate_limited: "Slow down a little.", player_offline: "That player is not online.",
            resource_is_essential: "Only the owner may stop or restart that resource.", resource_is_protected: "That resource cannot be stopped.", invalid_args: "Check what you entered.",
            unsupported_op: "This server cannot do that.", no_waypoint: "Set a waypoint first.", no_ground: "No ground found there.", no_vehicle: "You are not in a vehicle.",
            no_control: "Could not take control of the vehicle.", nothing_to_return_to: "No previous location yet.", no_session: "Open the menu again.", unknown_action: "Unknown action.",
            no_character: "That player has no character loaded.", not_found: "Not found.", refused: "Refused.", no_ped: "That player cannot be reached.",
        },
        ar: {
            no_permission: "ليست لديك صلاحية لذلك.", no_access: "ليست لديك صلاحية لقائمة Wraith.", no_discord: "اربط ديسكورد باللعبة لاستخدام قائمة Wraith.",
            offline: "السيرفر غير مرتبط بـ Wraith الآن.", timeout: "لم يصل رد في الوقت.", rate_limited: "تمهّل قليلًا.", player_offline: "اللاعب غير متصل.",
            resource_is_essential: "المالك فقط يستطيع إيقاف هذا المورد أو إعادة تشغيله.", resource_is_protected: "لا يمكن إيقاف هذا المورد.", invalid_args: "تحقق مما أدخلته.",
            unsupported_op: "هذا السيرفر لا يدعم ذلك.", no_waypoint: "ضع علامة على الخريطة أولًا.", no_ground: "لا توجد أرض هناك.", no_vehicle: "لست في مركبة.",
            no_control: "تعذر التحكم بالمركبة.", nothing_to_return_to: "لا يوجد مكان سابق بعد.", no_session: "افتح القائمة من جديد.", unknown_action: "إجراء غير معروف.",
            no_character: "لا توجد شخصية محمّلة لهذا اللاعب.", not_found: "غير موجود.", refused: "مرفوض.", no_ped: "تعذر الوصول إلى اللاعب.",
        },
    };
    var lang = "en";
    try { lang = localStorage.getItem("wm-lang") === "ar" ? "ar" : "en"; } catch (e) {}
    function t(k, vars) {
        var s = (T[lang] && T[lang][k]) || T.en[k] || k;
        if (vars) Object.keys(vars).forEach(function (v) { s = s.split("{" + v + "}").join(String(vars[v])); });
        return s;
    }
    function errText(e) {
        var k = String(e || "refused").replace(/^err_/, "");
        return (ERR[lang] && ERR[lang][k]) || ERR.en[k] || (T[lang] && T[lang]["err_" + k]) || k;
    }

    // ── DOM helpers ───────────────────────────────────────────────────────────────────────────────
    function h(tag, attrs, kids) {
        var el = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function (k) {
            var v = attrs[k];
            if (v === undefined || v === null || v === false) return;
            if (k === "text") el.textContent = String(v);
            else if (k === "class") el.className = v;
            else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
            else if (k === "value") el.value = v;
            else el.setAttribute(k, v === true ? "" : v);
        });
        (kids || []).forEach(function (c) { if (c != null && c !== false) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
        return el;
    }
    function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
    function btn(label, onclick, cls, disabled) { return h("button", { class: "wm-btn" + (cls ? " " + cls : ""), text: label, onclick: onclick, disabled: !!disabled }); }

    function toast(kind, text) {
        var el = h("div", { class: "wm-toast " + (kind || "ok"), text: text });
        toasts.appendChild(el);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, kind === "error" ? 5000 : 3200);
        while (toasts.children.length > 4) toasts.removeChild(toasts.firstChild);
    }

    // ── talking to cl_menu.lua ────────────────────────────────────────────────────────────────────
    function post(name, data) {
        return fetch("https://" + RES + "/" + name, { method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(data || {}) })
            .then(function (r) { return r.json(); })
            .catch(function () { return { ok: false, error: "timeout" }; });
    }
    function act(action, args) { return post("menuAct", { action: action, args: args || {} }); }
    /** act, and toast the outcome; resolves with the result. */
    function run(action, args, okText) {
        return act(action, args).then(function (r) {
            if (r && r.ok) toast("ok", okText || t("done")); else toast("error", errText(r && r.error));
            return r || { ok: false };
        });
    }

    // ── state ─────────────────────────────────────────────────────────────────────────────────────
    var S = { open: false, game: "fivem", role: "", perms: {}, ops: {}, self: 0, me: {}, fps: null, tab: "players" };
    var main, side, chatTimer = null;
    function can(p) { return !!S.perms[p]; }
    function hasOp(op) { return !!S.ops[op]; }

    // ── confirm dialog (optionally with fields) ───────────────────────────────────────────────────
    function confirmBox(title, fields, okLabel, onOk) {
        var inputs = {};
        var dlg = h("div", { class: "wm-dialog", role: "dialog" }, [h("h2", { text: title }), h("p", { text: t("sure") })]);
        (fields || []).forEach(function (f) {
            dlg.appendChild(h("label", { text: f.label }));
            var el;
            if (f.options) {
                el = h("select", { class: "wm-in" }, f.options.map(function (o) { return h("option", { value: o[0], text: o[1] }); }));
            } else {
                el = h(f.area ? "textarea" : "input", { class: "wm-in", maxlength: f.max || 300 });
            }
            inputs[f.key] = el;
            dlg.appendChild(el);
        });
        var modal = h("div", { class: "wm-modal" }, [dlg]);
        function done() { if (modal.parentNode) modal.parentNode.removeChild(modal); }
        dlg.appendChild(h("div", { class: "wm-row" }, [
            btn(t("cancel"), done),
            btn(okLabel || t("confirm"), function () {
                var values = {};
                Object.keys(inputs).forEach(function (k) { values[k] = inputs[k].value; });
                for (var i = 0; i < (fields || []).length; i++) if (fields[i].required && !String(values[fields[i].key] || "").trim()) { inputs[fields[i].key].focus(); return; }
                done();
                onOk(values);
            }, "danger"),
        ]));
        main.appendChild(modal);
        var first = dlg.querySelector("input,textarea,select");
        if (first) first.focus();
    }

    // ── layout ────────────────────────────────────────────────────────────────────────────────────
    var TABS = [
        { id: "players", show: function () { return can("players.view"); } },
        { id: "self", show: function () { return can("self.playermode") || can("self.teleport") || can("self.viewids"); } },
        { id: "vehicle", show: function () { return S.game === "fivem" && can("players.manage"); } },
        { id: "server", show: function () { return can("overview.view"); } },
        { id: "reports", show: function () { return can("reports.view"); } },
        { id: "bans", show: function () { return can("bans.view"); } },
        { id: "chat", show: function () { return can("staffchat.use"); } },
        { id: "logs", show: function () { return can("logs.view"); } },
    ];

    function setLang(l) {
        lang = l;
        try { localStorage.setItem("wm-lang", l); } catch (e) {}
        document.documentElement.lang = l;
        document.documentElement.dir = l === "ar" ? "rtl" : "ltr";
        if (S.open) render();
    }

    function render() {
        clear(root);
        stopChat();
        var visible = TABS.filter(function (x) { return x.show(); });
        if (!visible.some(function (x) { return x.id === S.tab; })) S.tab = visible.length ? visible[0].id : "";
        side = h("nav", { class: "wm-side" }, visible.map(function (x) {
            return h("button", { class: "wm-tab" + (x.id === S.tab ? " on" : ""), text: t(x.id), onclick: function () { S.tab = x.id; render(); } });
        }));
        main = h("main", { class: "wm-main" });
        root.appendChild(h("header", { class: "wm-head" }, [
            h("span", { class: "wm-mark", text: "Wraith" }),
            h("span", { class: "wm-role", text: S.role }),
            h("span", { class: "wm-spacer" }),
            btn(lang === "ar" ? "EN" : "ع", function () { setLang(lang === "ar" ? "en" : "ar"); }),
            h("button", { class: "wm-x", title: t("close"), text: "×", onclick: close }),
        ]));
        root.appendChild(side);
        root.appendChild(main);
        var view = VIEWS[S.tab];
        if (view) view(main); else main.appendChild(h("p", { class: "wm-empty", text: t("none") }));
    }

    // ── players ───────────────────────────────────────────────────────────────────────────────────
    var P = { list: [], q: "", page: 0, sel: null, sub: "info" };
    var PAGE = 14;

    function playersView(el) {
        var listBox = h("div");
        var detail = h("aside", { class: "wm-detail" });
        var search = h("input", { class: "wm-in wm-grow", placeholder: t("search"), value: P.q, oninput: function () { P.q = search.value; P.page = 0; drawList(); } });
        el.appendChild(h("div", { class: "wm-split" }, [h("section", null, [h("div", { class: "wm-row" }, [search, btn("↻", load)]), listBox]), detail]));

        function filtered() {
            var q = P.q.trim().toLowerCase();
            if (!q) return P.list;
            return P.list.filter(function (p) {
                return String(p.source) === q.replace(/^#/, "") || String(p.name || "").toLowerCase().indexOf(q) >= 0 || String(p.charName || "").toLowerCase().indexOf(q) >= 0;
            });
        }
        function drawList() {
            clear(listBox);
            var rows = filtered();
            var pages = Math.max(1, Math.ceil(rows.length / PAGE));
            if (P.page >= pages) P.page = pages - 1;
            var slice = rows.slice(P.page * PAGE, P.page * PAGE + PAGE);
            if (!slice.length) { listBox.appendChild(h("p", { class: "wm-empty", text: t("none") })); return; }
            listBox.appendChild(h("table", { class: "wm-t" }, [
                h("thead", null, [h("tr", null, [h("th", { text: "#" }), h("th", { text: t("players") }), h("th", { text: t("job") }), h("th", { text: t("ping") })])]),
                h("tbody", null, slice.map(function (p) {
                    return h("tr", { class: "click" + (P.sel && P.sel.source === p.source ? " sel" : ""), onclick: function () { P.sel = p; P.sub = "info"; drawList(); drawDetail(); } }, [
                        h("td", { class: "wm-muted", text: p.source }),
                        h("td", null, [h("div", { text: p.name || "?" }), p.charName ? h("div", { class: "wm-muted", text: p.charName }) : null]),
                        h("td", { class: "wm-muted", text: p.job || "" }),
                        h("td", { class: "wm-muted", text: p.ping != null ? p.ping : "" }),
                    ]);
                })),
            ]));
            listBox.appendChild(h("div", { class: "wm-pager" }, [
                btn("‹", function () { P.page = Math.max(0, P.page - 1); drawList(); }, null, P.page === 0),
                h("span", { text: t("page") + " " + (P.page + 1) + " / " + pages + " · " + rows.length }),
                btn("›", function () { P.page = Math.min(pages - 1, P.page + 1); drawList(); }, null, P.page >= pages - 1),
            ]));
        }
        function drawDetail() {
            clear(detail);
            var p = P.sel;
            if (!p) return;
            var me = p.source === S.self;
            detail.appendChild(h("div", { class: "name", text: p.name || "?" }));
            detail.appendChild(h("div", { class: "wm-muted", text: "#" + p.source + (p.charName ? " · " + p.charName : "") }));
            var A = [];
            function a(perm, op, label, fn, cls) { if (can(perm) && (!op || hasOp(op))) A.push(btn(label, fn, cls)); }
            if (!me) a("players.manage", "player.bring", t("goto"), function () { run("player.goto", { target: p.source }); });
            if (!me) a("players.manage", "player.bring", t("bring"), function () { run("player.bring", { target: p.source }); });
            a("players.manage", "player.freeze", t("freeze"), function () { run("player.freeze", { target: p.source, frozen: true }); });
            a("players.manage", "player.freeze", t("unfreeze"), function () { run("player.freeze", { target: p.source, frozen: false }); });
            if (!me) a("players.spectate", "player.get", t("spectate"), function () {
                post("menuSpectate", { target: p.source }).then(function (r) { if (!r.ok) toast("error", errText(r.error)); });
            });
            a("players.manage", "player.revive", t("revive"), function () { run("player.revive", { target: p.source }); });
            a("players.manage", "player.heal", t("heal"), function () { run("player.heal", { target: p.source }); });
            a("players.warn", "player.message", t("message"), function () {
                confirmBox(t("message") + " — " + p.name, [{ key: "message", label: t("text"), area: true, required: true, max: 500 }], t("send"), function (v) {
                    run("player.message", { target: p.source, message: v.message }, t("sent"));
                });
            });
            a("players.warn", null, t("warn"), function () {
                confirmBox(t("warn") + " — " + p.name, [{ key: "reason", label: t("reason"), required: true }], t("warn"), function (v) {
                    run("players.warn", { target: p.source, reason: v.reason });
                });
            }, "danger");
            if (!me) a("players.kick", "players.kick", t("kick"), function () {
                confirmBox(t("confirmKick", { name: p.name }), [{ key: "reason", label: t("reason"), max: 200 }], t("kick"), function (v) {
                    run("players.kick", { target: p.source, reason: v.reason }).then(function (r) { if (r.ok) setTimeout(load, 800); });
                });
            }, "danger");
            if (!me) a("bans.manage", null, t("ban"), function () {
                confirmBox(t("confirmBan", { name: p.name }), [
                    { key: "reason", label: t("reason"), required: true },
                    { key: "minutes", label: t("duration"), options: [["", t("permanent")], ["5", t("m5")], ["60", t("h1")], ["1440", t("d1")], ["10080", t("w1")], ["43200", t("mo1")]] },
                ], t("ban"), function (v) {
                    var args = { target: p.source, reason: v.reason };
                    if (v.minutes) args.minutes = Number(v.minutes);
                    run("players.ban", args).then(function (r) { if (r.ok) setTimeout(load, 800); });
                });
            }, "danger");
            a("whitelist.manage", null, t("whitelist"), function () { run("whitelist.add", { target: p.source }); });
            detail.appendChild(h("div", { class: "wm-actions" }, A));

            var subs = [["info", "players.view"], ["inventory", "players.view"], ["history", "players.view"]];
            var subBox = h("div");
            detail.appendChild(h("div", { class: "wm-subtabs" }, subs.filter(function (s) { return can(s[1]) && (s[0] !== "inventory" || hasOp("inventory.get")); }).map(function (s) {
                return h("button", { class: P.sub === s[0] ? "on" : "", text: t(s[0]), onclick: function () { P.sub = s[0]; drawDetail(); } });
            })));
            detail.appendChild(subBox);
            subBox.appendChild(h("p", { class: "wm-muted", text: t("loading") }));
            var target = p.source;
            function still() { return P.sel && P.sel.source === target; }
            if (P.sub === "info") {
                act("player.get", { target: target }).then(function (r) {
                    if (!still()) return;
                    clear(subBox);
                    if (!r.ok) { subBox.appendChild(h("p", { class: "wm-empty", text: errText(r.error) })); return; }
                    var d = r.data || {};
                    var cards = [[t("ping"), d.ping], [t("job"), d.job ? (d.job.label || d.job.name) + (d.job.grade != null ? " (" + d.job.grade + ")" : "") : "—"]];
                    if (d.money && typeof d.money === "object") Object.keys(d.money).forEach(function (k) { cards.push([t("money") + " · " + k, d.money[k]]); });
                    subBox.appendChild(h("div", { class: "wm-grid" }, cards.map(function (c) { return h("div", { class: "wm-card" }, [h("div", { class: "k", text: c[0] }), h("div", { class: "v", text: c[1] == null ? "—" : c[1] })]); })));
                    var ids = p.identifiers;
                    if (ids && typeof ids === "object") {
                        subBox.appendChild(h("h3", { text: t("identifiers") }));
                        Object.keys(ids).forEach(function (k) { subBox.appendChild(h("div", { class: "wm-mono", text: ids[k] })); });
                    }
                });
            } else if (P.sub === "inventory") {
                act("inventory.get", { target: target }).then(function (r) {
                    if (!still()) return;
                    clear(subBox);
                    if (!r.ok) { subBox.appendChild(h("p", { class: "wm-empty", text: errText(r.error) })); return; }
                    var items = Array.isArray(r.data) ? r.data : [];
                    if (!items.length) { subBox.appendChild(h("p", { class: "wm-empty", text: t("none") })); return; }
                    subBox.appendChild(h("table", { class: "wm-t" }, [h("tbody", null, items.map(function (it) {
                        return h("tr", null, [h("td", { text: it.label || it.name }), h("td", { class: "wm-muted", text: "×" + (it.count || 0) })]);
                    }))]));
                });
            } else {
                Promise.all([act("warnings.list", { target: target }), can("bans.view") ? act("bans.list", {}) : Promise.resolve({ ok: true, data: [] })]).then(function (rs) {
                    if (!still()) return;
                    clear(subBox);
                    var w = rs[0].ok && Array.isArray(rs[0].data) ? rs[0].data : [];
                    var ids = p.identifiers || {};
                    var bans = rs[1].ok && Array.isArray(rs[1].data) ? rs[1].data.filter(function (b) { return (ids.license && b.license === ids.license) || (ids.discord && b.discord === ids.discord); }) : [];
                    if (!rs[0].ok) subBox.appendChild(h("p", { class: "wm-empty", text: errText(rs[0].error) }));
                    subBox.appendChild(h("h3", { text: t("warnings") + " (" + w.length + ")" }));
                    w.forEach(function (x) { subBox.appendChild(h("div", { class: "wm-card" }, [h("div", { text: x.reason }), h("div", { class: "wm-muted", text: (x.created_by_name || "") + " · " + fmtDate(x.created_at) })])); });
                    if (bans.length) {
                        subBox.appendChild(h("h3", { text: t("bans") + " (" + bans.length + ")" }));
                        bans.forEach(function (b) { subBox.appendChild(h("div", { class: "wm-card" }, [h("div", { text: "#" + b.id + " · " + b.reason }), h("div", { class: "wm-muted", text: (b.created_by_name || "") + " · " + fmtDate(b.created_at) })])); });
                    }
                });
            }
        }
        function load() {
            act("players.list").then(function (r) {
                if (!r.ok) { toast("error", errText(r.error)); return; }
                P.list = Array.isArray(r.data) ? r.data : [];
                if (P.sel) P.sel = P.list.filter(function (x) { return x.source === P.sel.source; })[0] || null;
                drawList();
                drawDetail();
            });
        }
        drawList();
        drawDetail();
        load();
    }

    // ── me ────────────────────────────────────────────────────────────────────────────────────────
    function selfView(el) {
        el.appendChild(h("h2", { text: t("self") }));
        function toggle(action, key, label) {
            var on = !!S.me[key];
            return btn(label, function () {
                post("menuSelf", { action: action, on: !on }).then(function (r) {
                    if (r.state) S.me = r.state;
                    if (!r.ok) toast("error", errText(r.error));
                    render();
                });
            }, on ? "on" : "");
        }
        function once(action, label, extra) {
            return btn(label, function () {
                var d = { action: action };
                if (extra) Object.keys(extra()).forEach(function (k) { d[k] = extra()[k]; });
                post("menuSelf", d).then(function (r) {
                    if (r.state) S.me = r.state;
                    toast(r.ok ? "ok" : "error", r.ok ? t("done") : errText(r.error));
                });
            });
        }
        if (can("self.playermode")) {
            el.appendChild(h("div", { class: "wm-row" }, [toggle("self.noclip", "noclip", t("noclip")), toggle("self.godmode", "godmode", t("godmode")), toggle("self.freeze", "frozen", t("freezeSelf"))]));
        }
        if (can("self.viewids")) el.appendChild(h("div", { class: "wm-row" }, [toggle("self.viewids", "ids", t("ids"))]));
        if (can("self.teleport")) {
            el.appendChild(h("h3", { text: t("tpCoords") }));
            var x = h("input", { class: "wm-in", placeholder: "x", size: 8 }), y = h("input", { class: "wm-in", placeholder: "y", size: 8 }), z = h("input", { class: "wm-in", placeholder: "z", size: 8 });
            el.appendChild(h("div", { class: "wm-row" }, [x, y, z, once("self.tpCoords", t("go"), function () {
                var o = { x: Number(x.value), y: Number(y.value) };
                if (z.value.trim() !== "") o.z = Number(z.value);
                return o;
            })]));
            el.appendChild(h("div", { class: "wm-row" }, [once("self.tpWaypoint", t("tpWaypoint")), once("self.tpBack", t("tpBack"))]));
        }
    }

    // ── vehicle (FiveM) ───────────────────────────────────────────────────────────────────────────
    function vehicleView(el) {
        el.appendChild(h("h2", { text: t("vehicle") }));
        var model = h("input", { class: "wm-in wm-grow", placeholder: t("model"), maxlength: 32 });
        if (hasOp("vehicle.spawn")) el.appendChild(h("div", { class: "wm-row" }, [model, btn(t("spawn"), function () {
            if (!/^\w{1,32}$/.test(model.value.trim())) { toast("error", errText("invalid_args")); return; }
            run("vehicle.spawn", { model: model.value.trim() });
        }, "primary")]));
        el.appendChild(h("div", { class: "wm-row" }, [
            btn(t("repair"), function () { post("menuSelf", { action: "vehicle.repair" }).then(function (r) { toast(r.ok ? "ok" : "error", r.ok ? t("done") : errText(r.error)); }); }),
            btn(t("del"), function () {
                confirmBox(t("confirmDelete"), [], t("del"), function () { post("menuSelf", { action: "vehicle.delete" }).then(function (r) { toast(r.ok ? "ok" : "error", r.ok ? t("done") : errText(r.error)); }); });
            }, "danger"),
        ]));
    }

    // ── server ────────────────────────────────────────────────────────────────────────────────────
    function fmtUptime(s) { s = Number(s) || 0; var d = Math.floor(s / 86400), hr = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + "d " : "") + hr + "h " + m + "m"; }
    function fmtDate(v) { if (!v) return ""; var d = new Date(typeof v === "number" && v < 1e12 ? v * 1000 : v); return isNaN(d) ? String(v) : d.toLocaleString(lang === "ar" ? "ar" : "en-GB", { dateStyle: "short", timeStyle: "short" }); }

    function serverView(el) {
        el.appendChild(h("h2", { text: t("status") }));
        var cards = h("div", { class: "wm-grid" });
        el.appendChild(cards);
        function card(k, v) { cards.appendChild(h("div", { class: "wm-card" }, [h("div", { class: "k", text: k }), h("div", { class: "v", text: v == null || v === "" ? "—" : v })])); }
        Promise.all([act("server.local"), act("server.status")]).then(function (rs) {
            var l = rs[0].ok ? rs[0].data || {} : {}, s = rs[1].ok ? rs[1].data || {} : {};
            card(t("playersOnline"), l.players != null ? l.players + " / " + l.maxPlayers : s.players);
            card(t("uptime"), l.uptime != null ? fmtUptime(l.uptime) : null);
            card(t("resources"), l.resources);
            card(t("fps"), S.fps);
            card(t("framework"), s.framework ? s.framework.id + (s.framework.version ? " " + s.framework.version : "") : null);
            card(t("connector"), s.connector);
            card(t("restarts"), Array.isArray(s.restartTimes) && s.restartTimes.length ? s.restartTimes.join(", ") : "—");
            card(t("entry"), s.closed ? t("closed") : s.whitelistEnabled ? t("whitelistOn") : t("open"));
        });

        if (can("server.announce") && hasOp("server.announce")) {
            el.appendChild(h("h3", { text: t("announce") }));
            var msg = h("input", { class: "wm-in wm-grow", maxlength: 500 });
            el.appendChild(h("div", { class: "wm-row" }, [msg, btn(t("send"), function () {
                if (!msg.value.trim()) return;
                run("server.announce", { message: msg.value.trim() }, t("sent")).then(function (r) { if (r.ok) msg.value = ""; });
            }, "primary")]));
        }

        if (can("world.control") && hasOp("world.setWeather")) {
            el.appendChild(h("h3", { text: t("world") }));
            var weather = h("input", { class: "wm-in", placeholder: t("weather"), maxlength: 30, size: 14 });
            var hour = h("input", { class: "wm-in", type: "number", min: 0, max: 23, placeholder: "HH", style: "width:70px" });
            var minute = h("input", { class: "wm-in", type: "number", min: 0, max: 59, placeholder: "MM", style: "width:70px" });
            el.appendChild(h("div", { class: "wm-row" }, [
                weather, btn(t("set"), function () { if (weather.value.trim()) run("world.weather", { weather: weather.value.trim().toUpperCase() }); }),
                hour, minute, btn(t("set"), function () { run("world.time", { hour: Number(hour.value) || 0, minute: Number(minute.value) || 0 }); }),
            ]));
        }

        if (can("modules.use")) {
            var modBox = h("div", { class: "wm-row" });
            el.appendChild(h("h3", { text: t("modules") }));
            el.appendChild(modBox);
            act("modules.list").then(function (r) {
                var list = r.ok && Array.isArray(r.data) ? r.data : [];
                if (!list.length) modBox.appendChild(h("span", { class: "wm-muted", text: t("none") }));
                list.forEach(function (m) { modBox.appendChild(h("span", { class: "wm-pill ok", text: m.id + " " + (m.version || "") })); });
            });
        }

        if (can("resources.view")) {
            el.appendChild(h("h3", { text: t("resources") }));
            var filter = h("input", { class: "wm-in wm-grow", placeholder: t("search") });
            var resBox = h("div");
            el.appendChild(h("div", { class: "wm-row" }, [filter]));
            el.appendChild(resBox);
            var resources = [];
            var draw = function () {
                clear(resBox);
                var q = filter.value.trim().toLowerCase();
                var rows = resources.filter(function (r) { return !q || r.name.toLowerCase().indexOf(q) >= 0; }).slice(0, 60);
                resBox.appendChild(h("table", { class: "wm-t" }, [h("tbody", null, rows.map(function (r) {
                    var acts = [];
                    if (can("resources.control") && !r.protected) {
                        if (r.state !== "started") acts.push(btn(t("start"), function () { control(r, "start"); }));
                        else {
                            acts.push(btn(t("restart"), function () { control(r, "restart"); }));
                            acts.push(btn(t("stop"), function () { control(r, "stop"); }, "danger"));
                        }
                    }
                    return h("tr", null, [
                        h("td", null, [h("div", { text: r.name }), r.description ? h("div", { class: "wm-muted", text: r.description }) : null]),
                        h("td", null, [h("span", { class: "wm-pill " + (r.state === "started" ? "ok" : "bad"), text: r.state })]),
                        h("td", { style: "text-align:end;white-space:nowrap" }, acts),
                    ]);
                }))]));
            };
            var control = function (r, action) {
                var go = function () { run("resources.control", { name: r.name, action: action }).then(function (x) { if (x.ok) setTimeout(loadRes, 700); }); };
                if (action === "start") go(); else confirmBox(t("confirmStop", { action: t(action), name: r.name }), [], t(action), go);
            };
            var loadRes = function () { act("resources.list").then(function (r) { resources = r.ok && Array.isArray(r.data) ? r.data : []; draw(); }); };
            filter.addEventListener("input", draw);
            loadRes();
        }
    }

    // ── reports, bans, staff chat, logs ───────────────────────────────────────────────────────────
    function reportsView(el) {
        el.appendChild(h("h2", { text: t("reports") }));
        var status = h("select", { class: "wm-in", onchange: function () { load(); } }, [["", t("all")], ["open", "open"], ["claimed", "claimed"], ["resolved", "resolved"]].map(function (o) { return h("option", { value: o[0], text: o[1] }); }));
        status.value = "open";
        var box = h("div");
        el.appendChild(h("div", { class: "wm-row" }, [status, btn("↻", function () { load(); })]));
        el.appendChild(box);
        function load() {
            act("reports.list", status.value ? { status: status.value } : {}).then(function (r) {
                clear(box);
                var rows = r.ok && Array.isArray(r.data) ? r.data : [];
                if (!r.ok) box.appendChild(h("p", { class: "wm-empty", text: errText(r.error) }));
                else if (!rows.length) box.appendChild(h("p", { class: "wm-empty", text: t("none") }));
                rows.forEach(function (x) {
                    var acts = [];
                    if (can("reports.manage")) {
                        if (x.status !== "claimed") acts.push(btn(t("claim"), function () { run("reports.status", { id: x.id, status: "claimed" }).then(load); }));
                        if (x.status !== "resolved") acts.push(btn(t("resolve"), function () { run("reports.status", { id: x.id, status: "resolved" }).then(load); }, "primary"));
                        else acts.push(btn(t("reopen"), function () { run("reports.status", { id: x.id, status: "open" }).then(load); }));
                    }
                    box.appendChild(h("div", { class: "wm-card", style: "margin-bottom:8px" }, [
                        h("div", { class: "wm-row", style: "margin:0" }, [h("b", { text: "#" + x.id }), h("span", { text: (x.reporter_name || "?") + (x.reporter_source ? " (#" + x.reporter_source + ")" : "") }), h("span", { class: "wm-pill", text: x.status }), h("span", { class: "wm-spacer" }), h("span", { class: "wm-muted", text: fmtDate(x.created_at) })]),
                        h("p", { text: x.text, style: "margin:6px 0;user-select:text" }),
                        h("div", { class: "wm-row", style: "margin:0" }, acts.concat(x.claimed_by_name ? [h("span", { class: "wm-muted", text: t("by") + " " + x.claimed_by_name })] : [])),
                    ]));
                });
            });
        }
        load();
    }

    function bansView(el) {
        el.appendChild(h("h2", { text: t("bans") }));
        var box = h("div");
        el.appendChild(box);
        function load() {
            act("bans.list").then(function (r) {
                clear(box);
                var rows = r.ok && Array.isArray(r.data) ? r.data : [];
                if (!r.ok) { box.appendChild(h("p", { class: "wm-empty", text: errText(r.error) })); return; }
                if (!rows.length) { box.appendChild(h("p", { class: "wm-empty", text: t("none") })); return; }
                box.appendChild(h("table", { class: "wm-t" }, [
                    h("thead", null, [h("tr", null, [h("th", { text: "#" }), h("th", { text: t("players") }), h("th", { text: t("reason") }), h("th", { text: t("expires") }), h("th")])]),
                    h("tbody", null, rows.slice(0, 200).map(function (b) {
                        return h("tr", null, [
                            h("td", { class: "wm-muted", text: b.id }),
                            h("td", null, [h("div", { text: b.name || "?" }), h("div", { class: "wm-muted", text: t("by") + " " + (b.created_by_name || "?") })]),
                            h("td", { text: b.reason }),
                            h("td", { class: "wm-muted", text: b.expires_at ? fmtDate(b.expires_at) : t("permanent") }),
                            h("td", null, can("bans.manage") ? [btn(t("unban"), function () {
                                confirmBox(t("confirmUnban", { id: b.id }), [], t("unban"), function () { run("bans.revoke", { banId: b.id }).then(load); });
                            }, "danger")] : []),
                        ]);
                    })),
                ]));
            });
        }
        load();
    }

    function stopChat() { if (chatTimer) { clearInterval(chatTimer); chatTimer = null; } }
    function chatView(el) {
        el.appendChild(h("h2", { text: t("chat") }));
        var log = h("div", { class: "log" });
        var input = h("input", { class: "wm-in wm-grow", maxlength: 1000 });
        var last = 0;
        function load() {
            act("staffchat.list", { after: last }).then(function (r) {
                if (!r.ok || !Array.isArray(r.data)) return;
                r.data.forEach(function (m) {
                    last = Math.max(last, Number(m.id) || 0);
                    log.appendChild(h("div", { class: "msg" }, [h("b", { text: m.author_name || "?" }), h("span", { text: m.text })]));
                });
                if (r.data.length) log.scrollTop = log.scrollHeight;
            });
        }
        function send() {
            var v = input.value.trim();
            if (!v) return;
            input.value = "";
            act("staffchat.post", { text: v }).then(function (r) { if (!r.ok) toast("error", errText(r.error)); load(); });
        }
        input.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });
        el.appendChild(h("div", { class: "wm-chat" }, [log, h("div", { class: "wm-row" }, [input, btn(t("send"), send, "primary")])]));
        load();
        chatTimer = setInterval(function () { if (S.open && S.tab === "chat") load(); else stopChat(); }, 5000);
    }

    function logsView(el) {
        el.appendChild(h("h2", { text: t("logs") }));
        var kind = h("select", { class: "wm-in", onchange: function () { load(); } }, [["", t("all")], ["join", "join"], ["leave", "leave"], ["report", "report"], ["death", "death"]].map(function (o) { return h("option", { value: o[0], text: o[1] }); }));
        var q = h("input", { class: "wm-in wm-grow", placeholder: t("search"), onkeydown: function (e) { if (e.key === "Enter") load(); } });
        var box = h("div");
        el.appendChild(h("div", { class: "wm-row" }, [kind, q, btn("↻", function () { load(); })]));
        el.appendChild(box);
        function load() {
            var args = {};
            if (kind.value) args.kind = kind.value;
            if (q.value.trim()) args.q = q.value.trim();
            act("logs.list", args).then(function (r) {
                clear(box);
                var rows = r.ok && Array.isArray(r.data) ? r.data : [];
                if (!r.ok) { box.appendChild(h("p", { class: "wm-empty", text: errText(r.error) })); return; }
                if (!rows.length) { box.appendChild(h("p", { class: "wm-empty", text: t("none") })); return; }
                box.appendChild(h("table", { class: "wm-t" }, [h("tbody", null, rows.slice(0, 150).map(function (x) {
                    var data = x.data;
                    if (typeof data === "string") { try { data = JSON.parse(data); } catch (e) {} }
                    var extra = data && typeof data === "object" ? (data.reason || data.text || (data.killer && data.killer.name ? "← " + data.killer.name : "")) : "";
                    return h("tr", null, [
                        h("td", { class: "wm-muted", text: fmtDate(x.at) }),
                        h("td", null, [h("span", { class: "wm-pill", text: x.kind })]),
                        h("td", { text: (x.name || "?") + (x.source ? " (#" + x.source + ")" : "") }),
                        h("td", { class: "wm-muted", text: extra || "" }),
                    ]);
                }))]));
            });
        }
        load();
    }

    var VIEWS = { players: playersView, self: selfView, vehicle: vehicleView, server: serverView, reports: reportsView, bans: bansView, chat: chatView, logs: logsView };

    // ── open / close ──────────────────────────────────────────────────────────────────────────────
    function close() {
        if (!S.open) return;
        S.open = false;
        stopChat();
        root.hidden = true;
        clear(root);
        post("menuClose");
    }

    function setOf(list) { var o = {}; (Array.isArray(list) ? list : []).forEach(function (p) { o[p] = true; }); return o; }

    window.addEventListener("message", function (ev) {
        var d = (ev && ev.data) || {};
        if (d.action === "menu:open") {
            S.open = true;
            S.game = d.game === "redm" ? "redm" : "fivem";
            S.role = String(d.role || "");
            S.perms = setOf(d.permissions);
            S.ops = setOf(d.ops);
            S.self = Number(d.self) || 0;
            S.me = d.state || {};
            S.fps = d.fps || null;
            document.documentElement.lang = lang;
            document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
            root.hidden = false;
            render();
        } else if (d.action === "menu:close") {
            S.open = false;
            stopChat();
            root.hidden = true;
            clear(root);
        } else if (d.action === "menu:toast") {
            var key = String(d.key || "");
            var text = T.en[key] ? t(key) : errText(key);
            toast(d.kind === "error" ? "error" : d.kind === "info" ? "info" : "ok", text);
        }
    });

    window.addEventListener("keydown", function (e) {
        if (!S.open) return;
        if (e.key === "Escape") {
            var modal = main && main.querySelector(".wm-modal");
            if (modal) modal.parentNode.removeChild(modal); else close();
        }
    });
})();
