# Attendance Management & Tracking System (Node.js + Express + MySQL)

## Setup
1. Install Node.js 18+ and MySQL 8.
2. `mysql -u root -p < schema.sql`
3. `npm install`
4. Set DB credentials if needed: `DB_HOST`, `DB_USER`, `DB_PASS`, and `JWT_SECRET`.
5. `node seed.js` (creates demo users and attendance, run once)
6. `npm start`, then open http://localhost:3000

## Demo logins (password: password123)
student1@demo.in, parent@demo.in, faculty@demo.in, mentor@demo.in, hod@demo.in

## Structure
- schema.sql: tables for users, subjects, sessions, records, leaves, alerts, audit_log, settings
- server.js: REST API, JWT auth with role checks, calculation engine, alerts, leave workflow, reports
- public/index.html: role-based web interface
- seed.js: demo data

## Features
Attendance marking, auto percentage, configurable 80% threshold, alerts (English, Hindi, Marathi) with escalation,
leave and condonation workflow, exam eligibility, skip/recover calculator, projection, daily to semester reports with CSV, audit log.
Email and SMS are stubbed in notify() in server.js: connect nodemailer or Twilio there.

## Version 2 additions (run upgrade.sql once)
Attendance calendar and weekly trend chart, attendance correction requests (student to faculty), early-warning "Trending down" flag with escalation level,
mentor meeting notes with follow-up status, custom date-range reports, bulk student import for the HOD.

## Real timetable data (Semester V, Div A)
Run `node seed_timetable.js` instead of `seed.js`. It loads SE, AI, IVP, OS and DE-I MAD with their faculty. Faculty can only mark and review
corrections for the subjects assigned to them (OS has a theory and a lab faculty). Logins: se@, ai@, ivp@, os@, oslab@, mad@, mentor@, hod@ (all @demo.in).

## Version 3 (run `npm install` and upgrade2.sql once)
QR check-in (faculty Live QR tab, student Check in tab), login lockout after 5 failed attempts, change-password page, .env configuration (copy .env.example to .env),
optional real email alerts via SMTP, installable on phones (manifest). For QR, open the site on the PC's Wi-Fi IP address so phones can reach it.

## Version 4: unique features
- Recovery Planner (student, parent): plans to the end of the 15-week term. Shows how many of the remaining classes must be attended per subject, a weekly pace, and a what-if slider that shows the final percentage if classes are missed.
- Absence Insights (faculty, mentor, HOD): weekday x time-slot heatmap of absenteeism and a subject-wise absence rate.

## Deployment (free cloud)
See the steps in the chat: GitHub, then a free MySQL (for example Aiven), then a Node web service (for example Render). Set DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME, DB_SSL=true and JWT_SECRET as environment variables. Load cloud_setup.sql once, then run node seed_timetable.js with the same variables.
