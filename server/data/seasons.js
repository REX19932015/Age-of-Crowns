'use strict';
/* =====================================================================
   AGE OF CROWNS: SEASONAL CONTENT
   Everything players can earn in a season lives here: the cosmetic items,
   the four battle passes (100 tiers plus 50 bonus tiers), the challenge pool, the Spring story
   campaign, holiday activities and live world events.
   The server is the only authority: the browser receives a copy of this
   for display and can never grant itself anything from it.
   Places ("at") are resolved to map coordinates from data/places.json.
   ===================================================================== */

// ------------------------------------------------------------------ the calendar (UTC, server clock)
// Astronomical seasons, rounded to whole days. Winter spans the new year.
const SEASONS = {
  spring: { id: 'spring', name: 'Spring', title: 'The Broken Crown', start: [3, 20], end: [6, 20], accent: '#9fd28a', accent2: '#f2b8c6',
    blurb: 'The Keeper of the Concord has vanished and the Concord Crown lies in pieces. Old alliances crack while the kingdoms race to find out what happened.' },
  summer: { id: 'summer', name: 'Summer', title: 'The War of the Eastern Sea', start: [6, 21], end: [9, 21], accent: '#f3c45a', accent2: '#5fb3d6',
    blurb: 'Pirate fleets and rival admirals fight over the eastern ports and the trade routes that feed the realm.' },
  autumn: { id: 'autumn', name: 'Autumn', title: 'The Shadow of the Old Kingdom', start: [9, 22], end: [12, 20], accent: '#e0873a', accent2: '#b0453a',
    blurb: 'Ruins of a kingdom older than the four crowns stir, and a conspiracy built on its memory reaches for power.' },
  winter: { id: 'winter', name: 'Winter', title: 'The Last Siege', start: [12, 21], end: [3, 19], accent: '#9cc9ee', accent2: '#e9f2fb',
    blurb: 'An enemy no crown can face alone marches out of the frozen north. Only a realm that stands together will see the spring.' },
};
const TIERS = 100;
const TIER_XP = 1500;            // XP per battle pass tier
const PREMIUM_PRICE = 20000;     // in-game gold; there is no real-money purchase anywhere in the game

// ------------------------------------------------------------------ items
// kind: outfit | hat | title | balloon | sails | gunfin | emote | plate
// Every item here is equippable in the Wardrobe and is drawn by the game (see js/seasons.js).
const I = {};
function item(id, kind, name, data, rarity, desc) { I[id] = { id, kind, name, data, rarity: rarity || 'common', desc: desc || '' }; return id; }

// ---- Spring: The Broken Crown (blossom pinks, fresh greens, Concord silver)
item('sp_out_blossom', 'outfit', 'Blossom Courier Coat', { coat: '#e9a7b8', trim: '#f7efe4', pants: '#6b5a4a', hat: 'wide', hatCol: '#f2d7de' }, 'common', 'Worn by the riders who carry the first letters of spring.');
item('sp_out_meadow', 'outfit', 'Meadow Warden', { coat: '#5e8a4a', trim: '#e7dcb8', pants: '#4a3a2a', hat: 'cap', hatCol: '#3e5e30', crossbelt: true }, 'common');
item('sp_out_envoy', 'outfit', 'Envoy of the Four Crowns', { coat: '#3a4f7a', trim: '#e2b84a', pants: '#e9e2d2', hat: 'bicorne', hatCol: '#22304e', sash: '#c0303a' }, 'rare', 'Diplomatic dress for the spring talks.');
item('sp_out_herald', 'outfit', 'Concord Herald', { coat: '#d9d4c7', trim: '#6a7fa8', pants: '#3a4a6a', hat: 'tricorn', hatCol: '#6a7fa8', sash: '#6a7fa8' }, 'rare');
item('sp_out_guard', 'outfit', 'Concord Guard Uniform', { coat: '#7c8794', trim: '#f4f1ea', pants: '#2a2a2e', hat: 'shako', hatCol: '#2a2a2e', epaulettes: true, crossbelt: true }, 'epic', 'The silver-grey of the guard that protects the Concord Hall.');
item('sp_out_orchard', 'outfit', 'Orchard Keeper', { coat: '#a8c46a', trim: '#f4e7c8', pants: '#5a4a3a', hat: 'wide', hatCol: '#e9a7b8', apron: true }, 'common');
item('sp_out_regent', 'outfit', 'Regent’s Spring Mantle', { coat: '#f2f0ea', trim: '#e2b84a', pants: '#e9e2d2', hat: 'bicorne', hatCol: '#f2f0ea', cape: '#c97a96', sash: '#e2b84a', epaulettes: true }, 'legendary', 'A pale mantle trimmed in rose and gold.');
item('sp_out_lily', 'outfit', 'Lily-of-the-Valley Gown', { coat: '#f4f1ea', trim: '#8fbf7a', pants: '#e9e2d2', hat: 'wide', hatCol: '#8fbf7a', cape: '#8fbf7a' }, 'epic');
item('sp_hat_wreath', 'hat', 'Blossom Wide-Brim', { hat: 'wide', hatCol: '#f2b8c6' }, 'common');
item('sp_hat_green', 'hat', 'Fresh Green Cap', { hat: 'cap', hatCol: '#6ea85a' }, 'common');
item('sp_hat_silver', 'hat', 'Silver Concord Shako', { hat: 'shako', hatCol: '#b8c0cc' }, 'rare');
item('sp_hat_rose', 'hat', 'Rose Bicorne', { hat: 'bicorne', hatCol: '#c97a96' }, 'rare');
item('sp_tit_seeker', 'title', 'Title: Seeker of Shards', { text: 'Seeker of Shards' }, 'rare');
item('sp_tit_springborn', 'title', 'Title: Springborn', { text: 'Springborn' }, 'common');
item('sp_tit_envoy', 'title', 'Title: Envoy of Spring', { text: 'Envoy of Spring' }, 'epic');
item('sp_bal_blossom', 'balloon', 'Blossom Envelope', { a: '#f2b8c6', b: '#fbf3ea', band: '#8fbf7a' }, 'rare', 'Balloon envelope in petal stripes.');
item('sp_bal_meadow', 'balloon', 'Meadow Envelope', { a: '#7fb35a', b: '#f4e7c8', band: '#e2b84a' }, 'epic');
item('sp_sail_rose', 'sails', 'Rose-Dyed Sails', { col: '#f0c4cf' }, 'rare', 'Sails dyed in spring rose for any ship you take the helm of.');
item('sp_sail_green', 'sails', 'Fern-Green Sails', { col: '#b9d9a6' }, 'epic');
item('sp_gun_silver', 'gunfin', 'Concord Silver Finish', { wood: '#7a5a44', metal: '#c8ccd4', brass: '#e8e4dc' }, 'epic', 'Silver-chased musket and pistol fittings.');
item('sp_gun_cherry', 'gunfin', 'Cherrywood Stock', { wood: '#8a3a2a', metal: '#3a3d42', brass: '#d9b24a' }, 'rare');
item('sp_emo_bow', 'emote', 'Emote: Courtly Bow', { e: 'courtbow', verb: 'gives a deep courtly bow' }, 'rare');
item('sp_emo_petals', 'emote', 'Emote: Scatter Petals', { e: 'petals', verb: 'scatters a handful of petals' }, 'epic');
item('sp_plate_rose', 'plate', 'Rose Nameplate', { col: '#f2b8c6' }, 'common', 'Your name glows rose above your head.');
item('sp_plate_leaf', 'plate', 'Leaf Nameplate', { col: '#a9dc8c' }, 'common');
// Spring campaign rewards (only from finishing the story; never in the battle pass)
item('sp_story_regalia', 'outfit', 'Regalia of the Restored Concord', { coat: '#f7f4ee', trim: '#e2b84a', pants: '#e9e2d2', hat: 'bicorne', hatCol: '#e2b84a', cape: '#5a76b0', sash: '#e2b84a', epaulettes: true, cuirass: true }, 'mythic', 'Awarded only to those who saw the Broken Crown mended. Silver, gold and Concord blue.');
item('sp_story_title', 'title', 'Title: Keeper of the Concord', { text: 'Keeper of the Concord' }, 'mythic');
item('sp_story_balloon', 'balloon', 'Concord Crown Envelope', { a: '#5a76b0', b: '#f7f4ee', band: '#e2b84a' }, 'mythic');
item('sp_story_sails', 'sails', 'Concord Blue Sails', { col: '#9fb4e0' }, 'mythic');
item('sp_story_plate', 'plate', 'Concord Gold Nameplate', { col: '#ffd86a' }, 'mythic');
item('sp_story_crownbearer', 'title', 'Title: Crownbearer', { text: 'Crownbearer' }, 'mythic', 'For those who chose to reforge the crown for their own kingdom.');

