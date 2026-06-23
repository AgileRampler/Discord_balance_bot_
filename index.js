require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ActivityType
} = require("discord.js");

const Database = require("better-sqlite3");

const dbPath = process.env.DB_PATH || "economy.db";
console.log("Using database:", dbPath);

const db = new Database(dbPath);

const BOT_VERSION = "3.5.1";
const MAX_BET = 1_000_000;
const MIN_BET = 100_000;
const MIN_WITHDRAW = 500_000;
const WITHDRAW_FEE_PERCENT = 18;
const MIN_BLACKJACK_BUYIN = 100_000;
const MAX_BLACKJACK_BUYIN = 1_000_000;
const MAX_BLACKJACK_PLAYERS = 4;
const BLACKJACK_LOBBY_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const BLACKJACK_TURN_TIMEOUT = 2 * 60 * 1000; // 2 minutes
const RAID_JOIN_FEE = 100_000;
const RAID_MIN_PLAYERS = 5;
const RAID_MAX_PLAYERS = 30;
const RAID_BOSS_HP = 50_000;
const RAID_JOIN_WINDOW = 10 * 60 * 1000; // 10 minutes
const RAID_DURATION = 10 * 60 * 1000; // 10 minutes
const RAID_ACTION_COOLDOWN = 10 * 1000; // 10 seconds
const RAID_SPAWN_INTERVAL = 8 * 60 * 60 * 1000; // 3 times per 24 hours
const MIN_TRANSFER = 1;
const MIN_DUEL_BET = 100_000;
const MAX_DUEL_BET = 1_000_000;
const DUEL_START_HP = 100;
const DUEL_LOBBY_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const DUEL_TURN_TIMEOUT = 5 * 60 * 1000; // 5 minutes

db.pragma("journal_mode = WAL");

db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  balance INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
)
`).run();

try {
  db.prepare("ALTER TABLE users ADD COLUMN coinflip_streak INTEGER DEFAULT 0").run();
} catch (err) {
  if (!String(err.message).includes("duplicate column name")) console.error(err);
}

db.prepare(`
CREATE TABLE IF NOT EXISTS settings (
  guild_id TEXT PRIMARY KEY,
  coinflip_enabled INTEGER DEFAULT 1,
  blackjack_enabled INTEGER DEFAULT 1,
  raid_enabled INTEGER DEFAULT 1
)
`).run();

try {
  db.prepare("ALTER TABLE settings ADD COLUMN blackjack_enabled INTEGER DEFAULT 1").run();
} catch (err) {
  if (!String(err.message).includes("duplicate column name")) console.error(err);
}

try {
  db.prepare("ALTER TABLE settings ADD COLUMN raid_enabled INTEGER DEFAULT 1").run();
} catch (err) {
  if (!String(err.message).includes("duplicate column name")) console.error(err);
}

db.prepare(`
CREATE TABLE IF NOT EXISTS coinflips (
  game_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  creator_id TEXT NOT NULL,
  choice TEXT NOT NULL,
  bet INTEGER NOT NULL,
  status TEXT DEFAULT 'open',
  created_at INTEGER NOT NULL
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS withdrawals (
  withdraw_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  admin_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
)
`).run();






// -------- Duel Code Tables -------
db.prepare(`
CREATE TABLE IF NOT EXISTS duels (
  duel_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  creator_id TEXT NOT NULL,
  opponent_id TEXT,
  bet INTEGER NOT NULL,
  creator_hp INTEGER DEFAULT 100,
  opponent_hp INTEGER DEFAULT 100,
  turn_user_id TEXT,
  status TEXT DEFAULT 'open',
  winner_id TEXT,
  last_action_at INTEGER,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
)
`).run();

try {
  db.prepare("ALTER TABLE duels ADD COLUMN last_action_at INTEGER").run();
} catch (err) {
  if (!String(err.message).includes("duplicate column name")) console.error(err);
}

try {
  db.prepare("ALTER TABLE duels ADD COLUMN expires_at INTEGER").run();
} catch (err) {
  if (!String(err.message).includes("duplicate column name")) console.error(err);
}
// -------- Duel Code Tables End -------

// -------- Raid Boss Code -------
db.prepare(`
CREATE TABLE IF NOT EXISTS raid_bosses (
  raid_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  general_channel_id TEXT,
  general_message_id TEXT,
  raid_channel_id TEXT NOT NULL,
  raid_message_id TEXT,
  boss_name TEXT NOT NULL,
  boss_hp INTEGER NOT NULL,
  boss_max_hp INTEGER NOT NULL,
  join_fee INTEGER NOT NULL,
  reward_pool INTEGER DEFAULT 0,
  status TEXT DEFAULT 'open',
  started_at INTEGER,
  ends_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS raid_players (
  raid_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  damage INTEGER DEFAULT 0,
  healing INTEGER DEFAULT 0,
  tanking INTEGER DEFAULT 0,
  actions INTEGER DEFAULT 0,
  last_action_at INTEGER DEFAULT 0,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (raid_id, user_id)
)
`).run();
// -------- Raid Boss Code End -------


// -------- Blackjack Code Tables -------
db.prepare(`
CREATE TABLE IF NOT EXISTS blackjack_games (
  game_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  host_id TEXT NOT NULL,
  buyin INTEGER NOT NULL,
  status TEXT DEFAULT 'open',
  dealer_hand TEXT,
  current_turn_index INTEGER DEFAULT 0,
  pot INTEGER DEFAULT 0,
  winners TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  expires_at INTEGER
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS blackjack_players (
  game_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  hands TEXT,
  active_hand_index INTEGER DEFAULT 0,
  status TEXT DEFAULT 'playing',
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, user_id)
)
`).run();
// -------- Blackjack Code Tables End -------

db.prepare(`
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
)
`).run();

function getBal(guildId, userId) {
  const row = db.prepare(
    "SELECT balance FROM users WHERE guild_id = ? AND user_id = ?"
  ).get(guildId, userId);

  if (!row) {
    db.prepare(
      "INSERT INTO users (guild_id, user_id, balance) VALUES (?, ?, 0)"
    ).run(guildId, userId);
    return 0;
  }

  return row.balance;
}

function addBal(guildId, userId, amount) {
  getBal(guildId, userId);

  db.prepare(
    "UPDATE users SET balance = balance + ? WHERE guild_id = ? AND user_id = ?"
  ).run(amount, guildId, userId);
}

function logTransaction(guildId, userId, type, amount, reason = "") {
  db.prepare(`
    INSERT INTO transactions
    (guild_id, user_id, type, amount, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(guildId, userId, type, amount, reason, Date.now());
}

function changeBalance(guildId, userId, amount, type, reason = "") {
  addBal(guildId, userId, amount);
  logTransaction(guildId, userId, type, amount, reason);
}

function getCoinflipStreak(guildId, userId) {
  getBal(guildId, userId);
  const row = db.prepare("SELECT coinflip_streak FROM users WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
  return Number(row?.coinflip_streak || 0);
}

function setCoinflipStreak(guildId, userId, streak) {
  getBal(guildId, userId);
  db.prepare("UPDATE users SET coinflip_streak = ? WHERE guild_id = ? AND user_id = ?").run(streak, guildId, userId);
}

function getStreakComment(streak) {
  if (streak >= 20) return "☠️ The House Fears You!";
  if (streak >= 15) return "🐉 Legendary Gambler!";
  if (streak >= 10) return "💎 Silver Addict!";
  if (streak >= 7) return "👑 Casino King!";
  if (streak >= 5) return "⚡ Unstoppable!";
  if (streak >= 3) return "🔥 You're On Fire!";
  if (streak >= 2) return "🔥 Heating Up!";
  if (streak >= 1) return "🎯 Lucky Start!";
  return "No active streak.";
}

function transferBalance(guildId, fromUserId, toUserId, amount, sentType, receivedType, reason) {
  const fromBalance = getBal(guildId, fromUserId);
  if (amount <= 0) throw new Error("Amount must be more than 0.");
  if (fromUserId === toUserId) throw new Error("You cannot transfer to the same user.");
  if (fromBalance < amount) throw new Error("Insufficient balance.");

  const tx = db.transaction(() => {
    changeBalance(guildId, fromUserId, -amount, sentType, reason);
    changeBalance(guildId, toUserId, amount, receivedType, reason);
  });
  tx();
}

async function logToChannel(client, embed, components = []) {
  try {
    const channelId = process.env.TRANSACTION_LOG_CHANNEL;

    if (!channelId) return null;

    const channel = await client.channels.fetch(channelId);

    if (!channel || !channel.isTextBased()) return null;

    return await channel.send({ embeds: [embed], components });
  } catch (err) {
    console.error("Transaction channel log error:", err);
    return null;
  }
}

async function notifyUser(client, userId, message) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(message);
  } catch (err) {
    console.log(`Could not DM user ${userId}.`);
  }
}





function makeLogEmbed(title, description, color = 0xff3b3b) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
}

function isCoinflipEnabled(guildId) {
  const row = db.prepare(
    "SELECT coinflip_enabled FROM settings WHERE guild_id = ?"
  ).get(guildId);

  if (!row) {
    db.prepare(
      "INSERT INTO settings (guild_id, coinflip_enabled) VALUES (?, 1)"
    ).run(guildId);
    return true;
  }

  return row.coinflip_enabled === 1;
}

function setCoinflipEnabled(guildId, enabled) {
  db.prepare(`
    INSERT INTO settings (guild_id, coinflip_enabled)
    VALUES (?, ?)
    ON CONFLICT(guild_id)
    DO UPDATE SET coinflip_enabled = excluded.coinflip_enabled
  `).run(guildId, enabled ? 1 : 0);
}

function isBlackjackEnabled(guildId) {
  const row = db.prepare(
    "SELECT blackjack_enabled FROM settings WHERE guild_id = ?"
  ).get(guildId);

  if (!row) {
    db.prepare(
      "INSERT INTO settings (guild_id, coinflip_enabled, blackjack_enabled) VALUES (?, 1, 1)"
    ).run(guildId);
    return true;
  }

  return row.blackjack_enabled === 1;
}

function setBlackjackEnabled(guildId, enabled) {
  db.prepare(`
    INSERT INTO settings (guild_id, blackjack_enabled)
    VALUES (?, ?)
    ON CONFLICT(guild_id)
    DO UPDATE SET blackjack_enabled = excluded.blackjack_enabled
  `).run(guildId, enabled ? 1 : 0);
}

function isRaidEnabled(guildId) {
  const row = db.prepare(
    "SELECT raid_enabled FROM settings WHERE guild_id = ?"
  ).get(guildId);

  if (!row) {
    db.prepare(
      "INSERT INTO settings (guild_id, coinflip_enabled, blackjack_enabled, raid_enabled) VALUES (?, 1, 1, 1)"
    ).run(guildId);
    return true;
  }

  return row.raid_enabled === 1;
}

function setRaidEnabled(guildId, enabled) {
  db.prepare(`
    INSERT INTO settings (guild_id, raid_enabled)
    VALUES (?, ?)
    ON CONFLICT(guild_id)
    DO UPDATE SET raid_enabled = excluded.raid_enabled
  `).run(guildId, enabled ? 1 : 0);
}

function makeGameId() {
  return `${Date.now()}_${Math.floor(Math.random() * 999999)}`;
}

function makeWithdrawId() {
  return `WD-${Date.now()}-${Math.floor(Math.random() * 999999)}`;
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata"
  });
}

function safeReply(interaction, data) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(data).catch(() => {});
  }

  return interaction.reply(data).catch(() => {});
}

function chunkText(text, maxLength = 1900) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let current = "";

  for (const line of text.split("\n")) {
    if ((current + "\n" + line).length > maxLength) {
      chunks.push(current);
      current = line;
    } else {
      current += current ? "\n" + line : line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function parseAmountInput(input, balance) {
  const raw = String(input).toLowerCase().trim();

  if (raw === "all") {
    return { amount: balance, mode: "ALL" };
  }

  if (raw.endsWith("%")) {
    const percent = parseFloat(raw.replace("%", ""));

    if (isNaN(percent) || percent <= 0 || percent > 100) {
      return { error: "Percentage must be between 1% and 100%. Example: `25%`" };
    }

    return {
      amount: Math.floor((balance * percent) / 100),
      mode: `${percent}%`
    };
  }

  const amount = parseInt(raw.replace(/,/g, ""));

  if (isNaN(amount) || amount <= 0) {
    return { error: "Use a number, `all`, or percentage like `10%`." };
  }

  return { amount, mode: "AMOUNT" };
}

function withdrawalButtons(withdrawId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`withdraw_approve:${withdrawId}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`withdraw_deny:${withdrawId}`)
      .setLabel("Deny")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId(`withdraw_cancel:${withdrawId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );
}




function pageButtons(type, page, maxPage, userId, targetId = "none") {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`page_${type}_prev:${page}:${userId}:${targetId}`)
      .setLabel("⬅️ Back")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),

    new ButtonBuilder()
      .setCustomId(`page_${type}_next:${page}:${userId}:${targetId}`)
      .setLabel("Next ➡️")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= maxPage)
  );
}

function makeLeaderboardPage(guildId, page = 0) {
  const perPage = 10;
  const total = db.prepare("SELECT COUNT(*) AS count FROM users WHERE guild_id = ?").get(guildId).count;
  const maxPage = Math.max(0, Math.ceil(total / perPage) - 1);
  const safePage = Math.max(0, Math.min(page, maxPage));

  const rows = db.prepare(`
    SELECT user_id, balance
    FROM users
    WHERE guild_id = ?
    ORDER BY balance DESC
    LIMIT ?
    OFFSET ?
  `).all(guildId, perPage, safePage * perPage);

  const text = rows.length
    ? rows.map((r, i) => {
        const rank = safePage * perPage + i + 1;
        return `**#${rank}** <@${r.user_id}> — **${r.balance.toLocaleString()} coins**`;
      }).join("\n")
    : "No balance data found.";

  const embed = new EmbedBuilder()
    .setTitle("🏆 Balance Leaderboard")
    .setDescription(text)
    .setColor(0xff3b3b)
    .setFooter({ text: `Page ${safePage + 1}/${maxPage + 1} • Total users: ${total}` });

  return { embed, page: safePage, maxPage };
}

function makeHistoryPage(guildId, targetUser, page = 0) {
  const perPage = 10;
  const total = db.prepare(`
    SELECT COUNT(*) AS count FROM transactions WHERE guild_id = ? AND user_id = ?
  `).get(guildId, targetUser.id).count;
  const maxPage = Math.max(0, Math.ceil(total / perPage) - 1);
  const safePage = Math.max(0, Math.min(page, maxPage));
  const rows = db.prepare(`
    SELECT * FROM transactions
    WHERE guild_id = ? AND user_id = ?
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(guildId, targetUser.id, perPage, safePage * perPage);
  const text = rows.length ? rows.map(t => {
    const sign = t.amount > 0 ? "+" : "";
    return `**${t.type}** | ${sign}${t.amount.toLocaleString()} | ${t.reason || "-"}\n\`${formatDate(t.created_at)}\``;
  }).join("\n\n") : "No transaction history found.";
  const embed = new EmbedBuilder()
    .setTitle(`📜 ${targetUser.username} Transaction History`)
    .setDescription(text)
    .setColor(0xff3b3b)
    .setFooter({ text: `Page ${safePage + 1}/${maxPage + 1} • Total records: ${total}` });
  return { embed, page: safePage, maxPage };
}

function makeTransactionsPage(guildId, page = 0) {
  const perPage = 10;
  const total = db.prepare(`SELECT COUNT(*) AS count FROM transactions WHERE guild_id = ?`).get(guildId).count;
  const maxPage = Math.max(0, Math.ceil(total / perPage) - 1);
  const safePage = Math.max(0, Math.min(page, maxPage));
  const rows = db.prepare(`
    SELECT * FROM transactions
    WHERE guild_id = ?
    ORDER BY id DESC LIMIT ? OFFSET ?
  `).all(guildId, perPage, safePage * perPage);
  const text = rows.length ? rows.map(t => {
    const sign = t.amount > 0 ? "+" : "";
    return `**#${t.id}** | <@${t.user_id}>\n**${t.type}** | ${sign}${t.amount.toLocaleString()} | ${t.reason || "-"}\n\`${formatDate(t.created_at)}\``;
  }).join("\n\n") : "No transactions found.";
  const embed = new EmbedBuilder()
    .setTitle("📋 Recent Transaction Logs")
    .setDescription(text)
    .setColor(0xff3b3b)
    .setFooter({ text: `Page ${safePage + 1}/${maxPage + 1} • Total records: ${total}` });
  return { embed, page: safePage, maxPage };
}

