import nodemailer from "nodemailer";
import addressparser from "nodemailer/lib/addressparser/index.js";
import { HttpError } from "./server.js";

const SMTP_HOST = "smtp.qq.com";
const SMTP_PORT = 465;
const MAX_SECTION_CHARACTERS = 6_000;

export const WEEKLY_QUOTES = Object.freeze([
  "把今天认真过好，就是最稳的进步。",
  "慢一点没关系，别停下就好。",
  "让微小的完成，成为明天的底气。",
  "在重复的日子里，留下清醒的刻度。",
  "一周一小步，也会走出很远的路。",
  "认真生活的人，总会被时间看见。",
  "先完成，再完善；先出发，再抵达。",
  "并肩不是时刻同步，而是彼此照亮。",
]);

function requiredConfig(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new HttpError(503, "EMAIL_NOT_CONFIGURED", "邮件通知尚未配置完成。");
  }
  return value;
}

function strictMailbox(value) {
  const source = String(value || "").trim();
  if (!source || source.length > 320 || /[\r\n\u0000-\u001f\u007f]/.test(source)) return null;
  const parsed = addressparser(source);
  if (parsed.length !== 1 || parsed[0].group || !parsed[0].address) return null;
  const address = String(parsed[0].address).trim();
  if (address.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) return null;
  return address;
}

function safeHeader(value, fallback) {
  const cleaned = String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/[\r\n\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || fallback).slice(0, 40);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function truncateSection(value) {
  const text = String(value || "").trim();
  if (!text) return "（未填写）";
  const characters = Array.from(text);
  if (characters.length <= MAX_SECTION_CHARACTERS) return text;
  return `${characters.slice(0, MAX_SECTION_CHARACTERS).join("")}\n\n（内容较长，邮件中已截断；完整记录请在并肩中查看。）`;
}

function isoWeekIndex(dateValue) {
  const date = new Date(`${dateValue}T12:00:00Z`);
  if (!Number.isFinite(date.valueOf())) return 0;
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86_400_000) + 1) / 7);
  return (date.getUTCFullYear() * 53) + week;
}

export function quoteForDate(dateValue) {
  const index = isoWeekIndex(dateValue) % WEEKLY_QUOTES.length;
  return WEEKLY_QUOTES[index];
}

export function checkinEmailConfig(roleId) {
  if (!["me", "partner"].includes(roleId)) {
    throw new HttpError(400, "INVALID_ROLE", "身份参数不正确。");
  }
  const sender = strictMailbox(requiredConfig("QQ_USER"));
  const recipient = strictMailbox(roleId === "me"
    ? String(process.env.QQ_TO_PARTNER || process.env.QQ_TO || "").trim()
    : String(process.env.QQ_TO_ME || sender || "").trim());
  const auth = requiredConfig("QQ_AUTH");
  if (!sender || !recipient) {
    throw new HttpError(503, "EMAIL_NOT_CONFIGURED", "搭档邮箱尚未配置完成。");
  }
  return { sender, recipient, auth };
}

export function recipientForRole(roleId) {
  const { sender, recipient } = checkinEmailConfig(roleId);
  return { sender, recipient };
}

