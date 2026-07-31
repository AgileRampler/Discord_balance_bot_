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
  ActivityType,
  MessageFlags
} = require("discord.js");

const mongoose = require("mongoose");

// ==========================================
// CONSTANTS & CONFIG
// ==========================================
const BOT_VERSION = "4.0.0";
const MAX_BET = 1_000_000;
const MIN_BET = 100_000;
const MIN_WITHDRAW = 500_000;
const WITHDRAW_FEE_PERCENT = 18;
const MIN_BLACKJACK_BUYIN = 100_000;
const MAX_BLACKJACK_BUYIN = 1_000_000;
const MAX_BLACKJACK_PLAYERS = 4;
const BLACKJACK_LOBBY_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const BLACKJACK_TURN_TIMEOUT = 2 * 60 * 1000;  // 2 minutes
const RAID_JOIN_FEE = 100_000;
const RAID_MIN_PLAYERS = 5;
const RAID_MAX_PLAYERS = 30;
const RAID_BOSS_HP = 50_000;
const RAID_JOIN_WINDOW = 10 * 60 * 1000;      // 10 minutes
const RAID_DURATION = 10 * 60 * 1000;         // 10 minutes
const RAID_ACTION_COOLDOWN = 10 * 1000;       // 10 seconds
const RAID_SPAWN_INTERVAL = 8 * 60 * 60 * 1000; // 8 hours
const MIN_TRANSFER = 1;
const MIN_DUEL_BET = 100_000;
const MAX_DUEL_BET = 1_000_000;
const DUEL_START_HP = 100;
const DUEL_LOBBY_TIMEOUT = 5 * 60 * 1000;     // 5 minutes
const DUEL_TURN_TIMEOUT = 5 * 60 * 1000;      // 5 minutes

// ==========================================
// NUMBER FORMATTING HELPER (ENFORCES 100,000 FORMAT)
// ==========================================
function formatNum(num) {
  return Number(num || 0).toLocaleString("en-US");
}

// ==========================================
// MONGOOSE SCHEMAS & MODELS
// ==========================================
const userSchema = new mongoose.Schema({
  guild_id: { type: String, required: true },
  user_id: { type: String, required: true },
  balance: { type: Number, default: 0 },
  coinflip_streak: { type: Number, default: 0 }
});
userSchema.index({ guild_id: 1, user_id: 1 }, { unique: true });
const User = mongoose.model("User", userSchema);

const settingsSchema = new mongoose.Schema({
  guild_id: { type: String, required: true, unique: true },
  coinflip_enabled: { type: Boolean, default: true },
  blackjack_enabled: { type: Boolean, default: true },
  raid_enabled: { type: Boolean, default: true }
});
const Settings = mongoose.model("Settings", settingsSchema);

const coinflipSchema = new mongoose.Schema({
  game_id: { type: String, required: true, unique: true },
  guild_id: { type: String, required: true },
  channel_id: { type: String, required: true },
  message_id: { type: String, default: null },
  creator_id: { type: String, required: true },
  choice: { type: String, required: true },
  bet: { type: Number, required: true },
  status: { type: String, default: "open" },
  created_at: { type: Number, default: Date.now }
});
const Coinflip = mongoose.model("Coinflip", coinflipSchema);

const withdrawalSchema = new mongoose.Schema({
  withdraw_id: { type: String, required: true, unique: true },
  guild_id: { type: String, required: true },
  channel_id: { type: String, required: true },
  message_id: { type: String, default: null },
  user_id: { type: String, required: true },
  amount: { type: Number, required: true },
  balance_before: { type: Number, required: true },
  balance_after: { type: Number, required: true },
  status: { type: String, default: "pending" },
  admin_id: { type: String, default: null },
  created_at: { type: Number, default: Date.now },
  updated_at: { type: Number, default: null }
});
const Withdrawal = mongoose.model("Withdrawal", withdrawalSchema);

const duelSchema = new mongoose.Schema({
  duel_id: { type: String, required: true, unique: true },
  guild_id: { type: String, required: true },
  channel_id: { type: String, required: true },
  message_id: { type: String, default: null },
  creator_id: { type: String, required: true },
  opponent_id: { type: String, default: null },
  bet: { type: Number, required: true },
  creator_hp: { type: Number, default: 100 },
  opponent_hp: { type: Number, default: 100 },
  turn_user_id: { type: String, default: null },
  status: { type: String, default: "open" },
  winner_id: { type: String, default: null },
  last_action_at: { type: Number, default: null },
  expires_at: { type: Number, default: null },
  created_at: { type: Number, default: Date.now },
  updated_at: { type: Number, default: null }
});
const Duel = mongoose.model("Duel", duelSchema);

const raidBossSchema = new mongoose.Schema({
  raid_id: { type: String, required: true, unique: true },
  guild_id: { type: String, required: true },
  general_channel_id: { type: String, default: null },
  general_message_id: { type: String, default: null },
  raid_channel_id: { type: String, required: true },
  raid_message_id: { type: String, default: null },
  boss_name: { type: String, required: true },
  boss_hp: { type: Number, required: true },
  boss_max_hp: { type: Number, required: true },
  join_fee: { type: Number, required: true },
  reward_pool: { type: Number, default: 0 },
  status: { type: String, default: "open" },
  started_at: { type: Number, default: null },
  ends_at: { type: Number, default: null },
  created_at: { type: Number, default: Date.now },
  updated_at: { type: Number, default: null }
});
const RaidBoss = mongoose.model("RaidBoss", raidBossSchema);

const raidPlayerSchema = new mongoose.Schema({
  raid_id: { type: String, required: true },
  guild_id: { type: String, required: true },
  user_id: { type: String, required: true },
  damage: { type: Number, default: 0 },
  healing: { type: Number, default: 0 },
  tanking: { type: Number, default: 0 },
  actions: { type: Number, default: 0 },
  last_action_at: { type: Number, default: 0 },
  joined_at: { type: Number, default: Date.now }
});
raidPlayerSchema.index({ raid_id: 1, user_id: 1 }, { unique: true });
const RaidPlayer = mongoose.model("RaidPlayer", raidPlayerSchema);

const blackjackGameSchema = new mongoose.Schema({
  game_id: { type: String, required: true, unique: true },
  guild_id: { type: String, required: true },
  channel_id: { type: String, required: true },
  message_id: { type: String, default: null },
  host_id: { type: String, required: true },
  buyin: { type: Number, required: true },
  status: { type: String, default: "open" },
  dealer_hand: { type: Array, default: [] },
  current_turn_index: { type: Number, default: 0 },
  pot: { type: Number, default: 0 },
  winners: { type: Array, default: [] },
  created_at: { type: Number, default: Date.now },
  updated_at: { type: Number, default: null },
  expires_at: { type: Number, default: null }
});
const BlackjackGame = mongoose.model("BlackjackGame", blackjackGameSchema);

const blackjackPlayerSchema = new mongoose.Schema({
  game_id: { type: String, required: true },
  guild_id: { type: String, required: true },
  user_id: { type: String, required: true },
  hands: { type: Array, default: [] },
  active_hand_index: { type: Number, default: 0 },
  status: { type: String, default: "playing" },
  joined_at: { type: Number, default: Date.now }
});
blackjackPlayerSchema.index({ game_id: 1, user_id: 1 }, { unique: true });
const BlackjackPlayer = mongoose.model("BlackjackPlayer", blackjackPlayerSchema);

const transactionSchema = new mongoose.Schema({
  guild_id: { type: String, required: true },
  user_id: { type: String, required: true },
  type: { type: String, required: true },
  amount: { type: Number, required: true },
  reason: { type: String, default: "" },
  created_at: { type: Number, default: Date.now }
});
const Transaction = mongoose.model("Transaction", transactionSchema);

// ==========================================
// DATABASE HELPERS
// ==========================================
async function getBal(guildId, userId) {
  let user = await User.findOne({ guild_id: guildId, user_id: userId });
  if (!user) {
    user = await User.create({ guild_id: guildId, user_id: userId, balance: 0 });
  }
  return user.balance;
}

async function addBal(guildId, userId, amount) {
  await getBal(guildId, userId);
  await User.updateOne({ guild_id: guildId, user_id: userId }, { $inc: { balance: amount } });
}

async function logTransaction(guildId, userId, type, amount, reason = "") {
  await Transaction.create({ guild_id: guildId, user_id: userId, type, amount, reason, created_at: Date.now() });
}

async function changeBalance(guildId, userId, amount, type, reason = "") {
  await addBal(guildId, userId, amount);
  await logTransaction(guildId, userId, type, amount, reason);
}

async function getCoinflipStreak(guildId, userId) {
  const user = await User.findOne({ guild_id: guildId, user_id: userId });
  return Number(user?.coinflip_streak || 0);
}

async function setCoinflipStreak(guildId, userId, streak) {
  await getBal(guildId, userId);
  await User.updateOne({ guild_id: guildId, user_id: userId }, { $set: { coinflip_streak: streak } });
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

async function transferBalance(guildId, fromUserId, toUserId, amount, sentType, receivedType, reason) {
  const fromBalance = await getBal(guildId, fromUserId);
  if (amount <= 0) throw new Error("Amount must be more than 0.");
  if (fromUserId === toUserId) throw new Error("You cannot transfer to the same user.");
  if (fromBalance < amount) throw new Error("Insufficient balance.");

  await changeBalance(guildId, fromUserId, -amount, sentType, reason);
  await changeBalance(guildId, toUserId, amount, receivedType, reason);
}

async function isCoinflipEnabled(guildId) {
  let set = await Settings.findOne({ guild_id: guildId });
  if (!set) set = await Settings.create({ guild_id: guildId, coinflip_enabled: true });
  return set.coinflip_enabled;
}

async function setCoinflipEnabled(guildId, enabled) {
  await Settings.findOneAndUpdate({ guild_id: guildId }, { $set: { coinflip_enabled: enabled } }, { upsert: true });
}

async function isBlackjackEnabled(guildId) {
  let set = await Settings.findOne({ guild_id: guildId });
  if (!set) set = await Settings.create({ guild_id: guildId, blackjack_enabled: true });
  return set.blackjack_enabled;
}

async function setBlackjackEnabled(guildId, enabled) {
  await Settings.findOneAndUpdate({ guild_id: guildId }, { $set: { blackjack_enabled: enabled } }, { upsert: true });
}

async function isRaidEnabled(guildId) {
  let set = await Settings.findOne({ guild_id: guildId });
  if (!set) set = await Settings.create({ guild_id: guildId, raid_enabled: true });
  return set.raid_enabled;
}

async function setRaidEnabled(guildId, enabled) {
  await Settings.findOneAndUpdate({ guild_id: guildId }, { $set: { raid_enabled: enabled } }, { upsert: true });
}

// ==========================================
// ECONOMY AGGREGATION CALCULATOR
// ==========================================
async function getEconomyStats(guildId) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const weekMs = 7 * dayMs;
  const monthMs = 30 * dayMs;

  async function getTotalsForPeriod(sinceTimestamp) {
    const agg = await Transaction.aggregate([
      {
        $match: {
          guild_id: guildId,
          created_at: { $gte: sinceTimestamp }
        }
      },
      {
        $group: {
          _id: null,
          added: {
            $sum: {
              $cond: [{ $gt: ["$amount", 0] }, "$amount", 0]
            }
          },
          withdrawn: {
            $sum: {
              $cond: [{ $lt: ["$amount", 0] }, { $abs: "$amount" }, 0]
            }
          }
        }
      }
    ]);

    return {
      added: agg[0]?.added || 0,
      withdrawn: agg[0]?.withdrawn || 0
    };
  }

  const daily = await getTotalsForPeriod(now - dayMs);
  const weekly = await getTotalsForPeriod(now - weekMs);
  const monthly = await getTotalsForPeriod(now - monthMs);

  const totalCirculationArr = await User.aggregate([
    { $match: { guild_id: guildId } },
    { $group: { _id: null, total: { $sum: "$balance" } } }
  ]);
  const totalCirculation = totalCirculationArr[0]?.total || 0;

  return { daily, weekly, monthly, totalCirculation };
}

// ==========================================
// UTILITY FUNCTIONS & PARSER
// ==========================================
function makeGameId() { return `${Date.now()}_${Math.floor(Math.random() * 999999)}`; }
function makeWithdrawId() { return `WD-${Date.now()}-${Math.floor(Math.random() * 999999)}`; }
function formatDate(timestamp) { return new Date(timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }); }

function safeReply(interaction, data) {
  if (interaction.replied || interaction.deferred) return interaction.followUp(data).catch(() => {});
  return interaction.reply(data).catch(() => {});
}

function chunkText(text, maxLength = 1900) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let current = "";
  for (const line of text.split("\n")) {
    if ((current + "\n" + line).length > maxLength) { chunks.push(current); current = line; }
    else { current += current ? "\n" + line : line; }
  }
  if (current) chunks.push(current);
  return chunks;
}

function parseAmountInput(input, balance = 0) {
  let raw = String(input).toLowerCase().trim();

  if (raw === "all") return { amount: balance, mode: "ALL" };

  if (raw.endsWith("%")) {
    const percent = parseFloat(raw.replace("%", ""));
    if (isNaN(percent) || percent <= 0 || percent > 100) {
      return { error: "Percentage must be between 1% and 100%. Example: `25%`" };
    }
    return { amount: Math.floor((balance * percent) / 100), mode: `${percent}%` };
  }

  let multiplier = 1;
  if (raw.endsWith("k")) {
    multiplier = 1_000;
    raw = raw.slice(0, -1);
  } else if (raw.endsWith("m")) {
    multiplier = 1_000_000;
    raw = raw.slice(0, -1);
  } else if (raw.endsWith("b")) {
    multiplier = 1_000_000_000;
    raw = raw.slice(0, -1);
  }

  const num = parseFloat(raw.replace(/,/g, ""));
  if (isNaN(num) || num <= 0) {
    return { error: "Invalid amount. Use numbers like `100000`, `100k`, `1m`, `all`, or `25%`." };
  }

  const amount = Math.floor(num * multiplier);
  return { amount, mode: "AMOUNT" };
}

function makeLogEmbed(title, description, color = 0xff3b3b) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
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

async function logCasino(client, embed, components = []) {
  try {
    const channelId = process.env.CASINO_LOG_CHANNEL;
    if (!channelId) return null;
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return null;
    return await channel.send({ embeds: [embed], components });
  } catch (err) {
    console.error("Casino log error:", err);
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

function withdrawalButtons(withdrawId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`withdraw_approve:${withdrawId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`withdraw_deny:${withdrawId}`).setLabel("Deny").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`withdraw_cancel:${withdrawId}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );
}

function pageButtons(type, page, maxPage, userId, targetId = "none") {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`page_${type}_prev:${page}:${userId}:${targetId}`).setLabel("⬅️ Back").setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`page_${type}_next:${page}:${userId}:${targetId}`).setLabel("Next ➡️").setStyle(ButtonStyle.Secondary).setDisabled(page >= maxPage)
  );
}

