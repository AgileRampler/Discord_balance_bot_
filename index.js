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

const BOT_VERSION = "2.4.0";
const MAX_BET = 1_000_000;

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
        name: "/coinflip | /balance",
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

      let removeAmount = 0;

      if (input === "all") {
        removeAmount = balance;
      } else if (input.endsWith("%")) {
        const percent = parseFloat(input.replace("%", ""));

        if (isNaN(percent) || percent <= 0 || percent > 100) {
          return interaction.reply({
            content: "❌ Percentage must be between 1% and 100%. Example: `25%`",
            ephemeral: true
          });
        }

        removeAmount = Math.floor((balance * percent) / 100);
      } else {
        removeAmount = parseInt(input);

        if (isNaN(removeAmount) || removeAmount <= 0) {
          return interaction.reply({
            content: "❌ Use a number, `all`, or percentage like `10%`.",
            ephemeral: true
          });
        }

        removeAmount = Math.min(balance, removeAmount);
      }

      changeBalance(
        guildId,
        user.id,
        -removeAmount,
        "ADMIN_REMOVE",
        `Removed by ${interaction.user.tag}`
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

      return interaction.reply(
        enabled
          ? "✅ Coinflip has been **enabled**."
          : "🛑 Coinflip has been **disabled**."
      );
    }

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

client.login(process.env.TOKEN);
