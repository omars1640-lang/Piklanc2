const test = require("node:test");
const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");
const { _test: { validRecipient, escapeHtml } } = require("../lib/email");

test("mail recipients are single mailbox addresses, not address lists or injected headers", () => {
  for (const email of ["omar@example.com", "omar+support@example.com", "first.last@example.co.uk"]) assert.equal(validRecipient(email), true);
  for (const email of ["x@example.com\r\nBcc: y@example.com", "x@example.com,y@example.com", "x<y@example.com>", "a(comment)@example.com", "x@example.com;", "", "a".repeat(161) + "@example.com"]) assert.equal(validRecipient(email), false, email);
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});

test("updated Nodemailer generates ordinary PikLance emails without contacting an SMTP server", async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, disableFileAccess: true, disableUrlAccess: true });
  const result = await transport.sendMail({ from: "PikLance <info@piklance.com>", to: { address: "customer@example.com", name: "" }, subject: "PikLance support", text: "Support reply", html: "<p>Support reply</p>" });
  assert.match(result.message.toString(), /To: customer@example\.com/);
  assert.match(result.message.toString(), /Support reply/);
  await assert.rejects(transport.sendMail({ from: "info@piklance.com", to: "customer@example.com", subject: "blocked", attachments: [{ path: __filename }] }), /File access rejected/i);
  await assert.rejects(transport.sendMail({ from: "info@piklance.com", to: "customer@example.com", subject: "blocked", attachments: [{ path: "https://example.com/secret" }] }), /Url access rejected/i);
});
