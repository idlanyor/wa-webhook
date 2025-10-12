import { Router } from 'express';
import { config } from '../config/index.js';
import { getDatabase } from '../config/database.js';

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
        const supabase = getDatabase();
        
        // Attempt to sign up the user
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { full_name: name }
            }
        });
        
        if (signUpError) {
            return res.render('register', { 
                error: signUpError.message, 
                success: null 
            });
        }

        // If Supabase did NOT return a session, attempt to sign in
        let session = signUpData.session;
        if (!session) {
            const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ 
                email, 
                password 
            });
            if (!signInError) {
                session = signInData.session;
            }
        }

        // If we have a session, log the user in immediately
        if (session) {
            res.cookie('supabase-auth-token', JSON.stringify(session), {
                httpOnly: true,
                secure: config.node_env === 'production',
                maxAge: session.expires_in * 1000,
            });
            return res.redirect('/dashboard');
        }

        // Fallback: ask user to confirm email
        return res.render('register', {
            error: null,
            success: 'Registration successful! Please check your email to confirm your account before logging in.'
        });

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
        const supabase = getDatabase();
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) {
            return res.render('login', { error: error.message });
        }

        res.cookie('supabase-auth-token', JSON.stringify(data.session), {
            httpOnly: true,
            secure: config.node_env === 'production',
            maxAge: data.session.expires_in * 1000,
        });

        res.redirect('/dashboard');
    } catch (error) {
        console.error('Login error:', error);
        res.render('login', { error: 'An error occurred during login' });
    }
});

// Handle logout
router.post('/logout-user', async (req, res) => {
    try {
        const supabase = getDatabase();
        await supabase.auth.signOut();
    } catch (error) {
        console.error('Logout error:', error);
    }
    
    res.clearCookie('supabase-auth-token');
    res.redirect('/login');
});

export default router;