function makeStreakboardPage(guildId, page = 0) {
  const perPage = 10;
  const total = db.prepare("SELECT COUNT(*) AS count FROM users WHERE guild_id = ? AND COALESCE(coinflip_streak, 0) > 0").get(guildId).count;
  const maxPage = Math.max(0, Math.ceil(total / perPage) - 1);
  const safePage = Math.max(0, Math.min(page, maxPage));

  const rows = db.prepare(`
    SELECT user_id, coinflip_streak
    FROM users
    WHERE guild_id = ?
    AND COALESCE(coinflip_streak, 0) > 0
    ORDER BY coinflip_streak DESC
    LIMIT ? OFFSET ?
  `).all(guildId, perPage, safePage * perPage);

  const text = rows.length
    ? rows.map((r, i) => `**#${safePage * perPage + i + 1}** <@${r.user_id}> — **${Number(r.coinflip_streak || 0).toLocaleString()} wins** 🔥`).join("\n")
    : "No active coinflip streaks found.";

  const embed = new EmbedBuilder()
    .setTitle("🔥 Coinflip Streak Leaderboard")
    .setDescription(text)
    .setColor(0xff3b3b)
    .setFooter({ text: `Page ${safePage + 1}/${maxPage + 1} • Total streaks: ${total}` });

  return { embed, page: safePage, maxPage };
}


const commands = [
  new SlashCommandBuilder()
    .setName("version")
    .setDescription("Show bot version"),

  new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Check balance")
    .addUserOption(o =>
      o.setName("user").setDescription("User to check").setRequired(false)
    ),
    
    new SlashCommandBuilder()
  .setName("clearwithdraw")
  .setDescription("Admin only: clear/refund a user's pending withdrawal")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addUserOption(o =>
    o.setName("user")
      .setDescription("User whose pending withdrawal should be cleared")
      .setRequired(true)
  ),



  new SlashCommandBuilder()
    .setName("rank")
    .setDescription("Check your balance rank"),

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Show balance leaderboard"),

  new SlashCommandBuilder()
    .setName("history")
    .setDescription("Show last transactions")
    .addUserOption(o =>
      o.setName("user").setDescription("User to check").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("withdraw")
    .setDescription("Request a withdrawal")
    .addStringOption(o =>
      o.setName("amount")
        .setDescription("Amount, all, or percentage like 25%")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("addcoins")
    .setDescription("Admin only: add coins")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o =>
      o.setName("user").setDescription("User").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("amount").setDescription("Amount").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("removecoins")
    .setDescription("Admin only: remove coins")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o =>
      o.setName("user").setDescription("User").setRequired(true)
    )
    .addStringOption(o =>
      o.setName("amount")
        .setDescription("Number, all, or percentage like 10%")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("transfer")
    .setDescription("Transfer Digital Silver to another user")
    .addUserOption(o =>
      o.setName("user").setDescription("User to receive coins").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("amount").setDescription("Amount to transfer").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("admintransfer")
    .setDescription("Admin only: transfer balance from one user to another")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o =>
      o.setName("from").setDescription("User to remove coins from").setRequired(true)
    )
    .addUserOption(o =>
      o.setName("to").setDescription("User to receive coins").setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("amount").setDescription("Amount to transfer").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("streak")
    .setDescription("Check coinflip win streak")
    .addUserOption(o =>
      o.setName("user").setDescription("User to check").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("streakboard")
    .setDescription("Show coinflip win streak leaderboard"),

  new SlashCommandBuilder()
    .setName("duel")
    .setDescription("Create a skill-based PvP duel")
    .addIntegerOption(o =>
      o.setName("bet").setDescription("Duel bet amount").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("coinflip")
    .setDescription("Create PvP coinflip")
    .addStringOption(o =>
      o.setName("choice")
        .setDescription("Pick heads or tails")
        .setRequired(true)
        .addChoices(
          { name: "HEADS", value: "heads" },
          { name: "TAILS", value: "tails" }
        )
    )
    .addIntegerOption(o =>
      o.setName("bet").setDescription("Bet amount").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("blackjack")
    .setDescription("Admin host: create a 4-player PvP blackjack table")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption(o =>
      o.setName("buyin")
        .setDescription("Buy-in amount")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("blackjackadmin")
    .setDescription("Admin only: enable or disable blackjack")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
      o.setName("status")
        .setDescription("Enable or disable blackjack")
        .setRequired(true)
        .addChoices(
          { name: "ENABLE", value: "enable" },
          { name: "DISABLE", value: "disable" }
        )
    ),

  new SlashCommandBuilder()
    .setName("coinflipadmin")
    .setDescription("Admin only: enable or disable coinflip")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
      o.setName("status")
        .setDescription("Enable or disable coinflip")
        .setRequired(true)
        .addChoices(
          { name: "ENABLE", value: "enable" },
          { name: "DISABLE", value: "disable" }
        )
    ),

  new SlashCommandBuilder()
    .setName("raidspawn")
    .setDescription("Admin only: manually spawn a raid boss")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("raidcancel")
    .setDescription("Admin only: cancel the current open/active raid and refund players")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("raidadmin")
    .setDescription("Admin only: enable or disable raid boss spawns")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o =>
      o.setName("status")
        .setDescription("Enable or disable raid boss")
        .setRequired(true)
        .addChoices(
          { name: "ENABLE", value: "enable" },
          { name: "DISABLE", value: "disable" }
        )
    ),

  new SlashCommandBuilder()
    .setName("dbstats")
    .setDescription("Admin only: show database stats")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("allbalances")
    .setDescription("Admin only: show top 50 balances from database")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName("transactions")
    .setDescription("Admin only: show latest database transactions")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

async function registerCommands() {
  try {
    console.log("🧹 Clearing global commands...");
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: [] }
    );

    console.log("🧹 Clearing guild commands...");
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: [] }
    );

    console.log("✅ Registering guild commands...");
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log("✅ Commands refreshed.");
    console.log("Registered commands:", commands.map(c => c.name).join(", "));
  } catch (err) {
    console.error("Command register error:", err);
  }
}

registerCommands();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});


// -------- Raid Boss Code -------
function makeRaidId() {
  return `RAID-${Date.now()}-${Math.floor(Math.random() * 999999)}`;
}

function getRaidBossName() {
  const names = [
    "Ancient Dragon",
    "Avalonian Warlord",
    "Crystal Behemoth",
    "Demon Prince",
    "Undead Colossus"
  ];

  return names[Math.floor(Math.random() * names.length)];
}

function raidJoinButton(raidId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`raid_join:${raidId}`)
      .setLabel("Join Raid")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`raid_cancel:${raidId}`)
      .setLabel("Cancel Raid")
      .setStyle(ButtonStyle.Danger)
  );
}

function raidActionButtons(raidId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`raid_attack:${raidId}`)
      .setLabel("⚔️ Attack")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId(`raid_defend:${raidId}`)
      .setLabel("🛡️ Defend")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`raid_heal:${raidId}`)
      .setLabel("🩹 Heal")
      .setStyle(ButtonStyle.Success)
  );
}

function raidGeneralEmbed(raid, playerCount = 0) {
  const raidChannelId = process.env.RAID_CHANNEL_ID;
  const expireUnix = Math.floor((raid.created_at + RAID_JOIN_WINDOW) / 1000);

  return new EmbedBuilder()
    .setTitle("👹 Raid Boss Spawned!")
    .setColor(0xff3b3b)
    .setDescription(
      `**Boss:** ${raid.boss_name}\n` +
      `**HP:** ${raid.boss_hp.toLocaleString()} / ${raid.boss_max_hp.toLocaleString()}\n` +
      `**Join Fee:** ${raid.join_fee.toLocaleString()} Digital Silver\n` +
      `**Players:** ${playerCount}/${RAID_MAX_PLAYERS}\n` +
      `**Minimum Required:** ${RAID_MIN_PLAYERS}\n` +
      `**Current Reward Pool:** ${raid.reward_pool.toLocaleString()} Digital Silver\n` +
      `⏰ **Join Window:** <t:${expireUnix}:R>\n\n` +
      `Click **Join Raid** here, then continue the fight in ${raidChannelId ? `<#${raidChannelId}>` : "the raid channel"}.\n\n` +
      `Rewards are funded only by join fees, so the guild treasury does not lose money.`
    );
}

function raidStatusEmbed(raid, players, logText = "") {
  const hpBarLength = 20;
  const filled = Math.max(0, Math.round((raid.boss_hp / raid.boss_max_hp) * hpBarLength));
  const bar = "█".repeat(filled) + "░".repeat(hpBarLength - filled);

  const topPlayers = players
    .map(p => {
      const score = getRaidScore(p);
      return { ...p, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const leaderboard = topPlayers.length
    ? topPlayers.map((p, i) =>
        `**#${i + 1}** <@${p.user_id}> — Score: **${Math.floor(p.score).toLocaleString()}** | DMG ${p.damage.toLocaleString()} | HEAL ${p.healing.toLocaleString()} | TANK ${p.tanking.toLocaleString()}`
      ).join("\n")
    : "No players joined yet.";

  const timeText = raid.status === "open"
    ? `⏰ **Join Ends:** <t:${Math.floor((raid.created_at + RAID_JOIN_WINDOW) / 1000)}:R>`
    : `⏰ **Raid Ends:** <t:${Math.floor((raid.ends_at || Date.now() + RAID_DURATION) / 1000)}:R>`;

  return new EmbedBuilder()
    .setTitle(`👹 Raid Boss: ${raid.boss_name}`)
    .setColor(0xff3b3b)
    .setDescription(
      `**Status:** ${raid.status.toUpperCase()}\n` +
      `**Boss HP:** ${raid.boss_hp.toLocaleString()} / ${raid.boss_max_hp.toLocaleString()}\n` +
      `\`${bar}\`\n\n` +
      `**Players:** ${players.length}/${RAID_MAX_PLAYERS}\n` +
      `**Join Fee:** ${raid.join_fee.toLocaleString()} Digital Silver\n` +
      `**Reward Pool:** ${raid.reward_pool.toLocaleString()} Digital Silver\n` +
      `${timeText}\n\n` +
      `${logText ? `**Last Action:**\n${logText}\n\n` : ""}` +
      `**Top Contributors:**\n${leaderboard}\n\n` +
      `⚔️ Attack = damage score\n` +
      `🩹 Heal = support score\n` +
      `🛡️ Defend = tank score\n` +
      `Action cooldown: ${RAID_ACTION_COOLDOWN / 1000}s`
    );
}

function getRaidScore(player) {
  return Number(player.damage || 0) + Number(player.healing || 0) * 0.8 + Number(player.tanking || 0) * 0.5;
}

async function updateRaidMessages(raidId, logText = "") {
  const raid = db.prepare("SELECT * FROM raid_bosses WHERE raid_id = ?").get(raidId);
  if (!raid) return;

  const players = db.prepare(
    "SELECT * FROM raid_players WHERE raid_id = ? ORDER BY joined_at ASC"
  ).all(raidId);

  if (raid.raid_channel_id && raid.raid_message_id) {
    try {
      const channel = await client.channels.fetch(raid.raid_channel_id);
      const msg = await channel.messages.fetch(raid.raid_message_id);

      await msg.edit({
        embeds: [raidStatusEmbed(raid, players, logText)],
        components: raid.status === "active" ? [raidActionButtons(raidId)] : []
      });
    } catch (err) {
      console.error("Raid message update error:", err);
    }
  }

  if (raid.general_channel_id && raid.general_message_id && raid.status === "open") {
    try {
      const channel = await client.channels.fetch(raid.general_channel_id);
      const msg = await channel.messages.fetch(raid.general_message_id);

      await msg.edit({
        embeds: [raidGeneralEmbed(raid, players.length)],
        components: [raidJoinButton(raidId)]
      });
    } catch (err) {
      console.error("Raid general message update error:", err);
    }
  }
}

async function spawnRaidBoss(client, manualGuildId = null) {
  const generalChannelId = process.env.RAID_GENERAL_CHANNEL_ID;
  const raidChannelId = process.env.RAID_CHANNEL_ID;

  if (!generalChannelId || !raidChannelId) {
    console.error("RAID_GENERAL_CHANNEL_ID or RAID_CHANNEL_ID missing.");
    return null;
  }

  const raidChannel = await client.channels.fetch(raidChannelId).catch(() => null);
  const generalChannel = await client.channels.fetch(generalChannelId).catch(() => null);

  if (!raidChannel || !generalChannel || !raidChannel.isTextBased() || !generalChannel.isTextBased()) {
    console.error("Raid channels invalid or not text based.");
    return null;
  }

  const guildId = manualGuildId || raidChannel.guild?.id || generalChannel.guild?.id;

  if (!guildId) return null;

  if (!isRaidEnabled(guildId)) {
    console.log("Raid spawn skipped because raids are disabled.");
    return null;
  }

  const existing = db.prepare(`
    SELECT *
    FROM raid_bosses
    WHERE guild_id = ?
    AND status IN ('open', 'active')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(guildId);

  if (existing) {
    console.log("Raid spawn skipped because an active/open raid already exists.");
    return existing;
  }

  const raidId = makeRaidId();
  const now = Date.now();

  db.prepare(`
    INSERT INTO raid_bosses
    (raid_id, guild_id, general_channel_id, raid_channel_id, boss_name, boss_hp, boss_max_hp, join_fee, reward_pool, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'open', ?, ?)
  `).run(
    raidId,
    guildId,
    generalChannelId,
    raidChannelId,
    getRaidBossName(),
    RAID_BOSS_HP,
    RAID_BOSS_HP,
    RAID_JOIN_FEE,
    now,
    now
  );

  const raid = db.prepare("SELECT * FROM raid_bosses WHERE raid_id = ?").get(raidId);

  const generalMsg = await generalChannel.send({
    embeds: [raidGeneralEmbed(raid, 0)],
    components: [raidJoinButton(raidId)]
  });

  const raidMsg = await raidChannel.send({
    embeds: [raidStatusEmbed(raid, [], `Raid boss spawned. Join from <#${generalChannelId}>.`)],
    components: []
  });

  db.prepare(`
    UPDATE raid_bosses
    SET general_message_id = ?,
        raid_message_id = ?
    WHERE raid_id = ?
  `).run(generalMsg.id, raidMsg.id, raidId);

  await logCasino(
    makeLogEmbed(
      "👹 Raid Boss Spawned",
      `**Boss:** ${raid.boss_name}\n` +
      `🎮 **Raid:** \`${raidId}\`\n` +
      `📢 **Spawn Channel:** <#${generalChannelId}>\n` +
      `⚔️ **Raid Channel:** <#${raidChannelId}>\n` +
      `💰 **Join Fee:** ${RAID_JOIN_FEE.toLocaleString()} Digital Silver`
    )
  );

  return raid;
}

async function handleRaidJoin(interaction) {
  const guildId = interaction.guild.id;
  const raidId = interaction.customId.replace("raid_join:", "");
  const raid = db.prepare("SELECT * FROM raid_bosses WHERE raid_id = ?").get(raidId);

  if (!raid || raid.status !== "open") {
    return interaction.reply({
      content: "❌ This raid is no longer open for joining.",
      ephemeral: true
    });
  }

  const count = db.prepare("SELECT COUNT(*) AS count FROM raid_players WHERE raid_id = ?").get(raidId).count;

  if (count >= RAID_MAX_PLAYERS) {
    return interaction.reply({
      content: "❌ Raid is full.",
      ephemeral: true
    });
  }

  const existing = db.prepare(
    "SELECT * FROM raid_players WHERE raid_id = ? AND user_id = ?"
  ).get(raidId, interaction.user.id);

  if (existing) {
    return interaction.reply({
      content: `✅ You already joined. Continue in <#${raid.raid_channel_id}>.`,
      ephemeral: true
    });
  }

  if (getBal(guildId, interaction.user.id) < raid.join_fee) {
    return interaction.reply({
      content: `❌ You need **${raid.join_fee.toLocaleString()} Digital Silver** to join this raid.`,
      ephemeral: true
    });
  }

  const joinTx = db.transaction(() => {
    changeBalance(
      guildId,
      interaction.user.id,
      -raid.join_fee,
      "RAID_JOIN_FEE",
      `Joined raid boss | Raid: ${raidId}`
    );

    db.prepare(`
      INSERT INTO raid_players
      (raid_id, guild_id, user_id, joined_at)
      VALUES (?, ?, ?, ?)
    `).run(raidId, guildId, interaction.user.id, Date.now());

    db.prepare(`
      UPDATE raid_bosses
      SET reward_pool = reward_pool + ?,
          updated_at = ?
      WHERE raid_id = ?
    `).run(raid.join_fee, Date.now(), raidId);
  });

  joinTx();

  const newCount = db.prepare("SELECT COUNT(*) AS count FROM raid_players WHERE raid_id = ?").get(raidId).count;

  if (newCount >= RAID_MIN_PLAYERS) {
    const fresh = db.prepare("SELECT * FROM raid_bosses WHERE raid_id = ?").get(raidId);

    if (fresh.status === "open") {
      db.prepare(`
        UPDATE raid_bosses
        SET status = 'active',
            started_at = ?,
            ends_at = ?,
            updated_at = ?
        WHERE raid_id = ?
        AND status = 'open'
      `).run(Date.now(), Date.now() + RAID_DURATION, Date.now(), raidId);

      await updateRaidMessages(raidId, "Minimum players reached. Raid started!");
    }
  } else {
    await updateRaidMessages(raidId, `<@${interaction.user.id}> joined the raid.`);
  }

  return interaction.reply({
    content:
      `✅ You joined the raid. **${raid.join_fee.toLocaleString()} Digital Silver** locked as join fee.\n` +
      `Continue the fight here: <#${raid.raid_channel_id}>`,
    ephemeral: true
  });
}

async function handleRaidCancelButton(interaction) {
  const guildId = interaction.guild.id;
  const raidId = interaction.customId.replace("raid_cancel:", "");

  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ Only admins can cancel raids.",
      ephemeral: true
    });
  }

  const raid = db.prepare(`
    SELECT *
    FROM raid_bosses
    WHERE raid_id = ?
    AND guild_id = ?
  `).get(raidId, guildId);

  if (!raid || !["open", "active"].includes(raid.status)) {
    return interaction.reply({
      content: "❌ This raid is already finished/cancelled.",
      ephemeral: true
    });
  }

  const players = db.prepare(`
    SELECT *
    FROM raid_players
    WHERE raid_id = ?
  `).all(raidId);

  const cancelTx = db.transaction(() => {
    const fresh = db.prepare(`
      SELECT *
      FROM raid_bosses
      WHERE raid_id = ?
    `).get(raidId);

    if (!fresh || !["open", "active"].includes(fresh.status)) {
      throw new Error("Raid already handled.");
    }

    db.prepare(`
      UPDATE raid_bosses
      SET status = 'cancelled',
          updated_at = ?
      WHERE raid_id = ?
      AND status IN ('open', 'active')
    `).run(Date.now(), raidId);

    for (const player of players) {
      changeBalance(
        guildId,
        player.user_id,
        raid.join_fee,
        "RAID_CANCEL_REFUND",
        `Raid cancelled by admin button ${interaction.user.tag} | Raid: ${raidId}`
      );
    }
  });

  try {
    cancelTx();
  } catch (err) {
    return interaction.reply({
      content: "❌ This raid is already handled.",
      ephemeral: true
    });
  }

  const embed = makeLogEmbed(
    "🚫 Raid Boss Cancelled",
    `**Boss:** ${raid.boss_name}\n` +
    `🎮 **Raid:** \`${raidId}\`\n` +
    `🛡️ **Cancelled By:** ${interaction.user}\n` +
    `👥 **Players Refunded:** ${players.length}\n` +
    `💰 **Refund Each:** ${raid.join_fee.toLocaleString()} Digital Silver\n` +
    `💰 **Total Refunded:** ${(players.length * raid.join_fee).toLocaleString()} Digital Silver`,
    0x808080
  );

  await logCasino(embed);

  if (raid.raid_channel_id && raid.raid_message_id) {
    try {
      const channel = await client.channels.fetch(raid.raid_channel_id);
      const msg = await channel.messages.fetch(raid.raid_message_id);
      await msg.edit({ embeds: [embed], components: [] });
    } catch (err) {
      console.error("Could not update cancelled raid message:", err);
    }
  }

  if (raid.general_channel_id && raid.general_message_id) {
    try {
      const channel = await client.channels.fetch(raid.general_channel_id);
      const msg = await channel.messages.fetch(raid.general_message_id);
      await msg.edit({ embeds: [embed], components: [] });
    } catch (err) {
      console.error("Could not update cancelled general raid message:", err);
    }
  }

  return interaction.reply({
    content:
      `✅ Raid cancelled.\n` +
      `👥 Refunded **${players.length}** players.\n` +
      `💰 Total refunded: **${(players.length * raid.join_fee).toLocaleString()} Digital Silver**`,
    ephemeral: true
  });
}

