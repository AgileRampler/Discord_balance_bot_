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

const BOT_VERSION = "3.0.0";
const MAX_BET = 5_000_000;
const MIN_BET = 100_000;
const MIN_WITHDRAW = 500_000;
const WITHDRAW_FEE_PERCENT = 18;
const MIN_POKER_BUYIN = 100_000;
const MAX_POKER_BUYIN = 5_000_000;
const MAX_POKER_PLAYERS = 5;

db.pragma("journal_mode = WAL");

db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  balance INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS settings (
  guild_id TEXT PRIMARY KEY,
  coinflip_enabled INTEGER DEFAULT 1
)
`).run();

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


// -------- Poker Code -------
// Simple 5-card poker system.
// 2-5 players, fixed buy-in, auto-deal, best hand wins full pot.
db.prepare(`
CREATE TABLE IF NOT EXISTS poker_games (
  game_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  host_id TEXT NOT NULL,
  buyin INTEGER NOT NULL,
  status TEXT DEFAULT 'open',
  winner_id TEXT,
  pot INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS poker_players (
  game_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  hand TEXT,
  hand_rank INTEGER DEFAULT 0,
  hand_name TEXT,
  hand_score TEXT,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, user_id)
)
`).run();
// -------- Poker Code End -------

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


// -------- Poker Code -------
function makePokerId() {
  return `PK-${Date.now()}-${Math.floor(Math.random() * 999999)}`;
}

function createDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = [
    { name: "2", value: 2 }, { name: "3", value: 3 }, { name: "4", value: 4 },
    { name: "5", value: 5 }, { name: "6", value: 6 }, { name: "7", value: 7 },
    { name: "8", value: 8 }, { name: "9", value: 9 }, { name: "10", value: 10 },
    { name: "J", value: 11 }, { name: "Q", value: 12 }, { name: "K", value: 13 },
    { name: "A", value: 14 }
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

function evaluatePokerHand(hand) {
  const values = hand.map(c => c.value).sort((a, b) => b - a);
  const suits = hand.map(c => c.suit);
  const counts = {};

  for (const value of values) counts[value] = (counts[value] || 0) + 1;

  const groups = Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.value - a.value;
    });

  const isFlush = suits.every(s => s === suits[0]);
  const uniqueValues = [...new Set(values)].sort((a, b) => b - a);
  let straightHigh = 0;

  if (uniqueValues.length === 5) {
    if (uniqueValues[0] - uniqueValues[4] === 4) {
      straightHigh = uniqueValues[0];
    } else if (JSON.stringify(uniqueValues) === JSON.stringify([14, 5, 4, 3, 2])) {
      straightHigh = 5;
    }
  }

  const isStraight = straightHigh > 0;

  let rank = 1;
  let name = "High Card";
  let scoreValues = values;

  if (isStraight && isFlush && straightHigh === 14) {
    rank = 10; name = "Royal Flush"; scoreValues = [14];
  } else if (isStraight && isFlush) {
    rank = 9; name = "Straight Flush"; scoreValues = [straightHigh];
  } else if (groups[0].count === 4) {
    rank = 8; name = "Four of a Kind"; scoreValues = [groups[0].value, ...groups.filter(g => g.count !== 4).map(g => g.value)];
  } else if (groups[0].count === 3 && groups[1]?.count === 2) {
    rank = 7; name = "Full House"; scoreValues = [groups[0].value, groups[1].value];
  } else if (isFlush) {
    rank = 6; name = "Flush"; scoreValues = values;
  } else if (isStraight) {
    rank = 5; name = "Straight"; scoreValues = [straightHigh];
  } else if (groups[0].count === 3) {
    rank = 4; name = "Three of a Kind"; scoreValues = [groups[0].value, ...groups.filter(g => g.count !== 3).map(g => g.value)];
  } else if (groups[0].count === 2 && groups[1]?.count === 2) {
    rank = 3; name = "Two Pair"; scoreValues = [groups[0].value, groups[1].value, ...groups.filter(g => g.count === 1).map(g => g.value)];
  } else if (groups[0].count === 2) {
    rank = 2; name = "One Pair"; scoreValues = [groups[0].value, ...groups.filter(g => g.count !== 2).map(g => g.value)];
  }

  return { rank, name, score: scoreValues.join(",") };
}

function comparePokerResults(a, b) {
  if (a.rank !== b.rank) return b.rank - a.rank;

  const aScore = a.score.split(",").map(Number);
  const bScore = b.score.split(",").map(Number);

  for (let i = 0; i < Math.max(aScore.length, bScore.length); i++) {
    const av = aScore[i] || 0;
    const bv = bScore[i] || 0;
    if (av !== bv) return bv - av;
  }

  return 0;
}

function pokerButtons(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`poker_join:${gameId}`)
      .setLabel("Join Poker")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`poker_start:${gameId}`)
      .setLabel("Start Game")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`poker_leave:${gameId}`)
      .setLabel("Leave")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`poker_cancel:${gameId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
  );
}

