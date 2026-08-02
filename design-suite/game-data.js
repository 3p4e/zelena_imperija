export const FONT_HREF = "https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap";

export const STRAINS = [
  {id:'ohrid_crystal', nameMk:'Охридски Кристал', nameEn:'Ohrid Crystal', tier:1, growSec:55, yield:6, price:10, unlockLevel:1, glow:'#fbbf24'},
  {id:'pelister_frost', nameMk:'Пелистерски Мраз', nameEn:'Pelister Frost', tier:1, growSec:65, yield:7, price:11, unlockLevel:1, glow:'#93c5fd'},
  {id:'vardar_gold', nameMk:'Вардарско Злато', nameEn:'Vardar Gold', tier:2, growSec:90, yield:9, price:16, unlockLevel:3, glow:'#fbbf24'},
  {id:'skopje_haze', nameMk:'Скопска Измаглица', nameEn:'Skopje Haze', tier:2, growSec:100, yield:8, price:18, unlockLevel:4, glow:'#c4b5fd'},
  {id:'bitola_kush', nameMk:'Битолски Куш', nameEn:'Bitola Kush', tier:3, growSec:130, yield:11, price:26, unlockLevel:6, glow:'#86efac'},
  {id:'shar_diesel', nameMk:'Шарпланински Дизел', nameEn:'Shar Diesel', tier:3, growSec:140, yield:10, price:29, unlockLevel:7, glow:'#60a5fa'},
  {id:'galicica_dream', nameMk:'Галичица Сон', nameEn:'Galicica Dream', tier:4, growSec:170, yield:13, price:40, unlockLevel:9, glow:'#c084fc'},
  {id:'prespa_punch', nameMk:'Преспански Удар', nameEn:'Prespa Punch', tier:4, growSec:180, yield:12, price:44, unlockLevel:10, glow:'#fb923c'},
  {id:'macedonian_royal', nameMk:'Македонски Кралски', nameEn:'Macedonian Royal', tier:5, growSec:220, yield:16, price:60, unlockLevel:13, glow:'#fbbf24'},
  {id:'imperial_reserve', nameMk:'Империјална Резерва', nameEn:'Imperial Reserve', tier:5, growSec:240, yield:15, price:68, unlockLevel:15, glow:'#f472b6'},
];

export const SIGNATURE_HYBRIDS = {
  'ohrid_crystal|vardar_gold': {nameMk:'Кристално Злато', nameEn:'Crystal Gold', glow:'#fbbf24'},
  'bitola_kush|shar_diesel': {nameMk:'Планински Гром', nameEn:'Mountain Thunder', glow:'#60a5fa'},
  'galicica_dream|macedonian_royal': {nameMk:'Кралски Сон', nameEn:'Royal Dream', glow:'#c084fc'},
};

export const HYBRID_NAME_BANK = {
  prefixesMk:['Кристална','Планинска','Златна','Ноќна','Дивска','Империјална','Мистична','Сончева'],
  suffixesMk:['Магија','Искра','Мечта','Бура','Роса','Круна','Тајна','Светлина'],
  prefixesEn:['Crystal','Mountain','Golden','Midnight','Wild','Imperial','Mystic','Solar'],
  suffixesEn:['Magic','Spark','Dream','Storm','Dew','Crown','Secret','Glow'],
};

export function makeHybrid(a, b, seed){
  const key = [a.id,b.id].sort().join('|');
  const sig = SIGNATURE_HYBRIDS[key];
  const yieldV = Math.round(((a.yield+b.yield)/2)*1.15);
  const price = Math.round(((a.price+b.price)/2)*1.2);
  const growSec = Math.round((a.growSec+b.growSec)/2);
  const unlockLevel = Math.max(a.unlockLevel,b.unlockLevel);
  const tier = Math.min(5, Math.max(a.tier,b.tier));
  if (sig) return {id:'hybrid_'+key, nameMk:sig.nameMk, nameEn:sig.nameEn, tier, growSec:Math.round(growSec*0.92), yield:yieldV+2, price:price+6, unlockLevel, glow:sig.glow, hybrid:true, parents:[a.id,b.id]};
  const pi = seed % HYBRID_NAME_BANK.prefixesMk.length;
  const si = (seed*7+3) % HYBRID_NAME_BANK.suffixesMk.length;
  return {id:'hybrid_'+key+'_'+seed, nameMk:HYBRID_NAME_BANK.prefixesMk[pi]+' '+HYBRID_NAME_BANK.suffixesMk[si], nameEn:HYBRID_NAME_BANK.prefixesEn[pi]+' '+HYBRID_NAME_BANK.suffixesEn[si], tier, growSec, yield:yieldV, price, unlockLevel, glow:'#c084fc', hybrid:true, parents:[a.id,b.id]};
}