async function handleRaidAction(interaction, action) {
  const guildId = interaction.guild.id;
  const raidId = interaction.customId.replace(`raid_${action}:`, "");
  const raid = db.prepare("SELECT * FROM raid_bosses WHERE raid_id = ?").get(raidId);

  if (!raid || raid.status !== "active") {
    return interaction.reply({
      content: "❌ This raid is not active.",
      ephemeral: true
    });
  }

  const player = db.prepare(
    "SELECT * FROM raid_players WHERE raid_id = ? AND user_id = ?"
  ).get(raidId, interaction.user.id);

  if (!player) {
    return interaction.reply({
      content: "❌ You must join the raid from the spawn message first.",
      ephemeral: true
    });
  }

  const now = Date.now();
  const waitMs = RAID_ACTION_COOLDOWN - (now - Number(player.last_action_at || 0));

  if (waitMs > 0) {
    return interaction.reply({
      content: `⏳ You are on cooldown. Try again in **${Math.ceil(waitMs / 1000)}s**.`,
      ephemeral: true
    });
  }

  let damage = 0;
  let healing = 0;
  let tanking = 0;
  let logText = "";

  if (action === "attack") {
    damage = Math.floor(Math.random() * 351) + 250;
    logText = `<@${interaction.user.id}> attacked and dealt **${damage.toLocaleString()} damage**.`;
  }

  if (action === "heal") {
    healing = Math.floor(Math.random() * 201) + 150;
    logText = `<@${interaction.user.id}> healed the raid for **${healing.toLocaleString()} support**.`;
  }

  if (action === "defend") {
    tanking = Math.floor(Math.random() * 251) + 200;
    logText = `<@${interaction.user.id}> defended the raid and gained **${tanking.toLocaleString()} tank score**.`;
  }

  const newHp = Math.max(0, raid.boss_hp - damage);

  db.prepare(`
    UPDATE raid_players
    SET damage = damage + ?,
        healing = healing + ?,
        tanking = tanking + ?,
        actions = actions + 1,
        last_action_at = ?
    WHERE raid_id = ?
    AND user_id = ?
  `).run(damage, healing, tanking, now, raidId, interaction.user.id);

  db.prepare(`
    UPDATE raid_bosses
    SET boss_hp = ?,
        updated_at = ?
    WHERE raid_id = ?
  `).run(newHp, now, raidId);

  if (newHp <= 0) {
    const embed = finishRaidBoss(guildId, raidId, true);
    await logCasino(embed);

    const fresh = db.prepare("SELECT * FROM raid_bosses WHERE raid_id = ?").get(raidId);

    if (fresh.raid_channel_id && fresh.raid_message_id) {
      try {
        const channel = await client.channels.fetch(fresh.raid_channel_id);
        const msg = await channel.messages.fetch(fresh.raid_message_id);
        await msg.edit({ embeds: [embed], components: [] });
      } catch {}
    }

    return interaction.update({
      embeds: [embed],
      components: []
    }).catch(() => interaction.reply({ content: "🏆 Raid boss defeated!", ephemeral: true }));
  }

  await updateRaidMessages(raidId, logText);

  return interaction.deferUpdate().catch(() => {});
}

function finishRaidBoss(guildId, raidId, defeated) {
  const raid = db.prepare("SELECT * FROM raid_bosses WHERE raid_id = ?").get(raidId);
  const players = db.prepare("SELECT * FROM raid_players WHERE raid_id = ?").all(raidId);

  if (!raid || !["active", "open"].includes(raid.status)) {
    return makeLogEmbed("Raid Already Finished", `Raid \`${raidId}\` is already handled.`, 0x808080);
  }

  const ranked = players
    .map(p => ({ ...p, score: getRaidScore(p) }))
    .sort((a, b) => b.score - a.score);

  const totalScore = ranked.reduce((sum, p) => sum + p.score, 0);

  const finishTx = db.transaction(() => {
    db.prepare(`
      UPDATE raid_bosses
      SET status = ?,
          updated_at = ?
      WHERE raid_id = ?
      AND status IN ('open', 'active')
    `).run(defeated ? "finished" : "failed", Date.now(), raidId);

    if (defeated && totalScore > 0) {
      let paid = 0;

      for (let i = 0; i < ranked.length; i++) {
        const player = ranked[i];
        let payout = i === ranked.length - 1
          ? raid.reward_pool - paid
          : Math.floor((player.score / totalScore) * raid.reward_pool);

        payout = Math.max(0, payout);
        paid += payout;

        if (payout > 0) {
          changeBalance(
            guildId,
            player.user_id,
            payout,
            "RAID_REWARD",
            `Raid boss reward | Raid: ${raidId}`
          );
        }
      }
    } else {
      for (const player of players) {
        changeBalance(
          guildId,
          player.user_id,
          raid.join_fee,
          "RAID_REFUND",
          `Raid failed/not enough players refund | Raid: ${raidId}`
        );
      }
    }
  });

  finishTx();

  const rewardLines = ranked.length
    ? ranked.map((p, i) => {
        const pct = totalScore > 0 ? p.score / totalScore : 0;
        const reward = defeated ? Math.floor(pct * raid.reward_pool) : raid.join_fee;
        return `**#${i + 1}** <@${p.user_id}> — Score **${Math.floor(p.score).toLocaleString()}** | Reward **${reward.toLocaleString()}**`;
      }).join("\n")
    : "No players.";

  return makeLogEmbed(
    defeated ? "🏆 Raid Boss Defeated" : "❌ Raid Boss Failed",
    `**Boss:** ${raid.boss_name}\n` +
    `🎮 **Raid:** \`${raidId}\`\n` +
    `💰 **Reward Pool:** ${raid.reward_pool.toLocaleString()} Digital Silver\n` +
    `${defeated ? "Rewards split by performance." : "Join fees refunded."}\n\n` +
    `**Final Ranking:**\n${rewardLines}`,
    defeated ? 0x00ff00 : 0xff0000
  );
}

async function checkRaidBosses() {
  const now = Date.now();

  const expiredOpen = db.prepare(`
    SELECT *
    FROM raid_bosses
    WHERE status = 'open'
    AND created_at + ? <= ?
  `).all(RAID_JOIN_WINDOW, now);

  for (const raid of expiredOpen) {
    const playerCount = db.prepare("SELECT COUNT(*) AS count FROM raid_players WHERE raid_id = ?").get(raid.raid_id).count;

    if (playerCount < RAID_MIN_PLAYERS) {
      const embed = finishRaidBoss(raid.guild_id, raid.raid_id, false);
      await logCasino(embed);

      try {
        const channel = await client.channels.fetch(raid.raid_channel_id);
        const msg = await channel.messages.fetch(raid.raid_message_id);
        await msg.edit({ embeds: [embed], components: [] });
      } catch {}

      try {
        const channel = await client.channels.fetch(raid.general_channel_id);
        const msg = await channel.messages.fetch(raid.general_message_id);
        await msg.edit({ embeds: [embed], components: [] });
      } catch {}
    }
  }

  const expiredActive = db.prepare(`
    SELECT *
    FROM raid_bosses
    WHERE status = 'active'
    AND ends_at IS NOT NULL
    AND ends_at <= ?
  `).all(now);

  for (const raid of expiredActive) {
    const defeated = raid.boss_hp <= 0;
    const embed = finishRaidBoss(raid.guild_id, raid.raid_id, defeated);
    await logCasino(embed);

    try {
      const channel = await client.channels.fetch(raid.raid_channel_id);
      const msg = await channel.messages.fetch(raid.raid_message_id);
      await msg.edit({ embeds: [embed], components: [] });
    } catch {}
  }
}

function startRaidAutoSpawner(client) {
  setInterval(() => {
    spawnRaidBoss(client).catch(err => console.error("Auto raid spawn error:", err));
  }, RAID_SPAWN_INTERVAL);
}
// -------- Raid Boss Code End -------

client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag} | Version ${BOT_VERSION}`);

  client.user.setPresence({
    status: "online",
    activities: [
      {
        name: "/withdraw | /coinflip | /blackjack",
        type: ActivityType.Watching
      }
    ]
  });

  startRaidAutoSpawner(client);
});

function expireOldCoinflips() {
  const now = Date.now();
  const expireBefore = now - 10 * 60 * 1000;

  const oldGames = db.prepare(`
    SELECT *
    FROM coinflips
    WHERE status = 'open'
    AND created_at < ?
  `).all(expireBefore);

  const expireTx = db.transaction((games) => {
    for (const game of games) {
      db.prepare(
        "UPDATE coinflips SET status = 'expired' WHERE game_id = ? AND status = 'open'"
      ).run(game.game_id);

      changeBalance(
        game.guild_id,
        game.creator_id,
        game.bet,
        "COINFLIP_REFUND",
        `Coinflip expired refund | Game: ${game.game_id}`
      );
    }
  });

  if (oldGames.length > 0) {
    expireTx(oldGames);
    console.log(`Refunded ${oldGames.length} expired coinflip(s).`);
  }
}

setInterval(expireOldCoinflips, 60_000);

async function handleWithdrawApprove(interaction) {
  const guildId = interaction.guild.id;
  const withdrawId = interaction.customId.replace("withdraw_approve:", "");

  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ Only admins can approve withdrawals.",
      ephemeral: true
    });
  }

  const request = db.prepare(
    "SELECT * FROM withdrawals WHERE withdraw_id = ?"
  ).get(withdrawId);

  if (!request || request.status !== "pending") {
    return interaction.reply({
      content: "❌ This withdrawal is no longer pending.",
      ephemeral: true
    });
  }

  db.prepare(`
    UPDATE withdrawals
    SET status = 'approved', admin_id = ?, updated_at = ?
    WHERE withdraw_id = ? AND status = 'pending'
  `).run(interaction.user.id, Date.now(), withdrawId);

  logTransaction(
    guildId,
    request.user_id,
    "WITHDRAW_APPROVED",
    0,
    `Approved by ${interaction.user.tag} | Withdraw: ${withdrawId}`
  );

  const fee = Math.floor((request.amount * WITHDRAW_FEE_PERCENT) / 100);
  const netAmount = request.amount - fee;

  const embed = makeLogEmbed(
    "✅ Withdrawal Successful",
    `**ID:** \`${withdrawId}\`\n` +
    `👤 **User:** <@${request.user_id}>\n` +
    `💰 **Requested Amount:** ${request.amount.toLocaleString()} coins\n` +
    `💸 **Fee (${WITHDRAW_FEE_PERCENT}%):** ${fee.toLocaleString()} coins\n` +
    `✅ **Net Payout:** ${netAmount.toLocaleString()} coins\n` +
    `💳 **Balance Before:** ${request.balance_before.toLocaleString()} coins\n` +
    `💳 **Balance After:** ${request.balance_after.toLocaleString()} coins\n\n` +
    `Withdrawal has been verified by Admin.\n` +
    `🛡️ **Approved By:** ${interaction.user}`,
    0x00ff00
  );

  await interaction.update({
    embeds: [embed],
    components: []
  });

  await interaction.channel.send(
    `✅ <@${request.user_id}> your withdrawal has been **approved** by ${interaction.user}. Net payout: **${netAmount.toLocaleString()} coins** after ${WITHDRAW_FEE_PERCENT}% fee.`
  ).catch(() => {});

  await notifyUser(
    client,
    request.user_id,
    `✅ Your withdrawal was approved.\nRequested: ${request.amount.toLocaleString()} coins\nFee (${WITHDRAW_FEE_PERCENT}%): ${fee.toLocaleString()} coins\nNet Payout: ${netAmount.toLocaleString()} coins\nApproved by: ${interaction.user.tag}`
  );

  await logToChannel(client, embed);

  return;
}

async function handleWithdrawDeny(interaction) {
  const guildId = interaction.guild.id;
  const withdrawId = interaction.customId.replace("withdraw_deny:", "");

  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ Only admins can deny withdrawals.",
      ephemeral: true
    });
  }

  const request = db.prepare(
    "SELECT * FROM withdrawals WHERE withdraw_id = ?"
  ).get(withdrawId);

  if (!request || request.status !== "pending") {
    return interaction.reply({
      content: "❌ This withdrawal is no longer pending.",
      ephemeral: true
    });
  }

  const denyTx = db.transaction(() => {
    db.prepare(`
      UPDATE withdrawals
      SET status = 'denied', admin_id = ?, updated_at = ?
      WHERE withdraw_id = ? AND status = 'pending'
    `).run(interaction.user.id, Date.now(), withdrawId);

    changeBalance(
      guildId,
      request.user_id,
      request.amount,
      "WITHDRAW_REFUND",
      `Withdrawal denied refund by ${interaction.user.tag} | Withdraw: ${withdrawId}`
    );
  });

  denyTx();

  const newBalance = getBal(guildId, request.user_id);

  const embed = makeLogEmbed(
    "❌ Withdrawal Rejected",
    `**ID:** \`${withdrawId}\`\n` +
    `👤 **User:** <@${request.user_id}>\n` +
    `💰 **Refunded:** ${request.amount.toLocaleString()} coins\n` +
    `💳 **Current Balance:** ${newBalance.toLocaleString()} coins\n\n` +
    `Withdrawal has been rejected by Admin and refunded.\n` +
    `🛡️ **Rejected By:** ${interaction.user}`,
    0xff0000
  );

  await interaction.update({
    embeds: [embed],
    components: []
  });

  await interaction.channel.send(
    `❌ <@${request.user_id}> your withdrawal of **${request.amount.toLocaleString()} coins** was **rejected** by ${interaction.user}. The amount has been refunded.`
  ).catch(() => {});

  await notifyUser(
    client,
    request.user_id,
    `❌ Your withdrawal was rejected and refunded.\nAmount: ${request.amount.toLocaleString()} coins\nRejected by: ${interaction.user.tag}`
  );

  await logToChannel(client, embed);

  return;
}