function pokerStatusEmbed(game, players) {
  const playerList = players.length
    ? players.map((p, i) => `**${i + 1}.** <@${p.user_id}>`).join("\n")
    : "No players yet.";

  return new EmbedBuilder()
    .setTitle("🃏 5-Card Poker Table")
    .setColor(0xff3b3b)
    .setDescription(
      `**Host:** <@${game.host_id}>\n` +
      `**Buy-in:** ${game.buyin.toLocaleString()} Digital Silver\n` +
      `**Players:** ${players.length}/${MAX_POKER_PLAYERS}\n` +
      `**Prize Pool:** ${(game.buyin * players.length).toLocaleString()} Digital Silver\n\n` +
      `**Current Players:**\n${playerList}\n\n` +
      `Minimum **2 players** needed to start. Winner is decided by best 5-card poker hand.`
    );
}

async function updatePokerMessage(client, gameId) {
  const game = db.prepare("SELECT * FROM poker_games WHERE game_id = ?").get(gameId);
  if (!game || !game.message_id) return;

  const players = db.prepare(
    "SELECT * FROM poker_players WHERE game_id = ? ORDER BY joined_at ASC"
  ).all(gameId);

  try {
    const channel = await client.channels.fetch(game.channel_id);
    const msg = await channel.messages.fetch(game.message_id);

    await msg.edit({
      embeds: [pokerStatusEmbed(game, players)],
      components: game.status === "open" ? [pokerButtons(gameId)] : []
    });
  } catch (err) {
    console.error("Poker message update error:", err);
  }
}

async function handlePokerJoin(interaction) {
  const guildId = interaction.guild.id;
  const gameId = interaction.customId.replace("poker_join:", "");
  const game = db.prepare("SELECT * FROM poker_games WHERE game_id = ?").get(gameId);

  if (!game || game.status !== "open") {
    return interaction.reply({ content: "❌ This poker game is no longer open.", ephemeral: true });
  }

  const existingPlayer = db.prepare(
    "SELECT * FROM poker_players WHERE game_id = ? AND user_id = ?"
  ).get(gameId, interaction.user.id);

  if (existingPlayer) {
    return interaction.reply({ content: "❌ You already joined this poker game.", ephemeral: true });
  }

  const playerCount = db.prepare(
    "SELECT COUNT(*) AS count FROM poker_players WHERE game_id = ?"
  ).get(gameId).count;

  if (playerCount >= MAX_POKER_PLAYERS) {
    return interaction.reply({ content: "❌ Poker table is full.", ephemeral: true });
  }

  if (getBal(guildId, interaction.user.id) < game.buyin) {
    return interaction.reply({ content: "❌ You do not have enough Digital Silver to join.", ephemeral: true });
  }

  const joinTx = db.transaction(() => {
    changeBalance(guildId, interaction.user.id, -game.buyin, "POKER_BUYIN_LOCK", `Joined poker game | Game: ${gameId}`);

    db.prepare(`
      INSERT INTO poker_players
      (game_id, guild_id, user_id, joined_at)
      VALUES (?, ?, ?, ?)
    `).run(gameId, guildId, interaction.user.id, Date.now());

    db.prepare("UPDATE poker_games SET pot = pot + ?, updated_at = ? WHERE game_id = ?")
      .run(game.buyin, Date.now(), gameId);
  });

  joinTx();
  await updatePokerMessage(client, gameId);

  await logCasino(
    makeLogEmbed(
      "🃏 Poker Player Joined",
      `👤 **Player:** ${interaction.user}\n💰 **Buy-in:** ${game.buyin.toLocaleString()} Digital Silver\n🎮 **Game:** \`${gameId}\``
    )
  );

  return interaction.reply({
    content: `✅ You joined poker. Buy-in locked: **${game.buyin.toLocaleString()} Digital Silver**.`,
    ephemeral: true
  });
}