// ==========================================
// SEPARATE AUTO-DELETING COINFLIP NOTIFICATION (1 MINUTE)
// ==========================================
async function sendSeparateCoinflipNotification(client, guildId, creatorId, amount, choice) {
  const generalChannelId = process.env.RAID_GENERAL_CHANNEL_ID;
  const casinoChannelId = process.env.CASINO_CHANNEL_ID;

  if (!generalChannelId) {
    console.warn("⚠️ Coinflip Notification Skipped: RAID_GENERAL_CHANNEL_ID missing in .env");
    return;
  }

  try {
    const generalChannel = await client.channels.fetch(generalChannelId).catch(() => null);
    if (!generalChannel || !generalChannel.isTextBased()) {
      console.warn(`⚠️ Coinflip Notification Failed: General channel (${generalChannelId}) invalid or not text-based.`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("🎰 Live Casino Activity")
      .setColor(0x00ff99)
      .setDescription(
        `🪙 **Coinflip Challenge Open!**\n` +
        `<@${creatorId}> put up **${formatNum(amount)} Digital Silver** on **${choice.toUpperCase()}**!\n\n` +
        `💬 Want to play? ${casinoChannelId ? `Jump to <#${casinoChannelId}> to join or host your own game!` : "Head to the casino channel!"}`
      )
      .setFooter({ text: "⏱️ This notification will self-delete in 1 minute." })
      .setTimestamp();

    const components = [];
    if (casinoChannelId && guildId) {
      const casinoLink = `https://discord.com/channels/${guildId}/${casinoChannelId}`;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("🎰 Go to #casino")
          .setStyle(ButtonStyle.Link)
          .setURL(casinoLink)
      );
      components.push(row);
    }

    const sentMsg = await generalChannel.send({ embeds: [embed], components });

    setTimeout(() => {
      sentMsg.delete().catch(() => {});
    }, 60_000);

  } catch (err) {
    console.error("❌ Error sending separate coinflip notification:", err);
  }
}

// ==========================================
// PAGINATION BUILDERS
// ==========================================
async function makeLeaderboardPage(guildId, page = 0) {
  const perPage = 10;
  const total = await User.countDocuments({ guild_id: guildId });
  const maxPage = Math.max(0, Math.ceil(total / perPage) - 1);
  const safePage = Math.max(0, Math.min(page, maxPage));

  const rows = await User.find({ guild_id: guildId }).sort({ balance: -1 }).skip(safePage * perPage).limit(perPage);
  const text = rows.length
    ? rows.map((r, i) => `**#${safePage * perPage + i + 1}** <@${r.user_id}> — **${formatNum(r.balance)} coins**`).join("\n")
    : "No balance data found.";

  return {
    embed: new EmbedBuilder().setTitle("🏆 Balance Leaderboard").setDescription(text).setColor(0xff3b3b).setFooter({ text: `Page ${safePage + 1}/${maxPage + 1} • Total users: ${total}` }),
    page: safePage,
    maxPage
  };
}

async function makeHistoryPage(guildId, targetUser, page = 0) {
  const perPage = 10;
  const total = await Transaction.countDocuments({ guild_id: guildId, user_id: targetUser.id });
  const maxPage = Math.max(0, Math.ceil(total / perPage) - 1);
  const safePage = Math.max(0, Math.min(page, maxPage));

  const rows = await Transaction.find({ guild_id: guildId, user_id: targetUser.id }).sort({ created_at: -1 }).skip(safePage * perPage).limit(perPage);
  const text = rows.length ? rows.map(t => {
    const sign = t.amount > 0 ? "+" : "";
    return `**${t.type}** | ${sign}${formatNum(t.amount)} | ${t.reason || "-"}\n\`${formatDate(t.created_at)}\``;
  }).join("\n\n") : "No transaction history found.";

  return {
    embed: new EmbedBuilder().setTitle(`📜 ${targetUser.username} Transaction History`).setDescription(text).setColor(0xff3b3b).setFooter({ text: `Page ${safePage + 1}/${maxPage + 1} • Total records: ${total}` }),
    page: safePage,
    maxPage
  };
}

async function makeTransactionsPage(guildId, page = 0) {
  const perPage = 10;
  const total = await Transaction.countDocuments({ guild_id: guildId });
  const maxPage = Math.max(0, Math.ceil(total / perPage) - 1);
  const safePage = Math.max(0, Math.min(page, maxPage));

  const rows = await Transaction.find({ guild_id: guildId }).sort({ created_at: -1 }).skip(safePage * perPage).limit(perPage);
  const text = rows.length ? rows.map(t => {
    const sign = t.amount > 0 ? "+" : "";
    return `**#${t._id}** | <@${t.user_id}>\n**${t.type}** | ${sign}${formatNum(t.amount)} | ${t.reason || "-"}\n\`${formatDate(t.created_at)}\``;
  }).join("\n\n") : "No transactions found.";

  return {
    embed: new EmbedBuilder().setTitle("📋 Recent Transaction Logs").setDescription(text).setColor(0xff3b3b).setFooter({ text: `Page ${safePage + 1}/${maxPage + 1} • Total records: ${total}` }),
    page: safePage,
    maxPage
  };
}

async function makeStreakboardPage(guildId, page = 0) {
  const perPage = 10;
  const total = await User.countDocuments({ guild_id: guildId, coinflip_streak: { $gt: 0 } });
  const maxPage = Math.max(0, Math.ceil(total / perPage) - 1);
  const safePage = Math.max(0, Math.min(page, maxPage));

  const rows = await User.find({ guild_id: guildId, coinflip_streak: { $gt: 0 } }).sort({ coinflip_streak: -1 }).skip(safePage * perPage).limit(perPage);
  const text = rows.length
    ? rows.map((r, i) => `**#${safePage * perPage + i + 1}** <@${r.user_id}> — **${formatNum(r.coinflip_streak)} wins** 🔥`).join("\n")
    : "No active coinflip streaks found.";

  return {
    embed: new EmbedBuilder().setTitle("🔥 Coinflip Streak Leaderboard").setDescription(text).setColor(0xff3b3b).setFooter({ text: `Page ${safePage + 1}/${maxPage + 1} • Total streaks: ${total}` }),
    page: safePage,
    maxPage
  };
}

// ==========================================
// COMMAND DEFINITIONS
// ==========================================
const commands = [
  new SlashCommandBuilder().setName("version").setDescription("Show bot version"),
  new SlashCommandBuilder().setName("balance").setDescription("Check balance").addUserOption(o => o.setName("user").setDescription("User to check").setRequired(false)),
  new SlashCommandBuilder().setName("economy").setDescription("Show server economy flow statistics (Daily, Weekly, Monthly)"),
  new SlashCommandBuilder().setName("clearwithdraw").setDescription("Admin only: clear/refund a user's pending withdrawal").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName("user").setDescription("User whose pending withdrawal should be cleared").setRequired(true)),
  new SlashCommandBuilder().setName("discount").setDescription("Calculate discounted price").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addIntegerOption(o => o.setName("amount").setDescription("Original amount").setRequired(true)).addNumberOption(o => o.setName("discount").setDescription("Discount percentage").setRequired(true)),
  new SlashCommandBuilder().setName("rank").setDescription("Check your balance rank"),
  new SlashCommandBuilder().setName("leaderboard").setDescription("Show balance leaderboard"),
  new SlashCommandBuilder().setName("history").setDescription("Show last transactions").addUserOption(o => o.setName("user").setDescription("User to check").setRequired(false)),
  new SlashCommandBuilder().setName("withdraw").setDescription("Request a withdrawal").addStringOption(o => o.setName("amount").setDescription("Amount, all, or percentage like 25%").setRequired(true)),
  new SlashCommandBuilder().setName("addcoins").setDescription("Admin only: add coins").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName("user").setDescription("User").setRequired(true)).addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true)),
  new SlashCommandBuilder().setName("removecoins").setDescription("Admin only: remove coins").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName("user").setDescription("User").setRequired(true)).addStringOption(o => o.setName("amount").setDescription("Number, all, or percentage like 10%").setRequired(true)),
  new SlashCommandBuilder().setName("transfer").setDescription("Transfer Digital Silver to another user").addUserOption(o => o.setName("user").setDescription("User to receive coins").setRequired(true)).addIntegerOption(o => o.setName("amount").setDescription("Amount to transfer").setRequired(true)),
  new SlashCommandBuilder().setName("admintransfer").setDescription("Admin only: transfer balance from one user to another").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addUserOption(o => o.setName("from").setDescription("User to remove coins from").setRequired(true)).addUserOption(o => o.setName("to").setDescription("User to receive coins").setRequired(true)).addIntegerOption(o => o.setName("amount").setDescription("Amount to transfer").setRequired(true)),
  new SlashCommandBuilder().setName("streak").setDescription("Check coinflip win streak").addUserOption(o => o.setName("user").setDescription("User to check").setRequired(false)),
  new SlashCommandBuilder().setName("streakboard").setDescription("Show coinflip win streak leaderboard"),
  new SlashCommandBuilder().setName("duel").setDescription("Create a skill-based PvP duel").addIntegerOption(o => o.setName("bet").setDescription("Duel bet amount").setRequired(true)),
  new SlashCommandBuilder().setName("coinflip").setDescription("Create PvP coinflip").addStringOption(o => o.setName("choice").setDescription("Pick heads or tails").setRequired(true).addChoices({ name: "HEADS", value: "heads" }, { name: "TAILS", value: "tails" })).addStringOption(o => o.setName("bet").setDescription("Bet amount (e.g. 100k, 500000)").setRequired(true)),
  new SlashCommandBuilder().setName("blackjack").setDescription("Admin host: create a 4-player PvP blackjack table").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addIntegerOption(o => o.setName("buyin").setDescription("Buy-in amount").setRequired(true)),
  new SlashCommandBuilder().setName("blackjackadmin").setDescription("Admin only: enable or disable blackjack").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName("status").setDescription("Enable or disable blackjack").setRequired(true).addChoices({ name: "ENABLE", value: "enable" }, { name: "DISABLE", value: "disable" })),
  new SlashCommandBuilder().setName("coinflipadmin").setDescription("Admin only: enable or disable coinflip").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName("status").setDescription("Enable or disable coinflip").setRequired(true).addChoices({ name: "ENABLE", value: "enable" }, { name: "DISABLE", value: "disable" })),
  new SlashCommandBuilder().setName("raidspawn").setDescription("Admin only: manually spawn a raid boss").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("raidcancel").setDescription("Admin only: cancel the current open/active raid and refund players").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("raidadmin").setDescription("Admin only: enable or disable raid boss spawns").setDefaultMemberPermissions(PermissionFlagsBits.Administrator).addStringOption(o => o.setName("status").setDescription("Enable or disable raid boss").setRequired(true).addChoices({ name: "ENABLE", value: "enable" }, { name: "DISABLE", value: "disable" })),
  new SlashCommandBuilder().setName("dbstats").setDescription("Admin only: show database stats").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("allbalances").setDescription("Admin only: show top 50 balances from database").setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName("transactions").setDescription("Admin only: show latest database transactions").setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

async function registerCommands() {
  try {
    console.log("✅ Registering guild commands...");
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("✅ Commands refreshed successfully.");
  } catch (err) {
    console.error("Command register error:", err);
  }
}

// ==========================================
// RAID BOSS LOGIC
// ==========================================
function makeRaidId() { return `RAID-${Date.now()}-${Math.floor(Math.random() * 999999)}`; }

function getRaidBossName() {
  const names = ["Ancient Dragon", "Avalonian Warlord", "Crystal Behemoth", "Demon Prince", "Undead Colossus"];
  return names[Math.floor(Math.random() * names.length)];
}

function raidJoinButton(raidId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`raid_join:${raidId}`).setLabel("Join Raid").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`raid_cancel:${raidId}`).setLabel("Cancel Raid").setStyle(ButtonStyle.Danger)
  );
}

