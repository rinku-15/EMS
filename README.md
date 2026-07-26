# 🚀 QuickEMS - Employee Management System

A full-stack Employee Management System (EMS) built using the MERN Stack to simplify employee management, attendance tracking, leave management, payroll, and performance monitoring.

The application provides separate Admin and Employee dashboards with secure authentication, automated attendance workflows, scheduled background jobs using Inngest, and email notifications.



## ✨ Features

### 👨‍💼 Admin Dashboard

- Add, Update & Delete Employees
- Manage Departments
- Manage Attendance
- Approve / Reject Leave Applications
- Payroll Management
- Performance Reviews
- Dashboard Analytics
- Employee Status Management
- Role-Based Access Control

### 👩‍💻 Employee Dashboard

- Secure Login
- Daily Check-In / Check-Out
- View Attendance History
- Apply for Leave
- View Leave Status
- View Salary Details
- View Performance Reviews
- Update Profile



## ⚡ Automation (Inngest)

- Automatic Check-Out Reminder after 9 hours
- Automatic Half-Day marking if employee doesn't check out
- Leave Reminder to Admin after 24 hours
- Daily Attendance Reminder Cron (11:30 AM IST)
- Automated Email Notifications



## 📧 Email Notifications

The system automatically sends emails for:

- Attendance Reminder
- Check-Out Reminder
- Pending Leave Reminder

Powered by **Brevo SMTP + Nodemailer**



## 🔐 Authentication

- JWT Authentication
- Role-Based Authorization
- Protected Routes
- Secure Password Storage



## 🛠️ Tech Stack

### Frontend

- React.js
- Vite
- Tailwind CSS
- Axios
- React Router
- React Toastify

### Backend

- Node.js
- Express.js
- MongoDB
- Mongoose
- JWT
- Nodemailer
- Inngest



## 📂 Project Structure


EMS
│
├── client
│   ├── src
│   ├── public
│   └── package.json
│
├── server
│   ├── config
│   ├── controllers
│   ├── middleware
│   ├── models
│   ├── routes
│   ├── inngest
│   └── server.js
│
└── README.md




## 🚀 Installation

### Clone Repository

bash
git clone https://github.com/yourusername/EMS.git


### Backend

bash
cd server
npm install
npm run server


### Frontend

bash
cd client
npm install
npm run dev




## 🔑 Environment Variables

Create a `.env` file inside the server folder.

env
MONGODB_URI=

JWT_SECRET=

SMTP_USER=
SMTP_PASS=
SENDER_EMAIL=

ADMIN_EMAIL=

INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=




## 👤 Demo Credentials

### Admin


Email:admin@example.com
Password:admin123


### Employee


Email:avaniv964@gmail.com
Password:12345



## 🌟 Key Highlights

- MERN Stack Application
- JWT Authentication
- Role-Based Access Control
- Automated Attendance System
- Background Jobs using Inngest
- Automated Email Notifications
- Payroll Management
- Leave Management
- Responsive UI
- MVC Architecture



## 🚀 Future Improvements

- Face Recognition Attendance
- Mobile Application
- Real-Time Notifications
- Google Calendar Integration
- PDF & Excel Reports



## 🔗 Links

**Live Demo:** - https://ems-15ems.vercel.app/

**Frontend Repository:** - https://github.com/rinku-15/EMS/tree/main/client

**Backend Repository:** - https://github.com/rinku-15/EMS/tree/main/server



## 👨‍💻 Author

**Rinku Balai**

GitHub: https://github.com/rinku-hub15

LinkedIn: https://www.linkedin.com/in/rinku-balai-8b196228b/



## ⭐ If you found this project useful, don't forget to give it a star.