async function handlePokerLeave(interaction) {
  const guildId = interaction.guild.id;
  const gameId = interaction.customId.replace("poker_leave:", "");
  const game = db.prepare("SELECT * FROM poker_games WHERE game_id = ?").get(gameId);

  if (!game || game.status !== "open") {
    return interaction.reply({ content: "❌ This poker game is no longer open.", ephemeral: true });
  }

  const player = db.prepare(
    "SELECT * FROM poker_players WHERE game_id = ? AND user_id = ?"
  ).get(gameId, interaction.user.id);

  if (!player) {
    return interaction.reply({ content: "❌ You are not in this poker game.", ephemeral: true });
  }

  if (interaction.user.id === game.host_id) {
    return interaction.reply({ content: "❌ Host cannot leave. Use Cancel instead.", ephemeral: true });
  }

  const leaveTx = db.transaction(() => {
    db.prepare("DELETE FROM poker_players WHERE game_id = ? AND user_id = ?")
      .run(gameId, interaction.user.id);

    db.prepare("UPDATE poker_games SET pot = pot - ?, updated_at = ? WHERE game_id = ?")
      .run(game.buyin, Date.now(), gameId);

    changeBalance(guildId, interaction.user.id, game.buyin, "POKER_LEAVE_REFUND", `Left poker game refund | Game: ${gameId}`);
  });

  leaveTx();
  await updatePokerMessage(client, gameId);

  await logCasino(
    makeLogEmbed(
      "🚪 Poker Player Left",
      `👤 **Player:** ${interaction.user}\n💰 **Refunded:** ${game.buyin.toLocaleString()} Digital Silver\n🎮 **Game:** \`${gameId}\``,
      0x808080
    )
  );

  return interaction.reply({
    content: `✅ You left poker. Refunded **${game.buyin.toLocaleString()} Digital Silver**.`,
    ephemeral: true
  });
}

async function handlePokerCancel(interaction) {
  const guildId = interaction.guild.id;
  const gameId = interaction.customId.replace("poker_cancel:", "");
  const game = db.prepare("SELECT * FROM poker_games WHERE game_id = ?").get(gameId);

  if (!game || game.status !== "open") {
    return interaction.reply({ content: "❌ This poker game is no longer open.", ephemeral: true });
  }

  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
  if (interaction.user.id !== game.host_id && !isAdmin) {
    return interaction.reply({ content: "❌ Only the host or admin can cancel this poker game.", ephemeral: true });
  }

  const players = db.prepare("SELECT * FROM poker_players WHERE game_id = ?").all(gameId);

  const cancelTx = db.transaction(() => {
    for (const player of players) {
      changeBalance(guildId, player.user_id, game.buyin, "POKER_CANCEL_REFUND", `Poker game cancelled refund | Game: ${gameId}`);
    }

    db.prepare("UPDATE poker_games SET status = 'cancelled', updated_at = ? WHERE game_id = ?")
      .run(Date.now(), gameId);
  });

  cancelTx();

  const embed = makeLogEmbed(
    "🚫 Poker Cancelled",
    `🎮 **Game:** \`${gameId}\`\n💰 **Refunded Players:** ${players.length}\n🛡️ **Cancelled By:** ${interaction.user}`,
    0x808080
  );

  await interaction.update({ embeds: [embed], components: [] });
  await logCasino(embed);
  return;
}

