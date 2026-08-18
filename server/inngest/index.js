import { Inngest } from "inngest";
import Attendance from "../models/Attendance.js";
import Employee from "../models/Employee.js";
import User from "../models/User.js";
import LeaveApplication from "../models/LeaveApplication.js";
import sendEmail from "../config/nodemailer.js";

// Create a client to send and receive events
export const inngest = new Inngest({ id: "EMS" });

// Auto check out for employees
const autoCheckOut = inngest.createFunction(
    { id: "auto-check-out", triggers: [{ event: "employee/check-out" }] },

    async ({ event, step }) => {
        const { employeeId, attendanceId } = event.data;

        //Wait for 9 hours
        await step.sleepUntil("wait-for-the-9-hours", new Date(new Date().getTime() + 9 * 60 * 60 * 1000))

        //get attendance data (read-only, safe to re-run on replay)
        let attendance = await Attendance.findById(attendanceId)

        if (!attendance?.checkOut) {
            // send reminder email as its own memoized step.
            // Wrapping in step.run means:
            //   1) it will not be re-sent every time the function replays after the next sleep
            //   2) if it fails, we swallow the error here instead of crashing the whole
            //      function, so the auto-close-attendance step below still runs.
            await step.run("send-checkout-reminder-email", async () => {
                try {
                    const employee = await Employee.findById(employeeId)
                    if (!employee) return { skipped: true, reason: "employee-not-found" };

                    await sendEmail({
                        to: employee.email,
                        subject: "Attendance Check-Out Reminder",
                        body: `
                        <div style="max-width: 600px;">
                            <h2>Hi ${employee.firstName}, 👋</h2>
                            <p style="font-size: 16px;">You checked in to ${employee.department} today at:</p>
                            <p style="font-size: 18px; font-weight: bold; color: #007bff; margin: 8px 0;">${attendance?.checkIn?.toLocaleTimeString()}</p>
                            <p style="font-size: 16px;">You still haven't checked out. Please make sure to check-out within the next hour, otherwise your attendance will be automatically marked as a Half Day.</p>
                            <p style="font-size: 16px;">If you have any questions, please contact your admin.</p>
                            <br />
                            <p style="font-size: 16px;">Best Regards,</p>
                            <p style="font-size: 16px;">EMS</p>
                        </div>
                    `
                    })

                    return { sent: true };
                } catch (err) {
                    // Don't let a mail failure (SMTP/network/etc.) take down the whole
                    // function - if it did, the auto-close step below would never run
                    // and the attendance record would stay open (checkOut: null) forever.
                    console.error(`Failed to send checkout reminder email for attendance ${attendanceId}`, err);
                    return { sent: false, error: err?.message };
                }
            })

            // after 10 hours, mark attendance as checked out with status "late"
            await step.sleepUntil("wait-for-the-1-hour", new Date(new Date().getTime() + 1 * 60 * 60 * 1000))

            // isolate the final write in its own step too, so it's memoized/durable
            // and guaranteed to run exactly once regardless of what happened above.
            await step.run("auto-close-attendance", async () => {
                const latestAttendance = await Attendance.findById(attendanceId)
                if (!latestAttendance?.checkOut) {
                    latestAttendance.checkOut = new Date(new Date(latestAttendance.checkIn).getTime() + 4 * 60 * 60 * 1000);
                    latestAttendance.workingHours = 4;
                    latestAttendance.dayType = "Half Day";
                    latestAttendance.status = "LATE";
                    await latestAttendance.save();
                    return { closed: true };
                }
                return { closed: false, reason: "already-checked-out" };
            })
        }
    },
);