async function handleWithdrawCancel(interaction) {
  const guildId = interaction.guild.id;
  const withdrawId = interaction.customId.replace("withdraw_cancel:", "");
  const user = interaction.user;

  const request = db.prepare(
    "SELECT * FROM withdrawals WHERE withdraw_id = ?"
  ).get(withdrawId);

  if (!request || request.status !== "pending") {
    return interaction.reply({
      content: "❌ This withdrawal is no longer pending.",
      ephemeral: true
    });
  }

  if (user.id !== request.user_id) {
    return interaction.reply({
      content: "❌ Only the withdrawal requester can cancel this request.",
      ephemeral: true
    });
  }

  const cancelTx = db.transaction(() => {
    const fresh = db.prepare(
      "SELECT * FROM withdrawals WHERE withdraw_id = ?"
    ).get(withdrawId);

    if (!fresh || fresh.status !== "pending") {
      throw new Error("Withdrawal already handled.");
    }

    db.prepare(`
      UPDATE withdrawals
      SET status = 'cancelled', updated_at = ?
      WHERE withdraw_id = ? AND status = 'pending'
    `).run(Date.now(), withdrawId);

    changeBalance(
      guildId,
      request.user_id,
      request.amount,
      "WITHDRAW_CANCEL_REFUND",
      `Withdrawal cancelled by user | Withdraw: ${withdrawId}`
    );
  });

  try {
    cancelTx();
  } catch (err) {
    return interaction.reply({
      content: "❌ This withdrawal is already handled.",
      ephemeral: true
    });
  }

  const newBalance = getBal(guildId, request.user_id);

  const embed = makeLogEmbed(
    "🚫 Withdrawal Cancelled",
    `**ID:** \`${withdrawId}\`\n` +
    `👤 **User:** <@${request.user_id}>\n` +
    `💰 **Refunded:** ${request.amount.toLocaleString()} coins\n` +
    `💳 **Current Balance:** ${newBalance.toLocaleString()} coins\n\n` +
    `Withdrawal was cancelled by the requester.`,
    0x808080
  );

  await interaction.update({
    embeds: [embed],
    components: []
  });

  await interaction.channel.send(
    `🚫 <@${request.user_id}> cancelled their withdrawal request. **${request.amount.toLocaleString()} coins** refunded.`
  ).catch(() => {});

  await logToChannel(client, embed);

  return;
}

async function handleCancelCoinflipButton(interaction) {
  const guildId = interaction.guild.id;
  const gameId = interaction.customId.replace("cancel_coinflip:", "");
  const user = interaction.user;

  const game = db.prepare(
    "SELECT * FROM coinflips WHERE game_id = ?"
  ).get(gameId);

  if (!game || game.status !== "open") {
    return interaction.reply({
      content: "❌ This coinflip is no longer active.",
      ephemeral: true
    });
  }

  if (user.id !== game.creator_id) {
    return interaction.reply({
      content: "❌ Only the coinflip creator can cancel this game.",
      ephemeral: true
    });
  }

  const cancelTx = db.transaction(() => {
    const freshGame = db.prepare(
      "SELECT * FROM coinflips WHERE game_id = ?"
    ).get(gameId);

    if (!freshGame || freshGame.status !== "open") {
      throw new Error("Coinflip already finished/cancelled.");
    }

    db.prepare(
      "UPDATE coinflips SET status = 'cancelled' WHERE game_id = ?"
    ).run(gameId);

    changeBalance(
      guildId,
      user.id,
      game.bet,
      "COINFLIP_REFUND",
      `Coinflip cancelled by button | Game: ${gameId}`
    );
  });

  try {
    cancelTx();
  } catch (err) {
    return interaction.reply({
      content: "❌ This coinflip is already finished/cancelled.",
      ephemeral: true
    });
  }

  await logCasino(
    makeLogEmbed(
      "❌ Coinflip Cancelled",
      `👤 **User:** <@${game.creator_id}>\n💰 **Refunded:** ${game.bet.toLocaleString()} coins\n🎮 **Game:** \`${gameId}\``,
      0x808080
    )
  );

  const cancelledEmbed = new EmbedBuilder()
    .setTitle("🪙 Coinflip Cancelled")
    .setColor(0x808080)
    .setDescription(
      `**Creator:** <@${game.creator_id}>\n` +
      `**Choice:** ${game.choice.toUpperCase()}\n` +
      `**Bet:** ${game.bet.toLocaleString()} coins\n\n` +
      `❌ Cancelled by creator.\n` +
      `💰 Bet refunded.`
    );

  return interaction.update({
    embeds: [cancelledEmbed],
    components: []
  });
}

async function handleJoinCoinflip(interaction) {
  const guildId = interaction.guild.id;
  const gameId = interaction.customId.replace("join_coinflip:", "");
  const opponent = interaction.user;

  const game = db.prepare(
    "SELECT * FROM coinflips WHERE game_id = ?"
  ).get(gameId);

  if (!game || game.status !== "open") {
    return interaction.reply({
      content: "❌ This coinflip is no longer active.",
      ephemeral: true
    });
  }

  if (!isCoinflipEnabled(guildId)) {
    return interaction.reply({
      content: "❌ Coinflip is currently disabled by admins.",
      ephemeral: true
    });
  }

  if (opponent.id === game.creator_id) {
    return interaction.reply({
      content: "❌ You cannot join your own coinflip.",
      ephemeral: true
    });
  }

  if (opponent.bot) {
    return interaction.reply({
      content: "❌ Bots cannot join.",
      ephemeral: true
    });
  }

  if (getBal(guildId, opponent.id) < game.bet) {
    return interaction.reply({
      content: "❌ You do not have enough coins to join.",
      ephemeral: true
    });
  }

  const result = Math.random() < 0.5 ? "heads" : "tails";
  const creatorWon = result === game.choice;
  const winnerId = creatorWon ? game.creator_id : opponent.id;
  const loserId = creatorWon ? opponent.id : game.creator_id;
  const pot = game.bet * 2;

  const finishCoinflipTx = db.transaction(() => {
    const freshGame = db.prepare(
      "SELECT * FROM coinflips WHERE game_id = ?"
    ).get(gameId);

    if (!freshGame || freshGame.status !== "open") {
      throw new Error("Coinflip already finished/cancelled.");
    }

    changeBalance(
      guildId,
      opponent.id,
      -game.bet,
      "COINFLIP_JOIN_LOCK",
      `Joined coinflip | Game: ${gameId}`
    );

    changeBalance(
      guildId,
      winnerId,
      pot,
      "COINFLIP_WIN",
      `Won coinflip vs <@${loserId}> | Game: ${gameId}`
    );

    const winnerStreak = getCoinflipStreak(guildId, winnerId) + 1;
    const loserOldStreak = getCoinflipStreak(guildId, loserId);
    setCoinflipStreak(guildId, winnerId, winnerStreak);
    setCoinflipStreak(guildId, loserId, 0);

    logTransaction(
      guildId,
      loserId,
      "COINFLIP_LOSS",
      0,
      `Lost coinflip vs <@${winnerId}> | Game: ${gameId} | Streak broken: ${loserOldStreak}`
    );

    db.prepare(
      "UPDATE coinflips SET status = 'finished' WHERE game_id = ?"
    ).run(gameId);
  });

  try {
    finishCoinflipTx();
  } catch (err) {
    return interaction.reply({
      content: "❌ This coinflip was already handled or cancelled.",
      ephemeral: true
    });
  }

  const winnerCurrentStreak = getCoinflipStreak(guildId, winnerId);
  const streakComment = getStreakComment(winnerCurrentStreak);

  await logCasino(
    makeLogEmbed(
      "🏆 Coinflip Result",
      `🎲 **Result:** ${result.toUpperCase()}\n🥇 **Winner:** <@${winnerId}>\n💀 **Loser:** <@${loserId}>\n💰 **Pot:** ${pot.toLocaleString()} coins\n🎮 **Game:** \`${gameId}\``
    )
  );

  const oppositeChoice = game.choice === "heads" ? "tails" : "heads";

  const resultEmbed = new EmbedBuilder()
    .setTitle("🪙 Coinflip Result")
    .setColor(0xff3b3b)
    .setDescription(
      `🎯 **Result:** ${result.toUpperCase()}\n\n` +
      `🏆 **Winner:** <@${winnerId}>\n` +
      `💀 **Loser:** <@${loserId}>\n` +
      `💰 **Pot Won:** ${pot.toLocaleString()} coins\n\n` +
      `**Creator:** <@${game.creator_id}> — ${game.choice.toUpperCase()}\n` +
      `**Opponent:** ${opponent} — ${oppositeChoice.toUpperCase()}`
    );

  return interaction.update({
    embeds: [resultEmbed],
    components: []
  });
}





// -------- Duel Code -------
function makeDuelId() { return `DL-${Date.now()}-${Math.floor(Math.random() * 999999)}`; }

function duelButtons(duelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`duel_join:${duelId}`).setLabel("Join Duel").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`duel_cancel:${duelId}`).setLabel("Cancel").setStyle(ButtonStyle.Danger)
  );
}

function duelFightButtons(duelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`duel_attack:${duelId}`).setLabel("Attack").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`duel_defend:${duelId}`).setLabel("Defend").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`duel_heavy:${duelId}`).setLabel("Heavy Attack").setStyle(ButtonStyle.Danger)
  );
}

function duelOpenEmbed(duel) {
  const expireUnix = Math.floor((duel.expires_at || Date.now() + DUEL_LOBBY_TIMEOUT) / 1000);
  return new EmbedBuilder().setTitle("⚔️ PvP Duel Challenge").setColor(0xff3b3b).setDescription(
    `**Creator:** <@${duel.creator_id}>\n` +
    `**Bet:** ${duel.bet.toLocaleString()} Digital Silver\n` +
    `**Prize Pool:** ${(duel.bet * 2).toLocaleString()} Digital Silver\n` +
    `⏰ **Expires:** <t:${expireUnix}:R>\n\n` +
    `Waiting for an opponent...\n\nCreator can cancel before someone joins.`
  );
}

function duelBattleEmbed(duel, logText = "") {
  const expireUnix = Math.floor((duel.expires_at || Date.now() + DUEL_TURN_TIMEOUT) / 1000);
  return new EmbedBuilder().setTitle("⚔️ PvP Duel").setColor(0xff3b3b).setDescription(
    `**Player 1:** <@${duel.creator_id}> ❤️ ${duel.creator_hp} HP\n` +
    `**Player 2:** <@${duel.opponent_id}> ❤️ ${duel.opponent_hp} HP\n\n` +
    `🎯 **Turn:** <@${duel.turn_user_id}>\n` +
    `⏰ **Move Expires:** <t:${expireUnix}:R>\n` +
    `💰 **Prize Pool:** ${(duel.bet * 2).toLocaleString()} Digital Silver\n\n` +
    `${logText ? `**Last Action:**\n${logText}\n\n` : ""}` +
    `Choose your move:\n⚔️ Attack = 20 damage\n🛡️ Defend = heal 10 HP\n💥 Heavy Attack = 40 damage, 50% miss chance`
  );
}

function duelFinishedEmbed(duel, winnerId, loserId, logText = "") {
  return new EmbedBuilder().setTitle("🏆 Duel Finished").setColor(0x00ff00).setDescription(
    `🥇 **Winner:** <@${winnerId}>\n💀 **Loser:** <@${loserId}>\n` +
    `💰 **Prize Won:** ${(duel.bet * 2).toLocaleString()} Digital Silver\n\n` +
    `${logText ? `**Final Action:**\n${logText}` : ""}`
  );
}

async function handleDuelJoin(interaction) {
  const guildId = interaction.guild.id;
  const duelId = interaction.customId.replace("duel_join:", "");
  const duel = db.prepare("SELECT * FROM duels WHERE duel_id = ?").get(duelId);
  if (!duel || duel.status !== "open") return interaction.reply({ content: "❌ This duel is no longer open.", ephemeral: true });
  if (interaction.user.id === duel.creator_id) return interaction.reply({ content: "❌ You cannot join your own duel.", ephemeral: true });
  if (getBal(guildId, interaction.user.id) < duel.bet) return interaction.reply({ content: "❌ You do not have enough Digital Silver to join this duel.", ephemeral: true });

  const joinTx = db.transaction(() => {
    const fresh = db.prepare("SELECT * FROM duels WHERE duel_id = ?").get(duelId);
    if (!fresh || fresh.status !== "open") throw new Error("Duel no longer open.");
    changeBalance(guildId, interaction.user.id, -duel.bet, "DUEL_JOIN_LOCK", `Joined duel | Duel: ${duelId}`);
    db.prepare(`UPDATE duels SET opponent_id = ?, status = 'active', turn_user_id = ?, last_action_at = ?, expires_at = ?, updated_at = ? WHERE duel_id = ? AND status = 'open'`)
      .run(interaction.user.id, duel.creator_id, Date.now(), Date.now() + DUEL_TURN_TIMEOUT, Date.now(), duelId);
  });
  try { joinTx(); } catch { return interaction.reply({ content: "❌ This duel is no longer open.", ephemeral: true }); }
  const updated = db.prepare("SELECT * FROM duels WHERE duel_id = ?").get(duelId);
  await logCasino(makeLogEmbed("⚔️ Duel Started", `👤 **Player 1:** <@${updated.creator_id}>\n👤 **Player 2:** <@${updated.opponent_id}>\n💰 **Bet:** ${updated.bet.toLocaleString()} Digital Silver\n🎮 **Duel:** \`${duelId}\``));
  return interaction.update({ embeds: [duelBattleEmbed(updated, "Duel started!")], components: [duelFightButtons(duelId)] });
}

async function handleDuelCancel(interaction) {
  const guildId = interaction.guild.id;
  const duelId = interaction.customId.replace("duel_cancel:", "");
  const duel = db.prepare("SELECT * FROM duels WHERE duel_id = ?").get(duelId);
  if (!duel || duel.status !== "open") return interaction.reply({ content: "❌ This duel cannot be cancelled.", ephemeral: true });
  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
  if (interaction.user.id !== duel.creator_id && !isAdmin) return interaction.reply({ content: "❌ Only the creator or an admin can cancel this duel.", ephemeral: true });
  const cancelTx = db.transaction(() => {
    const fresh = db.prepare("SELECT * FROM duels WHERE duel_id = ?").get(duelId);
    if (!fresh || fresh.status !== "open") throw new Error("Duel already handled.");
    db.prepare("UPDATE duels SET status = 'cancelled', updated_at = ? WHERE duel_id = ? AND status = 'open'").run(Date.now(), duelId);
    changeBalance(guildId, duel.creator_id, duel.bet, "DUEL_CANCEL_REFUND", `Duel cancelled refund | Duel: ${duelId}`);
  });
  try { cancelTx(); } catch { return interaction.reply({ content: "❌ This duel is already handled.", ephemeral: true }); }
  const embed = makeLogEmbed("🚫 Duel Cancelled", `👤 **Creator:** <@${duel.creator_id}>\n💰 **Refunded:** ${duel.bet.toLocaleString()} Digital Silver\n🎮 **Duel:** \`${duelId}\``, 0x808080);
  await logCasino(embed);
  return interaction.update({ embeds: [embed], components: [] });
}

