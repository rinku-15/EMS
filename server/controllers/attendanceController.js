import Employee from "../models/Employee.js";
import Attendance from "../models/Attendance.js";
import { inngest } from "../inngest/index.js";


// clock in/out for employee
// post /api/attendance
export const clockInOut = async (req, res) => {
    try {
        const session = req.session;
        const employee = await Employee.findOne({userId: session.userId})
        if(!employee) return res.status(404).json({error: "Employee not found"});
        if(employee.isDeleted) return res.status(403).json({error: "Your account is deactivated. You cannot clock in/out."});

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const existing = await Attendance.findOne({employeeId: employee._id,
            date: today,
        })

        const now = new Date();

        // Treat "no record yet" the same as "a record exists but nobody has
        // actually checked in" (e.g. the 11:30 AM absent-reminder cron
        // already created an ABSENT placeholder for today with checkIn:
        // null). Both cases mean: this is genuinely their first check-in
        // of the day.
        if(!existing || !existing.checkIn){
            // Late = checked in after 9:00 AM sharp.
            // Compare total minutes-since-midnight instead of hours/minutes
            // separately - the old check (`getHours() >= 9 && getMinutes() > 0`)
            // incorrectly marked exact-hour check-ins (9:00:00, 10:00:00, even
            // 9:00:00 PM) as NOT late, since minutes was 0 in those cases.
            const LATE_CUTOFF_MINUTES = 9 * 60; // 9:00 AM
            const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
            const isLate = minutesSinceMidnight > LATE_CUTOFF_MINUTES;

            let attendance;
            if (existing) {
                // update the cron-created ABSENT placeholder in place,
                // instead of creating a second record for the same day
                // (which the unique employeeId+date index would reject anyway)
                existing.checkIn = now;
                existing.status = isLate ? "LATE" : "PRESENT";
                await existing.save();
                attendance = existing;
            } else {
                attendance = await Attendance.create({
                    employeeId: employee._id,
                    date: today,
                    checkIn: now,
                    status: isLate ? "LATE" : "PRESENT"
                })
            }

            await inngest.send({
                name: "employee/check-out",
                data: {
                    employeeId: employee._id,
                    attendanceId: attendance._id,
                }
            })

            return res.json({success: true, type: "CHECK_IN", data: attendance});
        }else if(!existing.checkOut){
            const checkInTime = new Date(existing.checkIn).getTime()
            const diffMs = now.getTime() - checkInTime;
            const diffHours = diffMs / (1000 * 60 * 60);

            existing.checkOut = now;

            //compute working hours and day type
            const workingHours = parseFloat(diffHours.toFixed(2));
            let dayType = "Half Day";
            if(workingHours >= 8) dayType = "Full Day";
            else if(workingHours >= 6) dayType = "Three Quarter Day";
            else if(workingHours >= 4) dayType = "Half Day";
            else dayType = "Short Day";

            existing.workingHours = workingHours;
            existing.dayType = dayType;

            await existing.save();
            return res.json({success: true, type: "CHECK_OUT", data: existing});
        }else{
            return res.json({success: true, type: "CHECK_OUT", data: existing});
        }
    } catch (error) {
        console.error("Attendance Error:", error);
        return res.status(500).json({error: "Operation Failed"});
        
    }

}

//get attendance for employee
// get /api/attendance
export const getAttendance = async (req, res) => {
    try {
        const session = req.session;
        const employee = await Employee.findOne({userId: session.userId})
        if(!employee) return res.status(404).json({error: "Employee not found"});

        const limit = parseInt(req.query.limit || 30);
        const history = await Attendance.find({employeeId: employee._id}).sort({date: -1}).limit(limit)

        return res.json({
            data:  history,
            employee: {isDeleted: employee.isDeleted}
        })
        
    } catch (error) {
        return res.status(500).json({error: "Failed to fetch attendance"});
    }

}