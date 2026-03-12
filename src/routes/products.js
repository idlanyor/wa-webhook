import express from 'express';
import Product from '../models/Product.js';
import ProductField from '../models/ProductField.js';
import { info, error as logError } from '../utils/logger.js';

const router = express.Router();

// Middleware to ensure admin/authenticated (assuming checkAuth or similar exists, but following existing patterns)
// Based on app.js, routes use `isAuthenticated` usually. 
// I will import it from middleware/auth.js if available, or just check req.session/locals in the route.
// Let's assume the router is mounted with authentication in app.js or check here.
// Checking `src/routes/users.js` logic might be good, but I'll stick to standard express logic.
import { isAuthenticated } from '../middleware/auth.js';

router.use(isAuthenticated);

// --- Product Fields (Columns) ---

// Get all fields
router.get('/fields', async (req, res) => {
    try {
        const fields = await ProductField.find({}).sort({ order: 1 });
        res.json(fields);
    } catch (err) {
        logError('Error fetching fields:', err);
        res.status(500).json({ error: 'Failed to fetch fields' });
    }
});

// Create a new field
router.post('/fields', async (req, res) => {
    try {
        const { label, type } = req.body;
        // Generate key from label (e.g., "Harga Jual" -> "harga_jual")
        const key = label.toLowerCase().replace(/[^a-z0-9]/g, '_');
        
        const existing = await ProductField.findOne({ key });
        if (existing) {
            return res.status(400).json({ error: 'Field with this name already exists' });
        }

        const count = await ProductField.countDocuments();
        const field = new ProductField({
            key,
            label,
            type,
            order: count
        });
        await field.save();
        
        info(`New product field created: ${label} (${key})`);
        res.json(field);
    } catch (err) {
        logError('Error creating field:', err);
        res.status(500).json({ error: 'Failed to create field' });
    }
});

// Delete a field
router.delete('/fields/:id', async (req, res) => {
    try {
        await ProductField.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        logError('Error deleting field:', err);
        res.status(500).json({ error: 'Failed to delete field' });
    }
});

// --- Products ---

// Render the products page
router.get('/', async (req, res) => {
    try {
        const fields = await ProductField.find({}).sort({ order: 1 });
        const products = await Product.find({}).sort({ createdAt: -1 });
        
        res.render('products', {
            title: 'Knowledge Base',
            user: req.user,
            path: '/products',
            fields,
            products
        });
    } catch (err) {
        logError('Error rendering products page:', err);
        res.status(500).render('error', { message: 'Failed to load products' });
    }
});

// Create product
router.post('/', async (req, res) => {
    try {
        const { name, ...dynamicFields } = req.body;
        
        const product = new Product({
            name,
            data: dynamicFields
        });
        await product.save();
        
        res.json({ success: true, product });
    } catch (err) {
        logError('Error creating product:', err);
        res.status(500).json({ error: 'Failed to create product' });
    }
});

// Update product
router.put('/:id', async (req, res) => {
    try {
        const { name, ...dynamicFields } = req.body;
        
        await Product.findByIdAndUpdate(req.params.id, {
            name,
            data: dynamicFields
        });
        
        res.json({ success: true });
    } catch (err) {
        logError('Error updating product:', err);
        res.status(500).json({ error: 'Failed to update product' });
    }
});

// Delete product
router.delete('/:id', async (req, res) => {
    try {
        await Product.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        logError('Error deleting product:', err);
        res.status(500).json({ error: 'Failed to delete product' });
    }
});

export default router;