async function handleDuelMove(interaction, move) {
  const guildId = interaction.guild.id;
  const duelId = interaction.customId.replace(`duel_${move}:`, "");
  const duel = db.prepare("SELECT * FROM duels WHERE duel_id = ?").get(duelId);
  if (!duel || duel.status !== "active") return interaction.reply({ content: "❌ This duel is not active.", ephemeral: true });
  if (interaction.user.id !== duel.turn_user_id) return interaction.reply({ content: "❌ It is not your turn.", ephemeral: true });

  const isCreatorTurn = interaction.user.id === duel.creator_id;
  let creatorHp = duel.creator_hp, opponentHp = duel.opponent_hp, logText = "";
  if (move === "attack") { const damage = 20; if (isCreatorTurn) opponentHp -= damage; else creatorHp -= damage; logText = `<@${interaction.user.id}> used **Attack** and dealt **${damage} damage**.`; }
  if (move === "defend") { const heal = 10; if (isCreatorTurn) creatorHp = Math.min(DUEL_START_HP, creatorHp + heal); else opponentHp = Math.min(DUEL_START_HP, opponentHp + heal); logText = `<@${interaction.user.id}> used **Defend** and healed **${heal} HP**.`; }
  if (move === "heavy") { const hit = Math.random() < 0.5; if (hit) { const damage = 40; if (isCreatorTurn) opponentHp -= damage; else creatorHp -= damage; logText = `<@${interaction.user.id}> used **Heavy Attack** and dealt **${damage} damage**.`; } else logText = `<@${interaction.user.id}> used **Heavy Attack** but missed.`; }
  creatorHp = Math.max(0, creatorHp); opponentHp = Math.max(0, opponentHp);
  let winnerId = null, loserId = null;
  if (creatorHp <= 0) { winnerId = duel.opponent_id; loserId = duel.creator_id; }
  else if (opponentHp <= 0) { winnerId = duel.creator_id; loserId = duel.opponent_id; }

  if (winnerId) {
    const pot = duel.bet * 2;
    const finishTx = db.transaction(() => {
      db.prepare("UPDATE duels SET creator_hp = ?, opponent_hp = ?, status = 'finished', winner_id = ?, updated_at = ? WHERE duel_id = ? AND status = 'active'").run(creatorHp, opponentHp, winnerId, Date.now(), duelId);
      changeBalance(guildId, winnerId, pot, "DUEL_WIN", `Won duel vs <@${loserId}> | Duel: ${duelId}`);
      logTransaction(guildId, loserId, "DUEL_LOSS", 0, `Lost duel vs <@${winnerId}> | Duel: ${duelId}`);
    });
    finishTx();
    const embed = duelFinishedEmbed({ ...duel, creator_hp: creatorHp, opponent_hp: opponentHp }, winnerId, loserId, logText);
    await logCasino(embed);
    return interaction.update({ embeds: [embed], components: [] });
  }
  const nextTurnUserId = isCreatorTurn ? duel.opponent_id : duel.creator_id;
  db.prepare("UPDATE duels SET creator_hp = ?, opponent_hp = ?, turn_user_id = ?, last_action_at = ?, expires_at = ?, updated_at = ? WHERE duel_id = ? AND status = 'active'")
    .run(creatorHp, opponentHp, nextTurnUserId, Date.now(), Date.now() + DUEL_TURN_TIMEOUT, Date.now(), duelId);
  const updated = db.prepare("SELECT * FROM duels WHERE duel_id = ?").get(duelId);
  return interaction.update({ embeds: [duelBattleEmbed(updated, logText)], components: [duelFightButtons(duelId)] });
}

async function checkExpiredDuels() {
  const now = Date.now();
  const expiredOpenDuels = db.prepare("SELECT * FROM duels WHERE status = 'open' AND expires_at IS NOT NULL AND expires_at <= ?").all(now);
  for (const duel of expiredOpenDuels) {
    try {
      const refundTx = db.transaction(() => {
        const fresh = db.prepare("SELECT * FROM duels WHERE duel_id = ?").get(duel.duel_id);
        if (!fresh || fresh.status !== "open") return;
        db.prepare("UPDATE duels SET status = 'expired', updated_at = ? WHERE duel_id = ? AND status = 'open'").run(Date.now(), duel.duel_id);
        changeBalance(duel.guild_id, duel.creator_id, duel.bet, "DUEL_LOBBY_TIMEOUT_REFUND", `Duel expired because no one joined | Duel: ${duel.duel_id}`);
      });
      refundTx();
      const embed = makeLogEmbed("⏰ Duel Expired", `👤 **Creator:** <@${duel.creator_id}>\n💰 **Refunded:** ${duel.bet.toLocaleString()} Digital Silver\n🎮 **Duel:** \`${duel.duel_id}\`\n\nNo opponent joined within 5 minutes.`, 0x808080);
      await logCasino(embed);
      if (duel.channel_id && duel.message_id) { try { const channel = await client.channels.fetch(duel.channel_id); const msg = await channel.messages.fetch(duel.message_id); await msg.edit({ embeds: [embed], components: [] }); } catch {} }
    } catch (err) { console.error("Expired open duel error:", err); }
  }

  const expiredActiveDuels = db.prepare("SELECT * FROM duels WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?").all(now);
  for (const duel of expiredActiveDuels) {
    try {
      const loserId = duel.turn_user_id;
      const winnerId = loserId === duel.creator_id ? duel.opponent_id : duel.creator_id;
      const pot = duel.bet * 2;
      if (!winnerId || !loserId) continue;
      const forfeitTx = db.transaction(() => {
        const fresh = db.prepare("SELECT * FROM duels WHERE duel_id = ?").get(duel.duel_id);
        if (!fresh || fresh.status !== "active") return;
        db.prepare("UPDATE duels SET status = 'finished', winner_id = ?, updated_at = ? WHERE duel_id = ? AND status = 'active'").run(winnerId, Date.now(), duel.duel_id);
        changeBalance(duel.guild_id, winnerId, pot, "DUEL_TIMEOUT_WIN", `Won duel by opponent timeout | Duel: ${duel.duel_id}`);
        logTransaction(duel.guild_id, loserId, "DUEL_TIMEOUT_LOSS", 0, `Lost duel by not responding in time | Duel: ${duel.duel_id}`);
      });
      forfeitTx();
      const embed = makeLogEmbed("⏰ Duel Forfeit", `🥇 **Winner:** <@${winnerId}>\n💀 **Loser:** <@${loserId}>\n💰 **Prize Won:** ${pot.toLocaleString()} Digital Silver\n🎮 **Duel:** \`${duel.duel_id}\`\n\n<@${loserId}> did not respond within 5 minutes.`, 0xff0000);
      await logCasino(embed);
      if (duel.channel_id && duel.message_id) { try { const channel = await client.channels.fetch(duel.channel_id); const msg = await channel.messages.fetch(duel.message_id); await msg.edit({ embeds: [embed], components: [] }); } catch {} }
    } catch (err) { console.error("Expired active duel error:", err); }
  }
}
// -------- Duel Code End -------

// -------- Blackjack Code -------
function makeBlackjackId() {
  return `BJ-${Date.now()}-${Math.floor(Math.random() * 999999)}`;
}

function bjCreateDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = [
    { name: "2", value: 2 }, { name: "3", value: 3 }, { name: "4", value: 4 },
    { name: "5", value: 5 }, { name: "6", value: 6 }, { name: "7", value: 7 },
    { name: "8", value: 8 }, { name: "9", value: 9 }, { name: "10", value: 10 },
    { name: "J", value: 10 }, { name: "Q", value: 10 }, { name: "K", value: 10 },
    { name: "A", value: 11 }
  ];

  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({
        suit,
        rank: rank.name,
        value: rank.value,
        text: `${rank.name}${suit}`
      });
    }
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

function bjHandValue(hand) {
  let total = 0;
  let aces = 0;

  for (const card of hand) {
    total += card.value;
    if (card.rank === "A") aces++;
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }

  return total;
}

function bjIsBust(hand) {
  return bjHandValue(hand) > 21;
}

function bjCardsText(hand, hideSecond = false) {
  if (!hand || !hand.length) return "-";
  if (hideSecond && hand.length >= 2) return `${hand[0].text} ??`;
  return hand.map(c => c.text).join(" ");
}

function bjParse(value, fallback) {
  try {
    return JSON.parse(value || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function bjLobbyButtons(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bj_join:${gameId}`)
      .setLabel("Join Blackjack")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`bj_leave:${gameId}`)
      .setLabel("Leave")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`bj_start:${gameId}`)
      .setLabel("Start Game")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`bj_cancel:${gameId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
  );
}

function bjActionButtons(gameId, canSplit) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bj_hit:${gameId}`)
      .setLabel("Hit")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`bj_stay:${gameId}`)
      .setLabel("Stay")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`bj_split:${gameId}`)
      .setLabel("Split")
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canSplit),

    new ButtonBuilder()
      .setCustomId(`bj_view:${gameId}`)
      .setLabel("View My Hand")
      .setStyle(ButtonStyle.Secondary)
  );
}

function bjLobbyEmbed(game, players) {
  const expireUnix = Math.floor((game.expires_at || Date.now() + BLACKJACK_LOBBY_TIMEOUT) / 1000);
  const list = players.length
    ? players.map((p, i) => `**${i + 1}.** <@${p.user_id}>`).join("\n")
    : "No players yet.";

  return new EmbedBuilder()
    .setTitle("🃏 Blackjack Table")
    .setColor(0xff3b3b)
    .setDescription(
      `**Host/Admin:** <@${game.host_id}>\n` +
      `**Buy-in:** ${game.buyin.toLocaleString()} Digital Silver\n` +
      `**Players:** ${players.length}/${MAX_BLACKJACK_PLAYERS}\n` +
      `**Prize Pool:** ${(game.buyin * players.length).toLocaleString()} Digital Silver\n` +
      `⏰ **Lobby Expires:** <t:${expireUnix}:R>\n\n` +
      `**Players:**\n${list}\n\n` +
      `Minimum **2 players** required. PvP mode: highest hand wins the pot. No dealer, no pot burn.`
    );
}

function bjGameEmbed(game, players, logText = "") {
  const current = players[game.current_turn_index];
  const expireUnix = Math.floor((game.expires_at || Date.now() + BLACKJACK_TURN_TIMEOUT) / 1000);

  const playerText = players.map((p, index) => {
    const hands = bjParse(p.hands, []);
    const handLines = hands.map((h, hIndex) => {
      const marker = index === game.current_turn_index && hIndex === p.active_hand_index ? "👉 " : "";
      const value = bjHandValue(h.cards);
      const state = h.done ? "✅ Stayed" : value > 21 ? "💥 Bust" : "⏳ Playing";
      return `${marker}Hand ${hIndex + 1}: **${h.cards.length} cards** — ${state}`;
    }).join("\\n");

    return `**${index + 1}. <@${p.user_id}>**\\n${handLines}`;
  }).join("\\n\\n");

  return new EmbedBuilder()
    .setTitle("🃏 PvP Blackjack")
    .setColor(0xff3b3b)
    .setDescription(
      `**Mode:** Player vs Player — No dealer / no pot burn\\n` +
      `**Pot:** ${game.pot.toLocaleString()} Digital Silver\\n\\n` +
      `${playerText}\\n\\n` +
      `🎯 **Turn:** ${current ? `<@${current.user_id}>` : "Resolving..."}\\n` +
      `⏰ **Auto Stay:** <t:${expireUnix}:R>\\n\\n` +
      `${logText ? `**Last Action:**\\n${logText}` : "Cards are hidden. Use **View My Hand** to see your cards."}`
    );
}

function bjCanSplit(player) {
  const hands = bjParse(player.hands, []);
  const hand = hands[player.active_hand_index];

  if (!hand || hand.done) return false;
  if (hands.length >= 2) return false;
  if (hand.cards.length !== 2) return false;

  return hand.cards[0].value === hand.cards[1].value;
}


function bjPrivateHandText(player) {
  const hands = bjParse(player.hands, []);

  if (!hands.length) return "No cards dealt yet.";

  return hands.map((h, i) => {
    const value = bjHandValue(h.cards);
    const state = value > 21 ? "💥 Bust" : h.done ? "✅ Stayed" : "⏳ Playing";
    return `**Hand ${i + 1}:** ${bjCardsText(h.cards)} = **${value}** ${state}`;
  }).join("\\n");
}

async function handleBlackjackView(interaction) {
  const gameId = interaction.customId.replace("bj_view:", "");
  const game = db.prepare("SELECT * FROM blackjack_games WHERE game_id = ?").get(gameId);

  if (!game || game.status !== "active") {
    return interaction.reply({
      content: "❌ This blackjack game is not active.",
      ephemeral: true
    });
  }

  const player = db.prepare(
    "SELECT * FROM blackjack_players WHERE game_id = ? AND user_id = ?"
  ).get(gameId, interaction.user.id);

  if (!player) {
    return interaction.reply({
      content: "❌ You are not in this blackjack game.",
      ephemeral: true
    });
  }

  const players = db.prepare(
    "SELECT * FROM blackjack_players WHERE game_id = ? ORDER BY joined_at ASC"
  ).all(gameId);
  const current = players[game.current_turn_index];

  return interaction.reply({
    content:
      `🃏 **Your Blackjack Hand**\\n\\n${bjPrivateHandText(player)}\\n\\n` +
      `🎯 Current turn: ${current ? `<@${current.user_id}>` : "Resolving..."}`,
    ephemeral: true
  });
}

function bjNextTurn(gameId) {
  const game = db.prepare("SELECT * FROM blackjack_games WHERE game_id = ?").get(gameId);
  const players = db.prepare(
    "SELECT * FROM blackjack_players WHERE game_id = ? ORDER BY joined_at ASC"
  ).all(gameId);

  for (let i = game.current_turn_index; i < players.length; i++) {
    const player = players[i];
    const hands = bjParse(player.hands, []);

    for (let h = player.active_hand_index; h < hands.length; h++) {
      if (!hands[h].done && !bjIsBust(hands[h].cards)) {
        db.prepare(`
          UPDATE blackjack_games
          SET current_turn_index = ?,
              expires_at = ?,
              updated_at = ?
          WHERE game_id = ?
        `).run(i, Date.now() + BLACKJACK_TURN_TIMEOUT, Date.now(), gameId);

        db.prepare(`
          UPDATE blackjack_players
          SET active_hand_index = ?
          WHERE game_id = ?
          AND user_id = ?
        `).run(h, gameId, player.user_id);

        return false;
      }
    }
  }

  return true;
}

function bjResolveGame(guildId, gameId) {
  const game = db.prepare("SELECT * FROM blackjack_games WHERE game_id = ?").get(gameId);
  const players = db.prepare(
    "SELECT * FROM blackjack_players WHERE game_id = ? ORDER BY joined_at ASC"
  ).all(gameId);

  const results = players.map(player => {
    const hands = bjParse(player.hands, []);
    let best = 0;

    for (const hand of hands) {
      const value = bjHandValue(hand.cards);
      if (value <= 21 && value > best) best = value;
    }

    return {
      user_id: player.user_id,
      best,
      hands
    };
  });

  const highest = Math.max(...results.map(r => r.best), 0);
  const winners = highest > 0 ? results.filter(r => r.best === highest) : [];

  const resultTx = db.transaction(() => {
    db.prepare(`
      UPDATE blackjack_games
      SET status = 'finished',
          dealer_hand = ?,
          winners = ?,
          updated_at = ?
      WHERE game_id = ?
    `).run(JSON.stringify([]), JSON.stringify(winners.map(w => w.user_id)), Date.now(), gameId);

    if (winners.length > 0) {
      const payout = Math.floor(game.pot / winners.length);
      let paid = 0;

      for (let i = 0; i < winners.length; i++) {
        const winner = winners[i];
        const amount = i === winners.length - 1 ? game.pot - paid : payout;
        paid += amount;

        changeBalance(
          guildId,
          winner.user_id,
          amount,
          "BLACKJACK_WIN",
          `Won PvP blackjack | Game: ${gameId}`
        );
      }
    } else {
      for (const player of players) {
        changeBalance(
          guildId,
          player.user_id,
          game.buyin,
          "BLACKJACK_ALL_BUST_REFUND",
          `PvP blackjack all players bust refund | Game: ${gameId}`
        );
      }
    }
  });

  resultTx();

  const playerResults = results.map(r => {
    const handText = r.hands.map((h, i) => {
      const value = bjHandValue(h.cards);
      return `Hand ${i + 1}: ${bjCardsText(h.cards)} = ${value}${value > 21 ? " Bust" : ""}`;
    }).join(" | ");

    return `<@${r.user_id}> — Best: **${r.best || "Bust"}** — ${handText}`;
  }).join("\\n");

  const payoutText = winners.length
    ? winners.map(w => `<@${w.user_id}>`).join(", ")
    : "No winner. Everyone busted, so all buy-ins were refunded.";

  const payoutAmount = winners.length ? Math.floor(game.pot / winners.length) : game.buyin;

  return makeLogEmbed(
    winners.length ? "🏆 PvP Blackjack Finished" : "🤝 PvP Blackjack Refunded",
    `💰 **Pot:** ${game.pot.toLocaleString()} Digital Silver\\n` +
    `🥇 **Winner(s):** ${payoutText}\\n` +
    `${winners.length ? `💸 **Payout Each:** ${payoutAmount.toLocaleString()} Digital Silver\\n` : `💸 **Refund Each:** ${payoutAmount.toLocaleString()} Digital Silver\\n`}\\n` +
    `**Results:**\\n${playerResults}`,
    winners.length ? 0x00ff00 : 0x808080
  );
}

async function updateBlackjackMessage(gameId, logText = "") {
  const game = db.prepare("SELECT * FROM blackjack_games WHERE game_id = ?").get(gameId);
  if (!game || !game.message_id) return;

  try {
    const channel = await client.channels.fetch(game.channel_id);
    const msg = await channel.messages.fetch(game.message_id);

    if (game.status === "open") {
      const players = db.prepare(
        "SELECT * FROM blackjack_players WHERE game_id = ? ORDER BY joined_at ASC"
      ).all(gameId);

      await msg.edit({
        embeds: [bjLobbyEmbed(game, players)],
        components: [bjLobbyButtons(gameId)]
      });
      return;
    }

    if (game.status === "active") {
      const players = db.prepare(
        "SELECT * FROM blackjack_players WHERE game_id = ? ORDER BY joined_at ASC"
      ).all(gameId);
      const current = players[game.current_turn_index];

      await msg.edit({
        embeds: [bjGameEmbed(game, players, logText)],
        components: [bjActionButtons(gameId, current ? bjCanSplit(current) : false)]
      });
    }
  } catch (err) {
    console.error("Blackjack message update error:", err);
  }
}

async function handleBlackjackJoin(interaction) {
  const guildId = interaction.guild.id;
  if (!isBlackjackEnabled(guildId)) return interaction.reply({ content: "❌ Blackjack is currently disabled by admins.", ephemeral: true });
  const gameId = interaction.customId.replace("bj_join:", "");
  const game = db.prepare("SELECT * FROM blackjack_games WHERE game_id = ?").get(gameId);

  if (!game || game.status !== "open") {
    return interaction.reply({ content: "❌ This blackjack table is no longer open.", ephemeral: true });
  }

  const existing = db.prepare(
    "SELECT * FROM blackjack_players WHERE game_id = ? AND user_id = ?"
  ).get(gameId, interaction.user.id);

  if (existing) {
    return interaction.reply({ content: "❌ You already joined this table.", ephemeral: true });
  }

  const count = db.prepare("SELECT COUNT(*) AS count FROM blackjack_players WHERE game_id = ?").get(gameId).count;

  if (count >= MAX_BLACKJACK_PLAYERS) {
    return interaction.reply({ content: "❌ Blackjack table is full.", ephemeral: true });
  }

  if (getBal(guildId, interaction.user.id) < game.buyin) {
    return interaction.reply({ content: "❌ You do not have enough Digital Silver.", ephemeral: true });
  }

  const joinTx = db.transaction(() => {
    changeBalance(guildId, interaction.user.id, -game.buyin, "BLACKJACK_BUYIN_LOCK", `Joined blackjack | Game: ${gameId}`);

    db.prepare(`
      INSERT INTO blackjack_players
      (game_id, guild_id, user_id, hands, active_hand_index, status, joined_at)
      VALUES (?, ?, ?, ?, 0, 'playing', ?)
    `).run(gameId, guildId, interaction.user.id, JSON.stringify([]), Date.now());

    db.prepare("UPDATE blackjack_games SET pot = pot + ?, updated_at = ? WHERE game_id = ?")
      .run(game.buyin, Date.now(), gameId);
  });

  joinTx();
  await updateBlackjackMessage(gameId);

  await logCasino(
    makeLogEmbed(
      "🃏 Blackjack Player Joined",
      `👤 **Player:** ${interaction.user}\n💰 **Buy-in:** ${game.buyin.toLocaleString()} Digital Silver\n🎮 **Game:** \`${gameId}\``
    )
  );

  return interaction.reply({ content: "✅ Joined blackjack table.", ephemeral: true });
}

