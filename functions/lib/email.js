const nodemailer = require("nodemailer");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall } = require("firebase-functions/v2/https");
const { FieldValue, HttpsError, REGION, db, requireAdmin } = require("./helpers");

const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");

function validRecipient(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function emailShell(title, body) {
  return `<div dir="rtl" style="background:#f7f6fc;padding:28px 14px;font-family:Arial,sans-serif;color:#252238"><div style="max-width:620px;margin:auto;background:#fff;border:1px solid #e8e5f4;border-radius:22px;overflow:hidden"><div style="padding:22px 28px;background:linear-gradient(135deg,#6c5ce7,#8b7cf6);color:#fff"><strong style="font-size:22px">PikLance</strong><div style="opacity:.86;font-size:13px">منصة الخدمات الرقمية السورية</div></div><div style="padding:28px;line-height:1.9"><h2 style="margin-top:0;color:#302a58">${escapeHtml(title)}</h2>${body}<p style="margin:28px 0 0;color:#777">فريق PikLance</p></div></div></div>`;
}

async function queueMailOnce(id, mail) {
  const reference = db.doc(`mailQueue/${id}`);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (snapshot.exists) return false;
    transaction.set(reference, {
      from: "PikLance <info@piklance.com>",
      replyTo: "info@piklance.com",
      status: "queued",
      attempts: 0,
      createdAt: FieldValue.serverTimestamp(),
      ...mail
    });
    return true;
  });
}

exports.sendAdminOfficialEmail = onCall({ region: REGION, enforceAppCheck: false }, async request => {
  const admin = await requireAdmin(request, ["support.reply", "verifications.manage", "services.moderate"]);
  const to = String(request.data?.to || "").trim().toLowerCase();
  const subject = String(request.data?.subject || "").trim().slice(0, 180);
  const message = String(request.data?.message || "").trim().slice(0, 5000);
  const actionUrl = String(request.data?.actionUrl || "").trim().slice(0, 500);
  const actionLabel = String(request.data?.actionLabel || "فتح PikLance").trim().slice(0, 80);
  if (!validRecipient(to) || !subject || !message) {
    throw new HttpsError("invalid-argument", "بيانات البريد غير مكتملة أو غير صالحة.");
  }
  const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");
  const safeAction = /^https:\/\//i.test(actionUrl)
    ? `<p style="margin-top:24px"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:11px 18px;border-radius:11px;background:#6c5ce7;color:#fff;text-decoration:none">${escapeHtml(actionLabel)}</a></p>`
    : "";
  const mailRef = db.collection("mailQueue").doc();
  const logRef = db.collection("mailLogs").doc();
  const batch = db.batch();
  batch.set(mailRef, {
    from: "PikLance <info@piklance.com>", replyTo: admin.email || "info@piklance.com",
    to, subject, text: message, html: emailShell(subject, `<p>${safeMessage}</p>${safeAction}`),
    template: request.data?.purpose || "admin_message", reference: request.data?.reference || "",
    status: "queued", attempts: 0, createdAt: FieldValue.serverTimestamp()
  });
  batch.set(logRef, {
    to, subject, purpose: request.data?.purpose || "admin_message", sentBy: admin.id,
    queueId: mailRef.id, createdAt: FieldValue.serverTimestamp()
  });
  await batch.commit();
  return { ok: true, queueId: mailRef.id };
});

exports.sendQueuedEmail = onDocumentCreated({
  document: "mailQueue/{mailId}",
  region: REGION,
  secrets: [SMTP_USER, SMTP_PASS],
  retry: true
}, async event => {
  const snapshot = event.data;
  if (!snapshot) return;
  const mail = snapshot.data();
  if (mail.status === "sent") return;
  const user = SMTP_USER.value();
  const pass = SMTP_PASS.value();
  if (!user || !pass) {
    await snapshot.ref.update({ status: "configuration_required", updatedAt: FieldValue.serverTimestamp() });
    console.error("SMTP secrets are not configured");
    return;
  }
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass }
  });
  try {
    const result = await transport.sendMail({
      from: mail.from || "PikLance <info@piklance.com>",
      replyTo: mail.replyTo || "info@piklance.com",
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html || undefined
    });
    await snapshot.ref.update({
      status: "sent",
      providerMessageId: result.messageId || "",
      sentAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  } catch (error) {
    await snapshot.ref.update({
      status: "failed",
      lastError: String(error.message || error).slice(0, 500),
      attempts: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp()
    });
    throw error;
  }
});

