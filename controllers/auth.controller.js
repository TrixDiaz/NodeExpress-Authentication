import User from "../models/user.model.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {JWT_SECRET, JWT_EXPIRES_IN} from "../config/env.js";
import transporter from "../config/nodemailer.js";
import LoginLogs from "../models/login-logs.model.js";

export const signUp = async (req, res, next) => {
    try {
        // Logic to create a new user
        const {name, email, password, confirmPassword} = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({email: email});

        // Check for missing confirmPassword specifically
        if (!confirmPassword) {
            return res.status(400).json({
                success: false,
                message: "Confirm password is empty"
            });
        }
        // If user already exists, return an error
        if (existingUser) {
            const error = new Error("User already exists");
            error.statusCode = 409;
            return next(error);
        }

        // Validate password and confirmPassword
        if (password !== confirmPassword) {
            const error = new Error("Passwords do not match");
            error.statusCode = 400;
            return next(error);
        }

        // Hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = await User.create({
            name: name,
            email: email,
            password: hashedPassword,
            isVerified: false
        });

        // Generate JWT token
        const verificationToken = jwt.sign({userId: newUser._id}, JWT_SECRET, {
            expiresIn: JWT_EXPIRES_IN,
        });

        // Create verification URL
        const verificationURL = `http://yourfrontend.com/verify-email/${verificationToken}`;

        // Send verification email
        const mailOptions = {
            from: 'noreply@noreply.com',
            to: email,
            subject: 'Email Verification',
            text: `Hello ${name},\n\n`
                + `Please verify your email by clicking the link:\n`
                + `${verificationURL}\n\n`
                + `This link will expire in 24 hours.\n`
        };

        await transporter.sendMail(mailOptions);

        res.status(201).json({
            success: true,
            message: "User created successfully",
            data: {
                verificationToken,
                user: newUser,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const signIn = async (req, res, next) => {
    try {
        const {email, password} = req.body;

        // Find user by email
        const user = await User.findOne({email: email});

        const createLoginLog = async (status, reason = null) => {
            await LoginLogs.create({
                userId: user?._id || null,
                name: user?.name || null,
                email,
                status,
                ipAddress: typeof ipAddress !== 'undefined' ? ipAddress : null,
                userAgent: typeof userAgent !== 'undefined' ? userAgent : null,
                reason
            });
        };


        if (!user) {
            const error = new Error("User not found");
            error.statusCode = 404;
            return next(error);
        }

        // Check if email is verified
        if (!user.isVerified) {
            const error = new Error("Please verify your email before signing in");
            error.statusCode = 403;
            return next(error);
        }

        // Check if account is locked
        if (user.isLocked) {
            const error = new Error("Account is locked. Please contact administrator");
            error.statusCode = 403;
            return next(error);
        }

        // Check password
        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            // Increment login attempts
            user.loginAttempts = (user.loginAttempts || 0) + 1;

            // Check if attempts exceed limit
            if (user.loginAttempts >= 5) {
                user.isLocked = true;
                await user.save();
                const error = new Error("Account locked due to multiple failed attempts. Please contact administrator");
                error.statusCode = 403;
                return next(error);
            }

            // Save the incremented attempts
            await user.save();
            await createLoginLog('failed', 'Invalid password');
            const error = new Error(`Invalid password. ${5  - user.loginAttempts} attempts remaining`);
            error.statusCode = 401;
            return next(error);
        }

        // Reset login attempts on successful login
        if (user.loginAttempts > 0) {
            user.loginAttempts = 0;
            await user.save();
        }

        // Generate JWT token
        const token = jwt.sign({userId: user._id}, JWT_SECRET, {
            expiresIn: JWT_EXPIRES_IN,
        });

        await createLoginLog('success');

        res.status(200).json({
            success: true,
            message: "User signed in successfully",
            data: {
                token,
                user,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const signOut = async (req, res, next) => {
    try {
        // Invalidate the token by removing it from the client side
        res.clearCookie("token");

        res.status(200).json({
            success: true,
            message: "User signed out successfully",
        });
    } catch (error) {
        next(error);
    }
};

export const forgotPassword = async (req, res, next) => {
    try {
        const {email} = req.body;

        if (!email) {
            const error = new Error("Email is required");
            error.statusCode = 401;
            return next(error);
        }

        // Find user by email
        const user = await User.findOne({email: email});

        // If user does not exist
        if (!user) {
            const error = new Error("User not found");
            error.statusCode = 404;
            return next(error);
        }

        // Generate reset token
        const resetToken = jwt.sign({userId: user._id}, JWT_SECRET, {
            expiresIn: "1h",
        });

        // Create reset password URL
        const resetURL = `http://yourfrontend.com/reset-password/${resetToken}`;

        // Configure mail options
        const mailOptions = {
            from: 'noreply@noreply.com',
            to: user.email,
            subject: 'Password Reset Request',
            text: `Hello ${user.name},\n\n`
                + `You have requested to reset your password.\n\n`
                + `Please click on the following link to reset your password:\n`
                + `${resetURL}\n\n`
                + `This link will expire in 1 hour.\n\n`
                + `If you did not request this, please ignore this email.\n`
        };

        // Send email
        await transporter.sendMail(mailOptions);

        res.status(200).json({
            success: true,
            message: "Password reset link sent to email",
            data: {
                resetToken,
                resetURL,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const resetPassword = async (req, res, next) => {
    try {
        const {token} = req.params;
        const {password} = req.body;

        if (!token || !password) {
            const error = new Error("Token and password are required");
            error.statusCode = 400;
            return next(error);
        }

        // Verify token
        let decodedToken;

        try {
            decodedToken = jwt.verify(token, JWT_SECRET);
        } catch (error) {
            error.message = "Invalid or expired token";
            error.statusCode = 401;
            return next(error);
        }

        // Find user
        const user = await User.findById(decodedToken.userId);
        if (!user) {
            const error = new Error("User not found");
            error.statusCode = 404;
            return next(error);
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Update user password and unlock account if locked
        user.password = hashedPassword;
        user.loginAttempts = 0;
        user.isLocked = false;
        await user.save();

        res.status(200).json({
            success: true,
            message: "Password reset successful"
        });
    } catch (error) {
        next(error);
    }
};

export const verifyEmail = async (req, res, next) => {
    try {
        const {token} = req.params;

        // Verify token
        let decodedToken;
        try {
            decodedToken = jwt.verify(token, JWT_SECRET);
        } catch (error) {
            error.message = "Invalid or expired verification token";
            error.statusCode = 401;
            return next(error);
        }

        // Find and update user
        const user = await User.findById(decodedToken.userId);
        if (!user) {
            const error = new Error("User not found");
            error.statusCode = 404;
            return next(error);
        }

        if (user.isVerified) {
            return res.status(400).json({
                success: false,
                message: "Email already verified"
            });
        }

        // Update verification status
        user.isVerified = true;
        await user.save();

        res.status(200).json({
            success: true,
            message: "Email verified successfully"
        });
    } catch (error) {
        next(error);
    }
};