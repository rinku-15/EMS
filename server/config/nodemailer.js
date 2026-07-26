import { createTransport } from "nodemailer";

const transporter = createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendEmail = async ({ to, subject, body }) => {
  try {
    return await transporter.sendMail({
      from: process.env.SENDER_EMAIL,
      to,
      subject,
      html: body,
    });
  } catch (error) {
    console.error(`❌ Failed to send email to ${to}`, error);
    throw error;
  }
};

export default sendEmail;