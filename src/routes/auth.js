import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import UserService from '../services/UserService.js';
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

// Register page
router.get('/register', redirectIfAuthenticated, (req, res) => {
    res.render('register', { error: null, success: null });
});

// Handle registration
router.post('/register', redirectIfAuthenticated, async (req, res) => {
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
        const existingUser = UserService.findByEmail(email);
        if (existingUser) {
            return res.render('register', { 
                error: 'Email already registered', 
                success: null 
            });
        }

        // Check if this is the first user
        const userCount = UserService.count();
        const role = userCount === 0 ? 'admin' : 'user';

        // Create new user
        const user = await UserService.create({ name, email, password, role });

        // Generate token
        const token = jwt.sign(
            { userId: user.id },
            config.session.secret,
            { expiresIn: '24h' }
        );

        res.cookie('auth-token', token, cookieOptions);

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
router.post('/login', redirectIfAuthenticated, async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.render('login', { error: 'Email and password are required' });
    }

    try {
        const user = UserService.findByEmail(email);
        if (!user) {
            return res.render('login', { error: 'Invalid email or password' });
        }

        const isMatch = await UserService.comparePassword(user, password);
        if (!isMatch) {
            return res.render('login', { error: 'Invalid email or password' });
        }

        // Generate token
        const token = jwt.sign(
            { userId: user.id },
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