export function buildCheckinMessage({ roleName, date, log, publicUrl }) {
  const name = safeHeader(roleName, "搭档");
  const growthText = truncateSection(log.growthText);
  const lifeText = truncateSection(log.lifeText);
  const growthScore = Number(log.growthScore || 0);
  const lifeScore = Number(log.lifeScore || 0);
  const totalScore = growthScore + lifeScore;
  const quote = quoteForDate(date);
  const siteUrl = /^https?:\/\//i.test(String(publicUrl || ""))
    ? String(publicUrl).trim()
    : "https://pair-star-journal.vercel.app/";
  const subject = `[并肩] ${name} 已打卡 · ${date}`;
  const text = [
    `${name} 完成了今天的打卡。`,
    "",
    `学习与工作 · ${growthScore}/5`,
    growthText,
    "",
    `生活与娱乐 · ${lifeScore}/5`,
    lifeText,
    "",
    `今日自评分：${totalScore}/10`,
    "",
    `本周格言：${quote}`,
    "",
    `打开并肩查看完整记录：${siteUrl}`,
  ].join("\n");
  const html = `<!doctype html>
<html lang="zh-CN"><body style="margin:0;background:#fdf6e3;color:#073642;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif">
  <div style="max-width:640px;margin:0 auto;padding:32px 20px">
    <div style="padding:28px;border:1px solid #eee8d5;border-radius:18px;background:#fffdf6;box-shadow:0 12px 32px rgba(0,43,54,.08)">
      <div style="color:#2aa198;font-size:12px;font-weight:700;letter-spacing:.14em">PAIR JOURNAL · 今日打卡</div>
      <h1 style="margin:10px 0 6px;font-size:24px;line-height:1.4">${escapeHtml(name)} 已打卡</h1>
      <p style="margin:0 0 24px;color:#657b83;font-size:14px">${escapeHtml(date)} · 今日自评分 ${totalScore}/10</p>
      <section style="margin:0 0 18px;padding:18px;border-radius:14px;background:#eef7f4">
        <h2 style="margin:0 0 10px;color:#268bd2;font-size:16px">学习与工作 · ${growthScore}/5</h2>
        <div style="white-space:pre-wrap;font-size:14px;line-height:1.75">${escapeHtml(growthText)}</div>
      </section>
      <section style="margin:0 0 22px;padding:18px;border-radius:14px;background:#fff4e8">
        <h2 style="margin:0 0 10px;color:#cb4b16;font-size:16px">生活与娱乐 · ${lifeScore}/5</h2>
        <div style="white-space:pre-wrap;font-size:14px;line-height:1.75">${escapeHtml(lifeText)}</div>
      </section>
      <blockquote style="margin:0 0 22px;padding:14px 18px;border-left:3px solid #b58900;background:#fbf3cf;color:#657b83;font-size:14px;line-height:1.7">本周格言：${escapeHtml(quote)}</blockquote>
      <a href="${escapeHtml(siteUrl)}" style="display:inline-block;padding:11px 16px;border-radius:10px;background:#268bd2;color:#fff;text-decoration:none;font-size:14px;font-weight:700">打开并肩查看记录</a>
    </div>
  </div>
</body></html>`;
  return { subject, text, html, quote };
}

function safeMessageId(value) {
  const messageId = String(value || "").trim();
  if (!/^<[^<>\s\r\n]{1,250}>$/.test(messageId)) {
    throw new HttpError(500, "INVALID_MESSAGE_ID", "邮件通知编号无效。");
  }
  return messageId;
}

function isDefiniteSmtpFailure(error) {
  const code = String(error?.code || "").toUpperCase();
  const command = String(error?.command || "").toUpperCase();
  const responseCode = Number(error?.responseCode || 0);
  if (["EAUTH", "EENVELOPE", "EMESSAGE"].includes(code)) return true;
  if (["AUTH", "MAIL FROM", "RCPT TO"].includes(command)) return true;
  return responseCode >= 500 && command !== "DATA";
}

export async function sendCheckinEmail({ config, roleName, date, log, messageId }) {
  const { sender, recipient, auth } = config || {};
  if (!sender || !recipient || !auth) {
    throw new HttpError(503, "EMAIL_NOT_CONFIGURED", "邮件通知尚未配置完成。");
  }
  const message = buildCheckinMessage({
    roleName,
    date,
    log,
    publicUrl: process.env.APP_PUBLIC_URL,
  });
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: true,
    auth: { user: sender, pass: auth },
    connectionTimeout: 6_000,
    greetingTimeout: 5_000,
    socketTimeout: 8_000,
    tls: { minVersion: "TLSv1.2", servername: SMTP_HOST },
  });

  try {
    await transporter.sendMail({
      from: { name: "并肩 · 打卡通知", address: sender },
      to: recipient,
      messageId: safeMessageId(messageId),
      subject: message.subject,
      text: message.text,
      html: message.html,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (isDefiniteSmtpFailure(error)) {
      throw new HttpError(502, "EMAIL_SEND_FAILED", "邮件服务器明确拒绝了这次通知，请检查配置后重试。");
    }
    throw new HttpError(
      502,
      "CHECKIN_DELIVERY_UNKNOWN",
      "邮件发送结果暂时无法确认，请不要立即重复打卡。",
    );
  } finally {
    transporter.close();
  }
  return { quote: message.quote, sentAt: new Date().toISOString() };
}