exports.sendOfficialEmail = onDocumentCreated({
  document: "supportTickets/{ticketId}/replies/{replyId}",
  region: REGION,
  retry: true
}, async event => {
  const replySnapshot = event.data;
  if (!replySnapshot) return;
  const reply = replySnapshot.data();
  if (reply.authorRole !== "admin") return;
  const { ticketId, replyId } = event.params;
  const ticketSnapshot = await db.doc(`supportTickets/${ticketId}`).get();
  if (!ticketSnapshot.exists) return;
  const ticket = ticketSnapshot.data();
  const recipient = String(ticket.requesterEmail || "").trim().toLowerCase();
  if (!validRecipient(recipient)) {
    console.warn("Support reply email skipped: invalid recipient", ticketId);
    return;
  }
  const subject = `رد جديد من دعم PikLance - ${ticket.subject || `التذكرة ${ticketId.slice(0, 8)}`}`;
  const replyText = String(reply.text || "").trim();
  const ticketTitle = escapeHtml(ticket.subject || "تذكرة الدعم");
  const replyHtml = escapeHtml(replyText).replace(/\n/g, "<br>");
  await queueMailOnce(`support_${ticketId}_${replyId}`, {
    to: recipient,
    subject,
    text: `مرحباً ${ticket.requesterName || ""}،\n\nوصلك رد جديد من فريق دعم PikLance على تذكرتك: ${ticket.subject || ticketId}\n\n${replyText}\n\nيمكنك متابعة التذكرة والرد من هنا: https://piklance.com/support.html\n\nفريق PikLance`,
    html: emailShell("رد جديد من فريق الدعم", `<p>مرحباً ${escapeHtml(ticket.requesterName || "")}</p><p>وصلك رد جديد على تذكرة <strong>${ticketTitle}</strong>:</p><div style="padding:18px;border-radius:14px;background:#f5f3ff;border-right:4px solid #6c5ce7">${replyHtml}</div><p style="margin-top:24px"><a href="https://piklance.com/support.html" style="display:inline-block;padding:11px 18px;border-radius:11px;background:#6c5ce7;color:#fff;text-decoration:none">فتح مركز الدعم</a></p>`),
    template: "support_admin_reply",
    reference: ticketId,
    relatedTicketId: ticketId,
    relatedReplyId: replyId
  });
});

exports.sendLaunchSubscriberWelcome = onDocumentCreated({
  document: "launchSubscribers/{subscriberId}",
  region: REGION,
  retry: true
}, async event => {
  const subscriberSnapshot = event.data;
  if (!subscriberSnapshot) return;
  const subscriber = subscriberSnapshot.data();
  const recipient = String(subscriber.email || "").trim().toLowerCase();
  if (!validRecipient(recipient)) {
    console.warn("Launch welcome email skipped: invalid recipient", event.params.subscriberId);
    return;
  }
  await queueMailOnce(`launch_${event.params.subscriberId}`, {
    to: recipient,
    subject: "أهلاً بك في قائمة إطلاق PikLance",
    text: "أهلاً بك،\n\nتم تسجيل بريدك بنجاح ضمن قائمة إطلاق PikLance. ستكون من أوائل من تصله أخبار الإطلاق الرسمي بتاريخ 01/08/2026.\n\nفريق PikLance",
    html: emailShell("أهلاً بك في PikLance", "<p>تم تسجيل بريدك بنجاح ضمن قائمة الإطلاق.</p><p>ستكون من أوائل من تصله أخبار المنصة وموعد الإطلاق الرسمي بتاريخ <strong dir=\"ltr\">01/08/2026</strong>.</p><p style=\"padding:16px;border-radius:14px;background:#f5f3ff;color:#4f43a7\">شكراً لأنك جزء من بداية PikLance.</p>"),
    template: "launch_subscriber_welcome",
    reference: event.params.subscriberId,
    relatedSubscriberId: event.params.subscriberId
  });
});