function raidActionButtons(raidId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`raid_attack:${raidId}`).setLabel("⚔️ Attack").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`raid_defend:${raidId}`).setLabel("🛡️ Defend").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`raid_heal:${raidId}`).setLabel("🩹 Heal").setStyle(ButtonStyle.Success)
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
      `**HP:** ${formatNum(raid.boss_hp)} / ${formatNum(raid.boss_max_hp)}\n` +
      `**Join Fee:** ${formatNum(raid.join_fee)} Digital Silver\n` +
      `**Players:** ${playerCount}/${RAID_MAX_PLAYERS}\n` +
      `**Minimum Required:** ${RAID_MIN_PLAYERS}\n` +
      `**Current Reward Pool:** ${formatNum(raid.reward_pool)} Digital Silver (🏆 Winner Takes All)\n` +
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
    .map(p => ({ ...p.toObject(), score: getRaidScore(p) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const leaderboard = topPlayers.length
    ? topPlayers.map((p, i) =>
        `**#${i + 1}** <@${p.user_id}> — Score: **${formatNum(Math.floor(p.score))}** | DMG ${formatNum(p.damage)} | HEAL ${formatNum(p.healing)} | TANK ${formatNum(p.tanking)}`
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
      `**Boss HP:** ${formatNum(raid.boss_hp)} / ${formatNum(raid.boss_max_hp)}\n` +
      `\`${bar}\`\n\n` +
      `**Players:** ${players.length}/${RAID_MAX_PLAYERS}\n` +
      `**Join Fee:** ${formatNum(raid.join_fee)} Digital Silver\n` +
      `🏆 **Winner-Take-All Pool:** ${formatNum(raid.reward_pool)} Digital Silver\n` +
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

async function updateRaidMessages(client, raidId, logText = "") {
  const raid = await RaidBoss.findOne({ raid_id: raidId });
  if (!raid) return;

  const players = await RaidPlayer.find({ raid_id: raidId }).sort({ joined_at: 1 });

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

  if (!generalChannelId || !raidChannelId) return null;

  const raidChannel = await client.channels.fetch(raidChannelId).catch(() => null);
  const generalChannel = await client.channels.fetch(generalChannelId).catch(() => null);

  if (!raidChannel || !generalChannel) return null;

  const guildId = manualGuildId || raidChannel.guild?.id || generalChannel.guild?.id;
  if (!guildId || !(await isRaidEnabled(guildId))) return null;

  const existing = await RaidBoss.findOne({ guild_id: guildId, status: { $in: ["open", "active"] } });
  if (existing) return existing;

  const raidId = makeRaidId();
  const now = Date.now();

  const raid = await RaidBoss.create({
    raid_id: raidId,
    guild_id: guildId,
    general_channel_id: generalChannelId,
    raid_channel_id: raidChannelId,
    boss_name: getRaidBossName(),
    boss_hp: RAID_BOSS_HP,
    boss_max_hp: RAID_BOSS_HP,
    join_fee: RAID_JOIN_FEE,
    reward_pool: 0,
    status: "open",
    created_at: now,
    updated_at: now
  });

  const generalMsg = await generalChannel.send({
    embeds: [raidGeneralEmbed(raid, 0)],
    components: [raidJoinButton(raidId)]
  });

  const raidMsg = await raidChannel.send({
    embeds: [raidStatusEmbed(raid, [], `Raid boss spawned. Join from <#${generalChannelId}>.`)],
    components: []
  });

  raid.general_message_id = generalMsg.id;
  raid.raid_message_id = raidMsg.id;
  await raid.save();

  await logCasino(
    client,
    makeLogEmbed(
      "👹 Raid Boss Spawned",
      `**Boss:** ${raid.boss_name}\n` +
      `🎮 **Raid:** \`${raidId}\`\n` +
      `📢 **Spawn Channel:** <#${generalChannelId}>\n` +
      `⚔️ **Raid Channel:** <#${raidChannelId}>\n` +
      `💰 **Join Fee:** ${formatNum(RAID_JOIN_FEE)} Digital Silver`
    )
  );

  return raid;
}

// ==========================================
// WINNER-TAKE-ALL RAID FINISH LOGIC
// ==========================================
async function finishRaidBoss(client, guildId, raidId, defeated) {
  const raid = await RaidBoss.findOne({ raid_id: raidId });
  const players = await RaidPlayer.find({ raid_id: raidId });

  if (!raid || !["active", "open"].includes(raid.status)) {
    return makeLogEmbed("Raid Already Finished", `Raid \`${raidId}\` is already handled.`, 0x808080);
  }

  const ranked = players
    .map(p => ({ ...p.toObject(), score: getRaidScore(p) }))
    .sort((a, b) => b.score - a.score);

  raid.status = defeated ? "finished" : "failed";
  raid.updated_at = Date.now();
  await raid.save();

  if (defeated && ranked.length > 0) {
    const winner = ranked[0];
    const payout = raid.reward_pool;

    if (payout > 0) {
      await changeBalance(guildId, winner.user_id, payout, "RAID_REWARD", `Raid boss winner-take-all reward | Raid: ${raidId}`);
    }
  } else {
    for (const player of players) {
      await changeBalance(guildId, player.user_id, raid.join_fee, "RAID_REFUND", `Raid failed refund | Raid: ${raidId}`);
    }
  }

  const rewardLines = ranked.length
    ? ranked.map((p, i) => {
        const isWinner = defeated && i === 0;
        const reward = isWinner ? raid.reward_pool : (defeated ? 0 : raid.join_fee);
        const crown = isWinner ? " 👑 **[WINNER TAKE ALL]**" : "";
        return `**#${i + 1}** <@${p.user_id}> — Score **${formatNum(Math.floor(p.score))}** | Reward **${formatNum(reward)} Digital Silver**${crown}`;
      }).join("\n")
    : "No players.";

  return makeLogEmbed(
    defeated ? "🏆 Raid Boss Defeated" : "❌ Raid Boss Failed",
    `**Boss:** ${raid.boss_name}\n` +
    `🎮 **Raid:** \`${raidId}\`\n` +
    `💰 **Total Pool:** ${formatNum(raid.reward_pool)} Digital Silver\n` +
    `${defeated ? `🏆 **Winner Take All:** <@${ranked[0]?.user_id}> took the entire pool!` : "Join fees refunded."}\n\n` +
    `**Final Ranking:**\n${rewardLines}`,
    defeated ? 0x00ff00 : 0xff0000
  );
}

// ==========================================
// BLACKJACK GAME LOGIC
// ==========================================
function makeBlackjackId() { return `BJ-${Date.now()}-${Math.floor(Math.random() * 999999)}`; }

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
      deck.push({ suit, rank: rank.name, value: rank.value, text: `${rank.name}${suit}` });
    }
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function bjHandValue(hand) {
  let total = 0, aces = 0;
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

function bjIsBust(hand) { return bjHandValue(hand) > 21; }

function bjCardsText(hand) {
  if (!hand || !hand.length) return "-";
  return hand.map(c => c.text).join(" ");
}

function bjLobbyButtons(gameId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bj_join:${gameId}`).setLabel("Join Blackjack").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`bj_leave:${gameId}`).setLabel("Leave").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bj_start:${gameId}`).setLabel("Start Game").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`bj_cancel:${gameId}`).setLabel("Cancel").setStyle(ButtonStyle.Danger)
  );
}

function bjActionButtons(gameId, canSplit) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`bj_hit:${gameId}`).setLabel("Hit").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`bj_stay:${gameId}`).setLabel("Stay").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`bj_split:${gameId}`).setLabel("Split").setStyle(ButtonStyle.Success).setDisabled(!canSplit),
    new ButtonBuilder().setCustomId(`bj_view:${gameId}`).setLabel("View My Hand").setStyle(ButtonStyle.Secondary)
  );
}

function bjLobbyEmbed(game, players) {
  const expireUnix = Math.floor((game.expires_at || Date.now() + BLACKJACK_LOBBY_TIMEOUT) / 1000);
  const list = players.length ? players.map((p, i) => `**${i + 1}.** <@${p.user_id}>`).join("\n") : "No players yet.";

  return new EmbedBuilder()
    .setTitle("🃏 Blackjack Table")
    .setColor(0xff3b3b)
    .setDescription(
      `**Host/Admin:** <@${game.host_id}>\n` +
      `**Buy-in:** ${formatNum(game.buyin)} Digital Silver\n` +
      `**Players:** ${players.length}/${MAX_BLACKJACK_PLAYERS}\n` +
      `**Prize Pool:** ${formatNum(game.buyin * players.length)} Digital Silver\n` +
      `⏰ **Lobby Expires:** <t:${expireUnix}:R>\n\n` +
      `**Players:**\n${list}\n\n` +
      `Minimum **2 players** required. PvP mode: highest hand wins the pot. No dealer, no pot burn.`
    );
}

function bjGameEmbed(game, players, logText = "") {
  const current = players[game.current_turn_index];
  const expireUnix = Math.floor((game.expires_at || Date.now() + BLACKJACK_TURN_TIMEOUT) / 1000);

  const playerText = players.map((p, index) => {
    const handLines = p.hands.map((h, hIndex) => {
      const marker = index === game.current_turn_index && hIndex === p.active_hand_index ? "👉 " : "";
      return `${marker}Hand ${hIndex + 1}`;
    }).join("\n");

    return `**${index + 1}. <@${p.user_id}>**\n${handLines}`;
  }).join("\n\n");

  return new EmbedBuilder()
    .setTitle("🃏 PvP Blackjack")
    .setColor(0xff3b3b)
    .setDescription(
      `**Mode:** Player vs Player — No dealer / no pot burn\n` +
      `**Pot:** ${formatNum(game.pot)} Digital Silver\n\n` +
      `${playerText}\n\n` +
      `🎯 **Turn:** ${current ? `<@${current.user_id}>` : "Resolving..."}\n` +
      `⏰ **Auto Stay:** <t:${expireUnix}:R>\n\n` +
      `${logText ? `**Last Action:**\n${logText}` : "Cards are hidden. Use **View My Hand** to see your cards."}`
    );
}

function bjCanSplit(player) {
  const hand = player.hands[player.active_hand_index];
  if (!hand || hand.done || player.hands.length >= 2 || hand.cards.length !== 2) return false;
  return hand.cards[0].value === hand.cards[1].value;
}

function bjPrivateHandText(player) {
  if (!player.hands || !player.hands.length) return "No cards dealt yet.";
  return player.hands.map((h, i) => {
    const value = bjHandValue(h.cards);
    const state = value > 21 ? "💥 Bust" : h.done ? "✅ Stayed" : "⏳ Playing";
    return `**Hand ${i + 1}:** ${bjCardsText(h.cards)} = **${value}** ${state}`;
  }).join("\n");
}

async function bjNextTurn(gameId) {
  const game = await BlackjackGame.findOne({ game_id: gameId });
  const players = await BlackjackPlayer.find({ game_id: gameId }).sort({ joined_at: 1 });

  for (let i = game.current_turn_index; i < players.length; i++) {
    const player = players[i];
    for (let h = player.active_hand_index; h < player.hands.length; h++) {
      if (!player.hands[h].done && !bjIsBust(player.hands[h].cards)) {
        game.current_turn_index = i;
        game.expires_at = Date.now() + BLACKJACK_TURN_TIMEOUT;
        game.updated_at = Date.now();
        await game.save();

        player.active_hand_index = h;
        await player.save();

        return false;
      }
    }
  }
  return true;
}

async function bjResolveGame(guildId, gameId) {
  const game = await BlackjackGame.findOne({ game_id: gameId });
  const players = await BlackjackPlayer.find({ game_id: gameId }).sort({ joined_at: 1 });

  const results = players.map(player => {
    let best = 0;
    for (const hand of player.hands) {
      const value = bjHandValue(hand.cards);
      if (value <= 21 && value > best) best = value;
    }
    return { user_id: player.user_id, best, hands: player.hands };
  });

  const highest = Math.max(...results.map(r => r.best), 0);
  const winners = highest > 0 ? results.filter(r => r.best === highest) : [];

  game.status = "finished";
  game.winners = winners.map(w => w.user_id);
  game.updated_at = Date.now();
  await game.save();

  if (winners.length > 0) {
    const payout = Math.floor(game.pot / winners.length);
    let paid = 0;
    for (let i = 0; i < winners.length; i++) {
      const winner = winners[i];
      const amount = i === winners.length - 1 ? game.pot - paid : payout;
      paid += amount;
      await changeBalance(guildId, winner.user_id, amount, "BLACKJACK_WIN", `Won PvP blackjack | Game: ${gameId}`);
    }
  } else {
    for (const player of players) {
      await changeBalance(guildId, player.user_id, game.buyin, "BLACKJACK_ALL_BUST_REFUND", `PvP blackjack all players bust refund | Game: ${gameId}`);
    }
  }

  const payoutAmount = winners.length ? Math.floor(game.pot / winners.length) : game.buyin;
  const winnersText = winners.length ? winners.map(w => `<@${w.user_id}>`).join(", ") : "No winner — everyone busted.";

  const resultLines = results.map((r, index) => {
    const handText = r.hands.map((h, i) => {
      const value = bjHandValue(h.cards);
      const bustText = value > 21 ? " 💥 Bust" : "";
      return `Hand ${i + 1}: ${bjCardsText(h.cards)} = ${value}${bustText}`;
    }).join("\n");

    return `**#${index + 1} <@${r.user_id}>**\nBest: **${r.best || "Bust"}**\n${handText}`;
  }).join("\n\n");

  return new EmbedBuilder()
    .setTitle(winners.length ? "🏆 PvP Blackjack Finished" : "🤝 PvP Blackjack Refunded")
    .setColor(winners.length ? 0x00ff00 : 0x808080)
    .addFields(
      { name: "💰 Pot", value: `${formatNum(game.pot)} Digital Silver`, inline: true },
      { name: winners.length ? "🥇 Winner(s)" : "🤝 Refund", value: winners.length ? winnersText : "Everyone busted, buy-ins refunded.", inline: true },
      { name: winners.length ? "💸 Payout Each" : "💸 Refund Each", value: `${formatNum(payoutAmount)} Digital Silver`, inline: true },
      { name: "📋 Final Results", value: resultLines.slice(0, 3900) }
    )
    .setTimestamp();
}