export const ROOM_TYPES = [
  {id:'starter', nameMk:'Стартовна Соба', nameEn:'Starter Room', capacity:4, unlockCost:0, unlockLevel:1, growMult:1, defaultUnlocked:true},
  {id:'greenhouse', nameMk:'Стаклена Градина', nameEn:'Greenhouse', capacity:8, unlockCost:3500, unlockLevel:5, growMult:0.85, defaultUnlocked:false},
  {id:'breeding_lab', nameMk:'Лабораторија за Генетика', nameEn:'Genetics Lab', capacity:0, unlockCost:6000, unlockLevel:8, growMult:1, defaultUnlocked:false, isLab:true},
];

export const LAMP_TIERS = [
  {tier:0, nameMk:'LED Основна', nameEn:'LED Basic', cost:0, growMult:1, yieldMult:1},
  {tier:1, nameMk:'LED Про', nameEn:'LED Pro', cost:1200, growMult:0.92, yieldMult:1.08},
  {tier:2, nameMk:'Целосен Спектар', nameEn:'Full Spectrum', cost:3200, growMult:0.82, yieldMult:1.18},
  {tier:3, nameMk:'Квантум Систем', nameEn:'Quantum System', cost:7500, growMult:0.7, yieldMult:1.32},
];

export const STAFF_TYPES = [
  {key:'waterer', nameMk:'Наводнувач', nameEn:'Waterer', cost:800, wage:40, everySec:15},
  {key:'feeder', nameMk:'Хранител', nameEn:'Feeder', cost:1000, wage:50, everySec:18},
  {key:'harvester', nameMk:'Берач', nameEn:'Harvester', cost:2200, wage:90, everySec:20},
  {key:'trader', nameMk:'Трговец', nameEn:'Trader', cost:1800, wage:70, everySec:30},
];

