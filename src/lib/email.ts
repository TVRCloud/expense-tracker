import nodemailer, { type Transporter } from "nodemailer";
import { config } from "@/lib/config";
import logger from "@/lib/logger";

let transport: Transporter | null = null;

function getTransport(): Transporter | null {
  const { host, port, user, pass } = config.email;
  if (!host) return null;

  if (!transport) {
    transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user ? { user, pass } : undefined,
    });
  }
  return transport;
}

// Sends the password reset email. Never throws — callers must not let a
// mail-provider failure change the response returned to the client (that
// would leak account existence via a timing/error side channel). The caller
// is responsible for never logging `resetUrl` itself.
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const mailer = getTransport();
  if (!mailer) {
    // SMTP not configured (e.g. local dev without a provider set up).
    if (config.app.nodeEnv !== "production") {
      // DEV ONLY - convenience so the reset flow is testable without SMTP.
      // Never enabled in production.
      logger.debug({ to, resetUrl }, "[dev only] SMTP not configured; reset link");
    } else {
      logger.warn({ to }, "SMTP not configured; password reset email not sent");
    }
    return;
  }

  try {
    await mailer.sendMail({
      from: config.email.from,
      to,
      subject: "Reset your Finance OS password",
      text: `We received a request to reset your password. This link expires in 1 hour:\n\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
      html: `<p>We received a request to reset your password. This link expires in 1 hour:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
    });
  } catch (err) {
    logger.error({ err, to }, "Failed to send password reset email");
  }
}