async function updateBlackjackMessage(client, gameId, logText = "") {
  const game = await BlackjackGame.findOne({ game_id: gameId });
  if (!game || !game.message_id) return;

  try {
    const channel = await client.channels.fetch(game.channel_id);
    const msg = await channel.messages.fetch(game.message_id);

    if (game.status === "open") {
      const players = await BlackjackPlayer.find({ game_id: gameId }).sort({ joined_at: 1 });
      await msg.edit({ embeds: [bjLobbyEmbed(game, players)], components: [bjLobbyButtons(gameId)] });
      return;
    }

    if (game.status === "active") {
      const players = await BlackjackPlayer.find({ game_id: gameId }).sort({ joined_at: 1 });
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

// ==========================================
// DUEL HELPERS & EMBEDS
// ==========================================
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
    `**Bet:** ${formatNum(duel.bet)} Digital Silver\n` +
    `**Prize Pool:** ${formatNum(duel.bet * 2)} Digital Silver\n` +
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
    `💰 **Prize Pool:** ${formatNum(duel.bet * 2)} Digital Silver\n\n` +
    `${logText ? `**Last Action:**\n${logText}\n\n` : ""}` +
    `Choose your move:\n⚔️ Attack = 20 damage\n🛡️ Defend = heal 10 HP\n💥 Heavy Attack = 40 damage, 50% miss chance`
  );
}

function duelFinishedEmbed(duel, winnerId, loserId, logText = "") {
  return new EmbedBuilder().setTitle("🏆 Duel Finished").setColor(0x00ff00).setDescription(
    `🥇 **Winner:** <@${winnerId}>\n💀 **Loser:** <@${loserId}>\n` +
    `💰 **Prize Won:** ${formatNum(duel.bet * 2)} Digital Silver\n\n` +
    `${logText ? `**Final Action:**\n${logText}` : ""}`
  );
}

// ==========================================
// TIMED / EXPIRATION JOBS
// ==========================================
async function expireOldCoinflips(client) {
  const expireBefore = Date.now() - 10 * 60 * 1000;
  const oldGames = await Coinflip.find({ status: "open", created_at: { $lt: expireBefore } });

  for (const game of oldGames) {
    game.status = "expired";
    await game.save();
    await changeBalance(game.guild_id, game.creator_id, game.bet, "COINFLIP_REFUND", `Coinflip expired refund | Game: ${game.game_id}`);
  }
}

async function checkExpiredBlackjackGames(client) {
  const now = Date.now();
  const expiredOpenGames = await BlackjackGame.find({ status: "open", expires_at: { $lte: now } });

  for (const game of expiredOpenGames) {
    const players = await BlackjackPlayer.find({ game_id: game.game_id });
    game.status = "expired";
    game.updated_at = now;
    await game.save();

    for (const player of players) {
      await changeBalance(game.guild_id, player.user_id, game.buyin, "BLACKJACK_EXPIRE_REFUND", `Blackjack lobby expired | Game: ${game.game_id}`);
    }

    const embed = makeLogEmbed("⏰ Blackjack Expired", `🎮 **Game:** \`${game.game_id}\`\n💰 **Refunded Players:** ${players.length}\n\nNo start within 5 minutes.`, 0x808080);
    await logCasino(client, embed);

    if (game.channel_id && game.message_id) {
      try {
        const channel = await client.channels.fetch(game.channel_id);
        const msg = await channel.messages.fetch(game.message_id);
        await msg.edit({ embeds: [embed], components: [] });
      } catch {}
    }
  }

  const expiredActiveGames = await BlackjackGame.find({ status: "active", expires_at: { $lte: now } });
  for (const game of expiredActiveGames) {
    const players = await BlackjackPlayer.find({ game_id: game.game_id }).sort({ joined_at: 1 });
    const current = players[game.current_turn_index];
    if (!current) continue;

    const hand = current.hands[current.active_hand_index];
    if (hand && !hand.done) {
      hand.done = true;
      current.markModified("hands");
      await current.save();
    }

    const allDone = await bjNextTurn(game.game_id);
    if (allDone) {
      const embed = await bjResolveGame(game.guild_id, game.game_id);
      await logCasino(client, embed);

      if (game.channel_id && game.message_id) {
        try {
          const channel = await client.channels.fetch(game.channel_id);
          const msg = await channel.messages.fetch(game.message_id);
          await msg.edit({ embeds: [embed], components: [] });
        } catch {}
      }
    } else {
      await updateBlackjackMessage(client, game.game_id, `<@${current.user_id}> timed out. Auto Stay.`);
    }
  }
}

async function checkExpiredDuels(client) {
  const now = Date.now();
  const expiredOpenDuels = await Duel.find({ status: "open", expires_at: { $lte: now } });

  for (const duel of expiredOpenDuels) {
    duel.status = "expired";
    duel.updated_at = now;
    await duel.save();

    await changeBalance(duel.guild_id, duel.creator_id, duel.bet, "DUEL_LOBBY_TIMEOUT_REFUND", `Duel expired because no one joined | Duel: ${duel.duel_id}`);
    const embed = makeLogEmbed("⏰ Duel Expired", `👤 **Creator:** <@${duel.creator_id}>\n💰 **Refunded:** ${formatNum(duel.bet)} Digital Silver\n🎮 **Duel:** \`${duel.duel_id}\`\n\nNo opponent joined within 5 minutes.`, 0x808080);
    await logCasino(client, embed);

    if (duel.channel_id && duel.message_id) {
      try {
        const channel = await client.channels.fetch(duel.channel_id);
        const msg = await channel.messages.fetch(duel.message_id);
        await msg.edit({ embeds: [embed], components: [] });
      } catch {}
    }
  }

  const expiredActiveDuels = await Duel.find({ status: "active", expires_at: { $lte: now } });
  for (const duel of expiredActiveDuels) {
    const loserId = duel.turn_user_id;
    const winnerId = loserId === duel.creator_id ? duel.opponent_id : duel.creator_id;
    const pot = duel.bet * 2;
    if (!winnerId || !loserId) continue;

    duel.status = "finished";
    duel.winner_id = winnerId;
    duel.updated_at = now;
    await duel.save();

    await changeBalance(duel.guild_id, winnerId, pot, "DUEL_TIMEOUT_WIN", `Won duel by opponent timeout | Duel: ${duel.duel_id}`);
    await logTransaction(duel.guild_id, loserId, "DUEL_TIMEOUT_LOSS", 0, `Lost duel by not responding in time | Duel: ${duel.duel_id}`);

    const embed = makeLogEmbed("⏰ Duel Forfeit", `🥇 **Winner:** <@${winnerId}>\n💀 **Loser:** <@${loserId}>\n💰 **Prize Won:** ${formatNum(pot)} Digital Silver\n🎮 **Duel:** \`${duel.duel_id}\`\n\n<@${loserId}> did not respond within 5 minutes.`, 0xff0000);
    await logCasino(client, embed);

    if (duel.channel_id && duel.message_id) {
      try {
        const channel = await client.channels.fetch(duel.channel_id);
        const msg = await channel.messages.fetch(duel.message_id);
        await msg.edit({ embeds: [embed], components: [] });
      } catch {}
    }
  }
}

async function checkRaidBosses(client) {
  const now = Date.now();
  const expiredOpen = await RaidBoss.find({ status: "open", created_at: { $lte: now - RAID_JOIN_WINDOW } });

  for (const raid of expiredOpen) {
    const playerCount = await RaidPlayer.countDocuments({ raid_id: raid.raid_id });
    if (playerCount < RAID_MIN_PLAYERS) {
      const embed = await finishRaidBoss(client, raid.guild_id, raid.raid_id, false);
      await logCasino(client, embed);

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

  const expiredActive = await RaidBoss.find({ status: "active", ends_at: { $lte: now } });
  for (const raid of expiredActive) {
    const defeated = raid.boss_hp <= 0;
    const embed = await finishRaidBoss(client, raid.guild_id, raid.raid_id, defeated);
    await logCasino(client, embed);

    try {
      const channel = await client.channels.fetch(raid.raid_channel_id);
      const msg = await channel.messages.fetch(raid.raid_message_id);
      await msg.edit({ embeds: [embed], components: [] });
    } catch {}
  }
}

// ==========================================
// DISCORD CLIENT INIT & EVENT HANDLERS
// ==========================================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// RESOLVED DEPRECATION: Using clientReady event name for v14/v15
client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag} | Version ${BOT_VERSION}`);

  client.user.setPresence({
    status: "online",
    activities: [{ name: "/withdraw | /coinflip | /blackjack", type: ActivityType.Watching }]
  });

  await registerCommands();

  setInterval(() => spawnRaidBoss(client).catch(err => console.error("Auto raid spawn error:", err)), RAID_SPAWN_INTERVAL);
  setInterval(() => expireOldCoinflips(client), 60_000);
  setInterval(() => checkExpiredBlackjackGames(client), 60_000);
  setInterval(() => checkExpiredDuels(client), 60_000);
  setInterval(() => checkRaidBosses(client), 60_000);
});

// ==========================================
// BUTTON INTERACTION HANDLERS
// ==========================================
async function handleWithdrawApprove(interaction) {
  const guildId = interaction.guild.id;
  const withdrawId = interaction.customId.replace("withdraw_approve:", "");

  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "❌ Only admins can approve withdrawals.", flags: MessageFlags.Ephemeral });
  }

  const request = await Withdrawal.findOne({ withdraw_id: withdrawId, status: "pending" });
  if (!request) return interaction.reply({ content: "❌ This withdrawal is no longer pending.", flags: MessageFlags.Ephemeral });

  request.status = "approved";
  request.admin_id = interaction.user.id;
  request.updated_at = Date.now();
  await request.save();

  await logTransaction(guildId, request.user_id, "WITHDRAW_APPROVED", 0, `Approved by ${interaction.user.tag} | Withdraw: ${withdrawId}`);

  const fee = Math.floor((request.amount * WITHDRAW_FEE_PERCENT) / 100);
  const netAmount = request.amount - fee;

  const embed = makeLogEmbed(
    "✅ Withdrawal Successful",
    `**ID:** \`${withdrawId}\`\n` +
    `👤 **User:** <@${request.user_id}>\n` +
    `💰 **Requested Amount:** ${formatNum(request.amount)} coins\n` +
    `💸 **Fee (${WITHDRAW_FEE_PERCENT}%):** ${formatNum(fee)} coins\n` +
    `✅ **Net Payout:** ${formatNum(netAmount)} coins\n` +
    `💳 **Balance Before:** ${formatNum(request.balance_before)} coins\n` +
    `💳 **Balance After:** ${formatNum(request.balance_after)} coins\n\n` +
    `Withdrawal has been verified by Admin.\n` +
    `🛡️ **Approved By:** ${interaction.user}`,
    0x00ff00
  );

  await interaction.update({ embeds: [embed], components: [] });
  await interaction.channel.send(`✅ <@${request.user_id}> your withdrawal has been **approved** by ${interaction.user}. Net payout: **${formatNum(netAmount)} coins** after ${WITHDRAW_FEE_PERCENT}% fee.`).catch(() => {});
  await notifyUser(client, request.user_id, `✅ Your withdrawal was approved.\nRequested: ${formatNum(request.amount)} coins\nFee (${WITHDRAW_FEE_PERCENT}%): ${formatNum(fee)} coins\nNet Payout: ${formatNum(netAmount)} coins\nApproved by: ${interaction.user.tag}`);
  await logToChannel(client, embed);
}

async function handleWithdrawDeny(interaction) {
  const guildId = interaction.guild.id;
  const withdrawId = interaction.customId.replace("withdraw_deny:", "");

  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "❌ Only admins can deny withdrawals.", flags: MessageFlags.Ephemeral });
  }

  const request = await Withdrawal.findOne({ withdraw_id: withdrawId, status: "pending" });
  if (!request) return interaction.reply({ content: "❌ This withdrawal is no longer pending.", flags: MessageFlags.Ephemeral });

  request.status = "denied";
  request.admin_id = interaction.user.id;
  request.updated_at = Date.now();
  await request.save();

  await changeBalance(guildId, request.user_id, request.amount, "WITHDRAW_REFUND", `Withdrawal denied refund by ${interaction.user.tag} | Withdraw: ${withdrawId}`);
  const newBalance = await getBal(guildId, request.user_id);

  const embed = makeLogEmbed(
    "❌ Withdrawal Rejected",
    `**ID:** \`${withdrawId}\`\n` +
    `👤 **User:** <@${request.user_id}>\n` +
    `💰 **Refunded:** ${formatNum(request.amount)} coins\n` +
    `💳 **Current Balance:** ${formatNum(newBalance)} coins\n\n` +
    `Withdrawal has been rejected by Admin and refunded.\n` +
    `🛡️ **Rejected By:** ${interaction.user}`,
    0xff0000
  );

  await interaction.update({ embeds: [embed], components: [] });
  await interaction.channel.send(`❌ <@${request.user_id}> your withdrawal of **${formatNum(request.amount)} coins** was **rejected** by ${interaction.user}. The amount has been refunded.`).catch(() => {});
  await notifyUser(client, request.user_id, `❌ Your withdrawal was rejected and refunded.\nAmount: ${formatNum(request.amount)} coins\nRejected by: ${interaction.user.tag}`);
  await logToChannel(client, embed);
}

