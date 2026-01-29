import nodemailer from 'nodemailer';

// Validate required environment variables
const getEmailConfig = () => {
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    if (!emailUser || !emailPass) {
        throw new Error('EMAIL_USER and EMAIL_PASS environment variables are required');
    }

    return { emailUser, emailPass };
};

// Create transporter with environment variables
const createTransporter = () => {
    const { emailUser, emailPass } = getEmailConfig();

    return nodemailer.createTransport({
        service: 'gmail',
        secure: true,
        port: 465,
        auth: {
            user: emailUser,
            pass: emailPass,
        },
    });
};

// Function to send email
const sendEmail = async (to, subject, text, html = null) => {
    try {
        const { emailUser } = getEmailConfig();
        const transporter = createTransporter();

        const mailOptions = {
            from: emailUser,
            to,
            subject,
            text,
            html: html || text
        };

        const info = await transporter.sendMail(mailOptions);
        return info;
    } catch (error) {
        console.error('Email sending failed:', error.message);
        throw error;
    }
};

export default sendEmail;