// send email to admin , if admin doesnt take action on leave application within 24 hours
const leaveApplicationReminder = inngest.createFunction(
    { id: "leave-application-reminder", triggers: [{ event: "leave/pending" }] },

    async ({ event, step }) => {
        const { leaveApplicationId } = event.data;

        // wait for 24 hours
        await step.sleepUntil("wait-for-the-24-hours", new Date(new Date().getTime() + 24 * 60 * 60 * 1000))

        const leaveApplication = await LeaveApplication.findById(leaveApplicationId)

        if (leaveApplication?.status === "PENDING") {
            // wrapped in step.run so it's memoized (won't double-send on replay)
            // and so a mail failure doesn't surface as an unhandled function crash
            await step.run("send-leave-reminder-email", async () => {
                try {
                    const employee = await Employee.findById(leaveApplication.employeeId)
                    if (!employee) return { skipped: true, reason: "employee-not-found" };

                    // Notify every admin, not just one hardcoded address - the
                    // system supports multiple admins, so every admin should
                    // find out about a pending leave, not just whoever happens
                    // to be set in ADMIN_EMAIL.
                    const admins = await User.find({ role: "ADMIN" }).select("email").lean();
                    let recipients = admins.map((a) => a.email).filter(Boolean);

                    // Fallback: if for some reason no ADMIN users are found in
                    // the DB, still fall back to ADMIN_EMAIL so the reminder
                    // isn't silently lost.
                    if (recipients.length === 0 && process.env.ADMIN_EMAIL) {
                        recipients = [process.env.ADMIN_EMAIL];
                    }

                    if (recipients.length === 0) {
                        return { sent: false, reason: "no-admin-recipients-found" };
                    }

                    const emailBody = `
                    <div style="max-width: 600px;">
                        <h2>Hi Admin, 👋</h2>
                        <p style="font-size: 16px;">You have a pending leave application in ${employee.department}:</p>
                        <p style="font-size: 18px; font-weight: bold; color: #007bff; margin: 8px 0;">${leaveApplication?.startDate?.toLocaleDateString()}</p>
                        <p style="font-size: 16px;">Please make sure to take action on this leave application.</p>
                        <br />
                        <p style="font-size: 16px;">Best Regards,</p>
                        <p style="font-size: 16px;">EMS</p>
                    </div>
                `

                    const results = await Promise.allSettled(
                        recipients.map((to) =>
                            sendEmail({
                                to,
                                subject: "Leave Application Reminder",
                                body: emailBody,
                            })
                        )
                    );

                    const sentCount = results.filter((r) => r.status === "fulfilled").length;
                    return { sent: sentCount > 0, sentCount, totalRecipients: recipients.length };
                } catch (err) {
                    console.error(`Failed to send leave reminder email for leave ${leaveApplicationId}`, err);
                    return { sent: false, error: err?.message };
                }
            });
        }
    }

);

// cron: check attendance at 11:30 am IST (06:00 UTC) and email absent employees