async function handlePokerStart(interaction) {
  const guildId = interaction.guild.id;
  const gameId = interaction.customId.replace("poker_start:", "");
  const game = db.prepare("SELECT * FROM poker_games WHERE game_id = ?").get(gameId);

  if (!game || game.status !== "open") {
    return interaction.reply({ content: "❌ This poker game is no longer open.", ephemeral: true });
  }

  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
  if (interaction.user.id !== game.host_id && !isAdmin) {
    return interaction.reply({ content: "❌ Only the host or admin can start this poker game.", ephemeral: true });
  }

  const players = db.prepare(
    "SELECT * FROM poker_players WHERE game_id = ? ORDER BY joined_at ASC"
  ).all(gameId);

  if (players.length < 2) {
    return interaction.reply({ content: "❌ Need at least 2 players to start poker.", ephemeral: true });
  }

  const deck = createDeck();
  const results = [];

  for (const player of players) {
    const hand = deck.splice(0, 5);
    const result = evaluatePokerHand(hand);

    results.push({
      user_id: player.user_id,
      handText: hand.map(c => c.text).join(" "),
      rank: result.rank,
      hand_name: result.name,
      hand_score: result.score
    });
  }

  results.sort(comparePokerResults);
  const winner = results[0];
  const pot = game.buyin * players.length;

  const finishTx = db.transaction(() => {
    for (const result of results) {
      db.prepare(`
        UPDATE poker_players
        SET hand = ?, hand_rank = ?, hand_name = ?, hand_score = ?
        WHERE game_id = ? AND user_id = ?
      `).run(result.handText, result.rank, result.hand_name, result.hand_score, gameId, result.user_id);
    }

    changeBalance(guildId, winner.user_id, pot, "POKER_WIN", `Won poker game | Game: ${gameId}`);

    db.prepare(`
      UPDATE poker_games
      SET status = 'finished', winner_id = ?, pot = ?, updated_at = ?
      WHERE game_id = ?
    `).run(winner.user_id, pot, Date.now(), gameId);
  });

  finishTx();

  const resultText = results.map((r, index) =>
    `**#${index + 1}** <@${r.user_id}> — ${r.handText} — **${r.hand_name}**`
  ).join("\n");

  const embed = makeLogEmbed(
    "🏆 Poker Finished",
    `🥇 **Winner:** <@${winner.user_id}>\n` +
    `🃏 **Winning Hand:** ${winner.handText}\n` +
    `✨ **Hand Type:** ${winner.hand_name}\n` +
    `💰 **Pot Won:** ${pot.toLocaleString()} Digital Silver\n\n` +
    `**Results:**\n${resultText}`,
    0x00ff00
  );

  await interaction.update({ embeds: [embed], components: [] });
  await logCasino(embed);
  return;
}
// -------- Poker Code End -------

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
    .setName("duel")
    .setDescription("Create a skill-based PvP duel")
    .addIntegerOption(o =>
      o.setName("bet")
        .setDescription("Duel bet amount")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("poker")
    .setDescription("Create a simple 5-card poker game")
    .addIntegerOption(o =>
      o.setName("buyin")
        .setDescription("Buy-in amount")
        .setRequired(true)
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

client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag} | Version ${BOT_VERSION}`);

  client.user.setPresence({
    status: "online",
    activities: [
      {
        name: "/withdraw | /coinflip",
        type: ActivityType.Watching
      }
    ]
  });
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

  await logToChannel(
    client,
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

    logTransaction(
      guildId,
      loserId,
      "COINFLIP_LOSS",
      0,
      `Lost coinflip vs <@${winnerId}> | Game: ${gameId}`
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

  await logToChannel(
    client,
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

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isButton()) {
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

      if (interaction.customId.startsWith("poker_join:")) {
        return handlePokerJoin(interaction);
      }

      if (interaction.customId.startsWith("poker_leave:")) {
        return handlePokerLeave(interaction);
      }

      if (interaction.customId.startsWith("poker_cancel:")) {
        return handlePokerCancel(interaction);
      }

      if (interaction.customId.startsWith("poker_start:")) {
        return handlePokerStart(interaction);
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
      const rows = db.prepare(
        "SELECT user_id, balance FROM users WHERE guild_id = ? ORDER BY balance DESC LIMIT 10"
      ).all(guildId);

      if (!rows.length) return interaction.reply("No balance data found.");

      const text = rows.map((r, i) =>
        `**#${i + 1}** <@${r.user_id}> — **${r.balance.toLocaleString()} coins**`
      ).join("\n");

      const embed = new EmbedBuilder()
        .setTitle("🏆 Balance Leaderboard")
        .setDescription(text)
        .setColor(0xff3b3b);

      return interaction.reply({ embeds: [embed] });
    }

    if (command === "history") {
      const user = interaction.options.getUser("user") || interaction.user;

      const rows = db.prepare(`
        SELECT *
        FROM transactions
        WHERE guild_id = ?
        AND user_id = ?
        ORDER BY created_at DESC
        LIMIT 10
      `).all(guildId, user.id);

      if (!rows.length) {
        return interaction.reply({
          content: "No transaction history found.",
          ephemeral: true
        });
      }

      const text = rows.map(t => {
        const sign = t.amount > 0 ? "+" : "";
        return `**${t.type}** | ${sign}${t.amount.toLocaleString()} | ${t.reason || "-"}\n\`${formatDate(t.created_at)}\``;
      }).join("\n\n");

      const embed = new EmbedBuilder()
        .setTitle(`📜 ${user.username} Transaction History`)
        .setDescription(text)
        .setColor(0xff3b3b);

      return interaction.reply({ embeds: [embed] });
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

    // -------- Duel Code -------
    if (command === "duel") {
      const creator = interaction.user;
      const bet = interaction.options.getInteger("bet");

      if (bet < MIN_DUEL_BET) {
        return interaction.reply({
          content: `❌ Minimum duel bet is **${MIN_DUEL_BET.toLocaleString()} Digital Silver**.`,
          ephemeral: true
        });
      }

      if (bet > MAX_DUEL_BET) {
        return interaction.reply({
          content: `❌ Maximum duel bet is **${MAX_DUEL_BET.toLocaleString()} Digital Silver**.`,
          ephemeral: true
        });
      }

      const openDuel = db.prepare(`
        SELECT *
        FROM duels
        WHERE guild_id = ?
        AND creator_id = ?
        AND status = 'open'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(guildId, creator.id);

      if (openDuel) {
        return interaction.reply({
          content: "❌ You already have an open duel. Start or cancel it first.",
          ephemeral: true
        });
      }

      if (getBal(guildId, creator.id) < bet) {
        return interaction.reply({
          content: "❌ You do not have enough Digital Silver.",
          ephemeral: true
        });
      }

      const duelId = makeDuelId();

      const createDuelTx = db.transaction(() => {
        changeBalance(
          guildId,
          creator.id,
          -bet,
          "DUEL_CREATE_LOCK",
          `Created duel | Duel: ${duelId}`
        );

        db.prepare(`
          INSERT INTO duels
          (duel_id, guild_id, channel_id, creator_id, bet, creator_hp, opponent_hp, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)
        `).run(
          duelId,
          guildId,
          interaction.channel.id,
          creator.id,
          bet,
          DUEL_START_HP,
          DUEL_START_HP,
          Date.now()
        );
      });

      createDuelTx();

      const duel = db.prepare("SELECT * FROM duels WHERE duel_id = ?").get(duelId);

      const msg = await interaction.reply({
        embeds: [duelOpenEmbed(duel)],
        components: [duelButtons(duelId)],
        fetchReply: true
      });

      db.prepare("UPDATE duels SET message_id = ? WHERE duel_id = ?")
        .run(msg.id, duelId);

      await logCasino(
        makeLogEmbed(
          "⚔️ Duel Created",
          `👤 **Creator:** ${creator}\n` +
          `💰 **Bet:** ${bet.toLocaleString()} Digital Silver\n` +
          `🎮 **Duel:** \`${duelId}\``
        )
      );

      return;
    }
    // -------- Duel Code End -------

    // -------- Poker Code -------
    if (command === "poker") {
      const host = interaction.user;
      const buyin = interaction.options.getInteger("buyin");

      if (buyin < MIN_POKER_BUYIN) {
        return interaction.reply({
          content: `❌ Minimum poker buy-in is **${MIN_POKER_BUYIN.toLocaleString()} Digital Silver**.`,
          ephemeral: true
        });
      }

      if (buyin > MAX_POKER_BUYIN) {
        return interaction.reply({
          content: `❌ Maximum poker buy-in is **${MAX_POKER_BUYIN.toLocaleString()} Digital Silver**.`,
          ephemeral: true
        });
      }

      const openGame = db.prepare(`
        SELECT *
        FROM poker_games
        WHERE guild_id = ?
        AND host_id = ?
        AND status = 'open'
        ORDER BY created_at DESC
        LIMIT 1
      `).get(guildId, host.id);

      if (openGame) {
        return interaction.reply({
          content: "❌ You already have an open poker game. Start or cancel it first.",
          ephemeral: true
        });
      }

      if (getBal(guildId, host.id) < buyin) {
        return interaction.reply({
          content: "❌ You do not have enough Digital Silver to create this poker game.",
          ephemeral: true
        });
      }

      const gameId = makePokerId();

      const createPokerTx = db.transaction(() => {
        changeBalance(guildId, host.id, -buyin, "POKER_BUYIN_LOCK", `Created poker game | Game: ${gameId}`);

        db.prepare(`
          INSERT INTO poker_games
          (game_id, guild_id, channel_id, host_id, buyin, status, pot, created_at)
          VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
        `).run(gameId, guildId, interaction.channel.id, host.id, buyin, buyin, Date.now());

        db.prepare(`
          INSERT INTO poker_players
          (game_id, guild_id, user_id, joined_at)
          VALUES (?, ?, ?, ?)
        `).run(gameId, guildId, host.id, Date.now());
      });

      createPokerTx();

      const game = db.prepare("SELECT * FROM poker_games WHERE game_id = ?").get(gameId);
      const players = db.prepare("SELECT * FROM poker_players WHERE game_id = ? ORDER BY joined_at ASC").all(gameId);

      const msg = await interaction.reply({
        embeds: [pokerStatusEmbed(game, players)],
        components: [pokerButtons(gameId)],
        fetchReply: true
      });

      db.prepare("UPDATE poker_games SET message_id = ? WHERE game_id = ?")
        .run(msg.id, gameId);

      await logCasino(
        makeLogEmbed(
          "🃏 Poker Created",
          `👤 **Host:** ${host}\n💰 **Buy-in:** ${buyin.toLocaleString()} Digital Silver\n🎮 **Game:** \`${gameId}\``
        )
      );

      return;
    }
    // -------- Poker Code End -------

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
      




      await logToChannel(
        client,
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
        return interaction.reply({
          content: "❌ Only admins can use this.",
          ephemeral: true
        });
      }

      const rows = db.prepare(`
        SELECT *
        FROM transactions
        WHERE guild_id = ?
        ORDER BY id DESC
        LIMIT 20
      `).all(guildId);

      if (!rows.length) {
        return interaction.reply({
          content: "No transactions found.",
          ephemeral: true
        });
      }

      const text = rows.map(t =>
        `#${t.id} | ${t.type} | ${t.amount} | ${t.user_id} | ${t.reason || "-"} | ${formatDate(t.created_at)}`
      ).join("\n");

      return interaction.reply({
        content: `📜 **Latest 20 Transactions**\n\`\`\`\n${text.slice(0, 1900)}\n\`\`\``,
        ephemeral: true
      });
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


