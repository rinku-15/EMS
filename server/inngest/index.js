import { Inngest } from "inngest";
import Attendance from "../models/Attendance.js";
import Employee from "../models/Employee.js";
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

                    await sendEmail({
                        to: process.env.ADMIN_EMAIL,
                        subject: "Leave Application Reminder",
                        body: `
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
                    });
                    return { sent: true };
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
            const employees = await Employee.find({
                isDeleted: false,
                employeeStatus: "ACTIVE",
            }).lean();

            return employees.map((e) => ({
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