// ---- Summer: The War of the Eastern Sea (sea blues, sun gold, coral)
item('su_out_deckhand', 'outfit', 'Sun-Bleached Deckhand', { coat: '#e8dcc0', trim: '#2f5f8a', pants: '#2f5f8a', hat: 'bandana', hatCol: '#c0303a' }, 'common');
item('su_out_marine', 'outfit', 'Eastern Sea Marine', { coat: '#1f4f7a', trim: '#f4f1ea', pants: '#f4f1ea', hat: 'shako', hatCol: '#1f2f4a', crossbelt: true }, 'rare');
item('su_out_captain', 'outfit', 'Coral Captain', { coat: '#d9705a', trim: '#e2b84a', pants: '#f4f1ea', hat: 'tricorn', hatCol: '#2a2a2e', sash: '#1f6a73' }, 'epic');
item('su_out_admiral', 'outfit', 'Admiral of the Tides', { coat: '#14304e', trim: '#e2b84a', pants: '#f4f1ea', hat: 'bicorne', hatCol: '#14304e', epaulettes: true, sash: '#e2b84a', cape: '#14304e' }, 'legendary');
item('su_out_trader', 'outfit', 'Spice-Route Trader', { coat: '#c89a3a', trim: '#7a2a2a', pants: '#5a3a2a', hat: 'wide', hatCol: '#8a5a2a', apron: true }, 'common');
item('su_out_sunlit', 'outfit', 'Sunlit Linen', { coat: '#f4ecd8', trim: '#f3c45a', pants: '#e9e2d2', hat: 'wide', hatCol: '#f3c45a' }, 'common');
item('su_out_corsair', 'outfit', 'Reformed Corsair', { coat: '#2a2a2e', trim: '#c0303a', pants: '#3a2a2a', hat: 'tricorn', hatCol: '#2a2a2e', crossbelt: true, sash: '#c0303a' }, 'epic');
item('su_hat_straw', 'hat', 'Straw Wide-Brim', { hat: 'wide', hatCol: '#e8cf8a' }, 'common');
item('su_hat_navy', 'hat', 'Navy Bicorne', { hat: 'bicorne', hatCol: '#1f2f4a' }, 'rare');
item('su_hat_red', 'hat', 'Red Sea Bandana', { hat: 'bandana', hatCol: '#c0303a' }, 'common');
item('su_tit_mariner', 'title', 'Title: Mariner of the East', { text: 'Mariner of the East' }, 'rare');
item('su_tit_sunchaser', 'title', 'Title: Sunchaser', { text: 'Sunchaser' }, 'common');
item('su_tit_tidecaller', 'title', 'Title: Tidecaller', { text: 'Tidecaller' }, 'epic');
item('su_bal_sun', 'balloon', 'Midsummer Sun Envelope', { a: '#f3c45a', b: '#fff4d6', band: '#d9705a' }, 'rare');
item('su_bal_sea', 'balloon', 'Eastern Sea Envelope', { a: '#2f7fb3', b: '#f4f1ea', band: '#f3c45a' }, 'epic');
item('su_sail_sun', 'sails', 'Sunset Sails', { col: '#f6c48e' }, 'rare');
item('su_sail_navy', 'sails', 'Admiralty Blue Sails', { col: '#8fb2d6' }, 'epic');
item('su_gun_brass', 'gunfin', 'Ship’s Brass Finish', { wood: '#5a3a20', metal: '#b8913a', brass: '#e8c86a' }, 'rare');
item('su_gun_driftwood', 'gunfin', 'Driftwood Stock', { wood: '#a89a84', metal: '#4a4e54', brass: '#c9a24a' }, 'epic');
item('su_emo_salute', 'emote', 'Emote: Sailor’s Salute', { e: 'sailsalute', verb: 'snaps a sailor’s salute' }, 'rare');
item('su_emo_hornpipe', 'emote', 'Emote: Hornpipe', { e: 'hornpipe', verb: 'dances a hornpipe' }, 'epic');
item('su_plate_sea', 'plate', 'Sea-Glass Nameplate', { col: '#8fe0e8' }, 'common');
item('su_plate_sun', 'plate', 'Sunlit Nameplate', { col: '#ffd27a' }, 'common');

// ---- Autumn: The Shadow of the Old Kingdom (amber, rust, old bronze)
item('au_out_harvest', 'outfit', 'Harvest Hand', { coat: '#b8742a', trim: '#f0dcb0', pants: '#5a4a3a', hat: 'wide', hatCol: '#8a5a2a', apron: true }, 'common');
item('au_out_scholar', 'outfit', 'Ruin Scholar', { coat: '#6a4a2a', trim: '#d9b24a', pants: '#3a2a1a', hat: 'tricorn', hatCol: '#3a2a1a' }, 'common');
item('au_out_ember', 'outfit', 'Ember Duelist', { coat: '#8a2a1a', trim: '#e2b84a', pants: '#2a2a2e', hat: 'bicorne', hatCol: '#2a1a10', sash: '#e0873a' }, 'rare');
item('au_out_oldguard', 'outfit', 'Old Kingdom Guard', { coat: '#5a5040', trim: '#b89a5a', pants: '#3a3428', hat: 'shako', hatCol: '#3a3428', cuirass: true, crossbelt: true }, 'epic');
item('au_out_masque', 'outfit', 'Masquerade Conspirator', { coat: '#2a1a2e', trim: '#b0453a', pants: '#1a1a1e', hat: 'tricorn', hatCol: '#1a1a1e', cape: '#5a1a2a' }, 'epic');
item('au_out_amber', 'outfit', 'Amber Court Dress', { coat: '#d99a3a', trim: '#f4efe0', pants: '#e9e2d2', hat: 'bicorne', hatCol: '#7a3a1a', cape: '#b0453a', sash: '#f4efe0', epaulettes: true }, 'legendary');
item('au_out_forager', 'outfit', 'Forest Forager', { coat: '#7a6a2a', trim: '#c8b88a', pants: '#4a3a2a', hat: 'furcap', hatCol: '#6a4a2a' }, 'common');
item('au_hat_rust', 'hat', 'Rust Tricorn', { hat: 'tricorn', hatCol: '#8a3a1a' }, 'common');
item('au_hat_amber', 'hat', 'Amber Wide-Brim', { hat: 'wide', hatCol: '#d99a3a' }, 'common');
item('au_hat_bronze', 'hat', 'Bronze Shako', { hat: 'shako', hatCol: '#7a5a2a' }, 'rare');
item('au_tit_lorekeeper', 'title', 'Title: Lorekeeper', { text: 'Lorekeeper' }, 'rare');
item('au_tit_harvest', 'title', 'Title: Harvest Born', { text: 'Harvest Born' }, 'common');
item('au_tit_shadow', 'title', 'Title: Walker in Shadow', { text: 'Walker in Shadow' }, 'epic');
item('au_bal_leaf', 'balloon', 'Falling Leaf Envelope', { a: '#e0873a', b: '#f4e2c0', band: '#8a2a1a' }, 'rare');
item('au_bal_ember', 'balloon', 'Ember Envelope', { a: '#b0453a', b: '#2a1a10', band: '#e2b84a' }, 'epic');
item('au_sail_amber', 'sails', 'Amber Sails', { col: '#e8b77a' }, 'rare');
item('au_sail_rust', 'sails', 'Rust-Red Sails', { col: '#c98a72' }, 'epic');
item('au_gun_bronze', 'gunfin', 'Old Bronze Finish', { wood: '#4a2e18', metal: '#8a6a3a', brass: '#b8913a' }, 'rare');
item('au_gun_walnut', 'gunfin', 'Black Walnut Stock', { wood: '#2a1a10', metal: '#3a3d42', brass: '#d9b24a' }, 'epic');
item('au_emo_tip', 'emote', 'Emote: Doff the Hat', { e: 'doff', verb: 'doffs their hat' }, 'rare');
item('au_emo_toast', 'emote', 'Emote: Harvest Toast', { e: 'toast', verb: 'raises a harvest toast' }, 'epic');
item('au_plate_amber', 'plate', 'Amber Nameplate', { col: '#f0b060' }, 'common');
item('au_plate_ember', 'plate', 'Ember Nameplate', { col: '#ff8a6a' }, 'common');