// -------- Duel Code -------
// Skill-based PvP duel system.
// 2 players, fixed bet, turn-based buttons.
// Add this code to your DonkBot index.js.

// ===== Constants =====
const MIN_DUEL_BET = 100_000;
const MAX_DUEL_BET = 1_000_000;
const DUEL_START_HP = 100;

// ===== Database Tables =====
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
  created_at INTEGER NOT NULL,
  updated_at INTEGER
)
`).run();

// ===== Helper Functions =====
function makeDuelId() {
  return `DL-${Date.now()}-${Math.floor(Math.random() * 999999)}`;
}

function duelButtons(duelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`duel_join:${duelId}`)
      .setLabel("Join Duel")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`duel_cancel:${duelId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger)
  );
}

function duelFightButtons(duelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`duel_attack:${duelId}`)
      .setLabel("Attack")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`duel_defend:${duelId}`)
      .setLabel("Defend")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`duel_heavy:${duelId}`)
      .setLabel("Heavy Attack")
      .setStyle(ButtonStyle.Danger)
  );
}

function duelOpenEmbed(duel) {
  return new EmbedBuilder()
    .setTitle("⚔️ PvP Duel Challenge")
    .setColor(0xff3b3b)
    .setDescription(
      `**Creator:** <@${duel.creator_id}>\n` +
      `**Bet:** ${duel.bet.toLocaleString()} Digital Silver\n` +
      `**Prize Pool:** ${(duel.bet * 2).toLocaleString()} Digital Silver\n\n` +
      `Waiting for an opponent...\n\n` +
      `Creator can cancel before someone joins.`
    );
}