export const ACHIEVEMENTS = [
  {id:'first_harvest', statKey:'totalHarvests', value:1, rewardXp:100, nameMk:'Прва Берба', nameEn:'First Harvest', descMk:'Обери го првото растение', descEn:'Harvest your first plant'},
  {id:'harvest_10', statKey:'totalHarvests', value:10, rewardXp:200, nameMk:'Расте Бизнисот', nameEn:'Growing Business', descMk:'Обери 10 растенија', descEn:'Harvest 10 plants'},
  {id:'harvest_50', statKey:'totalHarvests', value:50, rewardXp:500, nameMk:'Мастер Градинар', nameEn:'Master Grower', descMk:'Обери 50 растенија', descEn:'Harvest 50 plants'},
  {id:'harvest_200', statKey:'totalHarvests', value:200, rewardXp:1200, nameMk:'Индустриска Берба', nameEn:'Industrial Harvest', descMk:'Обери 200 растенија', descEn:'Harvest 200 plants'},
  {id:'earn_1000', statKey:'lifetimeMoneyEarned', value:1000, rewardXp:150, nameMk:'Прв Приход', nameEn:'First Income', descMk:'Заработи 1.000 денари вкупно', descEn:'Earn 1,000 total money'},
  {id:'earn_10000', statKey:'lifetimeMoneyEarned', value:10000, rewardXp:400, nameMk:'Мал Претприемач', nameEn:'Small Entrepreneur', descMk:'Заработи 10.000 денари вкупно', descEn:'Earn 10,000 total money'},
  {id:'earn_100000', statKey:'lifetimeMoneyEarned', value:100000, rewardXp:1500, nameMk:'Зелен Магнат', nameEn:'Green Tycoon', descMk:'Заработи 100.000 денари вкупно', descEn:'Earn 100,000 total money'},
  {id:'level_5', statKey:'level', value:5, rewardXp:200, nameMk:'Над Почетник', nameEn:'Past Beginner', descMk:'Достигни ниво 5', descEn:'Reach level 5'},
  {id:'level_10', statKey:'level', value:10, rewardXp:500, nameMk:'Искусен Одгледувач', nameEn:'Seasoned Grower', descMk:'Достигни ниво 10', descEn:'Reach level 10'},
  {id:'level_20', statKey:'level', value:20, rewardXp:1500, nameMk:'Легенда на Империјата', nameEn:'Empire Legend', descMk:'Достигни ниво 20', descEn:'Reach level 20'},
  {id:'first_hybrid', statKey:'hybridsDiscovered', value:1, rewardXp:300, nameMk:'Генетски Пионер', nameEn:'Genetic Pioneer', descMk:'Одгледај го првиот хибрид', descEn:'Breed your first hybrid'},
  {id:'hybrids_5', statKey:'hybridsDiscovered', value:5, rewardXp:800, nameMk:'Мајстор Генетичар', nameEn:'Master Geneticist', descMk:'Одгледај 5 хибридни сорти', descEn:'Discover 5 hybrid strains'},
  {id:'hire_first_staff', statKey:'staffHiredCount', value:1, rewardXp:150, nameMk:'Прв Вработен', nameEn:'First Hire', descMk:'Вработи го првиот член на персонал', descEn:'Hire your first staff member'},
  {id:'hire_all_staff', statKey:'staffHiredCount', value:4, rewardXp:600, nameMk:'Комплетен Тим', nameEn:'Full Team', descMk:'Вработи ги сите видови персонал', descEn:'Hire every staff type'},
  {id:'unlock_greenhouse', statKey:'greenhouseUnlocked', value:1, rewardXp:400, nameMk:'Проширување', nameEn:'Expansion', descMk:'Отклучи ја Стаклената Градина', descEn:'Unlock the Greenhouse'},
  {id:'unlock_lab', statKey:'breedingLabUnlocked', value:1, rewardXp:400, nameMk:'Научен Пристап', nameEn:'Scientific Approach', descMk:'Отклучи ја Лабораторијата за Генетика', descEn:'Unlock the Genetics Lab'},
  {id:'orders_10', statKey:'ordersCompleted', value:10, rewardXp:500, nameMk:'Доверлив Добавувач', nameEn:'Trusted Supplier', descMk:'Исполни 10 нарачки', descEn:'Fulfill 10 customer orders'},
  {id:'first_prestige', statKey:'prestigeCount', value:1, rewardXp:1000, nameMk:'Прераѓање', nameEn:'Rebirth', descMk:'Направи го првото прераѓање', descEn:'Complete your first rebirth'},
];

export const CHALLENGE_POOL = [
  {id:'harvest_n', key:'harvest', min:3, max:6, rewardMoney:400, rewardXp:80, labelMk:n=>`Обери ${n} растенија`, labelEn:n=>`Harvest ${n} plants`},
  {id:'earn_n', key:'earned', min:500, max:1800, rewardMoney:300, rewardXp:100, labelMk:n=>`Заработи ${n} денари`, labelEn:n=>`Earn ${n} money`},
  {id:'water_n', key:'water', min:8, max:16, rewardMoney:250, rewardXp:60, labelMk:n=>`Полеј ${n} пати`, labelEn:n=>`Water plants ${n} times`},
  {id:'feed_n', key:'feed', min:8, max:16, rewardMoney:250, rewardXp:60, labelMk:n=>`Нахрани ${n} пати`, labelEn:n=>`Feed plants ${n} times`},
  {id:'sell_n', key:'sold', min:10, max:26, rewardMoney:350, rewardXp:90, labelMk:n=>`Продај ${n} парчиња`, labelEn:n=>`Sell ${n} units`},
  {id:'orders_n', key:'orders', min:1, max:2, rewardMoney:500, rewardXp:150, labelMk:n=>`Исполни ${n} нарачки`, labelEn:n=>`Fulfill ${n} orders`},
];

