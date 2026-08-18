import e from "express";
import mongoose from "mongoose";

const leaveApplicationScheme = new mongoose.Schema({
    employeeId: {type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true},
    type: {type: String, enum: ["SICK", "CASUAL", "ANNUAL"], required: true},
    startDate: {type: Date, required: true},
    endDate: {type: Date, required: true},
    reason: {type: String, required: true},
    status: {type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING"},
    actionedBy: {type: mongoose.Schema.Types.ObjectId, ref: "User", default: null},
    actionedAt: {type: Date, default: null},

}, {timestamps: true})

const LeaveApplication = mongoose.models.
LeaveApplication || mongoose.model("LeaveApplication", leaveApplicationScheme);

export default LeaveApplication;