function duelBattleEmbed(duel, logText = "") {
  return new EmbedBuilder()
    .setTitle("⚔️ PvP Duel")
    .setColor(0xff3b3b)
    .setDescription(
      `**Player 1:** <@${duel.creator_id}> ❤️ ${duel.creator_hp} HP\n` +
      `**Player 2:** <@${duel.opponent_id}> ❤️ ${duel.opponent_hp} HP\n\n` +
      `🎯 **Turn:** <@${duel.turn_user_id}>\n` +
      `💰 **Prize Pool:** ${(duel.bet * 2).toLocaleString()} Digital Silver\n\n` +
      `${logText ? `**Last Action:**\n${logText}\n\n` : ""}` +
      `Choose your move:\n` +
      `⚔️ Attack = 20 damage\n` +
      `🛡️ Defend = heal 10 HP\n` +
      `💥 Heavy Attack = 40 damage, 50% miss chance`
    );
}

function duelFinishedEmbed(duel, winnerId, loserId, logText = "") {
  return new EmbedBuilder()
    .setTitle("🏆 Duel Finished")
    .setColor(0x00ff00)
    .setDescription(
      `🥇 **Winner:** <@${winnerId}>\n` +
      `💀 **Loser:** <@${loserId}>\n` +
      `💰 **Prize Won:** ${(duel.bet * 2).toLocaleString()} Digital Silver\n\n` +
      `${logText ? `**Final Action:**\n${logText}` : ""}`
    );
}