export const EVENT_POOL = [
  {id:'inspector', titleMk:'Изненадна Инспекција', titleEn:'Surprise Inspection', descMk:'Локален инспектор бара да го „провери" вашиот погон.', descEn:'A local inspector wants to "check" your operation.',
    choices:[{labelMk:'Плати поднамерение (-300)', labelEn:'Pay a bribe (-300)', type:'money', min:-300, max:-300},
             {labelMk:'Одбиј', labelEn:'Refuse', type:'moneyRisk', min:-700, max:0}]},
  {id:'trader', titleMk:'Редок Трговец', titleEn:'Rare Seed Trader', descMk:'Патувачки трговец нуди мистериозно семе за 500 денари.', descEn:'A traveling trader offers a mystery seed for 500.',
    choices:[{labelMk:'Купи (-500)', labelEn:'Buy (-500)', type:'freeSeed', cost:500},
             {labelMk:'Одбиј', labelEn:'Decline', type:'none'}]},
  {id:'demand', titleMk:'Бран на Побарувачка', titleEn:'Demand Surge', descMk:'Цените се зголемени! Следните 3 продажби носат +30%.', descEn:'Prices are up! Your next 3 sales earn +30%.',
    choices:[{labelMk:'Одлично!', labelEn:'Great!', type:'sellBoost', mult:1.3, count:3}]},
  {id:'pests', titleMk:'Напад на Штетници', titleEn:'Pest Outbreak', descMk:'Штетниците се појавуваат! Прскај сега или ризикувај здравје.', descEn:'Pests appear! Spray now or risk plant health.',
    choices:[{labelMk:'Прскај (-150)', labelEn:'Spray (-150)', type:'money', min:-150, max:-150},
             {labelMk:'Ризикувај', labelEn:'Risk it', type:'healthHit', min:20, max:40}]},
  {id:'donation', titleMk:'Донација на Семиња', titleEn:'Seed Donation', descMk:'Сосед подарува бесплатно семе за твојата колекција.', descEn:'A neighbor gifts a free seed for your collection.',
    choices:[{labelMk:'Прифати', labelEn:'Accept', type:'freeSeed', cost:0},
             {labelMk:'Одбиј', labelEn:'Decline', type:'none'}]},
  {id:'buyer', titleMk:'Ноќен Купувач', titleEn:'Late Night Buyer', descMk:'Купувач сака да го земе целото твое тековно количество за +20%.', descEn:'A buyer wants your entire current inventory for +20%.',
    choices:[{labelMk:'Продај сѐ', labelEn:'Sell it all', type:'sellAllBonus', mult:1.2},
             {labelMk:'Задржи', labelEn:'Keep inventory', type:'none'}]},
];

