import { Mongo } from "@telegraf/session/mongodb";
import * as dotenv from "dotenv";
import { Context, Telegraf, session } from "telegraf";
import { message } from "telegraf/filters";
import { MongoClient } from "mongodb";

dotenv.config();

export type State = "choose_language" | "ask_full_name" | "ask_contact" | "authenticated";

interface YankeyContext extends Context {
  session: {
    state?: State;
    lang?: keyof typeof languageOptions;
    full_name?: string;
    phone_number?: string;
  };
}

const languageOptions = {
  uzb: {
    success: "✅ Qabul qilindi.",
    choose_language: "Iltimos, tilni tanlang",
    ask_full_name: "Iltimos, to'liq ismingizni kiriting:",
    ask_contact: "Iltimos, telefon raqamingizni yuboring:",
    authenticated: "Siz muvaffaqiyatli autentifikatsiyadan o'tdingiz!",
    reset: "Sessiya tiklandi.",
    send_contact: "Telefon raqamni yuborish",
    view_balance: "Balansni ko'rish",
    change_language: "Tilni o'zgartirish",
    language_changed: "Til muvaffaqiyatli o'zgartirildi!"
  },
  rus: {
    success: "✅ Принят",
    choose_language: "Пожалуйста, выберите язык",
    ask_full_name: "Пожалуйста, введите ваше полное имя:",
    ask_contact: "Пожалуйста, отправьте свой номер телефона:",
    authenticated: "Вы успешно прошли аутентификацию!",
    reset: "Сессия сброшена.",
    send_contact: "Отправить номер телефона",
    view_balance: "Посмотреть баланс",
    change_language: "Сменить язык",
    language_changed: "Язык успешно изменён!"
  }
};

const LANGS_KEYBOARD = [
  [
    { text: "🇺🇿 O'zbek", callback_data: "uzb" },
    { text: "🇷🇺 Русский", callback_data: "rus" }
  ]
];

function getMainKeyboard(lang: keyof typeof languageOptions) {
  return {
    keyboard: [
      [
        { text: languageOptions[lang].view_balance },
        { text: languageOptions[lang].change_language }
      ]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

function getContactKeyboard(lang: keyof typeof languageOptions) {
  return {
    keyboard: [[{ text: languageOptions[lang].send_contact, request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true
  };
}

const bot = new Telegraf<YankeyContext>(process.env.BOT_TOKEN!);

async function processStateMessage(state: State, ctx: YankeyContext) {
  const lang = ctx.session.lang || "uzb";
  switch (state) {
    case "choose_language":
      return ctx.reply([languageOptions["uzb"].choose_language, languageOptions["rus"].choose_language].join("\n"), {
        reply_markup: { inline_keyboard: LANGS_KEYBOARD, remove_keyboard: true }
      });
    case "ask_full_name":
      return ctx.reply(languageOptions[lang].ask_full_name, {
        reply_markup: { remove_keyboard: true }
      });
    case "ask_contact":
      return ctx.reply(languageOptions[lang].ask_contact, {
        reply_markup: getContactKeyboard(lang)
      });
    case "authenticated":
      return ctx.reply(languageOptions[lang].authenticated, {
        reply_markup: getMainKeyboard(lang)
      });
  }
}

async function main() {
  const client = await MongoClient.connect("mongodb://127.0.0.1:27017/telegram_bot");
  const store = Mongo({
    client,
    collection: "sessions",
  });

  bot.use(session({
    store,
    getSessionKey: (ctx) => ctx.from && ctx.chat ? `${ctx.from.id}:${ctx.chat.id}` : undefined,
    defaultSession() {
      return { state: "choose_language", lang: undefined };
    },
  }));

  bot.command("reset", async (ctx) => {
    ctx.session = { state: "choose_language", lang: undefined };
    await ctx.reply([languageOptions["uzb"].success, languageOptions["rus"].success].join("\n"), { reply_markup: { remove_keyboard: true } });
    await processStateMessage("choose_language", ctx);
  });

  bot.hears([
    languageOptions.uzb.change_language,
    languageOptions.rus.change_language
  ], async (ctx) => {
    ctx.session.lang = undefined;
    ctx.session.state = "choose_language";
    await ctx.reply(languageOptions[ctx.session.lang || "uzb"].success);
    await processStateMessage("choose_language", ctx);
  });

  bot.on("callback_query", async (ctx) => {
    if (ctx.callbackQuery && "data" in ctx.callbackQuery) {
      const lang = ctx.callbackQuery.data as keyof typeof languageOptions;
      if (lang === "uzb" || lang === "rus") {
        ctx.session.lang = lang;
        if (!ctx.session.full_name) {
          ctx.session.state = "ask_full_name";
          await ctx.reply(languageOptions[lang].success);
          await processStateMessage("ask_full_name", ctx);
        } else if (!ctx.session.phone_number) {
          ctx.session.state = "ask_contact";
          await ctx.reply(languageOptions[lang].success);
          await processStateMessage("ask_contact", ctx);
        } else {
          ctx.session.state = "authenticated";
          await ctx.reply(languageOptions[lang].success);
          await ctx.reply(languageOptions[lang].language_changed, {
            reply_markup: getMainKeyboard(lang)
          });
        }
        await ctx.answerCbQuery();
      }
    }
  });

  bot.on(message("text"), async (ctx) => {
    const { state, lang } = ctx.session;
    if (!lang || state === "choose_language") {
      ctx.session.state = "choose_language";
      ctx.session.lang = undefined;
      await ctx.reply(languageOptions[lang || "uzb"].success);
      return processStateMessage("choose_language", ctx);
    }
    if (!ctx.session.full_name || state === "ask_full_name") {
      ctx.session.full_name = ctx.message.text;
      ctx.session.state = "ask_contact";
      await ctx.reply(languageOptions[lang].success);
      return processStateMessage("ask_contact", ctx);
    }
  });

  bot.on(message("contact"), async (ctx) => {
    if (ctx.session.state === "ask_contact" && ctx.message.contact) {
      ctx.session.phone_number = ctx.message.contact.phone_number;
      ctx.session.state = "authenticated";
      await ctx.reply(languageOptions[ctx.session.lang || "uzb"].success);
      return processStateMessage("authenticated", ctx);
    }
  });

  bot.start(async (ctx) => {
    ctx.session.state = "choose_language";
    ctx.session.lang = undefined;
    await processStateMessage("choose_language", ctx);
  });

  await bot.launch(() => {
    console.log("Bot is running");
  });
}

main();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));