// ===== Button Handlers =====
async function handleDuelJoin(interaction) {
  const guildId = interaction.guild.id;
  const duelId = interaction.customId.replace("duel_join:", "");

  const duel = db.prepare("SELECT * FROM duels WHERE duel_id = ?").get(duelId);

  if (!duel || duel.status !== "open") {
    return interaction.reply({
      content: "❌ This duel is no longer open.",
      ephemeral: true
    });
  }

  if (interaction.user.id === duel.creator_id) {
    return interaction.reply({
      content: "❌ You cannot join your own duel.",
      ephemeral: true
    });
  }

  if (getBal(guildId, interaction.user.id) < duel.bet) {
    return interaction.reply({
      content: "❌ You do not have enough Digital Silver to join this duel.",
      ephemeral: true
    });
  }

  const joinTx = db.transaction(() => {
    changeBalance(
      guildId,
      interaction.user.id,
      -duel.bet,
      "DUEL_JOIN_LOCK",
      `Joined duel | Duel: ${duelId}`
    );

    db.prepare(`
      UPDATE duels
      SET opponent_id = ?,
          status = 'active',
          turn_user_id = ?,
          updated_at = ?
      WHERE duel_id = ?
      AND status = 'open'
    `).run(interaction.user.id, duel.creator_id, Date.now(), duelId);
  });

  joinTx();

  const updated = db.prepare("SELECT * FROM duels WHERE duel_id = ?").get(duelId);

  await logCasino(
    makeLogEmbed(
      "⚔️ Duel Started",
      `👤 **Player 1:** <@${updated.creator_id}>\n` +
      `👤 **Player 2:** <@${updated.opponent_id}>\n` +
      `💰 **Bet:** ${updated.bet.toLocaleString()} Digital Silver\n` +
      `🎮 **Duel:** \`${duelId}\``
    )
  );

  return interaction.update({
    embeds: [duelBattleEmbed(updated, "Duel started!")],
    components: [duelFightButtons(duelId)]
  });
}

async function handleDuelCancel(interaction) {
  const guildId = interaction.guild.id;
  const duelId = interaction.customId.replace("duel_cancel:", "");

  const duel = db.prepare("SELECT * FROM duels WHERE duel_id = ?").get(duelId);

  if (!duel || duel.status !== "open") {
    return interaction.reply({
      content: "❌ This duel cannot be cancelled.",
      ephemeral: true
    });
  }

  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);

  if (interaction.user.id !== duel.creator_id && !isAdmin) {
    return interaction.reply({
      content: "❌ Only the creator or an admin can cancel this duel.",
      ephemeral: true
    });
  }

  const cancelTx = db.transaction(() => {
    db.prepare(`
      UPDATE duels
      SET status = 'cancelled',
          updated_at = ?
      WHERE duel_id = ?
      AND status = 'open'
    `).run(Date.now(), duelId);

    changeBalance(
      guildId,
      duel.creator_id,
      duel.bet,
      "DUEL_CANCEL_REFUND",
      `Duel cancelled refund | Duel: ${duelId}`
    );
  });

  cancelTx();

  const embed = makeLogEmbed(
    "🚫 Duel Cancelled",
    `👤 **Creator:** <@${duel.creator_id}>\n` +
    `💰 **Refunded:** ${duel.bet.toLocaleString()} Digital Silver\n` +
    `🎮 **Duel:** \`${duelId}\``,
    0x808080
  );

  await logCasino(embed);

  return interaction.update({
    embeds: [embed],
    components: []
  });
}