export const STR = {
  mk: {
    app_name:'Зелена Империја', stat_money:'Денари', stat_level:'Ниво', stat_day:'Ден',
    nav_grow:'Одгледување', nav_genetics:'Генетика', nav_market:'Пазар', nav_staff:'Персонал', nav_achievements:'Постигнувања', nav_prestige:'Престиж',
    grow_rooms_title:'Простории', room_capacity_prefix:'Капацитет', room_locked_btn:'Отклучи', room_unlock_needs_level:'Потребно ниво',
    lamp_current:'Ламба', lamp_upgrade_btn:'Надгради', lamp_maxed:'Максимум',
    challenges_title:'Дневни предизвици',
    plant_water:'Полеј', plant_feed:'Ѓубри', plant_harvest:'Обери', plant_harvest_ready:'Спремно', plant_growing_label:'Расте', plant_attention:'Внимание',
    badge_seed:'СЕМЕ', badge_sprout:'НИКНЕ', badge_veg:'РАСТЕ', badge_flower:'ЦВЕТА', badge_mature:'ЗРЕЛО',
    empty_slot_cta:'+ Посади',
    picker_title:'Избери сорта за садење', picker_locked_prefix:'Ниво',
    genetics_title:'Генетика и Сорти', genetics_desc:'Разгледај ги твоите откриени сорти и мешај генетика во лабораторијата.', discovered_heading:'Откриени сорти', locked_prefix:'Отклучува на ниво',
    breed_title:'Мешање на генетика', breed_hint:'Избери 2 откриени сорти за да создадеш нов хибрид.', breed_button:'Скрсти', breed_cost_prefix:'Цена', breed_need_lab:'Отклучи ја Лабораторијата за Генетика за да мешаш сорти.',
    breed_result_title:'Нова сорта откриена!', breed_result_cta:'Одлично',
    market_title:'Пазар', inventory_heading:'Залиха', inventory_empty:'Немаш залиха. Обери растенија за да се појават тука.', sell_one_btn:'Продај 1', sell_all_btn:'Продај сѐ', sell_all_inventory_btn:'Продај целата залиха',
    orders_heading:'Нарачки од купувачи', orders_empty:'Нема активни нарачки моментално.', order_reward_prefix:'Награда', order_have_prefix:'Имаш', order_fulfill_btn:'Исполни', order_need_btn:'Недоволно',
    staff_title:'Персонал', staff_desc:'Вработи персонал што автоматски работи наместо тебе.', staff_wage_prefix:'Плата/ден', staff_hire_btn:'Вработи', staff_hired_label:'Вработен',
    achievements_title:'Постигнувања и Статистика', stats_heading:'Твојата статистика', stat_harvests_label:'Вкупно берби', stat_earned_label:'Вкупно заработено', stat_playtime_label:'Време играно', stat_best_strain_label:'Најдобра сорта', stat_unlocked_label:'Отклучени',
    achievement_locked_label:'Заклучено',
    prestige_title:'Престиж и Прераѓање', prestige_desc:'Прероди се за трајни бонуси на продажната цена. Ова ги ресетира парите, растенијата и персоналот.', prestige_points_label:'Поени на престиж', prestige_mult_label:'Бонус на цена', prestige_locked_prefix:'Потребно ниво', prestige_btn:'Прероди се', prestige_confirm_title:'Дали си сигурен?', prestige_confirm_body:'Ова трајно ги ресетира парите, растенијата, просториите и персоналот во замена за трајни поени на престиж.', prestige_confirm_yes:'Да, прероди се', prestige_confirm_no:'Откажи',
    toast_heading:'Ново постигнување',
    tut_1_title:'Добредојде во Зелена Империја', tut_1_body:'Изгради одгледувачко царство од нула — сади, негувај, собирај и продавај.',
    tut_2_title:'Твоите ресурси', tut_2_body:'Парите и нивото се горе. Нивото ги отклучува нови сорти и простории.',
    tut_3_title:'Растенијата', tut_3_body:'Секое растение има вода, храна и здравје. Внимавај да не паднат premnogu ниско.',
    tut_4_title:'Полевање и хранење', tut_4_body:'Кликни „Полеј" и „Ѓубри" редовно за здраво и брзо растење.',
    tut_5_title:'Берба', tut_5_body:'Кога растението е ЗРЕЛО, обери го — производот оди во твојата залиха.',
    tut_6_title:'Пазар', tut_6_body:'Продај ја залихата или исполни нарачки од купувачи за поголема награда.',
    tut_7_title:'Истражи понатаму', tut_7_body:'Генетика, персонал, постигнувања и престиж те чекаат. Успешно одгледување!',
    tut_next:'Следно', tut_skip:'Прескокни', tut_done:'Започни',
    common_close:'Затвори',
  },
  en: {
    app_name:'Green Empire', stat_money:'Cash', stat_level:'Level', stat_day:'Day',
    nav_grow:'Grow Room', nav_genetics:'Genetics', nav_market:'Market', nav_staff:'Staff', nav_achievements:'Achievements', nav_prestige:'Prestige',
    grow_rooms_title:'Rooms', room_capacity_prefix:'Capacity', room_locked_btn:'Unlock', room_unlock_needs_level:'Requires level',
    lamp_current:'Lamp', lamp_upgrade_btn:'Upgrade', lamp_maxed:'Maxed',
    challenges_title:'Daily Challenges',
    plant_water:'Water', plant_feed:'Feed', plant_harvest:'Harvest', plant_harvest_ready:'Ready', plant_growing_label:'Growing', plant_attention:'Attention',
    badge_seed:'SEED', badge_sprout:'SPROUT', badge_veg:'VEG', badge_flower:'FLOWER', badge_mature:'MATURE',
    empty_slot_cta:'+ Plant',
    picker_title:'Choose a strain to plant', picker_locked_prefix:'Level',
    genetics_title:'Genetics & Strains', genetics_desc:'Browse your discovered strains and breed new genetics in the lab.', discovered_heading:'Discovered strains', locked_prefix:'Unlocks at level',
    breed_title:'Breed Genetics', breed_hint:'Select 2 discovered strains to create a new hybrid.', breed_button:'Breed', breed_cost_prefix:'Cost', breed_need_lab:'Unlock the Genetics Lab to breed strains.',
    breed_result_title:'New strain discovered!', breed_result_cta:'Awesome',
    market_title:'Market', inventory_heading:'Inventory', inventory_empty:'No inventory yet. Harvest plants to fill it up.', sell_one_btn:'Sell 1', sell_all_btn:'Sell all', sell_all_inventory_btn:'Sell entire inventory',
    orders_heading:'Customer Orders', orders_empty:'No active orders right now.', order_reward_prefix:'Reward', order_have_prefix:'Have', order_fulfill_btn:'Fulfill', order_need_btn:'Not enough',
    staff_title:'Staff', staff_desc:'Hire staff that automatically work for you.', staff_wage_prefix:'Wage/day', staff_hire_btn:'Hire', staff_hired_label:'Hired',
    achievements_title:'Achievements & Stats', stats_heading:'Your Stats', stat_harvests_label:'Total harvests', stat_earned_label:'Total earned', stat_playtime_label:'Time played', stat_best_strain_label:'Best strain', stat_unlocked_label:'Unlocked',
    achievement_locked_label:'Locked',
    prestige_title:'Prestige & Rebirth', prestige_desc:'Rebirth for a permanent boost to sell prices. This resets your money, plants, and staff.', prestige_points_label:'Prestige points', prestige_mult_label:'Price bonus', prestige_locked_prefix:'Requires level', prestige_btn:'Rebirth', prestige_confirm_title:'Are you sure?', prestige_confirm_body:'This permanently resets your money, plants, rooms, and staff in exchange for permanent prestige points.', prestige_confirm_yes:'Yes, rebirth', prestige_confirm_no:'Cancel',
    toast_heading:'Achievement unlocked',
    tut_1_title:'Welcome to Green Empire', tut_1_body:'Build a growing empire from nothing — plant, care, harvest, and sell.',
    tut_2_title:'Your resources', tut_2_body:'Cash and level are up top. Leveling up unlocks new strains and rooms.',
    tut_3_title:'Your plants', tut_3_body:'Every plant has water, food, and health. Keep them from dropping too low.',
    tut_4_title:'Water & feed', tut_4_body:'Click "Water" and "Feed" regularly for healthy, fast growth.',
    tut_5_title:'Harvest', tut_5_body:'Once a plant is MATURE, harvest it — the yield goes into your inventory.',
    tut_6_title:'Market', tut_6_body:'Sell your inventory or fulfill customer orders for a bigger reward.',
    tut_7_title:'Explore further', tut_7_body:'Genetics, staff, achievements, and prestige await. Happy growing!',
    tut_next:'Next', tut_skip:'Skip', tut_done:'Start playing',
    common_close:'Close',
  },
};

export function formatNum(n){ n=Math.round(n||0); return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g,'.'); }
export function formatCompact(n){ n=Math.round(n||0); if(Math.abs(n)>=1000000) return (n/1000000).toFixed(1).replace(/\.0$/,'')+'M'; if(Math.abs(n)>=1000) return (n/1000).toFixed(1).replace(/\.0$/,'')+'K'; return String(n); }
export function xpToNext(level){ return Math.round(140*Math.pow(level,1.32)); }
export function colorForPct(p){ if(p>=60) return '#22c55e'; if(p>=30) return '#f59e0b'; return '#ef4444'; }
export function fmtPlaytime(sec){ sec=Math.round(sec||0); const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60); return h>0 ? `${h}h ${m}m` : `${m}m`; }
