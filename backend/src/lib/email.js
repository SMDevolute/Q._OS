// email.js — outbound email (magic links, invites, password resets).
// Uses Resend if RESEND_API_KEY is set; otherwise logs the link (dev mode).
// Swap the provider here without touching the rest of the app.

export async function sendEmail(env, { to, subject, html, text }) {
  if (!env.RESEND_API_KEY) {
    // Dev fallback: no provider configured. Log so you can copy the link locally.
    console.log(`[email:dev] To:${to} | ${subject}\n${text || html}`);
    return { delivered: false, dev: true };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM || "Q. OS <no-reply@example.com>",
      to: [to],
      subject,
      html: html || undefined,
      text: text || undefined,
    }),
  });
  if (!res.ok) {
    console.error("email send failed", res.status, await res.text());
    return { delivered: false, error: true };
  }
  return { delivered: true };
}

export function linkEmail(kind, url) {
  const label = kind === "invite" ? "join the workspace"
    : kind === "password_reset" ? "reset your password"
    : "sign in";
  const text = `Click to ${label}:\n${url}\n\nThis link expires soon and can be used once. If you didn't request it, ignore this email.`;
  const html = `<p>Click to ${label}:</p><p><a href="${url}">${url}</a></p>`
    + `<p style="color:#888;font-size:13px">This link expires soon and can be used once. If you didn't request it, ignore this email.</p>`;
  return { text, html };
}
