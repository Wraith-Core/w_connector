-- 2.2.0: the scripts hub's registry, moved here from w_admin 3.1.14 (server/sv_scripts_data.lua; the texts
-- are w_admin's, w_legal dropped: it is no longer on the server). Data only: the page never sends a command
-- line, it names a script and a command id, and ops/native_scripts.lua builds the line from the template.
--
-- Entry
--   res          the resource name
--   group        'economy' | 'animals' | 'world' | 'tribes' | 'player' | 'fun' | 'system'
--   label, description, help   { ar, en } (the card: its name, one plain line, the "?" text)
--   probe        the script's OWN permission test, asked again for the admin before every open / run
--                (the script still checks everything itself; all of them are plain ACE now):
--                  { node = 'x.y' }        the ACE x.y (or x.*, *), or a framework admin
--                  { anyNode = { ... } }   any of the nodes
--                  { admin = true }        a framework admin (ACE 'admin' or 'command')
--                  { ace = 'command.x' }   IsPlayerAceAllowed
--                  { anyOf = { probe, probe } }
--   panel        its own interface: route + how a player opens it (+ note)
--                  route = { kind = 'command', line = 'stables' }   ExecuteCommand on the admin's client
--                        | { kind = 'export', fn = 'OpenAdmin' }    a client export of the script
--   commands     quick commands (scripts.run)
--                  id, label, help, level ('admin', or 'god' = the website's console.command too), danger
--                  (a red two-press confirm), needsOnline,
--                  route = 'command' (the admin's client runs the line: the script checks him as
--                          if he typed it) | 'console' (the server console runs it: only for an admin who
--                          holds that command's own ACE and the website's console.command),
--                  line = 'addxp {target} {amount}' ({key} = an argument),
--                  opensUi (the command opens the script's own menu: the console closes first),
--                  probe (this command's own test, instead of the script's),
--                  args = { { key, type = 'citizen'|'int'|'number'|'text'|'select'|'bool', label, help,
--                             required, min, max, step, maxLength, word (letters, digits, _ - . only),
--                             options = { { value, label } }, default } }
-- A 'citizen' argument is resolved like the console's citizen lookup (the citizen id as typed; '#5' = a
-- server id) and the script receives the canonical citizen id.
WC = WC or {}

local function T(ar, en) return { ar = ar, en = en } end

-- ── shared arguments ──────────────────────────────────────────────────────────

local PLAYER_ONLINE = {
    key = 'target', type = 'citizen', required = true,
    label = T('اللاعب', 'Player'),
    help = T('رقم المواطن للاعب، ويجب أن يكون داخل السيرفر الآن. لرقم الجلسة اكتب # قبله، مثل #5.',
        "The player's citizen ID; they must be in the game now. For a session number put # in front, e.g. #5."),
}
local PLAYER_ANY = {
    key = 'target', type = 'citizen', required = true,
    label = T('اللاعب', 'Player'),
    help = T('رقم المواطن للاعب، متصل أو غير متصل. لرقم الجلسة اكتب # قبله، مثل #5.',
        "The player's citizen ID, online or not. For a session number put # in front, e.g. #5."),
}
local TRIBE_ID = {
    key = 'tribe', type = 'int', required = true, min = 1, max = 1000000,
    label = T('رقم القبيلة', 'Tribe number'),
    help = T('رقم القبيلة كما يظهر في لوحة القبائل، مثل 3.', 'The tribe number as the tribes panel shows it, e.g. 3.'),
}
local REASON = {
    key = 'reason', type = 'text', required = true, maxLength = 120,
    label = T('السبب', 'Reason'),
    help = T('السبب يظهر للاعب أو لأعضاء القبيلة. اكتبه واضحًا وقصيرًا.', 'The reason is shown to the player or the tribe members. Keep it short and clear.'),
}

-- ── the registry ──────────────────────────────────────────────────────────────

local GROUPS = { 'economy', 'animals', 'world', 'tribes', 'player', 'fun', 'system' }

local SCRIPTS = {
    -- ── economy ───────────────────────────────────────────────────────────────
    {
        res = 'w_store', group = 'economy',
        label = T('المتاجر', 'Stores'),
        description = T('كل متاجر السيرفر: المالك والبضاعة والأسعار والمخزون والأموال.', 'Every store: owner, goods, prices, stock and money.'),
        help = T('يدير متاجر اللاعبين والحكومة. افتح لوحته عندما تنقص بضاعة متجر أو تريد تغيير مالكه. هوامش المتاجر الحكومية إعدادات اقتصادية، تعديلها لمستوى المالك فقط.',
            "Runs the player and government stores. Open its panel when a store runs out of goods or needs a new owner. Government margins are economy settings: owner level only."),
        probe = { node = 'w_store.admin' },
        panel = { route = { kind = 'command', line = 'wstore' }, how = T('الأمر /wstore', 'The /wstore command') },
    },
    {
        res = 'w_shops', group = 'economy',
        label = T('المتاجر العادية', 'NPC shops'),
        description = T('المتاجر التي يبيع فيها أصحاب محلات من اللعبة، ومخزونها.', 'The ordinary shops run by NPCs, and their stock.'),
        help = T('يدير المتاجر التي يبيع فيها أصحاب محلات من اللعبة. من هنا تزوّد مخزون صنف في متجر دون أن تفتح الملفات. ليس له واجهة خاصة.',
            "Runs the NPC shops. Refill an item's stock in a shop from here without touching files. It has no panel of its own."),
        probe = { ace = 'command.wshoprestock' },
        commands = {
            {
                id = 'restock', level = 'admin', route = 'command', line = 'wshoprestock {shop} {item} {quantity}',
                probe = { ace = 'command.wshoprestock' },
                label = T('تزويد المخزون', 'Restock'),
                help = T('يزيد مخزون صنف في متجر بالعدد الذي تكتبه، فوق الموجود. يستطيع اللاعبون شراءه فورًا. مثال: 50 = خمسون حبة إضافية.',
                    'Adds the number you type to an item in a shop, on top of what is there. Players can buy it at once. Example: 50 = fifty more.'),
                args = {
                    { key = 'shop', type = 'text', required = true, maxLength = 64, word = true,
                      label = T('رقم المتجر', 'Shop id'),
                      help = T('اسم المتجر في ملف الإعدادات، مثل valentine_general.', "The shop's name in its config file, e.g. valentine_general.") },
                    { key = 'item', type = 'text', required = true, maxLength = 64, word = true,
                      label = T('الصنف', 'Item'),
                      help = T('اسم الصنف بالإنجليزي كما في الحقيبة، مثل bread.', "The item's English name as in the inventory, e.g. bread.") },
                    { key = 'quantity', type = 'int', required = true, min = 1, max = 100000,
                      label = T('الكمية', 'Quantity'),
                      help = T('عدد الحبات التي تُضاف إلى المخزون، من 1 إلى 100000.', 'How many units are added to the stock, 1 to 100000.') },
                },
            },
        },
    },
    {
        res = 'w_marketplace', group = 'economy',
        label = T('سوق اللاعبين', 'Player market'),
        description = T('سوق اللاعبين والمزادات بينهم.', 'The player market and its auctions.'),
        help = T('يتيح للاعبين البيع والشراء فيما بينهم وإقامة المزادات. ليس له لوحة إدارة بعد؛ ستظهر الضريبة والرسوم هنا عندما يضيف السكربت إعداداته.',
            'Lets players sell to each other and run auctions. It has no admin panel yet; tax and fees appear here once the script adds its settings.'),
    },
    {
        res = 'w_centralbank', group = 'economy',
        label = T('البنك المركزي', 'Central bank'),
        description = T('خزينة السيرفر والبنوك والقروض.', 'The server treasury, the banks and the loans.'),
        help = T('يحفظ أموال السيرفر كلها. صلاحيات موظفي البنك تأتي من دور الشخصية داخل اللعبة، لا من الإدارة. أوامر الكونسول للمالك فقط.',
            "Holds all the server's money. Bank staff rights come from the character's role in the game, not from admin rank. Console commands are for the owner only."),
        panel = {
            route = { kind = 'command', line = 'central' },
            how = T('الأمر /central', 'The /central command'),
            note = T('تُفتح لك واجهة شخصيتك: إذا لم تكن شخصيتك من موظفي البنك فسترى واجهة العميل.', "It opens your character's view: unless your character is bank staff you see the customer view."),
        },
        commands = {
            {
                id = 'audit', level = 'god', route = 'console', line = 'central_audit',
                label = T('فحص الحسابات', 'Audit the accounts'),
                help = T('يفحص حسابات البنك المركزي ويكتب النتيجة في سجل السيرفر (الكونسول). لا يغيّر أي شيء، ولا يلاحظه اللاعبون.',
                    "Checks the central bank's accounts and writes the result in the server console. It changes nothing and players notice nothing."),
                args = {},
            },
            {
                id = 'governor', level = 'god', route = 'console', danger = true, line = 'central_governor {target}',
                label = T('تعيين حاكم البنك', 'Appoint the governor'),
                help = T('يعيّن هذه الشخصية حاكمًا للبنك المركزي، ويصبح الحاكم الحالي مدقّقًا. يظهر ذلك في واجهة البنك فورًا. للتراجع عيّن الحاكم القديم من جديد.',
                    'Makes this character the central bank governor; the current governor becomes an auditor. It shows in the bank at once. To undo, appoint the old governor again.'),
                args = { PLAYER_ANY },
            },
        },
    },
    {
        res = 'w_banking', group = 'economy',
        label = T('الحسابات البنكية', 'Bank accounts'),
        description = T('حسابات اللاعبين البنكية والتحويلات.', 'Player bank accounts and transfers.'),
        help = T('يدير حسابات اللاعبين في البنوك والتحويل بينهم. ليس له لوحة إدارة؛ تُعدَّل أموال اللاعب من صفحة اللاعب أو الشخصيات.',
            "Runs the players' bank accounts and transfers. It has no admin panel; change a player's money on the player or characters page."),
    },
    {
        res = 'w_management', group = 'economy',
        label = T('خزائن الوظائف', 'Job funds'),
        description = T('أموال الوظائف والعصابات وقوائم المدير.', 'Job and gang money and the boss menus.'),
        help = T('يحفظ خزنة كل وظيفة وعصابة. قوائم المدير نفسها لا تُفتح للإدارة لأن السكربت يعتبر ذلك غشًا ويحظر، لذا لا يوجد زر فتح هنا.',
            'Keeps the fund of every job and gang. Its boss menus never open for staff: the script treats that as cheating and bans, so there is no open button here.'),
    },
    {
        res = 'w_butcher', group = 'economy',
        label = T('الصيد', 'Hunting'),
        description = T('السلخ بنجوم الجودة وتسليم الذبيحة عند الجزّار.', 'Skinning with quality stars and handing carcasses in at the butcher.'),
        help = T('السلخ يعطي جلودًا وذبائح بنجوم الجودة (1 إلى 3)، والذبيحة الكاملة تُسلَّم عند الجزّار بالمفتاح R فتصير قطعًا بنجومها. لا يشتري شيئًا ولا يدفع مالًا: البيع عند متجر الجزّار في المتاجر (w_store) بسعر يزيد مع النجوم. ليس له أوامر إدارة.',
            'Skinning gives pelts and carcasses with quality stars (1 to 3), and a whole carcass is handed in at the butcher with R for its pieces with their stars. It buys nothing and pays no money: selling happens at the butcher store (w_store), at a price that rises with the stars. It has no admin commands.'),
    },
    {
        res = 'w_jobs', group = 'economy',
        label = T('باني الأعمال', 'Job builder'),
        description = T('تبني الأعمال والمهام من خطوات وتثبّت أماكنها في كل مدينة.',
            'Build jobs and missions from steps and place them in every town.'),
        help = T('تفتح لوحة تبني فيها عملًا من خطوات (اذهب، اجمع، احمل، اطبخ، بِع...) وتحدد أماكنه وأنت واقف في اللعبة بزر «حدّد هنا»، وتنسخه إلى مدن أخرى. لا يصل العمل إلى اللاعبين إلا عندما تنشره، وكل نشر يُحفظ فيمكنك الرجوع إلى نسخة سابقة. من هنا ترى مستوى لاعب في الأعمال، أو تنهي عمله الحالي.',
            'Opens a panel where you build a job from steps (go, gather, carry, cook, sell...), set its places while standing in the game with «Set here», and copy it to other towns. Players only get a job once you publish it, and every publish is kept so you can go back to an earlier version. From here you also see a player\'s job levels or end their current job.'),
        probe = { anyNode = { 'w_jobs.view', 'w_jobs.edit', 'w_jobs.publish' } },
        panel = { route = { kind = 'command', line = 'jobs' }, how = T('الأمر /jobs', 'The /jobs command') },
        commands = {
            {
                id = 'progress', level = 'admin', route = 'command', line = 'jobs progress {target}',
                probe = { anyNode = { 'w_jobs.view', 'w_jobs.edit', 'w_jobs.publish' } },
                label = T('مستوى اللاعب في الأعمال', "Player's job levels"),
                help = T('يعرض لك مستوى اللاعب وخبرته وعدد مرات كل عمل. لا يغيّر شيئًا ولا يلاحظه اللاعب.',
                    "Shows you the player's level, XP and run count on every job. It changes nothing and the player notices nothing."),
                args = { PLAYER_ANY },
            },
            {
                id = 'endrun', level = 'admin', route = 'command', danger = true, line = 'jobs endrun {target}',
                probe = { anyNode = { 'w_jobs.edit', 'w_jobs.publish' } },
                label = T('إنهاء عمل اللاعب الحالي', "End the player's current job"),
                help = T('ينهي العمل الذي يؤديه اللاعب الآن دون دفع، وتختفي عربة العمل. يرى اللاعب رسالة بأن العمل انتهى. لا يمكن التراجع.',
                    "Ends the job the player is doing now with no pay, and the job wagon is removed. The player sees a message that the job ended. It cannot be undone."),
                args = { PLAYER_ANY },
            },
            {
                id = 'reset', level = 'admin', route = 'command', danger = true, line = 'jobs reset {target} {track}',
                probe = { node = 'w_jobs.publish' },
                label = T('تصفير مستوى عمل', 'Reset a job level'),
                help = T('يعيد خبرة اللاعب في عمل واحد (أو كل الأعمال) إلى الصفر، فيعود إلى المستوى 1. لا تُسحب منه أموال. لا يمكن التراجع.',
                    "Puts the player's XP on one job (or every job) back to 0, so they are level 1 again. No money is taken. It cannot be undone."),
                args = {
                    PLAYER_ANY,
                    { key = 'track', type = 'text', maxLength = 40, word = true, default = 'all',
                      label = T('العمل', 'Job'),
                      help = T('اسم مسار العمل بالإنجليزي كما يظهر في «مستوى اللاعب»، مثل mining، أو all للكل.',
                          'The job track name as "Player\'s job levels" shows it, e.g. mining, or all for every job.') },
                },
            },
        },
    },

    -- ── horses and animals ────────────────────────────────────────────────────
    {
        res = 'w_stables', group = 'animals',
        label = T('الإسطبلات', 'Stables'),
        description = T('الخيول والعربات والإسطبلات وأصحابها.', 'Horses, wagons, stables and their owners.'),
        help = T('يدير الخيول والعربات والإسطبلات. افتح لوحته عندما تريد تعديل سعر خيل، أو نقل إسطبل، أو علاج حصان لاعب. كل تعديل فيها يُسجَّل.',
            "Runs horses, wagons and stables. Open its panel to change a horse price, move a stable or heal a player's horse. Every change there is recorded."),
        probe = { anyNode = { 'w_stables.admin', 'w_stables.admin.stables', 'w_stables.admin.catalogue',
            'w_stables.admin.balancing', 'w_stables.admin.records', 'w_stables.admin.ownership' } },
        panel = { route = { kind = 'command', line = 'stables' }, how = T('الأمر /stables', 'The /stables command') },
    },
    {
        res = 'w_pets', group = 'animals',
        label = T('الحيوانات الأليفة', 'Pets'),
        description = T('متاجر الحيوانات الأليفة وأماكنها وبضاعتها.', 'Pet shops, their places and their stock.'),
        help = T('يدير الحيوانات الأليفة ومتاجرها. افتح محرر المتاجر لتضع متجرًا جديدًا أو تغلق متجرًا؛ يرى اللاعبون التغيير فورًا.',
            'Runs pets and their shops. Open the shop editor to place a new shop or close one; players see the change at once.'),
        probe = { node = 'w_pets.admin' },
        panel = { route = { kind = 'command', line = 'petshops' }, how = T('الأمر /petshops', 'The /petshops command') },
    },

    -- ── world and map ─────────────────────────────────────────────────────────
    {
        res = 'w_map', group = 'world',
        label = T('الخريطة', 'Map'),
        description = T('خريطة العالم: الحدود والأسماء والشعار والعلامات.', 'The world map: borders, names, logo and markers.'),
        help = T('يرسم خريطة العالم. محرره الأصلي يضيف أماكن وأسماء على الخريطة، ويراها جميع اللاعبين بعد الحفظ.',
            'Draws the world map. Its own editor adds places and names on the map, and every player sees them after saving.'),
        probe = { node = 'w_map.editor' },
        panel = { route = { kind = 'command', line = 'mapedit' }, how = T('الأمر /mapedit', 'The /mapedit command') },
    },
    {
        res = 'w_weathersync', group = 'world',
        label = T('الجو والوقت', 'Weather and time'),
        description = T('جو السيرفر وساعته، نفسها عند كل اللاعبين.', "The server's weather and clock, the same for every player."),
        help = T('يجعل الجو والوقت واحدًا عند الجميع. تغيّر الجو والساعة من صفحة «الطقس والوقت»، ومن هنا توقف الساعة أو الجو أو تطفئ الأنوار.',
            "Keeps weather and time the same for everyone. Change them on the world page; from here you freeze the clock or the weather, or cut the lights."),
        commands = {
            {
                id = 'freezetime', level = 'god', route = 'command', line = 'freezetime', probe = { ace = 'command.freezetime' },
                label = T('إيقاف الساعة أو تشغيلها', 'Freeze or unfreeze the clock'),
                help = T('يوقف الساعة عند كل اللاعبين، وإذا كانت متوقفة يشغّلها. يلاحظ الجميع أن الوقت لا يمضي. اضغطه مرة أخرى للتراجع.',
                    'Stops the clock for every player, or starts it if it is stopped. Everyone notices time stands still. Press it again to undo.'),
                args = {},
            },
            {
                id = 'freezeweather', level = 'god', route = 'command', line = 'freezeweather', probe = { ace = 'command.freezeweather' },
                label = T('تثبيت الجو أو فكّه', 'Freeze or unfreeze the weather'),
                help = T('يوقف تغيّر الجو التلقائي فيبقى الجو الحالي، وإذا كان متوقفًا يعيده إلى التغيّر. اضغطه مرة أخرى للتراجع.',
                    'Stops the automatic weather changes so the current weather stays, or lets it change again. Press it again to undo.'),
                args = {},
            },
            {
                id = 'blackout', level = 'god', route = 'command', line = 'blackout', probe = { ace = 'command.blackout' },
                label = T('إطفاء الأنوار أو إرجاعها', 'Lights off or on'),
                help = T('يطفئ أنوار المدن كلها أو يعيدها. يرى جميع اللاعبين الظلام فورًا. اضغطه مرة أخرى للتراجع.',
                    'Turns every town light off, or back on. Every player sees the dark at once. Press it again to undo.'),
                args = {},
            },
        },
    },
    {
        res = 'w_doorlock', group = 'world',
        label = T('أقفال الأبواب', 'Door locks'),
        description = T('الأبواب المقفلة ومن يستطيع فتحها حسب الوظيفة.', 'Locked doors and which jobs may open them.'),
        help = T('يقفل الأبواب ويفتحها لأصحاب الوظيفة أو العصابة. ليس له لوحة إدارة بعد؛ سيتاح فتح أي باب من هنا عندما يضيف السكربت الربط.',
            'Locks doors and opens them for their job or gang. It has no admin panel yet; opening any door from here comes once the script adds the link.'),
    },
    {
        res = 'w_housing', group = 'world',
        label = T('البيوت', 'Houses'),
        description = T('البيوت وأصحابها والأثاث.', 'Houses, their owners and furniture.'),
        help = T('يبيع البيوت للاعبين ويدير الأثاث والمفاتيح. ليس له لوحة إدارة بعد؛ أسعار البيوت إعدادات اقتصادية وستظهر هنا لمستوى المالك.',
            'Sells houses to players and handles furniture and keys. It has no admin panel yet; house prices are economy settings for the owner level.'),
    },
    {
        -- 3.1.2: w_kingdoms replaces w_kingdom_v2 (retired, not ensured)
        res = 'w_kingdoms', group = 'world',
        label = T('الممالك', 'Kingdoms'),
        description = T('الممالك وأراضيها وعواصمها وملوكها ومناصبها، وحروب الممالك والقبائل.', 'Kingdoms, their lands, capitals, kings and offices; the wars of kingdoms and tribes.'),
        help = T('يدير الممالك: تنشئ مملكة، وتوزع عليها الأراضي (مناطق اللعبة أو أراضٍ ترسمها في محرر الخريطة)، وتحدد عاصمتها، وتعيّن الملك والمناصب. وفي «الحروب»: كل حرب قائمة، وإنهاؤها أو إيقافها، وقواعد الحروب (الرهان، المدة، الدائرة، المنع). كل تغيير يظهر على الخريطة فورًا ويُسجَّل.',
            'Runs the kingdoms: create one, give it lands (game districts or lands drawn in the map editor), set its capital, seat the king and the offices. Under «Wars»: every running war, end or stop it, and the war rules (stake, length, circle, ban). Every change shows on the map at once and is logged.'),
        probe = { anyOf = { { ace = 'w_kingdoms.admin' }, { admin = true } } },
        panel = { route = { kind = 'command', line = 'kingdomadmin' }, how = T('الأمر /kingdomadmin (واللاعبون /kingdom)', 'The /kingdomadmin command (players: /kingdom)') },
    },
    {
        res = 'w_guarma', group = 'world',
        label = T('جزيرة قوارما', 'Guarma island'),
        description = T('السفر إلى جزيرة قوارما والرجوع منها.', 'Travel to Guarma island and back.'),
        help = T('ينقل اللاعبين بين البر وجزيرة قوارما بالسفينة. من هنا ترسل لاعبًا إلى الجزيرة أو تعيده فورًا دون سفينة.',
            'Carries players between the mainland and Guarma by ship. From here you send a player to the island or bring them back at once.'),
        probe = { node = 'w_guarma.admin' },
        commands = {
            {
                id = 'tpguarma', level = 'admin', route = 'command', needsOnline = true, line = 'tpguarma {target}',
                label = T('إرسال إلى قوارما', 'Send to Guarma'),
                help = T('ينقل اللاعب إلى جزيرة قوارما فورًا، ويرى نفسه هناك. للتراجع استخدم «إرجاع من قوارما».',
                    'Moves the player to Guarma at once; they find themselves there. To undo, use "Back from Guarma".'),
                args = { PLAYER_ONLINE },
            },
            {
                id = 'exitguarma', level = 'admin', route = 'command', needsOnline = true, line = 'exitguarma {target}',
                label = T('إرجاع من قوارما', 'Back from Guarma'),
                help = T('يعيد اللاعب من جزيرة قوارما إلى البر الرئيسي فورًا.', 'Brings the player back from Guarma to the mainland at once.'),
                args = { PLAYER_ONLINE },
            },
        },
    },
    {
        res = 'w_zonenotify', group = 'world',
        label = T('أسماء المناطق', 'Place names'),
        description = T('اسم المنطقة الذي يظهر عندما تدخلها.', 'The place name shown when you enter an area.'),
        help = T('يعرض اسم المنطقة للاعب عندما يدخلها. لا يحتاج إلى إدارة.', 'Shows the area name to the player when they enter it. It needs no admin tools.'),
    },

    -- ── tribes and jobs ───────────────────────────────────────────────────────
    {
        res = 'w_tribes', group = 'tribes',
        label = T('القبائل', 'Tribes'),
        description = T('القبائل: الإنشاء والاعتماد والإنذارات.', 'Tribes: creation, approval and warnings.'),
        help = T('يدير القبائل. من هنا تعتمد قبيلة أو تنذرها، وكل أمر يُسجَّل في سجل الإدارة. للإدارة الكاملة فقط. الممالك في بطاقة «الممالك».',
            'Runs the tribes. Approve or warn a tribe from here; every command goes into the admin log. Full admins only. The kingdoms have their own card.'),
        probe = { admin = true },
        panel = { route = { kind = 'command', line = 'edittribe' }, how = T('الأوامر /createtribe و /edittribe و /deletetribe', 'The /createtribe, /edittribe and /deletetribe commands') },
        commands = {
            {
                id = 'createtribe', level = 'admin', route = 'command', opensUi = true, line = 'createtribe',
                label = T('إنشاء قبيلة', 'Create a tribe'),
                help = T('يفتح لك نموذج إنشاء قبيلة جديدة (الاسم والزعيم والمنطقة). تُغلق لوحة الإدارة وتُفتح النافذة.',
                    'Opens the form for a new tribe (name, leader, area). The admin panel closes and the form opens.'),
                args = {},
            },
            {
                id = 'deletetribe', level = 'admin', route = 'command', opensUi = true, danger = true, line = 'deletetribe',
                label = T('حذف قبيلة', 'Delete a tribe'),
                help = T('يفتح قائمة القبائل لتختار واحدة تحذفها. الحذف نهائي ويطرد أعضاءها منها.',
                    'Opens the tribe list so you pick one to delete. Deleting is final and removes its members from it.'),
                args = {},
            },
            {
                id = 'warnplayer', level = 'admin', route = 'command', line = 'warnplayer {target} {reason}',
                label = T('إنذار لاعب', 'Warn a player'),
                help = T('يعطي اللاعب إنذارًا في قبيلته ويرى السبب. كثرة الإنذارات تطرده منها. للتراجع استخدم «مسح إنذارات لاعب».',
                    'Gives the player a warning in their tribe; they see the reason. Too many warnings remove them. To undo, use "Clear player warnings".'),
                args = { PLAYER_ANY, REASON },
            },
            {
                id = 'clearstrikes', level = 'admin', route = 'command', line = 'clearstrikes {target}',
                label = T('مسح إنذارات لاعب', 'Clear player warnings'),
                help = T('يمسح كل إنذارات اللاعب في القبيلة فيعود سجله نظيفًا.', "Clears all the player's tribe warnings so their record is clean."),
                args = { PLAYER_ANY },
            },
            {
                id = 'warntribe', level = 'admin', route = 'command', line = 'warntribe {tribe} {reason}',
                label = T('إنذار قبيلة', 'Warn a tribe'),
                help = T('يعطي القبيلة كلها إنذارًا، ويرى أعضاؤها السبب. كثرة الإنذارات توقف القبيلة مؤقتًا. للتراجع استخدم «مسح إنذارات قبيلة».',
                    'Warns the whole tribe; its members see the reason. Too many warnings suspend the tribe for a while. To undo, use "Clear tribe warnings".'),
                args = { TRIBE_ID, REASON },
            },
            {
                id = 'clearwarnings', level = 'admin', route = 'command', line = 'clearwarnings {tribe}',
                label = T('مسح إنذارات قبيلة', 'Clear tribe warnings'),
                help = T('يمسح كل إنذارات القبيلة ويرفع إيقافها إذا كانت موقوفة. يصل إشعار إلى أعضائها.',
                    "Clears all the tribe's warnings and lifts a suspension. Its members get a notice."),
                args = { TRIBE_ID },
            },
            {
                id = 'approvetribe', level = 'admin', route = 'command', line = 'approvetribe {tribe}',
                label = T('اعتماد قبيلة', 'Approve a tribe'),
                help = T('يعتمد القبيلة رسميًا فتستطيع العمل بالكامل. للتراجع استخدم «إلغاء اعتماد قبيلة».',
                    'Approves the tribe officially so it can work fully. To undo, use "Withdraw approval".'),
                args = { TRIBE_ID },
            },
            {
                id = 'unapprovetribe', level = 'admin', route = 'command', danger = true, line = 'unapprovetribe {tribe}',
                label = T('إلغاء اعتماد قبيلة', 'Withdraw approval'),
                help = T('يسحب اعتماد القبيلة فتعود غير رسمية. يلاحظ أعضاؤها ذلك. يمكنك اعتمادها من جديد.',
                    'Withdraws the tribe approval so it is unofficial again. Its members notice. You can approve it again.'),
                args = { TRIBE_ID },
            },
            {
                id = 'tribestatus', level = 'admin', route = 'command', line = 'tribestatus {tribe}',
                label = T('حالة قبيلة', 'Tribe status'),
                help = T('يعرض لك حالة القبيلة وإنذاراتها في رسالة. لا يغيّر شيئًا.', 'Shows you the tribe status and warnings in a message. It changes nothing.'),
                args = { TRIBE_ID },
            },
        },
    },
    {
        res = 'w_policejob', group = 'tribes',
        label = T('الشرطة', 'Police'),
        description = T('وظيفة الشرطة والسجن.', 'The police job and the jail.'),
        help = T('وظيفة الشرطة. أوامر السجن للشرطة المناوبين فقط، فلا تعمل من الإدارة بعد.',
            'The police job. Its jail commands are for police on duty only, so they do not work from here yet.'),
    },
    {
        res = 'w_medic', group = 'tribes',
        label = T('الأطباء', 'Doctors'),
        description = T('وظيفة الأطباء: الإنعاش والعلاج والإصابات.', 'The doctors\' job: revive, heal and injuries.'),
        help = T('وظيفة الأطباء. من هنا تنعش لاعبًا حتى لو كان غير متصل، أو تعالجه، أو تقتله للتصحيح.',
            'The medic job. From here you revive a player even when offline, heal them, or kill them to fix a bug.'),
        probe = { ace = 'command.aheal' },
        commands = {
            {
                -- w_medic's admin revive (only while its Config.AdminRevive is on: there only a doctor revives)
                id = 'revive', level = 'admin', route = 'command', line = 'medrevive {target}', probe = { ace = 'command.medrevive' },
                label = T('إنعاش', 'Revive'),
                help = T('ينعش اللاعب إذا كان ميتًا أو مغمى عليه. إذا كان غير متصل يدخل حيًّا في المرة القادمة.',
                    'Revives the player if they are dead or knocked out. If they are offline they log in alive next time.'),
                args = { PLAYER_ANY },
            },
            {
                id = 'aheal', level = 'admin', route = 'command', needsOnline = true, line = 'aheal {target}', probe = { ace = 'command.aheal' },
                label = T('علاج كامل', 'Full heal'),
                help = T('يعالج اللاعب بالكامل الآن: الصحة والجروح. يرى صحته تمتلئ.', 'Heals the player fully now: health and wounds. They see their health fill up.'),
                args = { PLAYER_ONLINE },
            },
            {
                id = 'kill', level = 'admin', route = 'command', needsOnline = true, danger = true, line = 'kill {target}', probe = { ace = 'command.kill' },
                label = T('قتل', 'Kill'),
                help = T('يقتل اللاعب فورًا ويرى شاشة الموت. لا يعود إلا بالإنعاش. استخدمه للتصحيح فقط، لا كعقوبة.',
                    'Kills the player at once; they see the death screen. Only a revive brings them back. Use it to fix a bug, not as a punishment.'),
                args = { PLAYER_ONLINE },
            },
        },
    },
    {
        res = 'w_mdt', group = 'tribes',
        label = T('سجل الشريف', "Sheriff's ledger"),
        description = T('سجلات الشرطة والغرامات والأحكام والمطلوبين.', 'Police records, fines, sentences and warrants.'),
        help = T('سجل الشرطة للسجلات والغرامات والأحكام والمطلوبين. الشرطي يفتحه من عنصر "سجل الشريف" في حقيبته، وليس له أدوات إدارة هنا. تذهب الغرامات إلى خزينة الشرطة.',
            "The police ledger for records, fines, sentences and warrants. A lawman opens it with the Sheriff Ledger item in their satchel; it has no admin tools here. Fines go to the police fund."),
    },

    -- ── player and character ──────────────────────────────────────────────────
    {
        res = 'w_hud', group = 'player',
        label = T('الواجهة والأكل', 'HUD and food'),
        description = T('دوائر الصحة والتحمّل والجوع والعطش، وما يفعله الأكل.', 'Health, stamina, hunger and thirst rings, and what food does.'),
        help = T('يرسم واجهة اللاعب ويحسب الجوع والعطش. من هنا تعدّل سرعتهما وما يعطيه كل أكل، وواجهته الأصلية تبقى كما هي.',
            'Draws the player HUD and runs hunger and thirst. Change their speed and what each food gives here; its own panel stays as it is.'),
        probe = { node = 'w_hud.admin' },
        panel = { route = { kind = 'command', line = 'hudmenu' }, how = T('الأمر /hudmenu أو زر F7', 'The /hudmenu command or F7') },
    },
    {
        res = 'w_level', group = 'player',
        label = T('المستويات والخبرة', 'Levels and XP'),
        description = T('خبرة اللاعبين ومستوياتهم ومضاعفات الخبرة.', 'Player XP, levels and XP boosts.'),
        help = T('يحسب خبرة كل لاعب ومستواه. من هنا تعطي خبرة أو تسحبها أو تحدد مستوى، حتى للاعب غير متصل.',
            'Tracks each player XP and level. Give or take XP or set a level from here, even for a player who is offline.'),
        probe = { node = 'w_level.admin' },
        commands = {
            {
                id = 'addxp', level = 'admin', route = 'command', line = 'addxp {target} {amount}',
                label = T('إعطاء خبرة', 'Give XP'),
                help = T('يزيد خبرة اللاعب بالعدد الذي تكتبه ويصله إشعار. يعمل حتى لو كان غير متصل. للتراجع استخدم «سحب خبرة». مثال: 500 نقطة.',
                    'Adds the XP you type; the player gets a notice. Works even when they are offline. To undo, use "Take XP". Example: 500 points.'),
                args = { PLAYER_ANY, { key = 'amount', type = 'int', required = true, min = 1, max = 1000000,
                    label = T('كمية الخبرة', 'XP amount'),
                    help = T('عدد نقاط الخبرة التي تُضاف، من 1 إلى 1000000.', 'How many XP points are added, 1 to 1000000.') } },
            },
            {
                id = 'removexp', level = 'admin', route = 'command', line = 'removexp {target} {amount}',
                label = T('سحب خبرة', 'Take XP'),
                help = T('ينقص خبرة اللاعب بالعدد الذي تكتبه، وقد ينزل مستواه. يعمل حتى لو كان غير متصل. للتراجع أعطه الخبرة من جديد.',
                    'Takes the XP you type from the player; their level may drop. Works offline too. To undo, give the XP back.'),
                args = { PLAYER_ANY, { key = 'amount', type = 'int', required = true, min = 1, max = 1000000,
                    label = T('كمية الخبرة', 'XP amount'),
                    help = T('عدد نقاط الخبرة التي تُسحب، من 1 إلى 1000000.', 'How many XP points are taken, 1 to 1000000.') } },
            },
            {
                id = 'setlevel', level = 'admin', route = 'command', danger = true, line = 'setlevel {target} {level}',
                label = T('تحديد المستوى', 'Set level'),
                help = T('يضع مستوى اللاعب على الرقم الذي تختاره ويصفّر تقدّمه داخل هذا المستوى. لا يعود تلقائيًا؛ للتراجع ضع مستواه القديم.',
                    'Puts the player at the level you choose and clears their progress inside it. It does not undo itself; set the old level to go back.'),
                args = { PLAYER_ANY, { key = 'level', type = 'int', required = true, min = 0, max = 1000,
                    label = T('المستوى', 'Level'),
                    help = T('المستوى الجديد، مثل 10. السكربت يرفض أعلى من حدّه (100 عادةً).', 'The new level, e.g. 10. The script refuses anything above its limit (usually 100).') } },
            },
            {
                id = 'xpboost', level = 'admin', route = 'command', needsOnline = true, line = 'xpboost {target} {mult} {minutes} min',
                label = T('مضاعف خبرة للاعب', 'XP boost for a player'),
                help = T('يضاعف الخبرة التي يكسبها اللاعب لمدة محددة ثم ينتهي تلقائيًا. مثال: 2 لمدة 30 دقيقة = تُحسب كل خبرة مرتين.',
                    'Multiplies the XP the player earns for a while, then it ends by itself. Example: 2 for 30 minutes = every XP counts twice.'),
                args = {
                    PLAYER_ONLINE,
                    { key = 'mult', type = 'number', required = true, min = 1.1, max = 10, step = 0.1, default = 2,
                      label = T('المضاعف', 'Multiplier'),
                      help = T('كم مرة تُضرب الخبرة، من 1.1 إلى 10. مثال: 1.5 = زيادة النصف.', 'How many times XP is multiplied, 1.1 to 10. Example: 1.5 = half more.') },
                    { key = 'minutes', type = 'int', required = true, min = 1, max = 1440, default = 30,
                      label = T('المدة بالدقائق', 'Duration in minutes'),
                      help = T('عدد الدقائق التي يبقى فيها المضاعف، من 1 إلى 1440 (يوم كامل).', 'How many minutes the boost lasts, 1 to 1440 (a full day).') },
                },
            },
            {
                id = 'xpboostall', level = 'god', route = 'command', danger = true, line = 'xpboostall {mult} {minutes} min',
                label = T('مضاعف خبرة للكل', 'XP boost for everyone'),
                help = T('يضاعف خبرة كل اللاعبين المتصلين لمدة محددة، مثل حدث نهاية الأسبوع. ينتهي تلقائيًا بعد المدة.',
                    'Multiplies the XP of every player online for a while, like a weekend event. It ends by itself.'),
                args = {
                    { key = 'mult', type = 'number', required = true, min = 1.1, max = 10, step = 0.1, default = 2,
                      label = T('المضاعف', 'Multiplier'),
                      help = T('كم مرة تُضرب الخبرة، من 1.1 إلى 10. مثال: 2 = ضعف.', 'How many times XP is multiplied, 1.1 to 10. Example: 2 = double.') },
                    { key = 'minutes', type = 'int', required = true, min = 1, max = 1440, default = 60,
                      label = T('المدة بالدقائق', 'Duration in minutes'),
                      help = T('عدد الدقائق التي يبقى فيها المضاعف، من 1 إلى 1440 (يوم كامل).', 'How many minutes the boost lasts, 1 to 1440 (a full day).') },
                },
            },
        },
    },
    {
        res = 'w_creators', group = 'player',
        label = T('الشخصيات والملابس', 'Characters and clothes'),
        description = T('إنشاء الشخصيات والملابس ونقاط الظهور.', 'Character creation, clothes and spawn points.'),
        help = T('ينشئ الشخصيات ويدير الملابس ونقاط الظهور. من هنا تعيد لاعبًا عالقًا في مكان إلى نقطة ظهور.',
            'Creates characters and handles clothes and spawn points. From here you send a stuck player back to a spawn point.'),
        probe = { ace = 'w_creators.admin' },
        commands = {
            {
                id = 'respawn', level = 'admin', route = 'command', needsOnline = true, line = 'wc_respawn {target} {point}',
                label = T('إرجاع لنقطة ظهور', 'Respawn'),
                help = T('يعيد اللاعب إلى نقطة ظهور ويعيد تحميله فيها. مفيد إذا علق في مكان. اترك النقطة فارغة للنقطة الافتراضية.',
                    'Sends the player to a spawn point and reloads them there. Useful when they are stuck. Leave the point empty for the default one.'),
                args = { PLAYER_ONLINE, { key = 'point', type = 'text', maxLength = 64, word = true,
                    label = T('نقطة الظهور', 'Spawn point'),
                    help = T('اسم نقطة الظهور من إعدادات السكربت، مثل valentine. فارغ = الافتراضية.', "The spawn point's name from the script config, e.g. valentine. Empty = the default.") } },
            },
        },
    },
    {
        res = 'w_inventory', group = 'player',
        label = T('الحقائب والخزائن', 'Inventories and stashes'),
        description = T('حقائب اللاعبين والخزائن والأغراض.', 'Player bags, stashes and items.'),
        help = T('يدير حقائب اللاعبين والخزائن. إعطاء غرض من صفحة اللاعب، ومن هنا تسحب غرضًا أو تصادر حقيبة وتعيدها.',
            "Runs player bags and stashes. Give items on the player page; from here you take an item, or confiscate a bag and return it."),
        probe = { ace = 'command.removeitem' },
        commands = {
            {
                id = 'removeitem', level = 'admin', route = 'command', line = 'removeitem {target} {item} {count}', probe = { ace = 'command.removeitem' },
                label = T('سحب غرض', 'Take an item'),
                help = T('يسحب عددًا من غرض معيّن من حقيبة اللاعب، متصلًا أو لا. مثال: bread و 2 = يسحب رغيفين. للتراجع أعطه الغرض من صفحة اللاعب.',
                    "Takes a number of one item from the player's bag, online or not. Example: bread and 2 = two loaves. To undo, give it back on the player page."),
                args = {
                    PLAYER_ANY,
                    { key = 'item', type = 'text', required = true, maxLength = 64, word = true,
                      label = T('الغرض', 'Item'),
                      help = T('اسم الغرض بالإنجليزي كما في الحقيبة، مثل bread.', "The item's English name as in the bag, e.g. bread.") },
                    { key = 'count', type = 'int', required = true, min = 1, max = 1000, default = 1,
                      label = T('العدد', 'Count'),
                      help = T('عدد الحبات التي تُسحب، من 1 إلى 1000.', 'How many are taken, 1 to 1000.') },
                },
            },
            {
                id = 'takeinv', level = 'admin', route = 'command', needsOnline = true, danger = true, line = 'takeinv {target}', probe = { ace = 'command.takeinv' },
                label = T('مصادرة الحقيبة', 'Confiscate the bag'),
                help = T('يأخذ كل أغراض اللاعب ويحفظها عند الإدارة، فيرى حقيبته فارغة. تعود كاملة بأمر «إرجاع الحقيبة».',
                    'Takes every item the player carries and keeps it with the staff; they see an empty bag. "Return the bag" gives it all back.'),
                args = { PLAYER_ONLINE },
            },
            {
                id = 'restoreinv', level = 'admin', route = 'command', needsOnline = true, line = 'restoreinv {target}', probe = { ace = 'command.restoreinv' },
                label = T('إرجاع الحقيبة', 'Return the bag'),
                help = T('يعيد إلى اللاعب كل الأغراض التي صودرت منه، ويراها في حقيبته فورًا.',
                    'Gives the player back everything that was confiscated; they see it in their bag at once.'),
                args = { PLAYER_ONLINE },
            },
        },
    },
    {
        res = 'w_crafting', group = 'player',
        label = T('الصناعة', 'Crafting'),
        description = T('طاولات الصناعة ووصفاتها وأقسامها.', 'Crafting benches, recipes and categories.'),
        help = T('يدير الصناعة: الطاولات والوصفات ومن يستطيع استخدامها. تحتاج لوحته إلى صلاحية التصنيع أو صلاحية إداري حالي.',
            'Runs crafting: benches, recipes and who may use them. Its panel requires the crafting permission or an existing full admin.'),
        probe = { node = 'w_crafting.admin' },
        panel = { route = { kind = 'command', line = 'craftadmin' }, how = T('الأمر /craftadmin', 'The /craftadmin command') },
    },
    {
        res = 'w_survival', group = 'player',
        label = T('عالم النجاة', 'Survival world'),
        description = T('المناطق والقطعان والأحداث والمناطق الآمنة.', 'Regions, hordes, events and safe zones.'),
        help = T('يدير عالم النجاة. لوحته توقف العالم أو تشغّله، ترفع العدوى في منطقة أو تنزلها، وتبدأ حدثًا.',
            'Runs the survival world. Its panel pauses or resumes the world, raises or lowers infection in a region and starts events.'),
        probe = { anyNode = { 'survival.view', 'survival.manage' } },
        panel = { route = { kind = 'command', line = 'survival' }, how = T('الأمر /survival', 'The /survival command') },
    },

    -- ── entertainment ─────────────────────────────────────────────────────────
    {
        res = 'w_baloot', group = 'fun',
        label = T('البلوت', 'Baloot'),
        description = T('طاولات البلوت وكراسيها ومستوى القيد.', 'Baloot tables, chairs and the qayd level.'),
        help = T('لعبة البلوت داخل السيرفر. لوحته تضيف الطاولات والكراسي أو تحذفها وتحدد مستوى القيد.',
            'The baloot card game. Its panel adds or removes tables and chairs and sets the qayd level.'),
        probe = { node = 'w_baloot.admin' },
        panel = { route = { kind = 'command', line = 'baloot' }, how = T('الأمر /baloot', 'The /baloot command') },
    },
    {
        res = 'wraith_cinema', group = 'fun',
        label = T('السينما', 'Cinema'),
        description = T('شاشات السينما: التشغيل والجدولة والإعلانات.', 'Cinema screens: playback, schedule and announcements.'),
        help = T('يدير السينما. لوحته تشغّل الأفلام وتجدولها وترسل إعلانات، ويرى اللاعبون في السينما التغيير فورًا.',
            'Runs the cinema. Its panel plays and schedules films and sends announcements; players in the cinema see it at once.'),
        probe = { anyNode = { 'wraith_cinema.admin', 'wraith_cinema.control', 'wraith_cinema.schedule',
            'wraith_cinema.logs', 'wraith_cinema.broadcast', 'wraith_cinema.calibrate' } },
        panel = { route = { kind = 'command', line = 'cinemaadmin' }, how = T('الأمر /cinemaadmin', 'The /cinemaadmin command') },
    },

    -- ── system ────────────────────────────────────────────────────────────────
    {
        res = 'w_logs', group = 'system',
        label = T('سجلات السيرفر', 'Server logs'),
        description = T('كل سجلات السيرفر وقنوات ديسكورد.', 'Every server log and the Discord channels.'),
        help = T('يجمع كل سجلات السيرفر: من اشترى ومن باع ومن مات. لوحته تعرض السجلات لكل لاعب وترسلها لديسكورد.',
            'Gathers every server log: who bought, who sold, who died. Its panel shows the logs per player and sends them to Discord.'),
        probe = { node = 'w_logs.view' },
        panel = { route = { kind = 'command', line = 'logs' }, how = T('الأمر /logs', 'The /logs command') },
    },
    {
        res = 'w_chat', group = 'system',
        label = T('الشات', 'Chat'),
        description = T('شات السيرفر ورسائله.', 'The server chat and its messages.'),
        help = T('يدير شات السيرفر. الإعلان من صفحة «الطقس والوقت والإعلان»، ومن هنا تمسح الشات عند الكل.',
            'Runs the server chat. Announce on the world page; from here you clear the chat for everyone.'),
        probe = { anyOf = { { admin = true }, { ace = 'command' } } },
        commands = {
            {
                id = 'clearchat', level = 'admin', route = 'command', danger = true, line = 'clearchat',
                label = T('مسح الشات', 'Clear the chat'),
                help = T('يمسح الشات عند كل اللاعبين الآن، وتظهر لهم رسالة أن الإدارة مسحته. لا يمكن التراجع.',
                    'Clears the chat for every player now; they see a message that staff cleared it. It cannot be undone.'),
                args = {},
            },
        },
    },
    {
        res = 'w_loading', group = 'system',
        label = T('شاشة التحميل', 'Loading screen'),
        description = T('الشاشة التي يراها اللاعب وهو يدخل.', 'The screen a player sees while joining.'),
        help = T('يعرض شاشة التحميل ونصائحها. سيظهر اسم السيرفر والنصائح هنا عندما يضيف السكربت إعداداته.',
            'Shows the loading screen and its tips. The server name and tips appear here once the script adds its settings.'),
    },
    {
        res = 'w_pausemenu', group = 'system',
        label = T('قائمة الإيقاف', 'Pause menu'),
        description = T('قائمة الإيقاف ومداخلها.', 'The pause menu and its entries.'),
        help = T('يرسم قائمة الإيقاف. مدخل «الإدارة» فيها يفتح هذه اللوحة.', 'Draws the pause menu. Its "Admin" entry opens this panel.'),
    },
    {
        res = 'w_connector', group = 'system',
        label = T('ربط الموقع', 'Website link'),
        description = T('الربط بين السيرفر والموقع.', 'The link between the server and the website.'),
        help = T('يربط السيرفر بالموقع. ليس له واجهة داخل اللعبة.', 'Links the server to the website. It has no in-game interface.'),
    },
    {
        res = 'w_core', group = 'system',
        label = T('نواة السيرفر', 'Server core'),
        description = T('اللاعبون والشخصيات والوظائف والأموال.', 'Players, characters, jobs and money.'),
        help = T('قلب السيرفر: الشخصيات وأرقام المواطنين والوظائف والأموال. إدارته في صفحات اللاعبين والشخصيات، ولا يمكن إيقافه من هنا.',
            'The heart of the server: characters, citizen IDs, jobs and money. Manage it on the players and characters pages; it cannot be stopped from here.'),
    },
    {
        res = 'w_lib', group = 'system',
        label = T('المكتبة المشتركة', 'Shared library'),
        description = T('الأدوات التي تستخدمها كل السكربتات.', 'The tools every script uses.'),
        help = T('مكتبة تستخدمها كل السكربتات: الرسائل والقوائم والصلاحيات. ليس لها إدارة ولا يمكن إيقافها من هنا.',
            'A library every script uses: messages, menus and permissions. It has no admin tools and cannot be stopped from here.'),
    },
}

WC.ScriptsRegistry = { version = 1, groups = GROUPS, scripts = SCRIPTS, pinned = { w_hud = true } }