async function handleBlackjackLeave(interaction) {
  const guildId = interaction.guild.id;
  const gameId = interaction.customId.replace("bj_leave:", "");
  const game = db.prepare("SELECT * FROM blackjack_games WHERE game_id = ?").get(gameId);

  if (!game || game.status !== "open") {
    return interaction.reply({ content: "❌ You can only leave before the game starts.", ephemeral: true });
  }

  const player = db.prepare(
    "SELECT * FROM blackjack_players WHERE game_id = ? AND user_id = ?"
  ).get(gameId, interaction.user.id);

  if (!player) {
    return interaction.reply({ content: "❌ You are not in this table.", ephemeral: true });
  }

  if (interaction.user.id === game.host_id) {
    return interaction.reply({ content: "❌ Host cannot leave. Use Cancel.", ephemeral: true });
  }

  const leaveTx = db.transaction(() => {
    db.prepare("DELETE FROM blackjack_players WHERE game_id = ? AND user_id = ?").run(gameId, interaction.user.id);
    db.prepare("UPDATE blackjack_games SET pot = pot - ?, updated_at = ? WHERE game_id = ?").run(game.buyin, Date.now(), gameId);

    changeBalance(guildId, interaction.user.id, game.buyin, "BLACKJACK_LEAVE_REFUND", `Left blackjack refund | Game: ${gameId}`);
  });

  leaveTx();
  await updateBlackjackMessage(gameId);

  return interaction.reply({
    content: `✅ Left blackjack table. Refunded **${game.buyin.toLocaleString()} Digital Silver**.`,
    ephemeral: true
  });
}

async function handleBlackjackCancel(interaction) {
  const guildId = interaction.guild.id;
  const gameId = interaction.customId.replace("bj_cancel:", "");
  const game = db.prepare("SELECT * FROM blackjack_games WHERE game_id = ?").get(gameId);

  if (!game || game.status !== "open") {
    return interaction.reply({ content: "❌ This blackjack table cannot be cancelled now.", ephemeral: true });
  }

  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
  if (interaction.user.id !== game.host_id && !isAdmin) {
    return interaction.reply({ content: "❌ Only the host/admin can cancel this table.", ephemeral: true });
  }

  const players = db.prepare("SELECT * FROM blackjack_players WHERE game_id = ?").all(gameId);

  const cancelTx = db.transaction(() => {
    for (const player of players) {
      changeBalance(guildId, player.user_id, game.buyin, "BLACKJACK_CANCEL_REFUND", `Blackjack cancelled refund | Game: ${gameId}`);
    }

    db.prepare("UPDATE blackjack_games SET status = 'cancelled', updated_at = ? WHERE game_id = ?")
      .run(Date.now(), gameId);
  });

  cancelTx();

  const embed = makeLogEmbed(
    "🚫 Blackjack Cancelled",
    `🎮 **Game:** \`${gameId}\`\n💰 **Refunded Players:** ${players.length}\n🛡️ **Cancelled By:** ${interaction.user}`,
    0x808080
  );

  await logCasino(embed);
  return interaction.update({ embeds: [embed], components: [] });
}

async function handleBlackjackStart(interaction) {
  const guildId = interaction.guild.id;
  const gameId = interaction.customId.replace("bj_start:", "");
  const game = db.prepare("SELECT * FROM blackjack_games WHERE game_id = ?").get(gameId);

  if (!game || game.status !== "open") {
    return interaction.reply({ content: "❌ This blackjack table is not open.", ephemeral: true });
  }

  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
  if (interaction.user.id !== game.host_id && !isAdmin) {
    return interaction.reply({ content: "❌ Only the host/admin can start this game.", ephemeral: true });
  }

  const players = db.prepare(
    "SELECT * FROM blackjack_players WHERE game_id = ? ORDER BY joined_at ASC"
  ).all(gameId);

  if (players.length < 2) {
    return interaction.reply({ content: "❌ Need at least 2 players to start blackjack.", ephemeral: true });
  }

  const deck = bjCreateDeck();
  const dealerHand = [];

  const startTx = db.transaction(() => {
    for (const player of players) {
      const hand = [deck.pop(), deck.pop()];

      db.prepare(`
        UPDATE blackjack_players
        SET hands = ?,
            active_hand_index = 0,
            status = 'playing'
        WHERE game_id = ?
        AND user_id = ?
      `).run(JSON.stringify([{ cards: hand, done: false }]), gameId, player.user_id);
    }

    db.prepare(`
      UPDATE blackjack_games
      SET status = 'active',
          dealer_hand = ?,
          current_turn_index = 0,
          expires_at = ?,
          updated_at = ?
      WHERE game_id = ?
    `).run(JSON.stringify(dealerHand), Date.now() + BLACKJACK_TURN_TIMEOUT, Date.now(), gameId);
  });

  startTx();

  const updated = db.prepare("SELECT * FROM blackjack_games WHERE game_id = ?").get(gameId);
  const updatedPlayers = db.prepare("SELECT * FROM blackjack_players WHERE game_id = ? ORDER BY joined_at ASC").all(gameId);

  await logCasino(
    makeLogEmbed(
      "🃏 PvP Blackjack Started",
      `🎮 **Game:** \`${gameId}\`\n👥 **Players:** ${players.length}\n💰 **Pot:** ${game.pot.toLocaleString()} Digital Silver`
    )
  );

  return interaction.update({
    embeds: [bjGameEmbed(updated, updatedPlayers, "PvP Blackjack started! Cards are hidden. Click **View My Hand**.")],
    components: [bjActionButtons(gameId, bjCanSplit(updatedPlayers[0]))]
  });
}

async function handleBlackjackMove(interaction, move) {
  const guildId = interaction.guild.id;
  const gameId = interaction.customId.replace(`bj_${move}:`, "");
  const game = db.prepare("SELECT * FROM blackjack_games WHERE game_id = ?").get(gameId);

  if (!game || game.status !== "active") {
    return interaction.reply({ content: "❌ This blackjack game is not active.", ephemeral: true });
  }

  const players = db.prepare(
    "SELECT * FROM blackjack_players WHERE game_id = ? ORDER BY joined_at ASC"
  ).all(gameId);
  const current = players[game.current_turn_index];

  if (!current || current.user_id !== interaction.user.id) {
    return interaction.reply({ content: "❌ It is not your turn.", ephemeral: true });
  }

  let hands = bjParse(current.hands, []);
  let hand = hands[current.active_hand_index];
  let logText = "";

  if (!hand || hand.done) {
    return interaction.reply({ content: "❌ This hand is already done.", ephemeral: true });
  }

  if (move === "split") {
    if (!bjCanSplit(current)) {
      return interaction.reply({ content: "❌ You can only split when your first 2 cards have the same value.", ephemeral: true });
    }

    const first = hand.cards[0];
    const second = hand.cards[1];

    const usedCards = [];
    for (const p of players) {
      for (const h of bjParse(p.hands, [])) {
        for (const c of h.cards) usedCards.push(c.text);
      }
    }
    for (const c of bjParse(game.dealer_hand, [])) usedCards.push(c.text);

    const deck = bjCreateDeck().filter(c => !usedCards.includes(c.text));

    hands = [
      { cards: [first, deck.pop()], done: false },
      { cards: [second, deck.pop()], done: false }
    ];

    logText = `<@${interaction.user.id}> used **Split**.`;
  }

  if (move === "hit") {
    const usedCards = [];
    for (const p of players) {
      for (const h of bjParse(p.hands, [])) {
        for (const c of h.cards) usedCards.push(c.text);
      }
    }
    for (const c of bjParse(game.dealer_hand, [])) usedCards.push(c.text);

    const deck = bjCreateDeck().filter(c => !usedCards.includes(c.text));
    const card = deck.pop();

    hand.cards.push(card);

    if (bjIsBust(hand.cards)) {
      hand.done = true;
      logText = `<@${interaction.user.id}> used **Hit** and drew ${card.text}. 💥 Bust.`;
    } else {
      logText = `<@${interaction.user.id}> used **Hit** and drew ${card.text}.`;
    }

    hands[current.active_hand_index] = hand;
  }

  if (move === "stay") {
    hand.done = true;
    hands[current.active_hand_index] = hand;
    logText = `<@${interaction.user.id}> used **Stay**.`;
  }

  db.prepare(`
    UPDATE blackjack_players
    SET hands = ?
    WHERE game_id = ?
    AND user_id = ?
  `).run(JSON.stringify(hands), gameId, current.user_id);

  const allDone = bjNextTurn(gameId);

  if (allDone) {
    const embed = bjResolveGame(guildId, gameId);
    await logCasino(embed);

    return interaction.update({
      embeds: [embed],
      components: []
    });
  }

  await updateBlackjackMessage(gameId, logText);

  await interaction.deferUpdate().catch(() => {});

  const updatedPlayer = db.prepare(
    "SELECT * FROM blackjack_players WHERE game_id = ? AND user_id = ?"
  ).get(gameId, interaction.user.id);

  if (updatedPlayer) {
    await interaction.followUp({
      content: `🃏 **Your Updated Hand**\n\n${bjPrivateHandText(updatedPlayer)}`,
      ephemeral: true
    }).catch(() => {});
  }

  return;
}