// ---- Winter: The Last Siege (frost blue, snow white, steel)
item('wi_out_frost', 'outfit', 'Frostguard Greatcoat', { coat: '#3a4a6a', trim: '#e9f2fb', pants: '#2a2a2e', hat: 'furcap', hatCol: '#e9f2fb', crossbelt: true }, 'common');
item('wi_out_snow', 'outfit', 'Snowfield Scout', { coat: '#e9eef4', trim: '#7a8a9a', pants: '#c8d0d8', hat: 'furcap', hatCol: '#c8d0d8' }, 'common');
item('wi_out_siege', 'outfit', 'Siege Engineer', { coat: '#5a5a5a', trim: '#e2b84a', pants: '#3a3a3a', hat: 'cap', hatCol: '#2a2a2e', apron: true }, 'rare');
item('wi_out_defender', 'outfit', 'Defender of the Wall', { coat: '#2a3a5a', trim: '#c8d0d8', pants: '#e9e2d2', hat: 'shako', hatCol: '#1a2238', cuirass: true, epaulettes: true }, 'epic');
item('wi_out_winterfest', 'outfit', 'Winterfest Finery', { coat: '#8a1e2a', trim: '#f4f1ea', pants: '#2a2a2e', hat: 'furcap', hatCol: '#f4f1ea', sash: '#2e6b3a' }, 'rare');
item('wi_out_lastlight', 'outfit', 'Mantle of the Last Light', { coat: '#f4f6fa', trim: '#9cc9ee', pants: '#e9e2d2', hat: 'bicorne', hatCol: '#9cc9ee', cape: '#2a3a5a', sash: '#9cc9ee', epaulettes: true }, 'legendary');
item('wi_out_hearth', 'outfit', 'Hearthside Knit', { coat: '#8a5a3a', trim: '#e8dcc0', pants: '#4a3a2a', hat: 'furcap', hatCol: '#a07a5a' }, 'common');
item('wi_hat_fur', 'hat', 'White Fur Cap', { hat: 'furcap', hatCol: '#f4f6fa' }, 'common');
item('wi_hat_steel', 'hat', 'Steel Shako', { hat: 'shako', hatCol: '#7c8794' }, 'rare');
item('wi_hat_holly', 'hat', 'Holly Tricorn', { hat: 'tricorn', hatCol: '#2e6b3a' }, 'common');
item('wi_tit_frost', 'title', 'Title: Frostbound', { text: 'Frostbound' }, 'common');
item('wi_tit_wall', 'title', 'Title: Warden of the Wall', { text: 'Warden of the Wall' }, 'rare');
item('wi_tit_lastlight', 'title', 'Title: Bearer of the Last Light', { text: 'Bearer of the Last Light' }, 'epic');
item('wi_bal_snow', 'balloon', 'Snowflake Envelope', { a: '#e9f2fb', b: '#9cc9ee', band: '#f4f6fa' }, 'rare');
item('wi_bal_fest', 'balloon', 'Winterfest Envelope', { a: '#8a1e2a', b: '#f4f1ea', band: '#2e6b3a' }, 'epic');
item('wi_sail_ice', 'sails', 'Ice-White Sails', { col: '#f4f8fc' }, 'rare');
item('wi_sail_steel', 'sails', 'Storm-Grey Sails', { col: '#a8b2bc' }, 'epic');
item('wi_gun_frost', 'gunfin', 'Frosted Steel Finish', { wood: '#3a2a20', metal: '#d8e4ee', brass: '#9cc9ee' }, 'epic');
item('wi_gun_birch', 'gunfin', 'Birchwood Stock', { wood: '#d8ccb4', metal: '#4a4e54', brass: '#c9a24a' }, 'rare');
item('wi_emo_warm', 'emote', 'Emote: Warm Your Paws', { e: 'warm', verb: 'rubs their paws together against the cold' }, 'rare');
item('wi_emo_snowball', 'emote', 'Emote: Snowball', { e: 'snowball', verb: 'lobs a snowball' }, 'epic');
item('wi_plate_ice', 'plate', 'Ice Nameplate', { col: '#bfe4ff' }, 'common');
item('wi_plate_holly', 'plate', 'Holly Nameplate', { col: '#9fe0a8' }, 'common');

// ---- Holiday items (earned from holiday activities, any season)
item('hol_val_out', 'outfit', 'Sweetheart’s Coat', { coat: '#c0485a', trim: '#f7e4e8', pants: '#3a2a2e', hat: 'bicorne', hatCol: '#c0485a', sash: '#f7e4e8' }, 'epic', 'From the Day of Friendship letters.');
item('hol_val_plate', 'plate', 'Heartfelt Nameplate', { col: '#ff9fb4' }, 'rare');
item('hol_egg_out', 'outfit', 'Spring Festival Finery', { coat: '#bfe0f0', trim: '#f7d6e0', pants: '#e9e2d2', hat: 'wide', hatCol: '#f7e7a0' }, 'epic', 'From the Spring Festival egg hunt.');
item('hol_egg_tit', 'title', 'Title: Egg Finder', { text: 'Egg Finder' }, 'rare');
item('hol_mid_bal', 'balloon', 'Midsummer Bonfire Envelope', { a: '#f39a3a', b: '#fff1c0', band: '#c0303a' }, 'epic', 'From the Midsummer bonfires.');
item('hol_hal_out', 'outfit', 'Lantern-Night Costume', { coat: '#2a1a2e', trim: '#f08a2a', pants: '#1a1a1e', hat: 'wide', hatCol: '#1a1a1e', cape: '#f08a2a' }, 'epic', 'From the Haunted Lantern Walk.');
item('hol_hal_tit', 'title', 'Title: Lantern Walker', { text: 'Lantern Walker' }, 'rare');
item('hol_xmas_out', 'outfit', 'Winterfest Gift-Bringer', { coat: '#b0202a', trim: '#f4f6fa', pants: '#2a2a2e', hat: 'furcap', hatCol: '#f4f6fa', sash: '#2e6b3a' }, 'epic', 'From the Winterfest ornament hunt.');
item('hol_xmas_emo', 'emote', 'Emote: Give a Gift', { e: 'gift', verb: 'offers a wrapped gift' }, 'rare');
item('hol_ny_plate', 'plate', 'Firework Nameplate', { col: '#ffe36a' }, 'rare', 'From the New Year beacons.');
item('hol_ny_tit', 'title', 'Title: First Light of the Year', { text: 'First Light of the Year' }, 'epic');

// ------------------------------------------------------------------ battle passes
// Each pass has 10 chapters of 10 tiers, then 50 bonus tiers for those who keep playing.
// Reward kinds (all granted and checked by the server):
//   gold: n            gold paid into the wallet
//   item: id           a wardrobe item (see above)
//   tonic: n           healing tonics, a real game item (key 1)
//   boost: {mult,mins} more XP from everything for a while (stacks by adding time)
//   chest: {name,opts} the player picks ONE of the options when claiming
// Free track: an item, chest or useful reward through every chapter; premium (in-game gold only) adds
// something to every tier, including the four stages of the season's evolving outfit.
const BONUS_TIERS = 50, MAX_TIER = TIERS + BONUS_TIERS;
const CHAPTERS = {
  spring: ['First Thaw', 'Muddy Roads', 'Blossom Market', 'Rain on the Rooftops', 'Maypole Green', 'The Envoy’s Road', 'Orchard Lanterns', 'Silver Concord', 'Petal Storm', 'Full Bloom'],
  summer: ['Fair Winds', 'Salt and Sun', 'Harbour Days', 'The Long Light', 'Coral Coast', 'Midsummer Fires', 'The Spice Route', 'Broadside', 'Admiralty Blue', 'High Tide'],
  autumn: ['First Frost', 'Harvest Home', 'Amber Woods', 'The Old Roads', 'Lantern Nights', 'Ruin and Rust', 'Masquerade', 'The Ember Court', 'The Shadow Walks', 'Last Leaves'],
  winter: ['First Snow', 'Hearthside', 'Frozen Harbour', 'Steel and Ice', 'Winterfest', 'The Long Night', 'Holly and Iron', 'The Wall Holds', 'Lastlight', 'The Thaw'],
};

// ---- evolving outfits: one look in four stages, premium tiers 1, 33, 66 and 100
function evolving(prefix, name, stages) {
  const ids = [], rar = ['rare', 'epic', 'epic', 'legendary'], st = ['I', 'II', 'III', 'IV'];
  stages.forEach((d, i) => ids.push(item(`${prefix}_evo${i + 1}`, 'outfit', `${name} · Stage ${st[i]}`, d, rar[i], i === 3 ? 'The final form of this season’s evolving outfit.' : `Stage ${st[i]} of 4. Keep climbing the premium track to evolve it.`)));
  return ids;
}
const EVOLVE = {
  spring: evolving('sp', 'Bloomward', [
    { coat: '#8fbf7a', trim: '#f4efe4', pants: '#5a4a3a', hat: 'cap', hatCol: '#5e8a4a' },
    { coat: '#8fbf7a', trim: '#f4efe4', pants: '#5a4a3a', hat: 'wide', hatCol: '#f2b8c6', sash: '#f2b8c6' },
    { coat: '#6ea85a', trim: '#f7efe4', pants: '#e9e2d2', hat: 'tricorn', hatCol: '#3e5e30', sash: '#f2b8c6', cape: '#c97a96', epaulettes: true, crossbelt: true },
    { coat: '#f7f4ee', trim: '#e2b84a', pants: '#e9e2d2', hat: 'bicorne', hatCol: '#e2b84a', sash: '#e2b84a', cape: '#8fbf7a', epaulettes: true, cuirass: true }]),
  summer: evolving('su', 'Sunwake', [
    { coat: '#f4ecd8', trim: '#2f7fb3', pants: '#e9e2d2', hat: 'bandana', hatCol: '#2f7fb3' },
    { coat: '#f4ecd8', trim: '#2f7fb3', pants: '#e9e2d2', hat: 'wide', hatCol: '#f3c45a', sash: '#d9705a' },
    { coat: '#2f7fb3', trim: '#f3c45a', pants: '#f4f1ea', hat: 'tricorn', hatCol: '#14304e', sash: '#d9705a', cape: '#f3c45a', crossbelt: true },
    { coat: '#fff4d6', trim: '#e2b84a', pants: '#f4f1ea', hat: 'bicorne', hatCol: '#2f7fb3', sash: '#e2b84a', cape: '#2f7fb3', epaulettes: true, cuirass: true }]),
  autumn: evolving('au', 'Emberfall', [
    { coat: '#7a5a2a', trim: '#e0873a', pants: '#3a2a1a', hat: 'furcap', hatCol: '#6a4a2a' },
    { coat: '#b8742a', trim: '#f0dcb0', pants: '#3a2a1a', hat: 'wide', hatCol: '#8a3a1a', sash: '#b0453a' },
    { coat: '#8a2a1a', trim: '#e0873a', pants: '#2a2a2e', hat: 'tricorn', hatCol: '#2a1a10', sash: '#e0873a', cape: '#5a1a2a', crossbelt: true },
    { coat: '#2a1a10', trim: '#e2b84a', pants: '#e9e2d2', hat: 'bicorne', hatCol: '#b0453a', sash: '#e2b84a', cape: '#e0873a', epaulettes: true, cuirass: true }]),
  winter: evolving('wi', 'Hoarfrost', [
    { coat: '#c8d0d8', trim: '#3a4a6a', pants: '#2a2a2e', hat: 'furcap', hatCol: '#e9f2fb' },
    { coat: '#e9eef4', trim: '#3a4a6a', pants: '#2a2a2e', hat: 'furcap', hatCol: '#9cc9ee', sash: '#9cc9ee' },
    { coat: '#3a4a6a', trim: '#e9f2fb', pants: '#e9e2d2', hat: 'shako', hatCol: '#e9f2fb', sash: '#9cc9ee', cape: '#e9f2fb', crossbelt: true },
    { coat: '#f4f6fa', trim: '#9cc9ee', pants: '#e9e2d2', hat: 'bicorne', hatCol: '#3a4a6a', sash: '#9cc9ee', cape: '#3a4a6a', epaulettes: true, cuirass: true }]),
};
// ---- bonus-tier prestige rewards (free for everyone who reaches them)
const PRESTIGE = {
  spring: [item('sp_pre_title', 'title', 'Title: Paragon of Spring', { text: 'Paragon of Spring' }, 'legendary', 'For reaching bonus tier 125.'), item('sp_pre_plate', 'plate', 'Laurel Gold Nameplate', { col: '#f7e08a' }, 'legendary', 'For reaching the very last bonus tier.')],
  summer: [item('su_pre_title', 'title', 'Title: Paragon of Summer', { text: 'Paragon of Summer' }, 'legendary', 'For reaching bonus tier 125.'), item('su_pre_plate', 'plate', 'Sunfire Nameplate', { col: '#ffb347' }, 'legendary', 'For reaching the very last bonus tier.')],
  autumn: [item('au_pre_title', 'title', 'Title: Paragon of Autumn', { text: 'Paragon of Autumn' }, 'legendary', 'For reaching bonus tier 125.'), item('au_pre_plate', 'plate', 'Old Gold Nameplate', { col: '#e8c070' }, 'legendary', 'For reaching the very last bonus tier.')],
  winter: [item('wi_pre_title', 'title', 'Title: Paragon of Winter', { text: 'Paragon of Winter' }, 'legendary', 'For reaching bonus tier 125.'), item('wi_pre_plate', 'plate', 'Starlight Nameplate', { col: '#e6f4ff' }, 'legendary', 'For reaching the very last bonus tier.')],
};

