import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import User from '../models/User.js';

const router = Router();

// Login page
router.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// Register page
router.get('/register', (req, res) => {
    res.render('register', { error: null, success: null });
});

// Handle registration
router.post('/register', async (req, res) => {
    const { name, email, password, confirmPassword } = req.body;
    
    // Validation
    if (!name || !email || !password || !confirmPassword) {
        return res.render('register', { 
            error: 'All fields are required', 
            success: null 
        });
    }
    
    if (password !== confirmPassword) {
        return res.render('register', { 
            error: 'Passwords do not match', 
            success: null 
        });
    }
    
    if (password.length < 6) {
        return res.render('register', { 
            error: 'Password must be at least 6 characters long', 
            success: null 
        });
    }
    
    try {
        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.render('register', { 
                error: 'Email already registered', 
                success: null 
            });
        }

        // Check if this is the first user
        const userCount = await User.countDocuments();
        const role = userCount === 0 ? 'admin' : 'user';

        // Create new user
        const user = new User({
            name,
            email,
            password,
            role
        });
        await user.save();

        // Generate token
        const token = jwt.sign(
            { userId: user._id },
            config.session.secret,
            { expiresIn: '24h' }
        );

        res.cookie('auth-token', token, {
            httpOnly: true,
            secure: config.node_env === 'production',
            maxAge: config.session.maxAge,
        });

        return res.redirect('/dashboard');

    } catch (err) {
        console.error('Registration error:', err);
        return res.render('register', {
            error: 'An unexpected error occurred. Please try again.',
            success: null
        });
    }
});

// Handle login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.render('login', { error: 'Invalid email or password' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.render('login', { error: 'Invalid email or password' });
        }

        // Generate token
        const token = jwt.sign(
            { userId: user._id },
            config.session.secret,
            { expiresIn: '24h' }
        );

        res.cookie('auth-token', token, {
            httpOnly: true,
            secure: config.node_env === 'production',
            maxAge: config.session.maxAge,
        });

        res.redirect('/dashboard');
    } catch (error) {
        console.error('Login error:', error);
        res.render('login', { error: 'An error occurred during login' });
    }
});

// Handle logout
router.post('/logout-user', (req, res) => {
    res.clearCookie('auth-token');
    res.redirect('/login');
});

export default router;
