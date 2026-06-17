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
const db = new Database("economy.db");

const BOT_VERSION = "2.0.0";
const MAX_BET = 100_000_000;

db.prepare(`
CREATE TABLE IF NOT EXISTS users (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  balance INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
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
      o.setName("bet")
        .setDescription("Bet amount")
        .setRequired(true)
    )
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
    console.error(err);
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

client.on("interactionCreate", async interaction => {
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

  if (command === "addcoins") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "❌ Only admins can use this.", ephemeral: true });
    }

    const user = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");

    if (amount <= 0) {
      return interaction.reply({ content: "❌ Amount must be more than 0.", ephemeral: true });
    }

    addBal(guildId, user.id, amount);

    return interaction.reply(
      `✅ Added **${amount.toLocaleString()} coins** to ${user}.\n` +
      `💰 New balance: **${getBal(guildId, user.id).toLocaleString()} coins**`
    );
  }

  if (command === "removecoins") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "❌ Only admins can use this.", ephemeral: true });
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

    addBal(guildId, user.id, -removeAmount);

    return interaction.reply(
      `✅ Removed **${removeAmount.toLocaleString()} coins** from ${user}.\n` +
      `💰 New balance: **${getBal(guildId, user.id).toLocaleString()} coins**`
    );
  }

  if (command === "coinflip") {
    const creator = interaction.user;
    const choice = interaction.options.getString("choice");
    const bet = interaction.options.getInteger("bet");

    if (bet <= 0) {
      return interaction.reply({ content: "❌ Bet must be more than 0.", ephemeral: true });
    }

    if (bet > MAX_BET) {
      return interaction.reply({
        content: `❌ Max bet is **${MAX_BET.toLocaleString()} coins**.`,
        ephemeral: true
      });
    }

    if (getBal(guildId, creator.id) < bet) {
      return interaction.reply({ content: "❌ You do not have enough coins.", ephemeral: true });
    }

    addBal(guildId, creator.id, -bet);

    const oppositeChoice = choice === "heads" ? "tails" : "heads";

    const embed = new EmbedBuilder()
      .setTitle("🪙 Coinflip PvP")
      .setColor(0xff3b3b)
      .setDescription(
        `**Creator:** ${creator}\n` +
        `**Choice:** ${choice.toUpperCase()}\n` +
        `**Bet:** ${bet.toLocaleString()} coins\n\n` +
        `💰 Creator's bet is locked.\n` +
        `Waiting for opponent...\n\n` +
        `⏰ Expires in 1 minute`
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("join_coinflip")
        .setLabel("🪙 Join Coinflip")
        .setStyle(ButtonStyle.Success)
    );

    const message = await interaction.reply({
      embeds: [embed],
      components: [row],
      fetchReply: true
    });

    const collector = message.createMessageComponentCollector({
      time: 60000,
      max: 1
    });

    collector.on("collect", async btn => {
      const opponent = btn.user;

      if (opponent.id === creator.id) {
        return btn.reply({
          content: "❌ You cannot join your own coinflip.",
          ephemeral: true
        });
      }

      if (opponent.bot) {
        return btn.reply({
          content: "❌ Bots cannot join.",
          ephemeral: true
        });
      }

      if (getBal(guildId, opponent.id) < bet) {
        return btn.reply({
          content: "❌ You do not have enough coins to join.",
          ephemeral: true
        });
      }

      addBal(guildId, opponent.id, -bet);

      const result = Math.random() < 0.5 ? "heads" : "tails";
      const winner = result === choice ? creator : opponent;
      const loser = winner.id === creator.id ? opponent : creator;
      const pot = bet * 2;

      addBal(guildId, winner.id, pot);

      const resultEmbed = new EmbedBuilder()
        .setTitle("🪙 Coinflip Result")
        .setColor(0xff3b3b)
        .setDescription(
          `🎯 **Result:** ${result.toUpperCase()}\n\n` +
          `🏆 **Winner:** ${winner}\n` +
          `💀 **Loser:** ${loser}\n` +
          `💰 **Pot Won:** ${pot.toLocaleString()} coins\n\n` +
          `**${creator.username}:** ${choice.toUpperCase()}\n` +
          `**${opponent.username}:** ${oppositeChoice.toUpperCase()}`
        );

      return btn.update({
        embeds: [resultEmbed],
        components: []
      });
    });

    collector.on("end", async collected => {
      if (collected.size === 0) {
        addBal(guildId, creator.id, bet);

        const expiredEmbed = new EmbedBuilder()
          .setTitle("🪙 Coinflip Expired")
          .setColor(0x808080)
          .setDescription(
            `**Creator:** ${creator}\n` +
            `**Choice:** ${choice.toUpperCase()}\n` +
            `**Bet:** ${bet.toLocaleString()} coins\n\n` +
            `⌛ No one joined.\n` +
            `💰 Bet refunded to creator.`
          );

        await interaction.editReply({
          embeds: [expiredEmbed],
          components: []
        });
      }
    });
  }
});

client.login(process.env.TOKEN);