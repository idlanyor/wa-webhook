import { Router } from 'express';
import { isAuthenticated, isAdmin } from '../middleware/auth.js';
import User from '../models/User.js';

const router = Router();

// User management page
router.get('/', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const users = await User.find().sort({ createdAt: -1 });
        res.render('users', { 
            users, 
            error: req.query.error || null, 
            success: req.query.success || null,
            page: 'users',
            user: req.user
        });
    } catch (error) {
        console.error('Error loading users page:', error);
        res.status(500).render('error', { 
            error: 'Internal Server Error', 
            message: 'Failed to load user management page.' 
        });
    }
});

// Add new user
router.post('/add', isAuthenticated, isAdmin, async (req, res) => {
    const { name, email, password, role } = req.body;
    
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.redirect('/users?error=' + encodeURIComponent('Email already in use.'));
        }
        
        const newUser = new User({ name, email, password, role });
        await newUser.save();
        
        res.redirect('/users?success=' + encodeURIComponent('User created successfully.'));
    } catch (error) {
        console.error('Error adding user:', error);
        res.redirect('/users?error=' + encodeURIComponent('Failed to create user.'));
    }
});

// Update user
router.post('/update/:id', isAuthenticated, isAdmin, async (req, res) => {
    const { name, email, role, password } = req.body;
    
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.redirect('/users?error=' + encodeURIComponent('User not found.'));
        }
        
        user.name = name;
        user.email = email;
        user.role = role;
        
        if (password && password.trim() !== '') {
            user.password = password;
        }
        
        await user.save();
        res.redirect('/users?success=' + encodeURIComponent('User updated successfully.'));
    } catch (error) {
        console.error('Error updating user:', error);
        res.redirect('/users?error=' + encodeURIComponent('Failed to update user.'));
    }
});

// Delete user
router.post('/delete/:id', isAuthenticated, isAdmin, async (req, res) => {
    try {
        // Prevent deleting self
        if (req.params.id === req.user.id.toString()) {
            return res.redirect('/users?error=' + encodeURIComponent('You cannot delete your own account.'));
        }
        
        await User.findByIdAndDelete(req.params.id);
        res.redirect('/users?success=' + encodeURIComponent('User deleted successfully.'));
    } catch (error) {
        console.error('Error deleting user:', error);
        res.redirect('/users?error=' + encodeURIComponent('Failed to delete user.'));
    }
});

export default router;