async function checkExpiredBlackjackGames() {
  const now = Date.now();

  const expiredOpenGames = db.prepare(`
    SELECT *
    FROM blackjack_games
    WHERE status = 'open'
    AND expires_at IS NOT NULL
    AND expires_at <= ?
  `).all(now);

  for (const game of expiredOpenGames) {
    const players = db.prepare("SELECT * FROM blackjack_players WHERE game_id = ?").all(game.game_id);

    const expireTx = db.transaction(() => {
      const fresh = db.prepare("SELECT * FROM blackjack_games WHERE game_id = ?").get(game.game_id);
      if (!fresh || fresh.status !== "open") return;

      db.prepare("UPDATE blackjack_games SET status = 'expired', updated_at = ? WHERE game_id = ?")
        .run(Date.now(), game.game_id);

      for (const player of players) {
        changeBalance(game.guild_id, player.user_id, game.buyin, "BLACKJACK_EXPIRE_REFUND", `Blackjack lobby expired | Game: ${game.game_id}`);
      }
    });

    expireTx();

    const embed = makeLogEmbed(
      "⏰ Blackjack Expired",
      `🎮 **Game:** \`${game.game_id}\`\n💰 **Refunded Players:** ${players.length}\n\nNo start within 5 minutes.`,
      0x808080
    );

    await logCasino(embed);

    if (game.channel_id && game.message_id) {
      try {
        const channel = await client.channels.fetch(game.channel_id);
        const msg = await channel.messages.fetch(game.message_id);
        await msg.edit({ embeds: [embed], components: [] });
      } catch {}
    }
  }

  const expiredActiveGames = db.prepare(`
    SELECT *
    FROM blackjack_games
    WHERE status = 'active'
    AND expires_at IS NOT NULL
    AND expires_at <= ?
  `).all(now);

  for (const game of expiredActiveGames) {
    const players = db.prepare("SELECT * FROM blackjack_players WHERE game_id = ? ORDER BY joined_at ASC").all(game.game_id);
    const current = players[game.current_turn_index];

    if (!current) continue;

    const hands = bjParse(current.hands, []);
    const hand = hands[current.active_hand_index];

    if (hand && !hand.done) {
      hand.done = true;
      hands[current.active_hand_index] = hand;

      db.prepare("UPDATE blackjack_players SET hands = ? WHERE game_id = ? AND user_id = ?")
        .run(JSON.stringify(hands), game.game_id, current.user_id);
    }

    const allDone = bjNextTurn(game.game_id);

    if (allDone) {
      const embed = bjResolveGame(game.guild_id, game.game_id);
      await logCasino(embed);

      if (game.channel_id && game.message_id) {
        try {
          const channel = await client.channels.fetch(game.channel_id);
          const msg = await channel.messages.fetch(game.message_id);
          await msg.edit({ embeds: [embed], components: [] });
        } catch {}
      }
    } else {
      await updateBlackjackMessage(game.game_id, `<@${current.user_id}> timed out. Auto Stay.`);
    }
  }
}
// -------- Blackjack Code End -------

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith("page_")) {
        const [raw, pageRaw, ownerId, targetId] = interaction.customId.split(":");
        const parts = raw.split("_");
        const type = parts[1];
        const direction = parts[2];
        if (interaction.user.id !== ownerId) return interaction.reply({ content: "❌ Only the user who opened this page can use these buttons.", ephemeral: true });
        const oldPage = parseInt(pageRaw, 10) || 0;
        const newPage = direction === "next" ? oldPage + 1 : oldPage - 1;
        if (type === "leaderboard") {
          const data = makeLeaderboardPage(interaction.guild.id, newPage);
          return interaction.update({ embeds: [data.embed], components: [pageButtons("leaderboard", data.page, data.maxPage, ownerId)] });
        }
        if (type === "history") {
          const user = await client.users.fetch(targetId).catch(() => null);
          if (!user) return interaction.reply({ content: "❌ Could not fetch that user.", ephemeral: true });
          const data = makeHistoryPage(interaction.guild.id, user, newPage);
          return interaction.update({ embeds: [data.embed], components: [pageButtons("history", data.page, data.maxPage, ownerId, targetId)] });
        }
        if (type === "transactions") {
          const data = makeTransactionsPage(interaction.guild.id, newPage);
          return interaction.update({ embeds: [data.embed], components: [pageButtons("transactions", data.page, data.maxPage, ownerId)] });
        }
      }
      if (interaction.customId.startsWith("join_coinflip:")) {
        return handleJoinCoinflip(interaction);
      }

      if (interaction.customId.startsWith("cancel_coinflip:")) {
        return handleCancelCoinflipButton(interaction);
      }

      if (interaction.customId.startsWith("withdraw_approve:")) {
        return handleWithdrawApprove(interaction);
      }

      if (interaction.customId.startsWith("withdraw_deny:")) {
        return handleWithdrawDeny(interaction);
      }

      if (interaction.customId.startsWith("withdraw_cancel:")) {
        return handleWithdrawCancel(interaction);
      }

      if (interaction.customId.startsWith("bj_join:")) {
        return handleBlackjackJoin(interaction);
      }

      if (interaction.customId.startsWith("bj_leave:")) {
        return handleBlackjackLeave(interaction);
      }

      if (interaction.customId.startsWith("bj_start:")) {
        return handleBlackjackStart(interaction);
      }

      if (interaction.customId.startsWith("bj_cancel:")) {
        return handleBlackjackCancel(interaction);
      }

      if (interaction.customId.startsWith("bj_hit:")) {
        return handleBlackjackMove(interaction, "hit");
      }

      if (interaction.customId.startsWith("bj_stay:")) {
        return handleBlackjackMove(interaction, "stay");
      }

      if (interaction.customId.startsWith("bj_split:")) {
        return handleBlackjackMove(interaction, "split");
      }

      if (interaction.customId.startsWith("bj_view:")) {
        return handleBlackjackView(interaction);
      }

      if (interaction.customId.startsWith("raid_join:")) {
        return handleRaidJoin(interaction);
      }

      if (interaction.customId.startsWith("raid_cancel:")) {
        return handleRaidCancelButton(interaction);
      }

      if (interaction.customId.startsWith("duel_join:")) {
        return handleDuelJoin(interaction);
      }

      if (interaction.customId.startsWith("duel_cancel:")) {
        return handleDuelCancel(interaction);
      }

      if (interaction.customId.startsWith("duel_attack:")) {
        return handleDuelMove(interaction, "attack");
      }

      if (interaction.customId.startsWith("duel_defend:")) {
        return handleDuelMove(interaction, "defend");
      }

      if (interaction.customId.startsWith("duel_heavy:")) {
        return handleDuelMove(interaction, "heavy");
      }

      if (interaction.customId.startsWith("raid_attack:")) {
        return handleRaidAction(interaction, "attack");
      }

      if (interaction.customId.startsWith("raid_defend:")) {
        return handleRaidAction(interaction, "defend");
      }

      if (interaction.customId.startsWith("raid_heal:")) {
        return handleRaidAction(interaction, "heal");
      }





      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const guildId = interaction.guild.id;
    const command = interaction.commandName;

    if (command === "version") {
      return interaction.reply(`🤖 DonkBot Version: **${BOT_VERSION}**`);
    }

    if (command === "balance") {
      const user = interaction.options.getUser("user") || interaction.user;
      const balance = getBal(guildId, user.id);

      return interaction.reply(
        `💰 ${user} balance: **${balance.toLocaleString()} coins**`
      );
    }

    if (command === "rank") {
      getBal(guildId, interaction.user.id);

      const rows = db.prepare(
        "SELECT user_id, balance FROM users WHERE guild_id = ? ORDER BY balance DESC"
      ).all(guildId);

      const rank = rows.findIndex(r => r.user_id === interaction.user.id) + 1;
      const balance = getBal(guildId, interaction.user.id);

      return interaction.reply(
        `🏆 Your rank: **#${rank}**\n💰 Balance: **${balance.toLocaleString()} coins**`
      );
    }

    if (command === "leaderboard") {
      const data = makeLeaderboardPage(guildId, 0);
      return interaction.reply({ embeds: [data.embed], components: [pageButtons("leaderboard", data.page, data.maxPage, interaction.user.id)] });
    }

    if (command === "history") {
      const user = interaction.options.getUser("user") || interaction.user;
      const data = makeHistoryPage(guildId, user, 0);
      return interaction.reply({ embeds: [data.embed], components: [pageButtons("history", data.page, data.maxPage, interaction.user.id, user.id)] });
    }

    if (command === "withdraw") {
      const user = interaction.user;
      const input = interaction.options.getString("amount");
      const balance = getBal(guildId, user.id);

      const parsed = parseAmountInput(input, balance);

      if (parsed.error) {
        return interaction.reply({
          content: `❌ ${parsed.error}`,
          ephemeral: true
        });
      }

      const amount = parsed.amount;

      if (amount <= 0) {
        return interaction.reply({
          content: "❌ Withdrawal amount must be more than 0.",
          ephemeral: true
        });
      }

      if (amount < MIN_WITHDRAW) {
        return interaction.reply({
          content: `❌ Minimum withdrawal is **${MIN_WITHDRAW.toLocaleString()} coins**.`,
          ephemeral: true
        });
      }

      if (amount > balance) {
        return interaction.reply({
          content: "❌ You do not have enough balance for this withdrawal.",
          ephemeral: true
        });
      }

      const pending = db.prepare(`
        SELECT *
        FROM withdrawals
        WHERE guild_id = ?
        AND user_id = ?
        AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(guildId, user.id);

      if (pending) {
        return interaction.reply({
          content: "❌ You already have a pending withdrawal. Wait for admin approval, rejection, or cancel it first.",
          ephemeral: true
        });
      }

      const withdrawId = makeWithdrawId();
      const balanceBefore = balance;
      const balanceAfter = balance - amount;
      const fee = Math.floor((amount * WITHDRAW_FEE_PERCENT) / 100);
      const netAmount = amount - fee;

      const withdrawTx = db.transaction(() => {
        changeBalance(
          guildId,
          user.id,
          -amount,
          "WITHDRAW_LOCK",
          `Withdrawal request locked | Withdraw: ${withdrawId} | Mode: ${parsed.mode}`
        );

        db.prepare(`
          INSERT INTO withdrawals
          (withdraw_id, guild_id, channel_id, user_id, amount, balance_before, balance_after, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `).run(
          withdrawId,
          guildId,
          interaction.channel.id,
          user.id,
          amount,
          balanceBefore,
          balanceAfter,
          Date.now()
        );
      });

      withdrawTx();

      const requestEmbed = makeLogEmbed(
        "💸 Withdrawal Request",
        `**ID:** \`${withdrawId}\`\n` +
        `👤 **User:** ${user}\n` +
        `💰 **Requested Amount:** ${amount.toLocaleString()} coins\n` +
        `💸 **Fee (${WITHDRAW_FEE_PERCENT}%):** ${fee.toLocaleString()} coins\n` +
        `✅ **Net Payout:** ${netAmount.toLocaleString()} coins\n` +
        `📌 **Mode:** ${parsed.mode}\n` +
        `💳 **Balance Before:** ${balanceBefore.toLocaleString()} coins\n` +
        `💳 **Balance After Lock:** ${balanceAfter.toLocaleString()} coins\n\n` +
        `⏳ Waiting for admin approval.\n` +
        `Admins can approve or deny below.\n` +
        `Requester can cancel below.`,
        0xffcc00
      );

      const msg = await interaction.channel.send({
        embeds: [requestEmbed],
        components: [withdrawalButtons(withdrawId)]
      });

      db.prepare(
        "UPDATE withdrawals SET message_id = ? WHERE withdraw_id = ?"
      ).run(msg.id, withdrawId);

      await logToChannel(
        client,
        makeLogEmbed(
          "💸 Withdrawal Request Created",
          `👤 **User:** ${user}\n💰 **Requested:** ${amount.toLocaleString()} coins\n💸 **Fee (${WITHDRAW_FEE_PERCENT}%):** ${fee.toLocaleString()} coins\n✅ **Net Payout:** ${netAmount.toLocaleString()} coins\n💳 **Balance After Lock:** ${balanceAfter.toLocaleString()} coins\n🧵 **Channel/Post:** <#${interaction.channel.id}>\n**ID:** \`${withdrawId}\``,
          0xffcc00
        )
      );

      await interaction.reply({
        content: "✅",
        ephemeral: true
      });

      setTimeout(() => {
        interaction.deleteReply().catch(() => {});
      }, 500);

      return;
    }

    if (command === "clearwithdraw") {
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "❌ Only admins can use this.",
      ephemeral: true
    });
  }

  const user = interaction.options.getUser("user");

  const pending = db.prepare(`
    SELECT *
    FROM withdrawals
    WHERE guild_id = ?
    AND user_id = ?
    AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(guildId, user.id);

  if (!pending) {
    return interaction.reply({
      content: `❌ ${user} has no pending withdrawal.`,
      ephemeral: true
    });
  }

  const clearTx = db.transaction(() => {
    db.prepare(`
      UPDATE withdrawals
      SET status = 'cancelled',
          admin_id = ?,
          updated_at = ?
      WHERE withdraw_id = ?
      AND status = 'pending'
    `).run(interaction.user.id, Date.now(), pending.withdraw_id);

    changeBalance(
      guildId,
      user.id,
      pending.amount,
      "WITHDRAW_ADMIN_CLEAR_REFUND",
      `Pending withdrawal cleared/refunded by ${interaction.user.tag} | Withdraw: ${pending.withdraw_id}`
    );
  });

  clearTx();

  const newBalance = getBal(guildId, user.id);

  await logToChannel(
    client,
    makeLogEmbed(
      "🧹 Pending Withdrawal Cleared",
      `👤 **User:** ${user}\n` +
      `💰 **Refunded:** ${pending.amount.toLocaleString()} coins\n` +
      `💳 **New Balance:** ${newBalance.toLocaleString()} coins\n` +
      `🆔 **Withdraw ID:** \`${pending.withdraw_id}\`\n` +
      `🛡️ **Cleared By:** ${interaction.user}`,
      0x808080
    )
  );

  return interaction.reply(
    `✅ Cleared pending withdrawal for ${user}.\n` +
    `💰 Refunded **${pending.amount.toLocaleString()} coins**.\n` +
    `💳 New balance: **${newBalance.toLocaleString()} coins**`
  );
}


    if (command === "addcoins") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "❌ Only admins can use this.",
          ephemeral: true
        });
      }

      const user = interaction.options.getUser("user");
      const amount = interaction.options.getInteger("amount");

      if (amount <= 0) {
        return interaction.reply({
          content: "❌ Amount must be more than 0.",
          ephemeral: true
        });
      }

      changeBalance(
        guildId,
        user.id,
        amount,
        "ADMIN_ADD",
        `Added by ${interaction.user.tag}`
      );

      await logToChannel(
        client,
        makeLogEmbed(
          "➕ Admin Add Coins",
          `👤 **User:** ${user}\n💰 **Amount:** +${amount.toLocaleString()} coins\n💳 **New Balance:** ${getBal(guildId, user.id).toLocaleString()} coins\n🛡️ **Admin:** ${interaction.user}`
        )
      );

      return interaction.reply(
        `✅ Added **${amount.toLocaleString()} coins** to ${user}.\n` +
        `💰 New balance: **${getBal(guildId, user.id).toLocaleString()} coins**`
      );
    }

    if (command === "removecoins") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "❌ Only admins can use this.",
          ephemeral: true
        });
      }

      const user = interaction.options.getUser("user");
      const input = interaction.options.getString("amount").toLowerCase().trim();
      const balance = getBal(guildId, user.id);

      const parsed = parseAmountInput(input, balance);

      if (parsed.error) {
        return interaction.reply({
          content: `❌ ${parsed.error}`,
          ephemeral: true
        });
      }

      let removeAmount = Math.min(balance, parsed.amount);
      let removeType = parsed.mode;

      changeBalance(
        guildId,
        user.id,
        -removeAmount,
        "ADMIN_REMOVE",
        `Removed by ${interaction.user.tag} | Mode: ${removeType}`
      );

      const logTitle = removeType === "ALL" ? "☠️ Admin Removed ALL Coins" : "➖ Admin Remove Coins";

      await logToChannel(
        client,
        makeLogEmbed(
          logTitle,
          `👤 **User:** ${user}\n💰 **Removed:** ${removeAmount.toLocaleString()} coins\n📌 **Mode:** ${removeType}\n💳 **Old Balance:** ${balance.toLocaleString()} coins\n💳 **New Balance:** ${getBal(guildId, user.id).toLocaleString()} coins\n🛡️ **Admin:** ${interaction.user}`,
          removeType === "ALL" ? 0x000000 : 0xff3b3b
        )
      );

      return interaction.reply(
        `✅ Removed **${removeAmount.toLocaleString()} coins** from ${user}.\n` +
        `💰 New balance: **${getBal(guildId, user.id).toLocaleString()} coins**`
      );
    }

    if (command === "transfer") {
      const toUser = interaction.options.getUser("user");
      const amount = interaction.options.getInteger("amount");
      const fromUser = interaction.user;
      if (toUser.bot) return interaction.reply({ content: "❌ You cannot transfer Digital Silver to a bot.", ephemeral: true });
      if (amount < MIN_TRANSFER) return interaction.reply({ content: `❌ Minimum transfer is **${MIN_TRANSFER.toLocaleString()} coin**.`, ephemeral: true });
      try {
        transferBalance(guildId, fromUser.id, toUser.id, amount, "TRANSFER_SENT", "TRANSFER_RECEIVED", `Transfer ${fromUser.tag} -> ${toUser.tag}`);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      }
      const embed = makeLogEmbed("💸 User Transfer", `👤 **From:** ${fromUser}\n👤 **To:** ${toUser}\n💰 **Amount:** ${amount.toLocaleString()} Digital Silver\n💳 **Sender Balance:** ${getBal(guildId, fromUser.id).toLocaleString()} Digital Silver`, 0x00ff00);
      await logToChannel(client, embed);
      return interaction.reply({ embeds: [embed] });
    }

    if (command === "admintransfer") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Only admins can use this.", ephemeral: true });
      const fromUser = interaction.options.getUser("from");
      const toUser = interaction.options.getUser("to");
      const amount = interaction.options.getInteger("amount");
      if (amount <= 0) return interaction.reply({ content: "❌ Amount must be more than 0.", ephemeral: true });
      try {
        transferBalance(guildId, fromUser.id, toUser.id, amount, "ADMIN_TRANSFER_OUT", "ADMIN_TRANSFER_IN", `Admin transfer by ${interaction.user.tag}: ${fromUser.tag} -> ${toUser.tag}`);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
      }
      const embed = makeLogEmbed("👑 Admin Transfer", `👤 **From:** ${fromUser}\n👤 **To:** ${toUser}\n💰 **Amount:** ${amount.toLocaleString()} Digital Silver\n🛡️ **Admin:** ${interaction.user}\n💳 **From New Balance:** ${getBal(guildId, fromUser.id).toLocaleString()} Digital Silver\n💳 **To New Balance:** ${getBal(guildId, toUser.id).toLocaleString()} Digital Silver`, 0xffcc00);
      await logToChannel(client, embed);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (command === "streak") {
      const user = interaction.options.getUser("user") || interaction.user;
      const streak = getCoinflipStreak(guildId, user.id);
      return interaction.reply(`🔥 ${user} coinflip win streak: **${streak.toLocaleString()}**\n💬 **${getStreakComment(streak)}**`);
    }

    if (command === "streakboard") {
      const data = makeStreakboardPage(guildId, 0);
      return interaction.reply({ embeds: [data.embed], components: [pageButtons("streakboard", data.page, data.maxPage, interaction.user.id)] });
    }

    if (command === "duel") {
      const creator = interaction.user;
      const bet = interaction.options.getInteger("bet");
      if (bet < MIN_DUEL_BET) return interaction.reply({ content: `❌ Minimum duel bet is **${MIN_DUEL_BET.toLocaleString()} Digital Silver**.`, ephemeral: true });
      if (bet > MAX_DUEL_BET) return interaction.reply({ content: `❌ Maximum duel bet is **${MAX_DUEL_BET.toLocaleString()} Digital Silver**.`, ephemeral: true });
      const openDuel = db.prepare("SELECT * FROM duels WHERE guild_id = ? AND creator_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1").get(guildId, creator.id);
      if (openDuel) return interaction.reply({ content: "❌ You already have an open duel. Start it or cancel it first.", ephemeral: true });
      if (getBal(guildId, creator.id) < bet) return interaction.reply({ content: "❌ You do not have enough Digital Silver.", ephemeral: true });
      const duelId = makeDuelId();
      const now = Date.now();
      const createDuelTx = db.transaction(() => {
        changeBalance(guildId, creator.id, -bet, "DUEL_CREATE_LOCK", `Created duel | Duel: ${duelId}`);
        db.prepare(`INSERT INTO duels (duel_id, guild_id, channel_id, creator_id, bet, creator_hp, opponent_hp, status, created_at, last_action_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`)
          .run(duelId, guildId, interaction.channel.id, creator.id, bet, DUEL_START_HP, DUEL_START_HP, now, now, now + DUEL_LOBBY_TIMEOUT);
      });
      createDuelTx();
      const duel = db.prepare("SELECT * FROM duels WHERE duel_id = ?").get(duelId);
      const msg = await interaction.reply({ embeds: [duelOpenEmbed(duel)], components: [duelButtons(duelId)], fetchReply: true });
      db.prepare("UPDATE duels SET message_id = ? WHERE duel_id = ?").run(msg.id, duelId);
      await logCasino(makeLogEmbed("⚔️ Duel Created", `👤 **Creator:** ${creator}\n💰 **Bet:** ${bet.toLocaleString()} Digital Silver\n🎮 **Duel:** \`${duelId}\``));
      return;
    }

    if (command === "coinflipadmin") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "❌ Only admins can use this.",
          ephemeral: true
        });
      }

      const status = interaction.options.getString("status");
      const enabled = status === "enable";

      setCoinflipEnabled(guildId, enabled);

      await logToChannel(
        client,
        makeLogEmbed(
          enabled ? "✅ Coinflip Enabled" : "🛑 Coinflip Disabled",
          `🛡️ **Admin:** ${interaction.user}\n📌 **Status:** ${enabled ? "Enabled" : "Disabled"}`,
          enabled ? 0x00ff00 : 0xff0000
        )
      );

      return interaction.reply(
        enabled
          ? "✅ Coinflip has been **enabled**."
          : "🛑 Coinflip has been **disabled**."
      );
    }

    if (command === "blackjackadmin") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Only admins can use this.", ephemeral: true });
      const status = interaction.options.getString("status");
      const enabled = status === "enable";
      setBlackjackEnabled(guildId, enabled);
      await logCasino(makeLogEmbed(enabled ? "✅ Blackjack Enabled" : "🛑 Blackjack Disabled", `🛡️ **Admin:** ${interaction.user}\n📌 **Status:** ${enabled ? "Enabled" : "Disabled"}`, enabled ? 0x00ff00 : 0xff0000));
      return interaction.reply(enabled ? "✅ Blackjack has been **enabled**." : "🛑 Blackjack has been **disabled**.");
    }

    // -------- Blackjack Code -------
    if (command === "blackjack") {
      if (!isBlackjackEnabled(guildId)) return interaction.reply({ content: "❌ Blackjack is currently disabled by admins.", ephemeral: true });
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "❌ Only admins can host blackjack tables.",
          ephemeral: true
        });
      }

      const host = interaction.user;
      const buyin = interaction.options.getInteger("buyin");

      if (buyin < MIN_BLACKJACK_BUYIN) {
        return interaction.reply({
          content: `❌ Minimum blackjack buy-in is **${MIN_BLACKJACK_BUYIN.toLocaleString()} Digital Silver**.`,
          ephemeral: true
        });
      }

      if (buyin > MAX_BLACKJACK_BUYIN) {
        return interaction.reply({
          content: `❌ Maximum blackjack buy-in is **${MAX_BLACKJACK_BUYIN.toLocaleString()} Digital Silver**.`,
          ephemeral: true
        });
      }

      if (getBal(guildId, host.id) < buyin) {
        return interaction.reply({
          content: "❌ You do not have enough Digital Silver to host this blackjack table.",
          ephemeral: true
        });
      }

      const openGame = db.prepare(`
        SELECT *
        FROM blackjack_games
        WHERE guild_id = ?
        AND host_id = ?
        AND status = 'open'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(guildId, host.id);

      if (openGame) {
        return interaction.reply({
          content: "❌ You already have an open blackjack table. Start or cancel it first.",
          ephemeral: true
        });
      }

      const gameId = makeBlackjackId();
      const now = Date.now();

      const createTx = db.transaction(() => {
        changeBalance(
          guildId,
          host.id,
          -buyin,
          "BLACKJACK_BUYIN_LOCK",
          `Created blackjack table | Game: ${gameId}`
        );

        db.prepare(`
          INSERT INTO blackjack_games
          (game_id, guild_id, channel_id, host_id, buyin, status, pot, created_at, updated_at, expires_at)
          VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
        `).run(gameId, guildId, interaction.channel.id, host.id, buyin, buyin, now, now, now + BLACKJACK_LOBBY_TIMEOUT);

        db.prepare(`
          INSERT INTO blackjack_players
          (game_id, guild_id, user_id, hands, active_hand_index, status, joined_at)
          VALUES (?, ?, ?, ?, 0, 'playing', ?)
        `).run(gameId, guildId, host.id, JSON.stringify([]), now);
      });

      createTx();

      const game = db.prepare("SELECT * FROM blackjack_games WHERE game_id = ?").get(gameId);
      const players = db.prepare("SELECT * FROM blackjack_players WHERE game_id = ? ORDER BY joined_at ASC").all(gameId);

      const msg = await interaction.reply({
        embeds: [bjLobbyEmbed(game, players)],
        components: [bjLobbyButtons(gameId)],
        fetchReply: true
      });

      db.prepare("UPDATE blackjack_games SET message_id = ? WHERE game_id = ?")
        .run(msg.id, gameId);

      await logCasino(
        makeLogEmbed(
          "🃏 Blackjack Created",
          `👤 **Host/Admin:** ${host}\n💰 **Buy-in:** ${buyin.toLocaleString()} Digital Silver\n🎮 **Game:** \`${gameId}\``
        )
      );

      return;
    }
    // -------- Blackjack Code End -------

    if (command === "coinflip") {
      if (!isCoinflipEnabled(guildId)) {
        return interaction.reply({
          content: "❌ Coinflip is currently disabled by admins.",
          ephemeral: true
        });
      }

      const creator = interaction.user;
      const choice = interaction.options.getString("choice");
      const bet = interaction.options.getInteger("bet");
      

      if (bet <= 0) {
        return interaction.reply({
          content: "❌ Bet must be more than 0.",
          ephemeral: true
        });
      }

      if (bet < MIN_BET) {
  return interaction.reply({
    content: `❌ Minimum coinflip bet is **${MIN_BET.toLocaleString()} coins**.`,
    ephemeral: true
  });
}


      if (bet > MAX_BET) {
        return interaction.reply({
          content: `❌ Max bet is **${MAX_BET.toLocaleString()} coins**.`,
          ephemeral: true
        });
      }

      const existing = db.prepare(`
        SELECT *
        FROM coinflips
        WHERE guild_id = ?
        AND creator_id = ?
        AND status = 'open'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(guildId, creator.id);

      if (existing) {
        return interaction.reply({
          content: "❌ You already have an active coinflip. Cancel the old one using the red cancel button.",
          ephemeral: true
        });
      }

      if (getBal(guildId, creator.id) < bet) {
        return interaction.reply({
          content: "❌ You do not have enough coins.",
          ephemeral: true
        });
      }

      const gameId = makeGameId();

      const createTx = db.transaction(() => {
        changeBalance(
          guildId,
          creator.id,
          -bet,
          "COINFLIP_CREATE_LOCK",
          `Coinflip created | Game: ${gameId}`
        );

        db.prepare(`
          INSERT INTO coinflips
          (game_id, guild_id, channel_id, creator_id, choice, bet, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
        `).run(gameId, guildId, interaction.channel.id, creator.id, choice, bet, Date.now());
      });

      createTx();
      




      await logCasino(
        makeLogEmbed(
          "🪙 Coinflip Created",
          `👤 **Creator:** ${creator}\n🎯 **Choice:** ${choice.toUpperCase()}\n💰 **Bet Locked:** ${bet.toLocaleString()} coins\n🎮 **Game:** \`${gameId}\``
        )
      );

      const embed = new EmbedBuilder()
        .setTitle("🪙 Coinflip PvP")
        .setColor(0xff3b3b)
        .setDescription(
          `**Creator:** ${creator}\n` +
          `**Choice:** ${choice.toUpperCase()}\n` +
          `**Bet:** ${bet.toLocaleString()} coins\n\n` +
          `💰 Creator's bet is locked.\n` +
          `Waiting for opponent...\n\n` +
          `Creator can use the red cancel button to refund.`
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`join_coinflip:${gameId}`)
          .setLabel("🪙 Join Coinflip")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId(`cancel_coinflip:${gameId}`)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({
        embeds: [embed],
        components: [row]
      });

      const msg = await interaction.fetchReply();

      db.prepare(
        "UPDATE coinflips SET message_id = ? WHERE game_id = ?"
      ).run(msg.id, gameId);

      return;
    }

    if (command === "raidcancel") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "❌ Only admins can use this.",
          ephemeral: true
        });
      }

      const raid = db.prepare(`
        SELECT *
        FROM raid_bosses
        WHERE guild_id = ?
        AND status IN ('open', 'active')
        ORDER BY created_at DESC
        LIMIT 1
      `).get(guildId);

      if (!raid) {
        return interaction.reply({
          content: "❌ No open or active raid found.",
          ephemeral: true
        });
      }

      const players = db.prepare(`
        SELECT *
        FROM raid_players
        WHERE raid_id = ?
      `).all(raid.raid_id);

      const cancelTx = db.transaction(() => {
        const fresh = db.prepare(`
          SELECT *
          FROM raid_bosses
          WHERE raid_id = ?
        `).get(raid.raid_id);

        if (!fresh || !["open", "active"].includes(fresh.status)) {
          throw new Error("Raid already handled.");
        }

        db.prepare(`
          UPDATE raid_bosses
          SET status = 'cancelled',
              updated_at = ?
          WHERE raid_id = ?
          AND status IN ('open', 'active')
        `).run(Date.now(), raid.raid_id);

        for (const player of players) {
          changeBalance(
            guildId,
            player.user_id,
            raid.join_fee,
            "RAID_CANCEL_REFUND",
            `Raid cancelled by admin ${interaction.user.tag} | Raid: ${raid.raid_id}`
          );
        }
      });

      try {
        cancelTx();
      } catch (err) {
        return interaction.reply({
          content: "❌ This raid is already handled.",
          ephemeral: true
        });
      }

      const embed = makeLogEmbed(
        "🚫 Raid Boss Cancelled",
        `**Boss:** ${raid.boss_name}\n` +
        `🎮 **Raid:** \`${raid.raid_id}\`\n` +
        `🛡️ **Cancelled By:** ${interaction.user}\n` +
        `👥 **Players Refunded:** ${players.length}\n` +
        `💰 **Refund Each:** ${raid.join_fee.toLocaleString()} Digital Silver\n` +
        `💰 **Total Refunded:** ${(players.length * raid.join_fee).toLocaleString()} Digital Silver`,
        0x808080
      );

      await logCasino(embed);

      if (raid.raid_channel_id && raid.raid_message_id) {
        try {
          const channel = await client.channels.fetch(raid.raid_channel_id);
          const msg = await channel.messages.fetch(raid.raid_message_id);
          await msg.edit({ embeds: [embed], components: [] });
        } catch (err) {
          console.error("Could not update cancelled raid message:", err);
        }
      }

      if (raid.general_channel_id && raid.general_message_id) {
        try {
          const channel = await client.channels.fetch(raid.general_channel_id);
          const msg = await channel.messages.fetch(raid.general_message_id);
          await msg.edit({ embeds: [embed], components: [] });
        } catch (err) {
          console.error("Could not update cancelled general raid message:", err);
        }
      }

      return interaction.reply({
        content:
          `✅ Raid cancelled.\n` +
          `👥 Refunded **${players.length}** players.\n` +
          `💰 Total refunded: **${(players.length * raid.join_fee).toLocaleString()} Digital Silver**`,
        ephemeral: true
      });
    }

    if (command === "raidadmin") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "❌ Only admins can use this.",
          ephemeral: true
        });
      }

      const status = interaction.options.getString("status");
      const enabled = status === "enable";

      setRaidEnabled(guildId, enabled);

      await logCasino(
        makeLogEmbed(
          enabled ? "✅ Raid Boss Enabled" : "🛑 Raid Boss Disabled",
          `🛡️ **Admin:** ${interaction.user}\n📌 **Status:** ${enabled ? "Enabled" : "Disabled"}`,
          enabled ? 0x00ff00 : 0xff0000
        )
      );

      return interaction.reply(
        enabled
          ? "✅ Raid boss has been **enabled**."
          : "🛑 Raid boss has been **disabled**."
      );
    }

    if (command === "raidspawn") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "❌ Only admins can use this.",
          ephemeral: true
        });
      }

      if (!isRaidEnabled(guildId)) {
        return interaction.reply({
          content: "❌ Raid boss is disabled. Use `/raidadmin status:ENABLE` first.",
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const raid = await spawnRaidBoss(client, guildId);

      if (!raid) {
        return interaction.editReply("❌ Could not spawn raid boss. Check `RAID_GENERAL_CHANNEL_ID` and `RAID_CHANNEL_ID`.");
      }

      return interaction.editReply(`✅ Raid boss spawned in <#${process.env.RAID_GENERAL_CHANNEL_ID}>. Players continue in <#${process.env.RAID_CHANNEL_ID}>.`);
    }

    if (command === "dbstats") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "❌ Only admins can use this.",
          ephemeral: true
        });
      }

      const users = db.prepare(
        "SELECT COUNT(*) AS count FROM users WHERE guild_id = ?"
      ).get(guildId);

      const tx = db.prepare(
        "SELECT COUNT(*) AS count FROM transactions WHERE guild_id = ?"
      ).get(guildId);

      const openFlips = db.prepare(
        "SELECT COUNT(*) AS count FROM coinflips WHERE guild_id = ? AND status = 'open'"
      ).get(guildId);

      const finishedFlips = db.prepare(
        "SELECT COUNT(*) AS count FROM coinflips WHERE guild_id = ? AND status = 'finished'"
      ).get(guildId);

      const pendingWithdrawals = db.prepare(
        "SELECT COUNT(*) AS count FROM withdrawals WHERE guild_id = ? AND status = 'pending'"
      ).get(guildId);

      const activeRaids = db.prepare(
        "SELECT COUNT(*) AS count FROM raid_bosses WHERE guild_id = ? AND status IN ('open', 'active')"
      ).get(guildId);

      const activeDuels = db.prepare(
        "SELECT COUNT(*) AS count FROM duels WHERE guild_id = ? AND status IN ('open', 'active')"
      ).get(guildId);

      const totalCoins = db.prepare(
        "SELECT COALESCE(SUM(balance), 0) AS total FROM users WHERE guild_id = ?"
      ).get(guildId);

      const dbFile = db.prepare("PRAGMA database_list").all();

      const embed = new EmbedBuilder()
        .setTitle("🗄️ DonkBot Database Stats")
        .setColor(0xff3b3b)
        .setDescription(
          `👥 **Users:** ${users.count}\n` +
          `📜 **Transactions:** ${tx.count}\n` +
          `🪙 **Open Coinflips:** ${openFlips.count}\n` +
          `✅ **Finished Coinflips:** ${finishedFlips.count}\n` +
          `💸 **Pending Withdrawals:** ${pendingWithdrawals.count}\n` +
          `👹 **Active/Open Raids:** ${activeRaids.count}\n` +
          `💰 **Total Coins:** ${Number(totalCoins.total).toLocaleString()}\n` +
          `📁 **Database:** \`${dbPath}\`\n` +
          `📌 **SQLite File:** \`${dbFile[0]?.file || "unknown"}\``
        );

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (command === "allbalances") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: "❌ Only admins can use this.",
          ephemeral: true
        });
      }

      const rows = db.prepare(`
        SELECT user_id, balance
        FROM users
        WHERE guild_id = ?
        ORDER BY balance DESC
        LIMIT 50
      `).all(guildId);

      if (!rows.length) {
        return interaction.reply({
          content: "No balances found.",
          ephemeral: true
        });
      }

      const text = rows.map((r, i) =>
        `#${i + 1} | <@${r.user_id}> | ${r.balance.toLocaleString()} coins`
      ).join("\n");

      const chunks = chunkText(text);

      await interaction.reply({
        content: `📊 **All Balances - Page 1/${chunks.length}**\n\`\`\`\n${chunks[0].replace(/<@/g, "@").replace(/>/g, "")}\n\`\`\``,
        ephemeral: true
      });

      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({
          content: `📊 **All Balances - Page ${i + 1}/${chunks.length}**\n\`\`\`\n${chunks[i].replace(/<@/g, "@").replace(/>/g, "")}\n\`\`\``,
          ephemeral: true
        });
      }

      return;
    }

    if (command === "transactions") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: "❌ Only admins can use this.", ephemeral: true });
      }
      const data = makeTransactionsPage(guildId, 0);
      return interaction.reply({ embeds: [data.embed], components: [pageButtons("transactions", data.page, data.maxPage, interaction.user.id)], ephemeral: true });
    }
  } catch (err) {
    console.error("Interaction error:", err);

    return safeReply(interaction, {
      content: "❌ Something went wrong. Please tell an admin to check bot logs.",
      ephemeral: true
    });
  }
});

process.on("uncaughtException", err => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", err => {
  console.error("Unhandled Rejection:", err);
});


async function logCasino(embed, components = []) {
  try {
    const channelId = process.env.CASINO_LOG_CHANNEL;

    if (!channelId) return null;

    const channel = await client.channels.fetch(channelId);

    if (!channel || !channel.isTextBased()) return null;

    return await channel.send({
      embeds: [embed],
      components
    });
  } catch (err) {
    console.error("Casino log error:", err);
    return null;
  }
}




setInterval(checkExpiredBlackjackGames, 60_000);
setInterval(checkExpiredDuels, 60_000);
setInterval(checkRaidBosses, 60_000);

client.login(process.env.TOKEN);