// spread n items over tiers 1..100, keeping clear of the tiers in `taken`
function spread(list, taken, from = 2, to = 99) {
  const out = new Map(), used = new Set(taken);
  list.forEach((id, i) => {
    let t = Math.round(from + (i + 0.5) * (to - from) / list.length);
    for (let d = 0; used.has(t) || t < 1 || t > TIERS; d++) t = Math.round(from + (i + 0.5) * (to - from) / list.length) + (d % 2 ? -(d + 1) / 2 : d / 2 + 1);
    used.add(t); out.set(t, id);
  });
  return out;
}
const chestFree = c => ({ chest: { name: `Chapter ${c} Chest`, rarity: c >= 7 ? 'epic' : 'rare', opts: [{ gold: 300 + 60 * c }, { tonic: 3 + Math.floor(c / 3), gold: 100 + 20 * c }, { boost: { mult: 1.5, mins: 45 + 5 * c } }] } });
const chestPrem = c => ({ chest: { name: `Royal Chest ${c}`, rarity: 'epic', opts: [{ gold: 600 + 100 * c }, { tonic: 6, gold: 300 + 50 * c }, { boost: { mult: 2, mins: 60 } }] } });
function buildPass(key, free, premium) {
  const tiers = [], evo = EVOLVE[key];
  const freeChest = new Set([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  const evoAt = new Map([[1, evo[0]], [33, evo[1]], [66, evo[2]], [100, evo[3]]]);
  const fItems = spread(free, freeChest), pItems = spread(premium, [...freeChest, ...evoAt.keys()]);
  for (let t = 1; t <= TIERS; t++) {
    const c = Math.ceil(t / 10), r = t % 10;
    let f = null;
    if (t === TIERS) f = { chest: { name: 'Grand Crown Chest', rarity: 'legendary', opts: [{ gold: 2500 }, { tonic: 12, gold: 1200 }, { boost: { mult: 2, mins: 120 }, gold: 800 }] } };
    else if (freeChest.has(t)) f = chestFree(c);
    else if (fItems.has(t)) f = { item: fItems.get(t) };
    else if (r === 2 || r === 6) f = { gold: 100 + 15 * c };
    else if (r === 4) f = { tonic: 1 };
    else if (r === 8) f = { gold: 150 + 15 * c };
    let p;
    if (evoAt.has(t)) p = { item: evoAt.get(t) };
    else if (freeChest.has(t)) p = chestPrem(c);
    else if (pItems.has(t)) p = { item: pItems.get(t) };
    else if (r === 5) p = { boost: { mult: 1.5, mins: 30 } };
    else if (r === 3 || r === 7) p = { tonic: 2 };
    else p = { gold: 150 + 25 * c };
    tiers.push({ tier: t, chapter: c, free: f, premium: p });
  }
  const [pTitle, pPlate] = PRESTIGE[key];
  for (let t = TIERS + 1; t <= MAX_TIER; t++) {
    const f = t === 125 ? { item: pTitle } : t === MAX_TIER ? { item: pPlate } : t % 10 === 0 ? { chest: { name: 'Prestige Chest', rarity: 'epic', opts: [{ gold: 1000 }, { tonic: 8 }, { boost: { mult: 2, mins: 90 } }] } } : { gold: 200 };
    tiers.push({ tier: t, chapter: 11, bonus: true, free: f, premium: t % 2 ? { tonic: 1 } : { gold: 150 } });
  }
  return tiers;
}
const PASSES = {
  spring: buildPass('spring',
    ['sp_plate_leaf', 'sp_hat_green', 'sp_out_meadow', 'sp_tit_springborn', 'sp_hat_wreath', 'sp_out_orchard', 'sp_out_blossom', 'sp_plate_rose', 'sp_gun_cherry', 'sp_hat_silver', 'sp_out_herald', 'sp_tit_seeker', 'sp_bal_blossom', 'sp_sail_rose', 'sp_emo_bow'],
    ['sp_out_envoy', 'sp_hat_rose', 'sp_out_lily', 'sp_bal_meadow', 'sp_sail_green', 'sp_gun_silver', 'sp_emo_petals', 'sp_out_guard', 'sp_tit_envoy', 'sp_out_regent']),
  summer: buildPass('summer',
    ['su_plate_sea', 'su_hat_straw', 'su_out_sunlit', 'su_tit_sunchaser', 'su_hat_red', 'su_out_deckhand', 'su_out_trader', 'su_plate_sun', 'su_gun_brass', 'su_hat_navy', 'su_out_marine', 'su_tit_mariner', 'su_bal_sun', 'su_sail_sun', 'su_emo_salute'],
    ['su_out_captain', 'su_out_corsair', 'su_bal_sea', 'su_sail_navy', 'su_gun_driftwood', 'su_emo_hornpipe', 'su_tit_tidecaller', 'su_out_admiral']),
  autumn: buildPass('autumn',
    ['au_plate_amber', 'au_hat_amber', 'au_out_harvest', 'au_tit_harvest', 'au_hat_rust', 'au_out_forager', 'au_out_scholar', 'au_plate_ember', 'au_gun_bronze', 'au_hat_bronze', 'au_out_ember', 'au_tit_lorekeeper', 'au_bal_leaf', 'au_sail_amber', 'au_emo_tip'],
    ['au_out_oldguard', 'au_out_masque', 'au_bal_ember', 'au_sail_rust', 'au_gun_walnut', 'au_emo_toast', 'au_tit_shadow', 'au_out_amber']),
  winter: buildPass('winter',
    ['wi_plate_ice', 'wi_hat_fur', 'wi_out_snow', 'wi_tit_frost', 'wi_hat_holly', 'wi_out_hearth', 'wi_out_frost', 'wi_plate_holly', 'wi_gun_birch', 'wi_hat_steel', 'wi_out_siege', 'wi_tit_wall', 'wi_bal_snow', 'wi_sail_ice', 'wi_emo_warm'],
    ['wi_out_winterfest', 'wi_out_defender', 'wi_bal_fest', 'wi_sail_steel', 'wi_gun_frost', 'wi_emo_snowball', 'wi_tit_lastlight', 'wi_out_lastlight']),
};

// ------------------------------------------------------------------ challenges (all checked from data the server sees itself)
// metric names are counted by the server: dist (paces travelled), towns (different towns entered),
// caps (foreign capitals entered), events (world events completed), trades, gifts, emotes (near others),
// votes, steps (story steps), gold (gold earned), mins (minutes in the realm), hunt (holiday finds), donate (gold donated)
const DAILY_POOL = [
  { id: 'd_walk', metric: 'dist', n: 1500, xp: 500, text: 'Travel 1,500 paces across the realm' },
  { id: 'd_walk2', metric: 'dist', n: 3000, xp: 700, text: 'Travel 3,000 paces' },
  { id: 'd_towns', metric: 'towns', n: 3, xp: 600, text: 'Enter 3 different towns or villages' },
  { id: 'd_event', metric: 'events', n: 1, xp: 800, text: 'Complete a live world event' },
  { id: 'd_steps', metric: 'steps', n: 2, xp: 600, text: 'Complete 2 story steps' },
  { id: 'd_gold', metric: 'gold', n: 300, xp: 500, text: 'Earn 300 gold' },
  { id: 'd_mins', metric: 'mins', n: 30, xp: 500, text: 'Spend 30 minutes in the realm' },
  { id: 'd_emote', metric: 'emotes', n: 3, xp: 400, text: 'Greet other players with emotes 3 times' },
  { id: 'd_trade', metric: 'trades', n: 1, xp: 700, text: 'Complete a trade with another player' },
  { id: 'd_cap', metric: 'caps', n: 1, xp: 600, text: 'Visit the capital of another kingdom' },
];
const WEEKLY_POOL = [
  { id: 'w_walk', metric: 'dist', n: 20000, xp: 2500, text: 'Travel 20,000 paces this week' },
  { id: 'w_towns', metric: 'towns', n: 12, xp: 2500, text: 'Enter 12 different towns this week' },
  { id: 'w_events', metric: 'events', n: 4, xp: 3000, text: 'Complete 4 live world events' },
  { id: 'w_steps', metric: 'steps', n: 8, xp: 2500, text: 'Complete 8 story steps' },
  { id: 'w_gold', metric: 'gold', n: 3000, xp: 2000, text: 'Earn 3,000 gold' },
  { id: 'w_trades', metric: 'trades', n: 3, xp: 2500, text: 'Complete 3 trades with other players' },
  { id: 'w_votes', metric: 'votes', n: 2, xp: 2000, text: 'Vote in 2 elections or Parliament motions' },
  { id: 'w_caps', metric: 'caps', n: 3, xp: 2500, text: 'Visit 3 foreign capitals' },
  { id: 'w_gifts', metric: 'gifts', n: 3, xp: 2000, text: 'Give gold or gifts to other players 3 times' },
];
const SEASONAL_CH = [
  { id: 's_story', metric: 'steps', n: 40, xp: 8000, text: 'Complete 40 story steps this season' },
  { id: 's_walk', metric: 'dist', n: 150000, xp: 8000, text: 'Travel 150,000 paces this season' },
  { id: 's_towns', metric: 'towns', n: 40, xp: 8000, text: 'Enter 40 different towns and villages' },
  { id: 's_events', metric: 'events', n: 20, xp: 8000, text: 'Complete 20 live world events' },
  { id: 's_trades', metric: 'trades', n: 10, xp: 6000, text: 'Complete 10 trades with other players' },
  { id: 's_gold', metric: 'gold', n: 25000, xp: 6000, text: 'Earn 25,000 gold' },
  { id: 's_hunt', metric: 'hunt', n: 10, xp: 6000, text: 'Find 10 holiday or festival treasures' },
  { id: 's_donate', metric: 'donate', n: 500, xp: 5000, text: 'Donate 500 gold to this season’s realm fund' },
];
const DAILY_COUNT = 3, WEEKLY_COUNT = 4;

// ------------------------------------------------------------------ story characters
// "at" names a place in data/places.json. Looks use the game's own clothing.
const NPCS = {
  elowen: { name: 'Elowen Thistlewick', role: 'Archivist of the Concord', at: 'xr_hall', look: { coat: '#4a3a5a', trim: '#e2b84a', hat: 'wide', hatCol: '#2a2a2e', fur: '#e6d6bb' },
    voice: 'precise, dry, and secretly frightened' },
  rook: { name: 'Captain Rook Halloway', role: 'Commander of the Concord Guard', at: 'xr_gate', look: { coat: '#7c8794', trim: '#f4f1ea', hat: 'shako', hatCol: '#2a2a2e', epaulettes: true, crossbelt: true, musket: true, fur: '#4c3d35' },
    voice: 'gruff, loyal, suspicious of everyone' },
  seraphine: { name: 'Lady Seraphine Dusk', role: 'Envoy of Pinehallow', at: 'pin_court', look: { coat: '#2e5a3a', trim: '#e2b84a', hat: 'bicorne', hatCol: '#1e3a26', sash: '#e2b84a', fur: '#b37c46' },
    voice: 'charming, careful, always three moves ahead' },
  corvin: { name: 'Admiral Corvin Saltmarsh', role: 'Envoy of Tidecrest', at: 'tid_court', look: { coat: '#1f4f7a', trim: '#e2b84a', hat: 'bicorne', hatCol: '#14304e', epaulettes: true, fur: '#9a9aa0' },
    voice: 'blunt, ambitious, proud of his fleet' },
  hesk: { name: 'Thane Hesk Ironmantle', role: 'Envoy of Frosthold', at: 'fro_court', look: { coat: '#3a4a6a', trim: '#e9f2fb', hat: 'furcap', hatCol: '#e9f2fb', crossbelt: true, fur: '#f3f0ea' },
    voice: 'slow to speak, impossible to rush' },
  marisol: { name: 'Marisol Vey', role: 'Envoy of Verdantia', at: 'ver_court', look: { coat: '#2e6b3a', trim: '#f3c45a', hat: 'wide', hatCol: '#f3c45a', fur: '#c89a6a' },
    voice: 'warm, quick-witted, a merchant’s daughter' },
  jory: { name: 'Jory Quickpaw', role: 'Street runner of Thornwick', at: 'thorn_alley', look: { coat: '#6a5a4a', trim: '#d9ccb0', hat: 'cap', hatCol: '#4a3a2a', fur: '#8b6a4e' },
    voice: 'fast-talking, cheeky, braver than he admits' },
  ansel: { name: 'Brother Ansel', role: 'Keeper of the Mossbay Chapel', at: 'moss_chapel', look: { coat: '#6b5a43', trim: '#d9ccb0', hat: 'none', fur: '#a99b8b', apron: true },
    voice: 'gentle and patient, carrying an old guilt' },
  aldric: { name: 'Aldric Vane', role: 'Keeper of the Concord', at: 'ice_cell', look: { coat: '#f2f0ea', trim: '#5a76b0', hat: 'none', sash: '#5a76b0', fur: '#e8e8e8' },
    voice: 'tired, kind, and stubborn about peace' },
  wren: { name: 'Wren Fairweather', role: 'Blossom courier', at: 'xr_post', look: { coat: '#e9a7b8', trim: '#f7efe4', hat: 'wide', hatCol: '#f2d7de', fur: '#d8c0a0' },
    voice: 'cheerful and always in a hurry' },
};

// ------------------------------------------------------------------ the Spring campaign: THE BROKEN CROWN
// Step types (all checked on the server):
//   go     – reach a place (server sees your position)
//   talk   – speak to a story character standing at their place
//   search – search a marked spot (press E there)
//   hold   – stay at a place for "secs" seconds (others nearby count too: progress is shared)
//   choice – a decision, remembered and used later in the story
//   pay    – give gold or cargo to the cause (taken from your server-side wallet)
//   finale – take part in the live finale event
// "when" limits a step to players who made a particular choice earlier.
const SPRING_CAMPAIGN = {
  id: 'spring', title: 'The Broken Crown',
  intro: 'Every spring the four crowns meet at the Crossroads Market to renew the Concord, the peace that ended the Great War. This year the Keeper of the Concord, Aldric Vane, has vanished the night before the ceremony, and the Concord Crown that the kingdoms pass between them has been found smashed on the floor of the Concord Hall.',
  chapters: [
    { n: 1, title: 'Silence at the Crossroads', blurb: 'The Concord Hall is shut, the crown is in pieces, and the Keeper is gone.',
      steps: [
        { id: 'c1s1', type: 'talk', npc: 'elowen', at: 'xr_hall', r: 7, xp: 400, obj: 'Speak to Archivist Elowen Thistlewick at the Concord Hall in the Crossroads Market',
          say: ['You came. Good. Nobody else from outside the Guard will even look me in the eye today.', 'Aldric Vane, the Keeper of the Concord, was here at midnight. At dawn the doors were barred from the inside and the Concord Crown lay in pieces on the floor.', 'Four crowns signed the Concord. If it is not renewed by midsummer, the old treaties lapse. Help me find out what happened before someone decides war is simpler.'] },
        { id: 'c1s2', type: 'search', at: 'xr_floor', r: 6, xp: 400, obj: 'Search the ground outside the Concord Hall for what the Guard missed',
          found: 'Under a market stall you find a sliver of gilded crown, and pressed into the mud beside it, the print of a boot with a hollow, hand-shaped hobnail pattern.' },
        { id: 'c1s3', type: 'talk', npc: 'rook', at: 'xr_gate', r: 7, xp: 400, obj: 'Show the boot print to Captain Rook Halloway at the market gate',
          say: ['A hand in the hobnails? Hollow Hand. That’s an old soldiers’ joke from the war, or it was.', 'My guards didn’t see anyone leave. Either the Keeper walked out on his own, or one of my own people looked the other way.', 'Check his lodgings above the post house. I can’t be seen poking around there without half the market gossiping.'] },
        { id: 'c1s4', type: 'search', at: 'xr_post', r: 6, xp: 450, obj: 'Search Aldric Vane’s lodgings by the market post house',
          found: 'A half-burned letter in the grate. Four words survive: "…the shards…four envoys…trust none…". Someone wanted this gone.' },
        { id: 'c1s5', type: 'choice', npc: 'elowen', at: 'xr_hall', r: 7, xp: 500, key: 'first_word', obj: 'Return to Elowen and decide who hears the news first',
          say: ['"Trust none." Lovely. The envoys of all four crowns will be at their capitals by now, each blaming the others.', 'We can’t keep this secret for long. Who should hear first?'],
          options: [
            { id: 'quiet', label: 'Tell no crown yet. We investigate quietly.', reply: 'Quiet, then. It buys us days, perhaps a week, before the rumours outrun us.' },
            { id: 'open', label: 'Tell all four envoys at once, openly.', reply: 'Openly. Brave. They will all watch each other now, and so will we.' },
          ] },
      ] },
    { n: 2, title: 'Four Envoys', blurb: 'Each capital has an envoy who was at the Concord Hall that night. Each one has a story.',
      steps: [
        { id: 'c2s1', type: 'talk', npc: 'hesk', at: 'fro_court', r: 8, xp: 600, obj: 'Travel to Frosthold and speak with Thane Hesk Ironmantle',
          say: ['Frosthold did not break the crown. Frosthold has broken many things, but never a promise made in that hall.', 'The night Vane vanished I saw a lantern moving on the eastern road toward Hearthstead. One rider, fast, no colours.', 'Take this. A shard was left at my door this morning wrapped in a Pinehallow ribbon. Someone wants me to blame Pinehallow.'] },
        { id: 'c2s2', type: 'talk', npc: 'seraphine', at: 'pin_court', r: 8, xp: 600, obj: 'Travel to Pinehallow and speak with Lady Seraphine Dusk',
          say: ['A Pinehallow ribbon? How clumsy. If I wanted the Thane to blame someone, I would have used a Tidecrest knot.', 'You should look at the Admiral. Tidecrest wants the eastern ports, and a broken Concord means no treaty stops him taking them.', 'And look at me, of course. Everyone does. I have nothing to hide that I haven’t already hidden very well.'] },
        { id: 'c2s3', type: 'talk', npc: 'marisol', at: 'ver_court', r: 8, xp: 600, obj: 'Travel to Verdantia and speak with Marisol Vey',
          say: ['I counted the guests that night. I always count. Thirty-one went in, thirty-two came out.', 'The extra one wore a grey Concord Guard coat, but walked like a sailor.', 'Verdantia only wants the roads open and the prices fair. A war ruins both.'] },
        { id: 'c2s4', type: 'talk', npc: 'corvin', at: 'tid_court', r: 8, xp: 600, obj: 'Travel to Tidecrest and speak with Admiral Corvin Saltmarsh',
          say: ['Yes, I want the eastern ports. I say it out loud. That’s the difference between me and the people who did this.', 'One of my old captains, a man called Flint, was cashiered years ago for selling cannon to bandits. He had a hollow hand on his signet.', 'If he’s back, he’s working for someone with money.'] },
        { id: 'c2s5', type: 'choice', npc: 'elowen', at: 'xr_hall', r: 7, xp: 800, key: 'trust', obj: 'Report to Elowen in the Crossroads Market: whose account do you believe?',
          say: ['Four envoys, four stories, and every one of them pointing at someone else. Typical diplomacy.', 'We need someone inside. One of them will have to trust us. Which one do you trust?'],
          options: [
            { id: 'seraphine', label: 'Lady Seraphine. She lies, but she lies honestly.', reply: 'The Pinehallow fox. Very well. Keep your hand on your purse.' },
            { id: 'corvin', label: 'Admiral Corvin. He at least says what he wants.', reply: 'The Admiral. Ambition is easier to predict than charm.' },
          ] },
      ] },
    { n: 3, title: 'The Shard Trail', blurb: 'Pieces of the Concord Crown have been scattered across the realm, as if someone wants them found.',
      steps: [
        { id: 'c3s1', type: 'search', at: 'hearth_road', r: 7, xp: 700, obj: 'Follow the Thane’s lantern sighting: search the road outside Hearthstead',
          found: 'In a ditch by the road: a second shard of the crown, and a torn grey sleeve from a Concord Guard coat.' },
        { id: 'c3s2', type: 'search', at: 'oak_well', r: 7, xp: 700, obj: 'Search the old well at Oakcross',
          found: 'Tied to the well rope: a third shard, with Tidecrest sailor’s knots. Too obvious. Someone is laying a trail.' },
        { id: 'c3s3', type: 'search', at: 'amber_field', r: 7, xp: 700, obj: 'Search the fields at Amberfield',
          found: 'A fourth shard lies on a scarecrow’s hat. The scarecrow wears a Frosthold scarf. Every shard blames a different crown.' },
        { id: 'c3s4', type: 'pay', at: 'xr_hall', r: 8, xp: 900, gold: 150, obj: 'Pay the Crossroads goldsmith 150 gold to fit the shards together (at the Concord Hall)',
          say: ['Elowen lays the shards on velvet as the goldsmith works.', 'Four shards fit. The fifth, the central jewel, is missing. Whoever broke the crown kept the heart of it.'] },
        { id: 'c3s5', type: 'talk', npc: 'rook', at: 'xr_gate', r: 7, xp: 700, obj: 'Tell Captain Rook about the grey sleeve',
          say: ['A Guard sleeve. I knew it. I checked the roster. One man has been absent since that night: Sergeant Tobias Crane.', 'Crane grew up in Thornwick. If he is hiding, he is hiding there.', 'There’s a street runner in Thornwick, Jory Quickpaw, who owes me a favour. Find him.'] },
      ] },
    { n: 4, title: 'Whispers in Thornwick', blurb: 'A missing guardsman, a cheeky informant, and a chapel that keeps old secrets.',
      steps: [
        { id: 'c4s1', type: 'talk', npc: 'jory', at: 'thorn_alley', r: 7, xp: 800, obj: 'Find Jory Quickpaw in the streets of Thornwick',
          say: ['Rook sent you? Then I’m only charging you half. Kidding. Mostly.', 'Crane’s been seen at night with men in grey coats who aren’t Guard. They meet past the edge of town.', 'Go stand watch where I tell you and don’t look suspicious. Can you not look suspicious? Try.'] },
        { id: 'c4s2', type: 'hold', at: 'thorn_watch', r: 12, secs: 60, xp: 900, obj: 'Keep watch at the edge of Thornwick for 60 seconds (others nearby speed this up)',
          done: 'Two grey-coated figures pass, talking low: "…the Keeper’s comfortable in the cold…the Hand pays on midsummer…"' },
        { id: 'c4s3', type: 'go', at: 'thorn_road', r: 14, xp: 700, obj: 'Follow the figures north out of Thornwick',
          done: 'They split up. One heads for the coast toward Mossbay.' },
        { id: 'c4s4', type: 'talk', npc: 'ansel', at: 'moss_chapel', r: 7, xp: 900, obj: 'Follow the trail to the chapel at Mossbay and speak to Brother Ansel',
          say: ['The man you followed came here for confession. I cannot tell you what he said.', 'But I can tell you what I did, thirty years ago. I helped found the Hollow Hand. We were soldiers who swore the war would never end on terms we did not like.', 'Then the Concord came, and I put down my sword. Some of the others never did. The man paying them now calls himself the Hand. He hides in the cold north.'] },
        { id: 'c4s5', type: 'choice', npc: 'ansel', at: 'moss_chapel', r: 7, xp: 900, key: 'ansel', obj: 'Decide what to do about Brother Ansel’s confession',
          say: ['I have told you something that could hang me. What will you do with it?'],
          options: [
            { id: 'forgive', label: 'Keep his secret. He is trying to make amends.', reply: '…Thank you. When the end comes, I will stand with you. You have my word.' },
            { id: 'report', label: 'Tell Captain Rook. The Guard must know.', reply: 'That is fair. I will go to the Captain myself. Perhaps I can still be useful as a witness.' },
          ] },
      ] },
    { n: 5, title: 'The Hollow Hand', blurb: 'Your chosen ally points you at the conspiracy’s base, and the conspiracy notices you.',
      steps: [
        { id: 'c5s1a', type: 'talk', npc: 'seraphine', at: 'pin_court', r: 8, xp: 900, when: { trust: 'seraphine' }, obj: 'Your ally Lady Seraphine has news. Meet her in Pinehallow',
          say: ['I had the Hand’s bankers followed. Pinehallow money, I’m embarrassed to say, moving through Seabreak to buy powder.', 'There is a smugglers’ landing outside Seabreak. Take it, find their ledger, and I will make sure the right names go to the right gallows.', 'Do try not to get shot. It would be so inconvenient.'] },
        { id: 'c5s1b', type: 'talk', npc: 'corvin', at: 'tid_court', r: 8, xp: 900, when: { trust: 'corvin' }, obj: 'Your ally Admiral Corvin has news. Meet him in Tidecrest',
          say: ['Flint’s ship was sighted off Seabreak. My fleet can’t touch it without starting a war, but you can.', 'There’s a smugglers’ landing outside Seabreak. Take it. Bring me his ledger and I’ll see every port in the east closes to him.', 'And if you find out who pays him, I want to know first.'] },
        { id: 'c5s2', type: 'go', at: 'sea_landing', r: 16, xp: 800, obj: 'Go to the smugglers’ landing outside Seabreak' },
        { id: 'c5s3', type: 'hold', at: 'sea_landing', r: 18, secs: 90, xp: 1200, obj: 'Hold the smugglers’ landing for 90 seconds (bring friends: everyone nearby counts)',
          done: 'The Hand’s lookouts flee into the dunes, leaving their camp behind.' },
        { id: 'c5s4', type: 'search', at: 'sea_ledger', r: 7, xp: 1000, obj: 'Search the smugglers’ camp for the Hand’s ledger',
          found: 'The ledger lists payments in four currencies, one from each crown, and a delivery address: "the ice cells under Iceharbour". At the bottom, a single signature, a hollow hand drawn around a crown.' },
        { id: 'c5s5', type: 'talk', npc: 'elowen', at: 'xr_hall', r: 7, xp: 900, obj: 'Bring the ledger to Elowen at the Crossroads Market',
          say: ['Money from all four crowns. So it isn’t one kingdom. It’s people inside every kingdom who would rather have war.', 'Iceharbour. The old ice cells under the harbour. If Aldric is alive, he’s there.', 'Go. I will tell Rook to have the Guard ready on the north road.'] },
      ] },
    { n: 6, title: 'The Keeper in the Cold', blurb: 'Under Iceharbour, in cells cut from the ice, the Keeper of the Concord is waiting.',
      steps: [
        { id: 'c6s1', type: 'go', at: 'ice_gate', r: 14, xp: 900, obj: 'Travel to Iceharbour, far in the frozen north' },
        { id: 'c6s2', type: 'search', at: 'ice_door', r: 7, xp: 1000, obj: 'Find the hidden way into the ice cells',
          found: 'Behind stacked fish crates, a door in the ice, its lock scratched with a hollow hand.' },
        { id: 'c6s3', type: 'hold', at: 'ice_cell', r: 12, secs: 75, xp: 1300, obj: 'Hold the ice cells against the Hand’s jailers for 75 seconds',
          done: 'The jailers break and run into the snow.' },
        { id: 'c6s4', type: 'talk', npc: 'aldric', at: 'ice_cell', r: 7, xp: 1200, obj: 'Speak to the prisoner: Aldric Vane, Keeper of the Concord',
          say: ['I knew someone would come. I hoped it would be someone stubborn.', 'I broke the crown myself. The Hand meant to steal it on the night of the Concord and crown their own man as Regent of all four kingdoms. A crown in pieces cannot be worn.', 'I kept the heart-jewel. It’s sewn into my coat. Now there is a choice to make, and it should not be mine alone.'] },
        { id: 'c6s5', type: 'choice', npc: 'aldric', at: 'ice_cell', r: 7, xp: 1500, key: 'crown', obj: 'Decide the fate of the Concord Crown',
          say: ['We can mend the crown as it was, a crown that belongs to no kingdom and passes between all four.', 'Or we can reforge it for your own kingdom, so that one crown is strong enough to keep the peace by force.', 'Choose. The realm will remember.'],
          options: [
            { id: 'concord', label: 'Mend it as the Concord Crown, shared by all four kingdoms.', reply: 'Then we do it the hard way, together. I would expect nothing less.' },
            { id: 'reforge', label: 'Reforge it for my kingdom, to keep the peace by strength.', reply: 'A heavy choice. Strength can keep a peace. Make sure it does not become the very thing we fought.' },
          ] },
      ] },
    { n: 7, title: 'The Spring Concord', blurb: 'The Hand will strike at the Concord ceremony itself. Every crown must stand together, or fall apart.',
      steps: [
        { id: 'c7s1', type: 'pay', at: 'xr_hall', r: 8, xp: 1500, gold: 300, community: true, obj: 'Give 300 gold to the Concord Relief Fund at the Concord Hall (the whole realm’s donations count toward the fund)',
          say: ['Elowen writes your name in the great ledger of the Concord.', 'Every coin pays for guards, bread, and the ceremony itself. The Hand cannot buy everyone.'] },
        { id: 'c7s2', type: 'talk', npc: 'rook', at: 'xr_gate', r: 7, xp: 1200, obj: 'Get your orders from Captain Rook at the market gate',
          say: ['The Hand will come at the ceremony. When they do, three places matter: the Hall, the Gate, and the Bell Tower.', 'The Concord Assembly is held again and again until the Hand is beaten. Watch the Season panel for the next Assembly and be here when it starts.', 'Bring everyone you can. No one holds three places alone. Well. Almost no one.'] },
        { id: 'c7s3', type: 'finale', xp: 5000, obj: 'Take part in the live finale, The Concord Assembly, at the Crossroads Market: secure the Hall, the Gate and the Bell Tower together',
          done: 'The bells ring out across the Crossroads. The Hand’s last men throw down their arms. Aldric Vane raises the crown above the crowd.' },
      ] },
  ],
  side: [
    { id: 'sq_wren', title: 'Blossom Letters', giver: 'wren', blurb: 'Wren the courier has spring letters for three villages and only two legs.',
      steps: [
        { id: 'sw1', type: 'talk', npc: 'wren', at: 'xr_post', r: 7, xp: 300, obj: 'Speak to Wren Fairweather by the market post house',
          say: ['Oh thank goodness, a pair of feet that aren’t mine! Spring letters, three villages, and my boots have holes.', 'Cedarford, Snowmere and Brinewick. They’re all within a morning’s walk of the market, more or less. More, mostly.'] },
        { id: 'sw2', type: 'go', at: 'v_cedarford', r: 22, xp: 300, obj: 'Deliver a letter to Cedarford' },
        { id: 'sw3', type: 'go', at: 'v_snowmere', r: 22, xp: 300, obj: 'Deliver a letter to Snowmere' },
        { id: 'sw4', type: 'go', at: 'v_brinewick', r: 22, xp: 300, obj: 'Deliver a letter to Brinewick' },
        { id: 'sw5', type: 'talk', npc: 'wren', at: 'xr_post', r: 7, xp: 500, gold: 120, obj: 'Return to Wren for your pay',
          say: ['All three? Before lunch? You’re a marvel. Here, take this, and the eternal gratitude of my boots.'] },
      ] },
    { id: 'sq_ansel_herbs', title: 'Chapel Herbs', giver: 'ansel', blurb: 'Brother Ansel needs spring herbs for the sick of Mossbay.', after: 'c4s4',
      steps: [
        { id: 'ah1', type: 'search', at: 'moss_herb1', r: 8, xp: 350, obj: 'Gather wild garlic on the hills near Mossbay' },
        { id: 'ah2', type: 'search', at: 'moss_herb2', r: 8, xp: 350, obj: 'Gather sorrel by the shore near Mossbay' },
        { id: 'ah3', type: 'talk', npc: 'ansel', at: 'moss_chapel', r: 7, xp: 500, gold: 100, obj: 'Bring the herbs to Brother Ansel',
          say: ['Wild garlic and sorrel, just as the old books say. You have a gentle hand with plants.'] },
      ] },
    { id: 'sq_jory_debt', title: 'Jory’s Debts', giver: 'jory', blurb: 'Jory owes money to the wrong people in Thornwick.', after: 'c4s1',
      steps: [
        { id: 'jd1', type: 'pay', at: 'thorn_alley', r: 8, gold: 80, xp: 600, obj: 'Pay off Jory’s debt (80 gold) in Thornwick',
          say: ['You paid it? All of it? I… nobody’s ever… right. I owe you. Properly, this time.'] },
        { id: 'jd2', type: 'hold', at: 'thorn_watch', r: 12, secs: 40, xp: 500, gold: 60, obj: 'Stand guard with Jory at the edge of Thornwick for 40 seconds while his creditors leave town' },
      ] },
    { id: 'sq_guard_drill', title: 'Concord Guard Drill', giver: 'rook', blurb: 'Captain Rook wants new recruits who can hold a post.', after: 'c1s3',
      steps: [
        { id: 'gd1', type: 'hold', at: 'xr_gate', r: 12, secs: 45, xp: 500, obj: 'Hold the market gate for 45 seconds' },
        { id: 'gd2', type: 'hold', at: 'xr_bell', r: 12, secs: 45, xp: 500, obj: 'Hold the bell tower for 45 seconds' },
        { id: 'gd3', type: 'talk', npc: 'rook', at: 'xr_gate', r: 7, xp: 600, gold: 150, obj: 'Report to Captain Rook',
          say: ['Not bad. Not good either, but not bad. That’s high praise from me. Take your pay before I change my mind.'] },
      ] },
    { id: 'sq_envoy_gifts', title: 'Envoy Courtesies', giver: 'marisol', blurb: 'Marisol believes small gifts keep large wars away.', after: 'c2s3',
      steps: [
        { id: 'eg1', type: 'pay', at: 'ver_court', r: 8, cargo: 'cheese', n: 2, xp: 700, obj: 'Bring Marisol 2 crates of cheese (from any market) in Verdantia',
          say: ['Cheese! The universal language of goodwill. The Thane will be insufferably pleased.'] },
        { id: 'eg2', type: 'go', at: 'fro_court', r: 16, xp: 500, gold: 200, obj: 'Carry the gift to Thane Hesk in Frosthold' },
      ] },
    { id: 'sq_spring_regatta', title: 'The Spring Regatta', giver: 'corvin', blurb: 'The Admiral wants to know who can really sail.', after: 'c2s4',
      steps: [
        { id: 'sr1', type: 'go', at: 'reg_buoy1', r: 30, xp: 400, obj: 'Sail to the first regatta mark off Tidecrest' },
        { id: 'sr2', type: 'go', at: 'reg_buoy2', r: 30, xp: 400, obj: 'Sail to the second regatta mark off Greyhaven' },
        { id: 'sr3', type: 'talk', npc: 'corvin', at: 'tid_court', r: 8, xp: 600, gold: 200, obj: 'Report your time to Admiral Corvin',
          say: ['Not a record. But you didn’t sink, and in my navy that earns a drink.'] },
      ] },
  ],
  // completing the main story grants these (never sold or put in the battle pass)
  rewards: { gold: 5000, items: ['sp_story_regalia', 'sp_story_balloon', 'sp_story_sails', 'sp_story_plate'], byChoice: { crown: { concord: ['sp_story_title'], reforge: ['sp_story_crownbearer'] } } },
  // the realm-wide fund for chapter 7; every contributor receives the milestone rewards when reached
  fund: { name: 'Concord Relief Fund', milestones: [{ at: 20000, item: 'sp_plate_leaf', note: 'Leaf nameplate for every donor' }, { at: 60000, gold: 500, note: '500 gold for every donor' }, { at: 150000, item: 'sp_hat_silver', note: 'Silver Concord Shako for every donor' }] },
  finale: { at: 'xr_hall', posts: [{ id: 'hall', name: 'the Concord Hall', at: 'xr_hall' }, { id: 'gate', name: 'the Market Gate', at: 'xr_gate' }, { id: 'bell', name: 'the Bell Tower', at: 'xr_bell' }], holdSecs: 60, minutes: 15 },
};

// Plans for the other three seasons' campaigns (shown in the Season panel as previews; not yet playable)
const CAMPAIGN_PLANS = {
  summer: { title: 'The War of the Eastern Sea', chapters: [
    'Smoke over Coralport: pirates burn the eastern harbour and Admiral Corvin calls for volunteers.',
    'Letters of Marque: choose to sail under a kingdom’s flag or as a free privateer (changes every later chapter).',
    'The Spice Blockade: run supplies through the blockade to Pearlhaven, Tidewatch and Gullrock.',
    'The Lighthouse War: retake three lighthouses along the eastern coast, held as shared multiplayer points.',
    'Treaty at Freeport: negotiate with the pirate captains, or betray them, depending on your flag.',
    'The Burning Fleet: the pirate armada sails on Tidecrest.',
    'Finale, The Battle of the Eastern Sea: a scheduled naval battle where players crew ships together to hold the harbour mouth. Reward: Admiralty of the East regalia, ship sails and a unique title.' ] },
  autumn: { title: 'The Shadow of the Old Kingdom', chapters: [
    'The Harvest Stone: a farmer near Amberfield ploughs up a stone carved in a forgotten script.',
    'The Lorekeepers: scholars in every capital disagree about what the Old Kingdom was. Choose whose theory to follow.',
    'Ruins under the Pines: explore ruins near Oakcross and Elderbrook, searching for inscriptions.',
    'The Masquerade: a court ball at Sunspire where the conspirators wear masks; find them by what they say.',
    'The Heir: a claimant to the Old Kingdom’s throne appears. Support them, expose them or bargain with them.',
    'The Night of Lanterns: during the Halloween festival the conspiracy moves on all four capitals at once.',
    'Finale, The Unmasking: a realm-wide event where players hold the four capitals’ courts at the same time. Reward: Old Kingdom regalia, balloon envelope and a unique title.' ] },
  winter: { title: 'The Last Siege', chapters: [
    'The Northern Lights Go Out: beacons along the Frosthold border fall silent one by one.',
    'Refugees on the Ice: escort families south from Iceharbour and Hoarfrost.',
    'The War Council: the four crowns argue over who leads the defence; your vote counts.',
    'Supply Lines: the whole realm donates timber, furs and powder to a shared stockpile.',
    'The Walls of Frosthold: repair and man the walls in shared multiplayer hold objectives.',
    'The Long Night: during Winterfest the enemy attacks in a blizzard.',
    'Finale, The Last Siege: a massive scheduled defence of Frosthold where players from every kingdom fight side by side. Reward: Mantle of the Last Light regalia, war banner balloon, sails and the title Shield of the Realm.' ] },
};

// ------------------------------------------------------------------ holidays (server dates, UTC). Each has a "hunt" of spots to find.
// A spot is { at: place name }. Rewards: every find gives XP and a little gold; finding them all grants the holiday items.
const HOLIDAYS = [
  { id: 'valentine', name: 'Day of Friendship', from: [2, 10], to: [2, 16], deco: 'hearts', hunt: 'Deliver friendship letters to villages across the realm',
    spots: ['v_cedarford', 'v_snowmere', 'v_brinewick', 'v_foxburrow', 'v_orchid', 'v_saltmarsh', 'v_rimeholt', 'v_jadewater'], items: ['hol_val_out', 'hol_val_plate'], xp: 400, gold: 30 },
  { id: 'easter', name: 'Spring Festival', easter: true, deco: 'eggs', hunt: 'Find the painted festival eggs hidden near the capitals and market',
    spots: ['egg1', 'egg2', 'egg3', 'egg4', 'egg5', 'egg6', 'egg7', 'egg8', 'egg9', 'egg10'], items: ['hol_egg_out', 'hol_egg_tit'], xp: 400, gold: 30 },
  { id: 'midsummer', name: 'Midsummer Bonfires', from: [6, 20], to: [6, 26], deco: 'bunting', hunt: 'Light the midsummer bonfires on hilltops near the towns',
    spots: ['fire1', 'fire2', 'fire3', 'fire4', 'fire5', 'fire6'], items: ['hol_mid_bal'], xp: 450, gold: 30 },
  { id: 'halloween', name: 'Haunted Lantern Walk', from: [10, 24], to: [11, 2], deco: 'pumpkins', hunt: 'Find the haunted lanterns flickering on lonely roads',
    spots: ['lan1', 'lan2', 'lan3', 'lan4', 'lan5', 'lan6', 'lan7', 'lan8'], items: ['hol_hal_out', 'hol_hal_tit'], xp: 450, gold: 30 },
  { id: 'winterfest', name: 'Winterfest', from: [12, 12], to: [12, 31], deco: 'winterfest', hunt: 'Find the lost Winterfest ornaments, and give gifts to other players',
    spots: ['orn1', 'orn2', 'orn3', 'orn4', 'orn5', 'orn6', 'orn7', 'orn8', 'orn9', 'orn10'], items: ['hol_xmas_out', 'hol_xmas_emo'], xp: 400, gold: 40 },
  { id: 'newyear', name: 'New Year Beacons', from: [12, 31], to: [1, 2], deco: 'fireworks', hunt: 'Light the New Year beacons in the four capitals and the market',
    spots: ['ny1', 'ny2', 'ny3', 'ny4', 'ny5'], items: ['hol_ny_plate', 'hol_ny_tit'], xp: 500, gold: 50 },
];

// ------------------------------------------------------------------ live world events
// obj: stay (stay nearby for EVENT_STAY_SECONDS), checkpoints (visit points in order), hold (shared hold time)
const LIVE_EVENTS = [
  { kind: 'tourney', title: t => `Royal Tournament at ${t.name}`, obj: 'stay', reward: 80, xp: 600, seasons: ['spring', 'summer', 'autumn', 'winter'], where: 'big' },
  { kind: 'parade', title: t => `Grand Military Parade in ${t.name}`, obj: 'stay', reward: 60, xp: 500, seasons: ['spring', 'summer', 'autumn', 'winter'], where: 'capital' },
  { kind: 'celebration', title: t => `Kingdom Celebration in ${t.name}`, obj: 'stay', reward: 60, xp: 500, seasons: ['spring', 'summer', 'autumn', 'winter'], where: 'capital' },
  { kind: 'regatta', title: t => `Naval Regatta from ${t.name}`, obj: 'checkpoints', reward: 120, xp: 900, seasons: ['spring', 'summer', 'autumn'], where: 'port' },
  { kind: 'festival', title: (t, s) => `${({ spring: 'Blossom', summer: 'Midsummer', autumn: 'Harvest', winter: 'Frost' })[s]} Festival in ${t.name}`, obj: 'stay', reward: 70, xp: 600, seasons: ['spring', 'summer', 'autumn', 'winter'], where: 'big' },
  { kind: 'ceremony', title: t => `Public Ceremony at ${t.name}`, obj: 'stay', reward: 50, xp: 400, seasons: ['spring', 'summer', 'autumn', 'winter'], where: 'big' },
  { kind: 'battle', title: t => `Bandit Army Threatens ${t.name}: Hold the Line!`, obj: 'hold', reward: 150, xp: 1000, seasons: ['spring', 'summer', 'autumn', 'winter'], where: 'town', holdSecs: 120 },
  { kind: 'expedition', title: t => `Expedition from ${t.name}`, obj: 'checkpoints', reward: 120, xp: 900, seasons: ['spring', 'summer', 'autumn', 'winter'], where: 'big' },
  { kind: 'games', title: t => `Realm Games at ${t.name}: the Great Footrace`, obj: 'checkpoints', reward: 130, xp: 900, seasons: ['spring', 'summer', 'autumn', 'winter'], where: 'big' },
];

module.exports = { SEASONS, TIERS, BONUS_TIERS, MAX_TIER, CHAPTERS, EVOLVE, TIER_XP, PREMIUM_PRICE, ITEMS: I, PASSES, DAILY_POOL, WEEKLY_POOL, SEASONAL_CH, DAILY_COUNT, WEEKLY_COUNT, NPCS, CAMPAIGNS: { spring: SPRING_CAMPAIGN }, CAMPAIGN_PLANS, HOLIDAYS, LIVE_EVENTS };