const attendanceReminderCron = inngest.createFunction(
    { id: "attendance-reminder-cron", triggers: [{ cron: "TZ=Asia/Kolkata 30 11 * * *" }] },
    // 06:00 UTC = 11:30 AM IST
    async ({ step }) => {
        //step 1 : todays date range (IST)
        const today = await step.run("get-today-date", () => {
            const startUTC = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) + "T00:00:00+05:30");
            const endUTC = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000);
            return { startUTC: startUTC.toISOString(), endUTC: endUTC.toISOString() }
        })

        // step 2 : get all active , non-deleted employees
        const activeEmployees = await step.run("get-active-employees", async () => {
            // populate userId so we can filter out ADMIN accounts below -
            // admins don't have a clock-in/clock-out UI, so they should
            // never be treated as "absent" and reminded to mark attendance.
            const employees = await Employee.find({
                isDeleted: false,
                employeeStatus: "ACTIVE",
            }).populate("userId", "role").lean();

            return employees
                .filter((e) => e.userId?.role !== "ADMIN")
                .map((e) => ({
                    _id: e._id.toString(),
                    firstName: e.firstName,
                    lastName: e.lastName,
                    email: e.email,
                    department: e.department
                }));
        });
        // step 3: get employee ids on approved leave today
        const onLeaveIds = await step.run("get-on-leave-ids", async () => {
            const leaves = await LeaveApplication.find({
                status: "APPROVED",
                startDate: { $lte: new Date(today.endUTC) },
                endDate: { $gte: new Date(today.startUTC) },
            }).lean();
            return leaves.map((l) => l.employeeId.toString())
        })

        //step: 4 get employee ids who already checked in today
        const checkedInIds = await step.run("get-checked-in-ids", async () => {
            const attendances = await Attendance.find({
                date: { $gte: new Date(today.startUTC), $lt: new Date(today.endUTC) },
            }).lean();
            return attendances.map((a) => a.employeeId.toString())
        })

        //step 5 : filter absent employees (not on leaves & not checked in)
        const absentEmployees = activeEmployees.filter((emp) => !onLeaveIds.includes(emp._id) && !checkedInIds.includes(emp._id));



        // step 6 : send reminder emails
        if (absentEmployees.length > 0) {
            await step.run("send-reminder-emails", async () => {

                const emailPromises = absentEmployees.map(async (emp) => {
                    try {
                        await sendEmail({
                            to: emp.email,
                            subject: "Attendance Reminder - Please Mark Your Attendance",
                            body: `
                        <div style="max-width:600px; font-family:Arial, sans-serif;">
                            <h2>Hi ${emp.firstName}, 👋</h2>

                            <p style="font-size:16px;">
                                We noticed you haven't marked your attendance yet today.
                            </p>

                            <p style="font-size:16px;">
                                The deadline was <strong>11:30 AM</strong> and your attendance is still missing.
                            </p>

                            <p style="font-size:16px;">
                                Please check in as soon as possible or contact your admin if you're facing any issues.
                            </p>

                            <br />

                            <p style="font-size:14px; color:#666;">
                                Department: ${emp.department}
                            </p>

                            <br />

                            <p style="font-size:16px;">
                                Best Regards,
                            </p>

                            <p style="font-size:16px;">
                                <strong>QuickEMS</strong>
                            </p>
                        </div>
                    `
                        });
                    } catch (err) {
                        console.error(`Failed to send email to ${emp.email}`, err);
                    }
                });

                await Promise.all(emailPromises);

                return {
                    emailsSent: absentEmployees.length,
                };
            });

            // step 7 : actually record the absence in the DB (not just email
            // about it). Use the SAME "start of day" calculation that
            // attendanceController.clockInOut uses for its `date` field
            // (server-local midnight), so that if this employee checks in
            // later today, it looks up/updates this exact same record
            // instead of colliding with a different `date` value or
            // silently creating a second, contradictory record for today.
            await step.run("mark-absent-employees", async () => {
                const dayStart = new Date();
                dayStart.setHours(0, 0, 0, 0);

                const results = await Promise.all(
                    absentEmployees.map(async (emp) => {
                        try {
                            // upsert: if a record for today already exists for
                            // this employee (shouldn't, since we already
                            // filtered out checked-in employees, but be safe
                            // against race conditions / retries), don't
                            // overwrite it - only create when truly missing.
                            const created = await Attendance.findOneAndUpdate(
                                { employeeId: emp._id, date: dayStart },
                                {
                                    $setOnInsert: {
                                        employeeId: emp._id,
                                        date: dayStart,
                                        checkIn: null,
                                        checkOut: null,
                                        status: "ABSENT",
                                    },
                                },
                                { upsert: true, new: true, setDefaultsOnInsert: true }
                            );
                            return { employeeId: emp._id, ok: true, id: created._id };
                        } catch (err) {
                            console.error(`Failed to mark absence for employee ${emp._id}`, err);
                            return { employeeId: emp._id, ok: false, error: err?.message };
                        }
                    })
                );

                return { marked: results.filter((r) => r.ok).length };
            });
        }
        return { totalActive: activeEmployees.length, onLeave: onLeaveIds.length, checkedIn: checkedInIds.length, absent: absentEmployees.length }
    }
);

// Create an empty array where we'll export future Inngest functions
export const functions = [
    autoCheckOut,
    leaveApplicationReminder,
    attendanceReminderCron
];