async function handleDuelMove(interaction, move) {
  const guildId = interaction.guild.id;
  const duelId = interaction.customId.replace(`duel_${move}:`, "");

  const duel = db.prepare("SELECT * FROM duels WHERE duel_id = ?").get(duelId);

  if (!duel || duel.status !== "active") {
    return interaction.reply({
      content: "❌ This duel is not active.",
      ephemeral: true
    });
  }

  if (interaction.user.id !== duel.turn_user_id) {
    return interaction.reply({
      content: "❌ It is not your turn.",
      ephemeral: true
    });
  }

  const isCreatorTurn = interaction.user.id === duel.creator_id;
  const attackerId = interaction.user.id;
  const defenderId = isCreatorTurn ? duel.opponent_id : duel.creator_id;

  let creatorHp = duel.creator_hp;
  let opponentHp = duel.opponent_hp;
  let logText = "";

  if (move === "attack") {
    const damage = 20;

    if (isCreatorTurn) opponentHp -= damage;
    else creatorHp -= damage;

    logText = `<@${attackerId}> used **Attack** and dealt **${damage} damage**.`;
  }

  if (move === "defend") {
    const heal = 10;

    if (isCreatorTurn) creatorHp = Math.min(DUEL_START_HP, creatorHp + heal);
    else opponentHp = Math.min(DUEL_START_HP, opponentHp + heal);

    logText = `<@${attackerId}> used **Defend** and healed **${heal} HP**.`;
  }

  if (move === "heavy") {
    const hit = Math.random() < 0.5;

    if (hit) {
      const damage = 40;

      if (isCreatorTurn) opponentHp -= damage;
      else creatorHp -= damage;

      logText = `<@${attackerId}> used **Heavy Attack** and dealt **${damage} damage**.`;
    } else {
      logText = `<@${attackerId}> used **Heavy Attack** but missed.`;
    }
  }

  creatorHp = Math.max(0, creatorHp);
  opponentHp = Math.max(0, opponentHp);

  let winnerId = null;
  let loserId = null;

  if (creatorHp <= 0) {
    winnerId = duel.opponent_id;
    loserId = duel.creator_id;
  } else if (opponentHp <= 0) {
    winnerId = duel.creator_id;
    loserId = duel.opponent_id;
  }

  if (winnerId) {
    const pot = duel.bet * 2;

    const finishTx = db.transaction(() => {
      db.prepare(`
        UPDATE duels
        SET creator_hp = ?,
            opponent_hp = ?,
            status = 'finished',
            winner_id = ?,
            updated_at = ?
        WHERE duel_id = ?
      `).run(creatorHp, opponentHp, winnerId, Date.now(), duelId);

      changeBalance(
        guildId,
        winnerId,
        pot,
        "DUEL_WIN",
        `Won duel vs <@${loserId}> | Duel: ${duelId}`
      );

      logTransaction(
        guildId,
        loserId,
        "DUEL_LOSS",
        0,
        `Lost duel vs <@${winnerId}> | Duel: ${duelId}`
      );
    });

    finishTx();

    const finishedDuel = {
      ...duel,
      creator_hp: creatorHp,
      opponent_hp: opponentHp
    };

    const embed = duelFinishedEmbed(finishedDuel, winnerId, loserId, logText);

    await logCasino(embed);

    return interaction.update({
      embeds: [embed],
      components: []
    });
  }

  const nextTurnUserId = isCreatorTurn ? duel.opponent_id : duel.creator_id;

  db.prepare(`
    UPDATE duels
    SET creator_hp = ?,
        opponent_hp = ?,
        turn_user_id = ?,
        updated_at = ?
    WHERE duel_id = ?
  `).run(creatorHp, opponentHp, nextTurnUserId, Date.now(), duelId);

  const updated = db.prepare("SELECT * FROM duels WHERE duel_id = ?").get(duelId);

  return interaction.update({
    embeds: [duelBattleEmbed(updated, logText)],
    components: [duelFightButtons(duelId)]
  });
}
// -------- Duel Code End -------





client.login(process.env.TOKEN);