async function handleWithdrawCancel(interaction) {
  const guildId = interaction.guild.id;
  const withdrawId = interaction.customId.replace("withdraw_cancel:", "");

  const request = await Withdrawal.findOne({ withdraw_id: withdrawId, status: "pending" });
  if (!request) return interaction.reply({ content: "❌ This withdrawal is no longer pending.", flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== request.user_id) return interaction.reply({ content: "❌ Only the withdrawal requester can cancel this request.", flags: MessageFlags.Ephemeral });

  request.status = "cancelled";
  request.updated_at = Date.now();
  await request.save();

  await changeBalance(guildId, request.user_id, request.amount, "WITHDRAW_CANCEL_REFUND", `Withdrawal cancelled by user | Withdraw: ${withdrawId}`);
  const newBalance = await getBal(guildId, request.user_id);

  const embed = makeLogEmbed(
    "🚫 Withdrawal Cancelled",
    `**ID:** \`${withdrawId}\`\n` +
    `👤 **User:** <@${request.user_id}>\n` +
    `💰 **Refunded:** ${formatNum(request.amount)} coins\n` +
    `💳 **Current Balance:** ${formatNum(newBalance)} coins\n\n` +
    `Withdrawal was cancelled by the requester.`,
    0x808080
  );

  await interaction.update({ embeds: [embed], components: [] });
  await interaction.channel.send(`🚫 <@${request.user_id}> cancelled their withdrawal request. **${formatNum(request.amount)} coins** refunded.`).catch(() => {});
  await logToChannel(client, embed);
}

async function handleCancelCoinflipButton(interaction) {
  const guildId = interaction.guild.id;
  const gameId = interaction.customId.replace("cancel_coinflip:", "");

  const game = await Coinflip.findOne({ game_id: gameId, status: "open" });
  if (!game) return interaction.reply({ content: "❌ This coinflip is no longer active.", flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== game.creator_id) return interaction.reply({ content: "❌ Only the coinflip creator can cancel this game.", flags: MessageFlags.Ephemeral });

  game.status = "cancelled";
  await game.save();

  await changeBalance(guildId, interaction.user.id, game.bet, "COINFLIP_REFUND", `Coinflip cancelled by button | Game: ${gameId}`);
  await logCasino(client, makeLogEmbed("❌ Coinflip Cancelled", `👤 **User:** <@${game.creator_id}>\n💰 **Refunded:** ${formatNum(game.bet)} coins\n🎮 **Game:** \`${gameId}\``, 0x808080));

  const cancelledEmbed = new EmbedBuilder()
    .setTitle("🪙 Coinflip Cancelled")
    .setColor(0x808080)
    .setDescription(
      `**Creator:** <@${game.creator_id}>\n` +
      `**Choice:** ${game.choice.toUpperCase()}\n` +
      `**Bet:** ${formatNum(game.bet)} coins\n\n` +
      `❌ Cancelled by creator.\n` +
      `💰 Bet refunded.`
    );

  return interaction.update({ embeds: [cancelledEmbed], components: [] });
}

async function handleJoinCoinflip(interaction) {
  const guildId = interaction.guild.id;
  const gameId = interaction.customId.replace("join_coinflip:", "");
  const opponent = interaction.user;

  const game = await Coinflip.findOne({ game_id: gameId, status: "open" });
  if (!game) return interaction.reply({ content: "❌ This coinflip is no longer active.", flags: MessageFlags.Ephemeral });
  if (!(await isCoinflipEnabled(guildId))) return interaction.reply({ content: "❌ Coinflip is currently disabled by admins.", flags: MessageFlags.Ephemeral });
  if (opponent.id === game.creator_id) return interaction.reply({ content: "❌ You cannot join your own coinflip.", flags: MessageFlags.Ephemeral });
  if (opponent.bot) return interaction.reply({ content: "❌ Bots cannot join.", flags: MessageFlags.Ephemeral });

  const opponentBal = await getBal(guildId, opponent.id);
  if (opponentBal < game.bet) return interaction.reply({ content: "❌ You do not have enough coins to join.", flags: MessageFlags.Ephemeral });

  const result = Math.random() < 0.5 ? "heads" : "tails";
  const creatorWon = result === game.choice;
  const winnerId = creatorWon ? game.creator_id : opponent.id;
  const loserId = creatorWon ? opponent.id : game.creator_id;
  const pot = game.bet * 2;

  await changeBalance(guildId, opponent.id, -game.bet, "COINFLIP_JOIN_LOCK", `Joined coinflip | Game: ${gameId}`);
  await changeBalance(guildId, winnerId, pot, "COINFLIP_WIN", `Won coinflip vs <@${loserId}> | Game: ${gameId}`);

  const winnerStreak = (await getCoinflipStreak(guildId, winnerId)) + 1;
  const loserOldStreak = await getCoinflipStreak(guildId, loserId);

  await setCoinflipStreak(guildId, winnerId, winnerStreak);
  await setCoinflipStreak(guildId, loserId, 0);

  await logTransaction(guildId, loserId, "COINFLIP_LOSS", 0, `Lost coinflip vs <@${winnerId}> | Game: ${gameId} | Streak broken: ${loserOldStreak}`);

  game.status = "finished";
  await game.save();

  await logCasino(client, makeLogEmbed("🏆 Coinflip Result", `🎲 **Result:** ${result.toUpperCase()}\n🥇 **Winner:** <@${winnerId}>\n💀 **Loser:** <@${loserId}>\n💰 **Pot:** ${formatNum(pot)} coins\n🎮 **Game:** \`${gameId}\``));

  const oppositeChoice = game.choice === "heads" ? "tails" : "heads";
  const resultEmbed = new EmbedBuilder()
    .setTitle("🪙 Coinflip Result")
    .setColor(0xff3b3b)
    .setDescription(
      `🎯 **Result:** ${result.toUpperCase()}\n\n` +
      `🏆 **Winner:** <@${winnerId}>\n` +
      `💀 **Loser:** <@${loserId}>\n` +
      `💰 **Pot Won:** ${formatNum(pot)} coins\n\n` +
      `**Creator:** <@${game.creator_id}> — ${game.choice.toUpperCase()}\n` +
      `**Opponent:** ${opponent} — ${oppositeChoice.toUpperCase()}`
    );

  return interaction.update({ embeds: [resultEmbed], components: [] });
}

async function handleDuelJoin(interaction) {
  const guildId = interaction.guild.id;
  const duelId = interaction.customId.replace("duel_join:", "");

  const duel = await Duel.findOne({ duel_id: duelId, status: "open" });
  if (!duel) return interaction.reply({ content: "❌ This duel is no longer open.", flags: MessageFlags.Ephemeral });
  if (interaction.user.id === duel.creator_id) return interaction.reply({ content: "❌ You cannot join your own duel.", flags: MessageFlags.Ephemeral });

  const bal = await getBal(guildId, interaction.user.id);
  if (bal < duel.bet) return interaction.reply({ content: "❌ You do not have enough Digital Silver to join this duel.", flags: MessageFlags.Ephemeral });

  await changeBalance(guildId, interaction.user.id, -duel.bet, "DUEL_JOIN_LOCK", `Joined duel | Duel: ${duelId}`);

  duel.opponent_id = interaction.user.id;
  duel.status = "active";
  duel.turn_user_id = duel.creator_id;
  duel.last_action_at = Date.now();
  duel.expires_at = Date.now() + DUEL_TURN_TIMEOUT;
  duel.updated_at = Date.now();
  await duel.save();

  await logCasino(client, makeLogEmbed("⚔️ Duel Started", `👤 **Player 1:** <@${duel.creator_id}>\n👤 **Player 2:** <@${duel.opponent_id}>\n💰 **Bet:** ${formatNum(duel.bet)} Digital Silver\n🎮 **Duel:** \`${duelId}\``));
  return interaction.update({ embeds: [duelBattleEmbed(duel, "Duel started!")], components: [duelFightButtons(duelId)] });
}

async function handleDuelCancel(interaction) {
  const guildId = interaction.guild.id;
  const duelId = interaction.customId.replace("duel_cancel:", "");

  const duel = await Duel.findOne({ duel_id: duelId, status: "open" });
  if (!duel) return interaction.reply({ content: "❌ This duel cannot be cancelled.", flags: MessageFlags.Ephemeral });

  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
  if (interaction.user.id !== duel.creator_id && !isAdmin) {
    return interaction.reply({ content: "❌ Only the creator or an admin can cancel this duel.", flags: MessageFlags.Ephemeral });
  }

  duel.status = "cancelled";
  duel.updated_at = Date.now();
  await duel.save();

  await changeBalance(guildId, duel.creator_id, duel.bet, "DUEL_CANCEL_REFUND", `Duel cancelled refund | Duel: ${duelId}`);
  const embed = makeLogEmbed("🚫 Duel Cancelled", `👤 **Creator:** <@${duel.creator_id}>\n💰 **Refunded:** ${formatNum(duel.bet)} Digital Silver\n🎮 **Duel:** \`${duelId}\``, 0x808080);
  await logCasino(client, embed);

  return interaction.update({ embeds: [embed], components: [] });
}

async function handleDuelMove(interaction, move) {
  const guildId = interaction.guild.id;
  const duelId = interaction.customId.replace(`duel_${move}:`, "");

  const duel = await Duel.findOne({ duel_id: duelId, status: "active" });
  if (!duel) return interaction.reply({ content: "❌ This duel is not active.", flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== duel.turn_user_id) return interaction.reply({ content: "❌ It is not your turn.", flags: MessageFlags.Ephemeral });

  const isCreatorTurn = interaction.user.id === duel.creator_id;
  let creatorHp = duel.creator_hp, opponentHp = duel.opponent_hp, logText = "";

  if (move === "attack") {
    const damage = 20;
    if (isCreatorTurn) opponentHp -= damage; else creatorHp -= damage;
    logText = `<@${interaction.user.id}> used **Attack** and dealt **${damage} damage**.`;
  }
  if (move === "defend") {
    const heal = 10;
    if (isCreatorTurn) creatorHp = Math.min(DUEL_START_HP, creatorHp + heal); else opponentHp = Math.min(DUEL_START_HP, opponentHp + heal);
    logText = `<@${interaction.user.id}> used **Defend** and healed **${heal} HP**.`;
  }
  if (move === "heavy") {
    const hit = Math.random() < 0.5;
    if (hit) {
      const damage = 40;
      if (isCreatorTurn) opponentHp -= damage; else creatorHp -= damage;
      logText = `<@${interaction.user.id}> used **Heavy Attack** and dealt **${damage} damage**.`;
    } else {
      logText = `<@${interaction.user.id}> used **Heavy Attack** but missed.`;
    }
  }

  creatorHp = Math.max(0, creatorHp);
  opponentHp = Math.max(0, opponentHp);

  let winnerId = null, loserId = null;
  if (creatorHp <= 0) { winnerId = duel.opponent_id; loserId = duel.creator_id; }
  else if (opponentHp <= 0) { winnerId = duel.creator_id; loserId = duel.opponent_id; }

  if (winnerId) {
    const pot = duel.bet * 2;
    duel.creator_hp = creatorHp;
    duel.opponent_hp = opponentHp;
    duel.status = "finished";
    duel.winner_id = winnerId;
    duel.updated_at = Date.now();
    await duel.save();

    await changeBalance(guildId, winnerId, pot, "DUEL_WIN", `Won duel vs <@${loserId}> | Duel: ${duelId}`);
    await logTransaction(guildId, loserId, "DUEL_LOSS", 0, `Lost duel vs <@${winnerId}> | Duel: ${duelId}`);

    const embed = duelFinishedEmbed(duel, winnerId, loserId, logText);
    await logCasino(client, embed);
    return interaction.update({ embeds: [embed], components: [] });
  }

  duel.creator_hp = creatorHp;
  duel.opponent_hp = opponentHp;
  duel.turn_user_id = isCreatorTurn ? duel.opponent_id : duel.creator_id;
  duel.last_action_at = Date.now();
  duel.expires_at = Date.now() + DUEL_TURN_TIMEOUT;
  duel.updated_at = Date.now();
  await duel.save();

  return interaction.update({ embeds: [duelBattleEmbed(duel, logText)], components: [duelFightButtons(duelId)] });
}

async function handleRaidJoin(interaction) {
  const guildId = interaction.guild.id;
  const raidId = interaction.customId.replace("raid_join:", "");
  const raid = await RaidBoss.findOne({ raid_id: raidId, status: "open" });

  if (!raid) return interaction.reply({ content: "❌ This raid is no longer open for joining.", flags: MessageFlags.Ephemeral });

  const count = await RaidPlayer.countDocuments({ raid_id: raidId });
  if (count >= RAID_MAX_PLAYERS) return interaction.reply({ content: "❌ Raid is full.", flags: MessageFlags.Ephemeral });

  const existing = await RaidPlayer.findOne({ raid_id: raidId, user_id: interaction.user.id });
  if (existing) return interaction.reply({ content: `✅ You already joined. Continue in <#${raid.raid_channel_id}>.`, flags: MessageFlags.Ephemeral });

  const bal = await getBal(guildId, interaction.user.id);
  if (bal < raid.join_fee) return interaction.reply({ content: `❌ You need **${formatNum(raid.join_fee)} Digital Silver** to join this raid.`, flags: MessageFlags.Ephemeral });

  await changeBalance(guildId, interaction.user.id, -raid.join_fee, "RAID_JOIN_FEE", `Joined raid boss | Raid: ${raidId}`);

  await RaidPlayer.create({
    raid_id: raidId,
    guild_id: guildId,
    user_id: interaction.user.id,
    joined_at: Date.now()
  });

  raid.reward_pool += raid.join_fee;
  raid.updated_at = Date.now();
  await raid.save();

  const newCount = await RaidPlayer.countDocuments({ raid_id: raidId });

  if (newCount >= RAID_MIN_PLAYERS && raid.status === "open") {
    raid.status = "active";
    raid.started_at = Date.now();
    raid.ends_at = Date.now() + RAID_DURATION;
    raid.updated_at = Date.now();
    await raid.save();

    await updateRaidMessages(client, raidId, "Minimum players reached. Raid started!");
  } else {
    await updateRaidMessages(client, raidId, `<@${interaction.user.id}> joined the raid.`);
  }

  return interaction.reply({
    content: `✅ You joined the raid. **${formatNum(raid.join_fee)} Digital Silver** locked into the pool.\nContinue the fight here: <#${raid.raid_channel_id}>`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleRaidCancelButton(interaction) {
  const guildId = interaction.guild.id;
  const raidId = interaction.customId.replace("raid_cancel:", "");

  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: "❌ Only admins can cancel raids.", flags: MessageFlags.Ephemeral });
  }

  const raid = await RaidBoss.findOne({ raid_id: raidId, guild_id: guildId, status: { $in: ["open", "active"] } });
  if (!raid) return interaction.reply({ content: "❌ This raid is already finished/cancelled.", flags: MessageFlags.Ephemeral });

  const players = await RaidPlayer.find({ raid_id: raidId });

  raid.status = "cancelled";
  raid.updated_at = Date.now();
  await raid.save();

  for (const player of players) {
    await changeBalance(guildId, player.user_id, raid.join_fee, "RAID_CANCEL_REFUND", `Raid cancelled by admin button ${interaction.user.tag} | Raid: ${raidId}`);
  }

  const embed = makeLogEmbed(
    "🚫 Raid Boss Cancelled",
    `**Boss:** ${raid.boss_name}\n` +
    `🎮 **Raid:** \`${raidId}\`\n` +
    `🛡️ **Cancelled By:** ${interaction.user}\n` +
    `👥 **Players Refunded:** ${players.length}\n` +
    `💰 **Refund Each:** ${formatNum(raid.join_fee)} Digital Silver\n` +
    `💰 **Total Refunded:** ${formatNum(players.length * raid.join_fee)} Digital Silver`,
    0x808080
  );

  await logCasino(client, embed);

  if (raid.raid_channel_id && raid.raid_message_id) {
    try {
      const channel = await client.channels.fetch(raid.raid_channel_id);
      const msg = await channel.messages.fetch(raid.raid_message_id);
      await msg.edit({ embeds: [embed], components: [] });
    } catch (err) { console.error(err); }
  }

  if (raid.general_channel_id && raid.general_message_id) {
    try {
      const channel = await client.channels.fetch(raid.general_channel_id);
      const msg = await channel.messages.fetch(raid.general_message_id);
      await msg.edit({ embeds: [embed], components: [] });
    } catch (err) { console.error(err); }
  }

  return interaction.reply({
    content: `✅ Raid cancelled.\n👥 Refunded **${players.length}** players.\n💰 Total refunded: **${formatNum(players.length * raid.join_fee)} Digital Silver**`,
    flags: MessageFlags.Ephemeral
  });
}

async function handleRaidAction(interaction, action) {
  const guildId = interaction.guild.id;
  const raidId = interaction.customId.replace(`raid_${action}:`, "");
  const raid = await RaidBoss.findOne({ raid_id: raidId, status: "active" });

  if (!raid) return interaction.reply({ content: "❌ This raid is not active.", flags: MessageFlags.Ephemeral });

  const player = await RaidPlayer.findOne({ raid_id: raidId, user_id: interaction.user.id });
  if (!player) return interaction.reply({ content: "❌ You must join the raid from the spawn message first.", flags: MessageFlags.Ephemeral });

  const now = Date.now();
  const waitMs = RAID_ACTION_COOLDOWN - (now - Number(player.last_action_at || 0));
  if (waitMs > 0) return interaction.reply({ content: `⏳ You are on cooldown. Try again in **${Math.ceil(waitMs / 1000)}s**.`, flags: MessageFlags.Ephemeral });

  let damage = 0, healing = 0, tanking = 0, logText = "";

  if (action === "attack") {
    damage = Math.floor(Math.random() * 351) + 250;
    logText = `<@${interaction.user.id}> attacked and dealt **${formatNum(damage)} damage**.`;
  }
  if (action === "heal") {
    healing = Math.floor(Math.random() * 201) + 150;
    logText = `<@${interaction.user.id}> healed the raid for **${formatNum(healing)} support**.`;
  }
  if (action === "defend") {
    tanking = Math.floor(Math.random() * 251) + 200;
    logText = `<@${interaction.user.id}> defended the raid and gained **${formatNum(tanking)} tank score**.`;
  }

  const newHp = Math.max(0, raid.boss_hp - damage);

  player.damage += damage;
  player.healing += healing;
  player.tanking += tanking;
  player.actions += 1;
  player.last_action_at = now;
  await player.save();

  raid.boss_hp = newHp;
  raid.updated_at = now;
  await raid.save();

  if (newHp <= 0) {
    const embed = await finishRaidBoss(client, guildId, raidId, true);
    await logCasino(client, embed);

    if (raid.raid_channel_id && raid.raid_message_id) {
      try {
        const channel = await client.channels.fetch(raid.raid_channel_id);
        const msg = await channel.messages.fetch(raid.raid_message_id);
        await msg.edit({ embeds: [embed], components: [] });
      } catch {}
    }

    return interaction.update({ embeds: [embed], components: [] }).catch(() => interaction.reply({ content: "🏆 Raid boss defeated!", flags: MessageFlags.Ephemeral }));
  }

  await updateRaidMessages(client, raidId, logText);
  return interaction.deferUpdate().catch(() => {});
}

async function handleBlackjackJoin(interaction) {
  const guildId = interaction.guild.id;
  if (!(await isBlackjackEnabled(guildId))) return interaction.reply({ content: "❌ Blackjack is currently disabled by admins.", flags: MessageFlags.Ephemeral });

  const gameId = interaction.customId.replace("bj_join:", "");
  const game = await BlackjackGame.findOne({ game_id: gameId, status: "open" });
  if (!game) return interaction.reply({ content: "❌ This blackjack table is no longer open.", flags: MessageFlags.Ephemeral });

  const existing = await BlackjackPlayer.findOne({ game_id: gameId, user_id: interaction.user.id });
  if (existing) return interaction.reply({ content: "❌ You already joined this table.", flags: MessageFlags.Ephemeral });

  const count = await BlackjackPlayer.countDocuments({ game_id: gameId });
  if (count >= MAX_BLACKJACK_PLAYERS) return interaction.reply({ content: "❌ Blackjack table is full.", flags: MessageFlags.Ephemeral });

  const bal = await getBal(guildId, interaction.user.id);
  if (bal < game.buyin) return interaction.reply({ content: "❌ You do not have enough Digital Silver.", flags: MessageFlags.Ephemeral });

  await changeBalance(guildId, interaction.user.id, -game.buyin, "BLACKJACK_BUYIN_LOCK", `Joined blackjack | Game: ${gameId}`);

  await BlackjackPlayer.create({
    game_id: gameId,
    guild_id: guildId,
    user_id: interaction.user.id,
    hands: [],
    active_hand_index: 0,
    status: "playing",
    joined_at: Date.now()
  });

  game.pot += game.buyin;
  game.updated_at = Date.now();
  await game.save();

  await updateBlackjackMessage(client, gameId);
  await logCasino(client, makeLogEmbed("🃏 Blackjack Player Joined", `👤 **Player:** ${interaction.user}\n💰 **Buy-in:** ${formatNum(game.buyin)} Digital Silver\n🎮 **Game:** \`${gameId}\``));

  return interaction.reply({ content: "✅ Joined blackjack table.", flags: MessageFlags.Ephemeral });
}

async function handleBlackjackLeave(interaction) {
  const guildId = interaction.guild.id;
  const gameId = interaction.customId.replace("bj_leave:", "");
  const game = await BlackjackGame.findOne({ game_id: gameId, status: "open" });

  if (!game) return interaction.reply({ content: "❌ You can only leave before the game starts.", flags: MessageFlags.Ephemeral });

  const player = await BlackjackPlayer.findOne({ game_id: gameId, user_id: interaction.user.id });
  if (!player) return interaction.reply({ content: "❌ You are not in this table.", flags: MessageFlags.Ephemeral });
  if (interaction.user.id === game.host_id) return interaction.reply({ content: "❌ Host cannot leave. Use Cancel.", flags: MessageFlags.Ephemeral });

  await BlackjackPlayer.deleteOne({ game_id: gameId, user_id: interaction.user.id });
  game.pot -= game.buyin;
  game.updated_at = Date.now();
  await game.save();

  await changeBalance(guildId, interaction.user.id, game.buyin, "BLACKJACK_LEAVE_REFUND", `Left blackjack refund | Game: ${gameId}`);
  await updateBlackjackMessage(client, gameId);

  return interaction.reply({ content: `✅ Left blackjack table. Refunded **${formatNum(game.buyin)} Digital Silver**.`, flags: MessageFlags.Ephemeral });
}

async function handleBlackjackCancel(interaction) {
  const guildId = interaction.guild.id;
  const gameId = interaction.customId.replace("bj_cancel:", "");
  const game = await BlackjackGame.findOne({ game_id: gameId, status: "open" });

  if (!game) return interaction.reply({ content: "❌ This blackjack table cannot be cancelled now.", flags: MessageFlags.Ephemeral });

  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
  if (interaction.user.id !== game.host_id && !isAdmin) {
    return interaction.reply({ content: "❌ Only the host/admin can cancel this table.", flags: MessageFlags.Ephemeral });
  }

  const players = await BlackjackPlayer.find({ game_id: gameId });
  for (const player of players) {
    await changeBalance(guildId, player.user_id, game.buyin, "BLACKJACK_CANCEL_REFUND", `Blackjack cancelled refund | Game: ${gameId}`);
  }

  game.status = "cancelled";
  game.updated_at = Date.now();
  await game.save();

  const embed = makeLogEmbed("🚫 Blackjack Cancelled", `🎮 **Game:** \`${gameId}\`\n💰 **Refunded Players:** ${players.length}\n🛡️ **Cancelled By:** ${interaction.user}`, 0x808080);
  await logCasino(client, embed);

  return interaction.update({ embeds: [embed], components: [] });
}

async function handleBlackjackStart(interaction) {
  const gameId = interaction.customId.replace("bj_start:", "");
  const game = await BlackjackGame.findOne({ game_id: gameId, status: "open" });

  if (!game) return interaction.reply({ content: "❌ This blackjack table is not open.", flags: MessageFlags.Ephemeral });

  const isAdmin = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);
  if (interaction.user.id !== game.host_id && !isAdmin) {
    return interaction.reply({ content: "❌ Only the host/admin can start this game.", flags: MessageFlags.Ephemeral });
  }

  const players = await BlackjackPlayer.find({ game_id: gameId }).sort({ joined_at: 1 });
  if (players.length < 2) return interaction.reply({ content: "❌ Need at least 2 players to start blackjack.", flags: MessageFlags.Ephemeral });

  const deck = bjCreateDeck();
  for (const player of players) {
    player.hands = [{ cards: [deck.pop(), deck.pop()], done: false }];
    player.active_hand_index = 0;
    player.status = "playing";
    await player.save();
  }

  game.status = "active";
  game.dealer_hand = [];
  game.current_turn_index = 0;
  game.expires_at = Date.now() + BLACKJACK_TURN_TIMEOUT;
  game.updated_at = Date.now();
  await game.save();

  const updatedPlayers = await BlackjackPlayer.find({ game_id: gameId }).sort({ joined_at: 1 });

  await logCasino(client, makeLogEmbed("🃏 PvP Blackjack Started", `🎮 **Game:** \`${gameId}\`\n👥 **Players:** ${players.length}\n💰 **Pot:** ${formatNum(game.pot)} Digital Silver`));

  return interaction.update({
    embeds: [bjGameEmbed(game, updatedPlayers, "PvP Blackjack started! Cards are hidden. Click **View My Hand**.")],
    components: [bjActionButtons(gameId, bjCanSplit(updatedPlayers[0]))]
  });
}

async function handleBlackjackMove(interaction, move) {
  const guildId = interaction.guild.id;
  const gameId = interaction.customId.replace(`bj_${move}:`, "");
  const game = await BlackjackGame.findOne({ game_id: gameId, status: "active" });

  if (!game) return interaction.reply({ content: "❌ This blackjack game is not active.", flags: MessageFlags.Ephemeral });

  const players = await BlackjackPlayer.find({ game_id: gameId }).sort({ joined_at: 1 });
  const current = players[game.current_turn_index];

  if (!current || current.user_id !== interaction.user.id) {
    return interaction.reply({ content: "❌ It is not your turn.", flags: MessageFlags.Ephemeral });
  }

  let hands = current.hands;
  let hand = hands[current.active_hand_index];
  let logText = "";

  if (!hand || hand.done) return interaction.reply({ content: "❌ This hand is already done.", flags: MessageFlags.Ephemeral });

  if (move === "split") {
    if (!bjCanSplit(current)) return interaction.reply({ content: "❌ You can only split when your first 2 cards have the same value.", flags: MessageFlags.Ephemeral });

    const first = hand.cards[0];
    const second = hand.cards[1];

    const usedCards = [];
    for (const p of players) {
      for (const h of p.hands) {
        for (const c of h.cards) usedCards.push(c.text);
      }
    }

    const deck = bjCreateDeck().filter(c => !usedCards.includes(c.text));
    current.hands = [
      { cards: [first, deck.pop()], done: false },
      { cards: [second, deck.pop()], done: false }
    ];
    logText = `<@${interaction.user.id}> used **Split**.`;
  }

  if (move === "hit") {
    const usedCards = [];
    for (const p of players) {
      for (const h of p.hands) {
        for (const c of h.cards) usedCards.push(c.text);
      }
    }

    const deck = bjCreateDeck().filter(c => !usedCards.includes(c.text));
    const card = deck.pop();
    hand.cards.push(card);

    if (bjIsBust(hand.cards)) {
      hand.done = true;
      logText = `<@${interaction.user.id}> used **Hit** and drew ${card.text}. 💥 Bust.`;
    } else {
      logText = `<@${interaction.user.id}> used **Hit** and drew ${card.text}.`;
    }
  }

  if (move === "stay") {
    hand.done = true;
    logText = `<@${interaction.user.id}> used **Stay**.`;
  }

  current.markModified("hands");
  await current.save();

  const allDone = await bjNextTurn(gameId);

  if (allDone) {
    const embed = await bjResolveGame(guildId, gameId);
    await logCasino(client, embed);
    return interaction.update({ embeds: [embed], components: [] });
  }

  await updateBlackjackMessage(client, gameId, logText);
  await interaction.deferUpdate().catch(() => {});

  const updatedPlayer = await BlackjackPlayer.findOne({ game_id: gameId, user_id: interaction.user.id });
  if (updatedPlayer) {
    await interaction.followUp({ content: `🃏 **Your Updated Hand**\n\n${bjPrivateHandText(updatedPlayer)}`, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

async function handleBlackjackView(interaction) {
  const gameId = interaction.customId.replace("bj_view:", "");
  const game = await BlackjackGame.findOne({ game_id: gameId, status: "active" });

  if (!game) return interaction.reply({ content: "❌ This blackjack game is not active.", flags: MessageFlags.Ephemeral });

  const player = await BlackjackPlayer.findOne({ game_id: gameId, user_id: interaction.user.id });
  if (!player) return interaction.reply({ content: "❌ You are not in this blackjack game.", flags: MessageFlags.Ephemeral });

  const players = await BlackjackPlayer.find({ game_id: gameId }).sort({ joined_at: 1 });
  const current = players[game.current_turn_index];

  return interaction.reply({
    content: `🃏 **Your Blackjack Hand**\n\n${bjPrivateHandText(player)}\n\n🎯 Current turn: ${current ? `<@${current.user_id}>` : "Resolving..."}`,
    flags: MessageFlags.Ephemeral
  });
}

// ==========================================
// MAIN INTERACTION ROUTER
// ==========================================
client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith("page_")) {
        const [raw, pageRaw, ownerId, targetId] = interaction.customId.split(":");
        const parts = raw.split("_");
        const type = parts[1];
        const direction = parts[2];

        if (interaction.user.id !== ownerId) return interaction.reply({ content: "❌ Only the user who opened this page can use these buttons.", flags: MessageFlags.Ephemeral });

        const oldPage = parseInt(pageRaw, 10) || 0;
        const newPage = direction === "next" ? oldPage + 1 : oldPage - 1;

        if (type === "leaderboard") {
          const data = await makeLeaderboardPage(interaction.guild.id, newPage);
          return interaction.update({ embeds: [data.embed], components: [pageButtons("leaderboard", data.page, data.maxPage, ownerId)] });
        }
        if (type === "history") {
          const user = await client.users.fetch(targetId).catch(() => null);
          if (!user) return interaction.reply({ content: "❌ Could not fetch that user.", flags: MessageFlags.Ephemeral });
          const data = await makeHistoryPage(interaction.guild.id, user, newPage);
          return interaction.update({ embeds: [data.embed], components: [pageButtons("history", data.page, data.maxPage, ownerId, targetId)] });
        }
        if (type === "transactions") {
          const data = await makeTransactionsPage(interaction.guild.id, newPage);
          return interaction.update({ embeds: [data.embed], components: [pageButtons("transactions", data.page, data.maxPage, ownerId)] });
        }
        if (type === "streakboard") {
          const data = await makeStreakboardPage(interaction.guild.id, newPage);
          return interaction.update({ embeds: [data.embed], components: [pageButtons("streakboard", data.page, data.maxPage, ownerId)] });
        }
      }

      if (interaction.customId.startsWith("join_coinflip:")) return handleJoinCoinflip(interaction);
      if (interaction.customId.startsWith("cancel_coinflip:")) return handleCancelCoinflipButton(interaction);
      if (interaction.customId.startsWith("withdraw_approve:")) return handleWithdrawApprove(interaction);
      if (interaction.customId.startsWith("withdraw_deny:")) return handleWithdrawDeny(interaction);
      if (interaction.customId.startsWith("withdraw_cancel:")) return handleWithdrawCancel(interaction);
      if (interaction.customId.startsWith("bj_join:")) return handleBlackjackJoin(interaction);
      if (interaction.customId.startsWith("bj_leave:")) return handleBlackjackLeave(interaction);
      if (interaction.customId.startsWith("bj_start:")) return handleBlackjackStart(interaction);
      if (interaction.customId.startsWith("bj_cancel:")) return handleBlackjackCancel(interaction);
      if (interaction.customId.startsWith("bj_hit:")) return handleBlackjackMove(interaction, "hit");
      if (interaction.customId.startsWith("bj_stay:")) return handleBlackjackMove(interaction, "stay");
      if (interaction.customId.startsWith("bj_split:")) return handleBlackjackMove(interaction, "split");
      if (interaction.customId.startsWith("bj_view:")) return handleBlackjackView(interaction);
      if (interaction.customId.startsWith("raid_join:")) return handleRaidJoin(interaction);
      if (interaction.customId.startsWith("raid_cancel:")) return handleRaidCancelButton(interaction);
      if (interaction.customId.startsWith("duel_join:")) return handleDuelJoin(interaction);
      if (interaction.customId.startsWith("duel_cancel:")) return handleDuelCancel(interaction);
      if (interaction.customId.startsWith("duel_attack:")) return handleDuelMove(interaction, "attack");
      if (interaction.customId.startsWith("duel_defend:")) return handleDuelMove(interaction, "defend");
      if (interaction.customId.startsWith("duel_heavy:")) return handleDuelMove(interaction, "heavy");
      if (interaction.customId.startsWith("raid_attack:")) return handleRaidAction(interaction, "attack");
      if (interaction.customId.startsWith("raid_defend:")) return handleRaidAction(interaction, "defend");
      if (interaction.customId.startsWith("raid_heal:")) return handleRaidAction(interaction, "heal");

      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const guildId = interaction.guild.id;
    const command = interaction.commandName;

    if (command === "version") return interaction.reply(`🤖 DonkBot Version: **${BOT_VERSION}**`);

    if (command === "balance") {
      const user = interaction.options.getUser("user") || interaction.user;
      const balance = await getBal(guildId, user.id);
      return interaction.reply(`💰 ${user} balance: **${formatNum(balance)} coins**`);
    }

    if (command === "economy") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const stats = await getEconomyStats(guildId);

      const embed = new EmbedBuilder()
        .setTitle("📊 Server Economy Overview")
        .setColor(0x00ff99)
        .setDescription(
          `### 📅 Daily (Last 24 Hours)\n` +
          `• ➕ **Added:** \`${formatNum(stats.daily.added)}\` coins\n` +
          `• ➖ **Withdrawn:** \`${formatNum(stats.daily.withdrawn)}\` coins\n` +
          `• 📈 **Net Flow:** \`${stats.daily.added >= stats.daily.withdrawn ? "+" : ""}${formatNum(stats.daily.added - stats.daily.withdrawn)}\` coins\n\n` +
          `### 🗓️ Weekly (Last 7 Days)\n` +
          `• ➕ **Added:** \`${formatNum(stats.weekly.added)}\` coins\n` +
          `• ➖ **Withdrawn:** \`${formatNum(stats.weekly.withdrawn)}\` coins\n` +
          `• 📈 **Net Flow:** \`${stats.weekly.added >= stats.weekly.withdrawn ? "+" : ""}${formatNum(stats.weekly.added - stats.weekly.withdrawn)}\` coins\n\n` +
          `### 📆 Monthly (Last 30 Days)\n` +
          `• ➕ **Added:** \`${formatNum(stats.monthly.added)}\` coins\n` +
          `• ➖ **Withdrawn:** \`${formatNum(stats.monthly.withdrawn)}\` coins\n` +
          `• 📈 **Net Flow:** \`${stats.monthly.added >= stats.monthly.withdrawn ? "+" : ""}${formatNum(stats.monthly.added - stats.monthly.withdrawn)}\` coins\n\n` +
          `---\n` +
          `🏦 **Total Coins in Circulation:** \`${formatNum(stats.totalCirculation)}\` coins`
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    }

    if (command === "rank") {
      const allUsers = await User.find({ guild_id: guildId }).sort({ balance: -1 });
      const rank = allUsers.findIndex(r => r.user_id === interaction.user.id) + 1;
      const balance = await getBal(guildId, interaction.user.id);
      return interaction.reply(`🏆 Your rank: **#${rank || allUsers.length + 1}**\n💰 Balance: **${formatNum(balance)} coins**`);
    }

    if (command === "leaderboard") {
      const data = await makeLeaderboardPage(guildId, 0);
      return interaction.reply({ embeds: [data.embed], components: [pageButtons("leaderboard", data.page, data.maxPage, interaction.user.id)] });
    }

    if (command === "history") {
      const user = interaction.options.getUser("user") || interaction.user;
      const data = await makeHistoryPage(guildId, user, 0);
      return interaction.reply({ embeds: [data.embed], components: [pageButtons("history", data.page, data.maxPage, interaction.user.id, user.id)] });
    }

    if (command === "withdraw") {
      const user = interaction.user;
      const input = interaction.options.getString("amount");
      const balance = await getBal(guildId, user.id);

      const parsed = parseAmountInput(input, balance);
      if (parsed.error) return interaction.reply({ content: `❌ ${parsed.error}`, flags: MessageFlags.Ephemeral });

      const amount = parsed.amount;
      if (amount <= 0) return interaction.reply({ content: "❌ Withdrawal amount must be more than 0.", flags: MessageFlags.Ephemeral });
      if (amount < MIN_WITHDRAW) return interaction.reply({ content: `❌ Minimum withdrawal is **${formatNum(MIN_WITHDRAW)} coins**.`, flags: MessageFlags.Ephemeral });
      if (amount > balance) return interaction.reply({ content: "❌ You do not have enough balance for this withdrawal.", flags: MessageFlags.Ephemeral });

      const pending = await Withdrawal.findOne({ guild_id: guildId, user_id: user.id, status: "pending" });
      if (pending) return interaction.reply({ content: "❌ You already have a pending withdrawal. Wait for admin approval, rejection, or cancel it first.", flags: MessageFlags.Ephemeral });

      const withdrawId = makeWithdrawId();
      const balanceBefore = balance;
      const balanceAfter = balance - amount;
      const fee = Math.floor((amount * WITHDRAW_FEE_PERCENT) / 100);
      const netAmount = amount - fee;

      await changeBalance(guildId, user.id, -amount, "WITHDRAW_LOCK", `Withdrawal request locked | Withdraw: ${withdrawId} | Mode: ${parsed.mode}`);

      const request = await Withdrawal.create({
        withdraw_id: withdrawId,
        guild_id: guildId,
        channel_id: interaction.channel.id,
        user_id: user.id,
        amount,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        status: "pending",
        created_at: Date.now()
      });

      const requestEmbed = makeLogEmbed(
        "💸 Withdrawal Request",
        `**ID:** \`${withdrawId}\`\n` +
        `👤 **User:** ${user}\n` +
        `💰 **Requested Amount:** ${formatNum(amount)} coins\n` +
        `💸 **Fee (${WITHDRAW_FEE_PERCENT}%):** ${formatNum(fee)} coins\n` +
        `✅ **Net Payout:** ${formatNum(netAmount)} coins\n` +
        `📌 **Mode:** ${parsed.mode}\n` +
        `💳 **Balance Before:** ${formatNum(balanceBefore)} coins\n` +
        `💳 **Balance After Lock:** ${formatNum(balanceAfter)} coins\n\n` +
        `⏳ Waiting for admin approval.\nAdmins can approve or deny below.\nRequester can cancel below.`,
        0xffcc00
      );

      const msg = await interaction.channel.send({ embeds: [requestEmbed], components: [withdrawalButtons(withdrawId)] });
      request.message_id = msg.id;
      await request.save();

      await logToChannel(client, makeLogEmbed("💸 Withdrawal Request Created", `👤 **User:** ${user}\n💰 **Requested:** ${formatNum(amount)} coins\n💸 **Fee (${WITHDRAW_FEE_PERCENT}%):** ${formatNum(fee)} coins\n✅ **Net Payout:** ${formatNum(netAmount)} coins\n💳 **Balance After Lock:** ${formatNum(balanceAfter)} coins\n🧵 **Channel/Post:** <#${interaction.channel.id}>\n**ID:** \`${withdrawId}\``, 0xffcc00));
      await interaction.reply({ content: "✅ Request submitted.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (command === "clearwithdraw") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Only admins can use this.", flags: MessageFlags.Ephemeral });

      const user = interaction.options.getUser("user");
      const pending = await Withdrawal.findOne({ guild_id: guildId, user_id: user.id, status: "pending" });
      if (!pending) return interaction.reply({ content: `❌ ${user} has no pending withdrawal.`, flags: MessageFlags.Ephemeral });

      pending.status = "cancelled";
      pending.admin_id = interaction.user.id;
      pending.updated_at = Date.now();
      await pending.save();

      await changeBalance(guildId, user.id, pending.amount, "WITHDRAW_ADMIN_CLEAR_REFUND", `Pending withdrawal cleared/refunded by ${interaction.user.tag} | Withdraw: ${pending.withdraw_id}`);
      const newBalance = await getBal(guildId, user.id);

      await logToChannel(client, makeLogEmbed("🧹 Pending Withdrawal Cleared", `👤 **User:** ${user}\n💰 **Refunded:** ${formatNum(pending.amount)} coins\n💳 **New Balance:** ${formatNum(newBalance)} coins\n🆔 **Withdraw ID:** \`${pending.withdraw_id}\`\n🛡️ **Cleared By:** ${interaction.user}`, 0x808080));
      return interaction.reply(`✅ Cleared pending withdrawal for ${user}.\n💰 Refunded **${formatNum(pending.amount)} coins**.\n💳 New balance: **${formatNum(newBalance)} coins**`);
    }

    if (command === "addcoins") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Only admins can use this.", flags: MessageFlags.Ephemeral });

      const user = interaction.options.getUser("user");
      const amount = interaction.options.getInteger("amount");
      if (amount <= 0) return interaction.reply({ content: "❌ Amount must be more than 0.", flags: MessageFlags.Ephemeral });

      await changeBalance(guildId, user.id, amount, "ADMIN_ADD", `Added by ${interaction.user.tag}`);
      const newBal = await getBal(guildId, user.id);

      await logToChannel(client, makeLogEmbed("➕ Admin Add Coins", `👤 **User:** ${user}\n💰 **Amount:** +${formatNum(amount)} coins\n💳 **New Balance:** ${formatNum(newBal)} coins\n🛡️ **Admin:** ${interaction.user}`));
      return interaction.reply(`✅ Added **${formatNum(amount)} coins** to ${user}.\n💰 New balance: **${formatNum(newBal)} coins**`);
    }

    if (command === "removecoins") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Only admins can use this.", flags: MessageFlags.Ephemeral });

      const user = interaction.options.getUser("user");
      const input = interaction.options.getString("amount");
      const balance = await getBal(guildId, user.id);

      const parsed = parseAmountInput(input, balance);
      if (parsed.error) return interaction.reply({ content: `❌ ${parsed.error}`, flags: MessageFlags.Ephemeral });

      const removeAmount = Math.min(balance, parsed.amount);
      const removeType = parsed.mode;

      await changeBalance(guildId, user.id, -removeAmount, "ADMIN_REMOVE", `Removed by ${interaction.user.tag} | Mode: ${removeType}`);
      const newBal = await getBal(guildId, user.id);

      const logTitle = removeType === "ALL" ? "☠️ Admin Removed ALL Coins" : "➖ Admin Remove Coins";
      await logToChannel(client, makeLogEmbed(logTitle, `👤 **User:** ${user}\n💰 **Removed:** ${formatNum(removeAmount)} coins\n📌 **Mode:** ${removeType}\n💳 **Old Balance:** ${formatNum(balance)} coins\n💳 **New Balance:** ${formatNum(newBal)} coins\n🛡️ **Admin:** ${interaction.user}`, removeType === "ALL" ? 0x000000 : 0xff3b3b));

      return interaction.reply(`✅ Removed **${formatNum(removeAmount)} coins** from ${user}.\n💰 New balance: **${formatNum(newBal)} coins**`);
    }

    if (command === "transfer") {
      const toUser = interaction.options.getUser("user");
      const amount = interaction.options.getInteger("amount");
      const fromUser = interaction.user;

      if (toUser.bot) return interaction.reply({ content: "❌ You cannot transfer Digital Silver to a bot.", flags: MessageFlags.Ephemeral });
      if (amount < MIN_TRANSFER) return interaction.reply({ content: `❌ Minimum transfer is **${formatNum(MIN_TRANSFER)} coin**.`, flags: MessageFlags.Ephemeral });

      try {
        await transferBalance(guildId, fromUser.id, toUser.id, amount, "TRANSFER_SENT", "TRANSFER_RECEIVED", `Transfer ${fromUser.tag} -> ${toUser.tag}`);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      const senderBal = await getBal(guildId, fromUser.id);
      const embed = makeLogEmbed("💸 User Transfer", `👤 **From:** ${fromUser}\n👤 **To:** ${toUser}\n💰 **Amount:** ${formatNum(amount)} Digital Silver\n💳 **Sender Balance:** ${formatNum(senderBal)} Digital Silver`, 0x00ff00);
      await logToChannel(client, embed);
      return interaction.reply({ embeds: [embed] });
    }

    if (command === "admintransfer") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Only admins can use this.", flags: MessageFlags.Ephemeral });

      const fromUser = interaction.options.getUser("from");
      const toUser = interaction.options.getUser("to");
      const amount = interaction.options.getInteger("amount");
      if (amount <= 0) return interaction.reply({ content: "❌ Amount must be more than 0.", flags: MessageFlags.Ephemeral });

      try {
        await transferBalance(guildId, fromUser.id, toUser.id, amount, "ADMIN_TRANSFER_OUT", "ADMIN_TRANSFER_IN", `Admin transfer by ${interaction.user.tag}: ${fromUser.tag} -> ${toUser.tag}`);
      } catch (err) {
        return interaction.reply({ content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral });
      }

      const fromBal = await getBal(guildId, fromUser.id);
      const toBal = await getBal(guildId, toUser.id);
      const embed = makeLogEmbed("👑 Admin Transfer", `👤 **From:** ${fromUser}\n👤 **To:** ${toUser}\n💰 **Amount:** ${formatNum(amount)} Digital Silver\n🛡️ **Admin:** ${interaction.user}\n💳 **From New Balance:** ${formatNum(fromBal)} Digital Silver\n💳 **To New Balance:** ${formatNum(toBal)} Digital Silver`, 0xffcc00);

      await logToChannel(client, embed);
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (command === "streak") {
      const user = interaction.options.getUser("user") || interaction.user;
      const streak = await getCoinflipStreak(guildId, user.id);
      return interaction.reply(`🔥 ${user} coinflip win streak: **${formatNum(streak)}**\n💬 **${getStreakComment(streak)}**`);
    }

    if (command === "streakboard") {
      const data = await makeStreakboardPage(guildId, 0);
      return interaction.reply({ embeds: [data.embed], components: [pageButtons("streakboard", data.page, data.maxPage, interaction.user.id)] });
    }

    if (command === "duel") {
      const creator = interaction.user;
      const bet = interaction.options.getInteger("bet");

      if (bet < MIN_DUEL_BET) return interaction.reply({ content: `❌ Minimum duel bet is **${formatNum(MIN_DUEL_BET)} Digital Silver**.`, flags: MessageFlags.Ephemeral });
      if (bet > MAX_DUEL_BET) return interaction.reply({ content: `❌ Maximum duel bet is **${formatNum(MAX_DUEL_BET)} Digital Silver**.`, flags: MessageFlags.Ephemeral });

      const openDuel = await Duel.findOne({ guild_id: guildId, creator_id: creator.id, status: "open" });
      if (openDuel) return interaction.reply({ content: "❌ You already have an open duel. Start it or cancel it first.", flags: MessageFlags.Ephemeral });

      const bal = await getBal(guildId, creator.id);
      if (bal < bet) return interaction.reply({ content: "❌ You do not have enough Digital Silver.", flags: MessageFlags.Ephemeral });

      const duelId = makeDuelId();
      const now = Date.now();

      await changeBalance(guildId, creator.id, -bet, "DUEL_CREATE_LOCK", `Created duel | Duel: ${duelId}`);

      const duel = await Duel.create({
        duel_id: duelId,
        guild_id: guildId,
        channel_id: interaction.channel.id,
        creator_id: creator.id,
        bet,
        creator_hp: DUEL_START_HP,
        opponent_hp: DUEL_START_HP,
        status: "open",
        created_at: now,
        last_action_at: now,
        expires_at: now + DUEL_LOBBY_TIMEOUT
      });

      // RESOLVED DEPRECATION: Replace fetchReply with withResponse
      const response = await interaction.reply({ embeds: [duelOpenEmbed(duel)], components: [duelButtons(duelId)], withResponse: true });
      duel.message_id = response.resource?.message?.id || null;
      await duel.save();

      await logCasino(client, makeLogEmbed("⚔️ Duel Created", `👤 **Creator:** ${creator}\n💰 **Bet:** ${formatNum(bet)} Digital Silver\n🎮 **Duel:** \`${duelId}\``));
      return;
    }

    if (command === "coinflipadmin") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Only admins can use this.", flags: MessageFlags.Ephemeral });

      const status = interaction.options.getString("status");
      const enabled = status === "enable";

      await setCoinflipEnabled(guildId, enabled);
      await logToChannel(client, makeLogEmbed(enabled ? "✅ Coinflip Enabled" : "🛑 Coinflip Disabled", `🛡️ **Admin:** ${interaction.user}\n📌 **Status:** ${enabled ? "Enabled" : "Disabled"}`, enabled ? 0x00ff00 : 0xff0000));

      return interaction.reply(enabled ? "✅ Coinflip has been **enabled**." : "🛑 Coinflip has been **disabled**.");
    }

    if (command === "discount") {
      const amount = interaction.options.getInteger("amount");
      const discount = interaction.options.getNumber("discount");

      const discountAmount = Math.floor(amount * (discount / 100));
      const finalAmount = amount - discountAmount;

      const embed = new EmbedBuilder()
        .setTitle("🏷️ Discount Calculator")
        .setColor(0x00ff99)
        .addFields(
          { name: "💰 Original Price", value: formatNum(amount), inline: true },
          { name: "📉 Discount", value: `${discount}%`, inline: true },
          { name: "💸 Discount Amount", value: formatNum(discountAmount), inline: true },
          { name: "✅ Final Price", value: formatNum(finalAmount), inline: false }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (command === "blackjackadmin") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Only admins can use this.", flags: MessageFlags.Ephemeral });

      const status = interaction.options.getString("status");
      const enabled = status === "enable";

      await setBlackjackEnabled(guildId, enabled);
      await logCasino(client, makeLogEmbed(enabled ? "✅ Blackjack Enabled" : "🛑 Blackjack Disabled", `🛡️ **Admin:** ${interaction.user}\n📌 **Status:** ${enabled ? "Enabled" : "Disabled"}`, enabled ? 0x00ff00 : 0xff0000));

      return interaction.reply(enabled ? "✅ Blackjack has been **enabled**." : "🛑 Blackjack has been **disabled**.");
    }

    if (command === "blackjack") {
      if (!(await isBlackjackEnabled(guildId))) return interaction.reply({ content: "❌ Blackjack is currently disabled by admins.", flags: MessageFlags.Ephemeral });
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Only admins can host blackjack tables.", flags: MessageFlags.Ephemeral });

      const host = interaction.user;
      const buyin = interaction.options.getInteger("buyin");

      if (buyin < MIN_BLACKJACK_BUYIN) return interaction.reply({ content: `❌ Minimum blackjack buy-in is **${formatNum(MIN_BLACKJACK_BUYIN)} Digital Silver**.`, flags: MessageFlags.Ephemeral });
      if (buyin > MAX_BLACKJACK_BUYIN) return interaction.reply({ content: `❌ Maximum blackjack buy-in is **${formatNum(MAX_BLACKJACK_BUYIN)} Digital Silver**.`, flags: MessageFlags.Ephemeral });

      const bal = await getBal(guildId, host.id);
      if (bal < buyin) return interaction.reply({ content: "❌ You do not have enough Digital Silver to host this blackjack table.", flags: MessageFlags.Ephemeral });

      const openGame = await BlackjackGame.findOne({ guild_id: guildId, host_id: host.id, status: "open" });
      if (openGame) return interaction.reply({ content: "❌ You already have an open blackjack table. Start or cancel it first.", flags: MessageFlags.Ephemeral });

      const gameId = makeBlackjackId();
      const now = Date.now();

      await changeBalance(guildId, host.id, -buyin, "BLACKJACK_BUYIN_LOCK", `Created blackjack table | Game: ${gameId}`);

      const game = await BlackjackGame.create({
        game_id: gameId,
        guild_id: guildId,
        channel_id: interaction.channel.id,
        host_id: host.id,
        buyin,
        status: "open",
        pot: buyin,
        created_at: now,
        updated_at: now,
        expires_at: now + BLACKJACK_LOBBY_TIMEOUT
      });

      await BlackjackPlayer.create({
        game_id: gameId,
        guild_id: guildId,
        user_id: host.id,
        hands: [],
        active_hand_index: 0,
        status: "playing",
        joined_at: now
      });

      const players = await BlackjackPlayer.find({ game_id: gameId }).sort({ joined_at: 1 });
      
      // RESOLVED DEPRECATION: Replace fetchReply with withResponse
      const response = await interaction.reply({ embeds: [bjLobbyEmbed(game, players)], components: [bjLobbyButtons(gameId)], withResponse: true });

      game.message_id = response.resource?.message?.id || null;
      await game.save();

      await logCasino(client, makeLogEmbed("🃏 Blackjack Created", `👤 **Host/Admin:** ${host}\n💰 **Buy-in:** ${formatNum(buyin)} Digital Silver\n🎮 **Game:** \`${gameId}\``));
      return;
    }

    if (command === "coinflip") {
      if (!(await isCoinflipEnabled(guildId))) return interaction.reply({ content: "❌ Coinflip is currently disabled by admins.", flags: MessageFlags.Ephemeral });

      const creator = interaction.user;
      const choice = interaction.options.getString("choice");
      const rawBet = interaction.options.getString("bet");

      const userBal = await getBal(guildId, creator.id);
      const parsed = parseAmountInput(rawBet, userBal);

      if (parsed.error) return interaction.reply({ content: `❌ ${parsed.error}`, flags: MessageFlags.Ephemeral });

      const bet = parsed.amount;

      if (bet < MIN_BET) return interaction.reply({ content: `❌ Minimum coinflip bet is **${formatNum(MIN_BET)} coins**.`, flags: MessageFlags.Ephemeral });
      if (bet > MAX_BET) return interaction.reply({ content: `❌ Max bet is **${formatNum(MAX_BET)} coins**.`, flags: MessageFlags.Ephemeral });
      if (userBal < bet) return interaction.reply({ content: "❌ You do not have enough coins.", flags: MessageFlags.Ephemeral });

      const existing = await Coinflip.findOne({ guild_id: guildId, creator_id: creator.id, status: "open" });
      if (existing) return interaction.reply({ content: "❌ You already have an active coinflip. Cancel the old one using the red cancel button.", flags: MessageFlags.Ephemeral });

      const gameId = makeGameId();
      await changeBalance(guildId, creator.id, -bet, "COINFLIP_CREATE_LOCK", `Coinflip created | Game: ${gameId}`);

      const game = await Coinflip.create({
        game_id: gameId,
        guild_id: guildId,
        channel_id: interaction.channel.id,
        creator_id: creator.id,
        choice,
        bet,
        status: "open",
        created_at: Date.now()
      });

      await logCasino(client, makeLogEmbed("🪙 Coinflip Created", `👤 **Creator:** ${creator}\n🎯 **Choice:** ${choice.toUpperCase()}\n💰 **Bet Locked:** ${formatNum(bet)} coins\n🎮 **Game:** \`${gameId}\``));

      const embed = new EmbedBuilder()
        .setTitle("🪙 Coinflip PvP")
        .setColor(0xff3b3b)
        .setDescription(
          `**Creator:** ${creator}\n` +
          `**Choice:** ${choice.toUpperCase()}\n` +
          `**Bet:** ${formatNum(bet)} coins\n\n` +
          `💰 Creator's bet is locked.\nWaiting for opponent...\n\nCreator can use the red cancel button to refund.`
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`join_coinflip:${gameId}`).setLabel("🪙 Join Coinflip").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`cancel_coinflip:${gameId}`).setLabel("Cancel").setStyle(ButtonStyle.Danger)
      );

      // RESOLVED DEPRECATION: Replace fetchReply with withResponse
      const response = await interaction.reply({ embeds: [embed], components: [row], withResponse: true });
      const msg = response.resource?.message;

      if (msg) {
        game.message_id = msg.id;
        await game.save();
      }

      // 📢 Send SEPARATE notification that auto-deletes in 1 minute
      await sendSeparateCoinflipNotification(client, guildId, creator.id, bet, choice);

      return;
    }

    if (command === "raidcancel") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Only admins can use this.", flags: MessageFlags.Ephemeral });

      const raid = await RaidBoss.findOne({ guild_id: guildId, status: { $in: ["open", "active"] } });
      if (!raid) return interaction.reply({ content: "❌ No open or active raid found.", flags: MessageFlags.Ephemeral });

      const players = await RaidPlayer.find({ raid_id: raid.raid_id });

      raid.status = "cancelled";
      raid.updated_at = Date.now();
      await raid.save();

      for (const player of players) {
        await changeBalance(guildId, player.user_id, raid.join_fee, "RAID_CANCEL_REFUND", `Raid cancelled by admin ${interaction.user.tag} | Raid: ${raid.raid_id}`);
      }

      const embed = makeLogEmbed(
        "🚫 Raid Boss Cancelled",
        `**Boss:** ${raid.boss_name}\n` +
        `🎮 **Raid:** \`${raid.raid_id}\`\n` +
        `🛡️ **Cancelled By:** ${interaction.user}\n` +
        `👥 **Players Refunded:** ${players.length}\n` +
        `💰 **Refund Each:** ${formatNum(raid.join_fee)} Digital Silver\n` +
        `💰 **Total Refunded:** ${formatNum(players.length * raid.join_fee)} Digital Silver`,
        0x808080
      );

      await logCasino(client, embed);

      if (raid.raid_channel_id && raid.raid_message_id) {
        try {
          const channel = await client.channels.fetch(raid.raid_channel_id);
          const msg = await channel.messages.fetch(raid.raid_message_id);
          await msg.edit({ embeds: [embed], components: [] });
        } catch (err) { console.error(err); }
      }

      if (raid.general_channel_id && raid.general_message_id) {
        try {
          const channel = await client.channels.fetch(raid.general_channel_id);
          const msg = await channel.messages.fetch(raid.general_message_id);
          await msg.edit({ embeds: [embed], components: [] });
        } catch (err) { console.error(err); }
      }

      return interaction.reply({
        content: `✅ Raid cancelled.\n👥 Refunded **${players.length}** players.\n💰 Total refunded: **${formatNum(players.length * raid.join_fee)} Digital Silver**`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (command === "raidadmin") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Only admins can use this.", flags: MessageFlags.Ephemeral });

      const status = interaction.options.getString("status");
      const enabled = status === "enable";

      await setRaidEnabled(guildId, enabled);
      await logCasino(client, makeLogEmbed(enabled ? "✅ Raid Boss Enabled" : "🛑 Raid Boss Disabled", `🛡️ **Admin:** ${interaction.user}\n📌 **Status:** ${enabled ? "Enabled" : "Disabled"}`, enabled ? 0x00ff00 : 0xff0000));

      return interaction.reply(enabled ? "✅ Raid boss has been **enabled**." : "🛑 Raid boss has been **disabled**.");
    }

    if (command === "raidspawn") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Only admins can use this.", flags: MessageFlags.Ephemeral });

      if (!(await isRaidEnabled(guildId))) {
        return interaction.reply({ content: "❌ Raid boss is disabled. Use `/raidadmin status:ENABLE` first.", flags: MessageFlags.Ephemeral });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const raid = await spawnRaidBoss(client, guildId);
      if (!raid) return interaction.editReply("❌ Could not spawn raid boss. Check `RAID_GENERAL_CHANNEL_ID` and `RAID_CHANNEL_ID`.");

      return interaction.editReply(`✅ Raid boss spawned in <#${process.env.RAID_GENERAL_CHANNEL_ID}>. Players continue in <#${process.env.RAID_CHANNEL_ID}>.`);
    }

    if (command === "dbstats") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Only admins can use this.", flags: MessageFlags.Ephemeral });

      const userCount = await User.countDocuments({ guild_id: guildId });
      const txCount = await Transaction.countDocuments({ guild_id: guildId });
      const openFlips = await Coinflip.countDocuments({ guild_id: guildId, status: "open" });
      const finishedFlips = await Coinflip.countDocuments({ guild_id: guildId, status: "finished" });
      const pendingWithdrawals = await Withdrawal.countDocuments({ guild_id: guildId, status: "pending" });
      const activeRaids = await RaidBoss.countDocuments({ guild_id: guildId, status: { $in: ["open", "active"] } });

      const totalCoinsArr = await User.aggregate([
        { $match: { guild_id: guildId } },
        { $group: { _id: null, total: { $sum: "$balance" } } }
      ]);
      const totalCoins = totalCoinsArr[0]?.total || 0;

      const embed = new EmbedBuilder()
        .setTitle("🗄️ DonkBot Database Stats")
        .setColor(0xff3b3b)
        .setDescription(
          `👥 **Users:** ${userCount}\n` +
          `📜 **Transactions:** ${txCount}\n` +
          `🪙 **Open Coinflips:** ${openFlips}\n` +
          `✅ **Finished Coinflips:** ${finishedFlips}\n` +
          `💸 **Pending Withdrawals:** ${pendingWithdrawals}\n` +
          `👹 **Active/Open Raids:** ${activeRaids}\n` +
          `💰 **Total Coins:** ${formatNum(totalCoins)}\n` +
          `📁 **Database Engine:** MongoDB`
        );

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (command === "allbalances") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Only admins can use this.", flags: MessageFlags.Ephemeral });

      const rows = await User.find({ guild_id: guildId }).sort({ balance: -1 }).limit(50);
      if (!rows.length) return interaction.reply({ content: "No balances found.", flags: MessageFlags.Ephemeral });

      const text = rows.map((r, i) => `#${i + 1} | <@${r.user_id}> | ${formatNum(r.balance)} coins`).join("\n");
      const chunks = chunkText(text);

      await interaction.reply({ content: `📊 **All Balances - Page 1/${chunks.length}**\n\`\`\`\n${chunks[0].replace(/<@/g, "@").replace(/>/g, "")}\n\`\`\``, flags: MessageFlags.Ephemeral });

      for (let i = 1; i < chunks.length; i++) {
        await interaction.followUp({ content: `📊 **All Balances - Page ${i + 1}/${chunks.length}**\n\`\`\`\n${chunks[i].replace(/<@/g, "@").replace(/>/g, "")}\n\`\`\``, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (command === "transactions") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return interaction.reply({ content: "❌ Only admins can use this.", flags: MessageFlags.Ephemeral });
      const data = await makeTransactionsPage(guildId, 0);
      return interaction.reply({ embeds: [data.embed], components: [pageButtons("transactions", data.page, data.maxPage, interaction.user.id)], flags: MessageFlags.Ephemeral });
    }

  } catch (err) {
    console.error("Interaction error:", err);
    return safeReply(interaction, { content: "❌ Something went wrong. Please tell an admin to check bot logs.", flags: MessageFlags.Ephemeral });
  }
});

process.on("uncaughtException", err => console.error("Uncaught Exception:", err));
process.on("unhandledRejection", err => console.error("Unhandled Rejection:", err));

// ==========================================
// DB CONNECTION & LOGIN
// ==========================================
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/economy_bot";

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log("✅ Connected to MongoDB");
    client.login(process.env.TOKEN);
  })
  .catch(err => {
    console.error("❌ MongoDB connection error:", err);
  });