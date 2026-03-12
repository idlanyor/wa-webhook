import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import User from '../models/User.js';
import { redirectIfAuthenticated } from '../middleware/auth.js';

const router = Router();

// Cookie options
const cookieOptions = {
    httpOnly: true,
    secure: config.node_env === 'production',
    sameSite: 'lax',
    maxAge: config.session.maxAge,
    signed: true
};

// Login page
router.get('/login', redirectIfAuthenticated, (req, res) => {
    res.render('login', { error: null });
});

// Register page (Disabled)
router.get('/register', redirectIfAuthenticated, (req, res) => {
    res.redirect('/login');
});

// Handle registration (Disabled)
router.post('/register', redirectIfAuthenticated, (req, res) => {
    res.redirect('/login');
});

// Handle login
router.post('/login', redirectIfAuthenticated, async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.render('login', { error: 'Email and password are required' });
    }

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

        res.cookie('auth-token', token, cookieOptions);

        res.redirect('/dashboard');
    } catch (error) {
        console.error('Login error:', error);
        res.render('login', { error: 'An error occurred during login' });
    }
});

// Handle logout
router.post('/logout-user', (req, res) => {
    res.clearCookie('auth-token', {
        ...cookieOptions,
        maxAge: 0
    });
    res.redirect('/login');
});

export default router;
