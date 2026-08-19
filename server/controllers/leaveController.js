import { err } from "inngest/types";
import Employee from "../models/Employee.js";
import LeaveApplication from "../models/LeaveApplication.js";
import User from "../models/User.js";
import { inngest } from "../inngest/index.js";
import sendEmail from "../config/nodemailer.js";

// create leave
// pst/api/leaves



export const createLeave = async(req, res) => {
    try {
        const session = req.session;
        const employee = await Employee.findOne({userId: session.userId})
        if(!employee) return res.status(404).json({error: "Employee not found"});
        if(employee.isDeleted){
            return res.status(403).json({
                error: "Your account is deactivated. You cannot apply for leave."
            });
        }
        const { type, startDate, endDate, reason } = req.body;

        if(!type || !startDate || !endDate || !reason){
            return res.status(400).json({error: "Missing fields"});
        }

        const today = new Date();
        today.setHours(0,0,0,0);
        if(new Date(startDate) <= today || new Date(endDate) <= today){
            return res.status(400).json({error: "Leave dates must be in the future"})
        }

        if(new Date(endDate) < new Date(startDate)){
            return res.status(400).json({error: "end date cannot be before start date"})
        }

        const leave = await LeaveApplication.create({
            employeeId: employee._id,
            type,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            reason,
            status: "PENDING",
        })

        await inngest.send({
            name: "leave/pending",
            data: {leaveApplicationId: leave._id}
        })

        // Notify admins right away instead of leaving them to find out only
        // 24 hours later via the reminder job. That reminder still exists
        // as a backup nudge in case nobody actions it in time.
        try {
            const admins = await User.find({ role: "ADMIN" }).select("email").lean();
            let recipients = admins.map((a) => a.email).filter(Boolean);
            if (recipients.length === 0 && process.env.ADMIN_EMAIL) {
                recipients = [process.env.ADMIN_EMAIL];
            }

            if (recipients.length > 0) {
                const emailBody = `
                <div style="max-width: 600px;">
                    <h2>Hi Admin, 👋</h2>
                    <p style="font-size: 16px;">
                        ${employee.firstName} ${employee.lastName || ""} (${employee.department}) has submitted a new leave application:
                    </p>
                    <p style="font-size: 16px;">
                        <strong>Type:</strong> ${type}<br/>
                        <strong>From:</strong> ${new Date(startDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}<br/>
                        <strong>To:</strong> ${new Date(endDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}<br/>
                        <strong>Reason:</strong> ${reason}
                    </p>
                    <p style="font-size: 16px;">Please review and take action.</p>
                    <br />
                    <p style="font-size: 16px;">Best Regards,</p>
                    <p style="font-size: 16px;">EMS</p>
                </div>
            `;
                await Promise.allSettled(
                    recipients.map((to) =>
                        sendEmail({ to, subject: "New Leave Application Submitted", body: emailBody })
                    )
                );
            }
        } catch (mailErr) {
            console.error(`Failed to send new-leave notification for leave ${leave._id}`, mailErr);
            // don't fail the request just because the notification email failed
        }

        return res.json({success: true, data: leave});
    } catch (error) {
        return res.status(500).json({error: "Failed"});
    }

}

//get leaves
// get/api/leaves
export const getLeave = async(req, res) => {
    try {
        const session = req.session;
        const isAdmin = session.role === "ADMIN";
        if(isAdmin){
            const status = req.query.status;
            const where = status ? {status} : {};
            const leaves = await LeaveApplication.find(where).populate("employeeId").sort({ createdAt: -1});
            const data = leaves.map((l) => {
                const obj = l.toObject();
                return {
                    ...obj,
                    id: obj._id.toString(),
                    employee : obj.employeeId,
                    employeeId : obj.employeeId?._id?.toString(),

                }
            }) 
            return res.json({data})
        }else{
            const employee = await Employee.findOne({userId: session.userId}).lean();
            if(!employee) return res.status(404).json({error: "Not found"});
            const leaves = await LeaveApplication.find({
                employeeId: employee._id
            }).sort({createdAt: -1});
            return res.json({
                data: leaves,
                employee: {...employee, id: employee._id.toString()}
            })
        }
    } catch (error) {
        return res.status(500).json({error: "Failed"})
        
    }

}

//update leave status
// patch/api/leaves/:id
export const updateLeaveStatus = async(req, res) => {
    try {
        const {status} = req.body;
        if(!["APPROVED", "REJECTED", "PENDING"].includes(status)){
            return res.status(400).json({error: "Invalid status"});
        }

        const session = req.session;

        // Only update if it's still PENDING - this is what actually prevents
        // the race condition. If two admins click Approve/Reject on the same
        // leave at nearly the same time, only the first request's findOneAndUpdate
        // matches (status: "PENDING" at that instant) and succeeds; by the time
        // the second request runs, status is no longer "PENDING", so it matches
        // nothing and we return a clear "already handled" error instead of
        // silently overwriting the first admin's decision.
        const leave = await LeaveApplication.findOneAndUpdate(
            { _id: req.params.id, status: "PENDING" },
            {
                status,
                actionedBy: session.userId,
                actionedAt: new Date(),
            },
            { returnDocument: "after" }
        ).populate("actionedBy", "email").populate("employeeId")

        if (!leave) {
            // Either the leave doesn't exist, or it's no longer PENDING
            // (already approved/rejected by another admin).
            const existing = await LeaveApplication.findById(req.params.id).populate("actionedBy", "email")
            if (!existing) {
                return res.status(404).json({ error: "Leave application not found" });
            }
            return res.status(409).json({
                error: `This leave application was already ${existing.status.toLowerCase()} by ${existing.actionedBy?.email || "another admin"}.`,
                data: existing,
            });
        }

        // Notify the employee right away that a decision was made, instead
        // of leaving them to find out only by checking the dashboard
        // themselves. This is a direct request/response call (not an Inngest
        // step), so wrap in try/catch: a mail failure here should never
        // break the actual approve/reject action, which has already
        // succeeded in the DB by this point.
        if (status === "APPROVED" || status === "REJECTED") {
            try {
                const employee = leave.employeeId;
                if (employee?.email) {
                    const isApproved = status === "APPROVED";
                    await sendEmail({
                        to: employee.email,
                        subject: `Leave Application ${isApproved ? "Approved" : "Rejected"}`,
                        body: `
                        <div style="max-width: 600px;">
                            <h2>Hi ${employee.firstName}, 👋</h2>
                            <p style="font-size: 16px;">
                                Your leave application for
                                <strong>${new Date(leave.startDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</strong>
                                to
                                <strong>${new Date(leave.endDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</strong>
                                has been
                                <strong style="color: ${isApproved ? "#16a34a" : "#dc2626"};">${status}</strong>.
                            </p>
                            <p style="font-size: 16px;">If you have any questions, please contact your admin.</p>
                            <br />
                            <p style="font-size: 16px;">Best Regards,</p>
                            <p style="font-size: 16px;">EMS</p>
                        </div>
                    `
                    });
                }
            } catch (mailErr) {
                console.error(`Failed to send leave decision email for leave ${leave._id}`, mailErr);
                // don't fail the request just because the notification email failed
            }
        }

        return res.json({success: true, data: leave})
    } catch (error) {
        return res.status(500).json({error: "Failed"})
    }

}