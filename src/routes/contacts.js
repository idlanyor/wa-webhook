import { Router } from 'express';
import { isAuthenticated, isAuthenticatedOrApiKey, getEffectiveUserId } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { getContacts, importFromVCF, importFromCSV, deleteContact, getAllContacts, updateTags, addContact } from '../services/ContactService.js';

const router = Router();

// Contacts page
router.get('/', isAuthenticated, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const result = await getContacts(req.user.id, page);
        
        res.render('contacts', { 
            ...result,
            error: req.query.error, 
            success: req.query.success, 
            page: 'contacts'
        });
    } catch (error) {
        console.error('Error loading contacts page:', error);
        res.render('contacts', { 
            contacts: [], 
            error: 'Failed to load contacts.', 
            success: null, 
            page: 'contacts',
            totalPages: 0,
            currentPage: 1
        });
    }
});

// Add single contact
router.post('/add', isAuthenticated, async (req, res) => {
    const { name, phone, tags } = req.body;
    
    try {
        await addContact(req.user.id, name, phone, tags || '');
        res.redirect('/contacts?success=' + encodeURIComponent('Contact added successfully.'));
    } catch (error) {
        console.error('Error adding contact:', error);
        res.redirect('/contacts?error=' + encodeURIComponent(error.message));
    }
});

// Import contacts from VCF
router.post('/import', isAuthenticated, upload.single('vcfFile'), async (req, res) => {
    if (!req.file) {
        return res.redirect('/contacts?error=' + encodeURIComponent('No file uploaded.'));
    }

    try {
        const result = await importFromVCF(req.user.id, req.file.buffer);
        
        let successMessage = `${result.imported} contacts imported successfully.`;
        if (result.duplicates > 0) {
            successMessage += ` ${result.duplicates} duplicates were ignored.`;
        }
        
        res.redirect('/contacts?success=' + encodeURIComponent(successMessage));
    } catch (error) {
        console.error('Error importing VCF file:', error);
        res.redirect('/contacts?error=' + encodeURIComponent(
            'Failed to import contacts from VCF file. ' + error.message
        ));
    }
});

// Import contacts from CSV
router.post('/import/csv', isAuthenticated, upload.single('csvFile'), async (req, res) => {
    if (!req.file) {
        return res.redirect('/contacts?error=' + encodeURIComponent('No file uploaded.'));
    }

    try {
        const result = await importFromCSV(req.user.id, req.file.buffer);
        
        let successMessage = `${result.imported} contacts imported successfully.`;
        if (result.duplicates > 0) {
            successMessage += ` ${result.duplicates} duplicates were ignored.`;
        }
        
        res.redirect('/contacts?success=' + encodeURIComponent(successMessage));
    } catch (error) {
        console.error('Error importing CSV file:', error);
        res.redirect('/contacts?error=' + encodeURIComponent(
            'Failed to import contacts from CSV file. ' + error.message
        ));
    }
});

// Delete contact
router.post('/delete/:id', isAuthenticated, async (req, res) => {
    try {
        await deleteContact(req.user.id, req.params.id);
        res.redirect('/contacts?success=' + encodeURIComponent('Contact deleted successfully.'));
    } catch (error) {
        console.error('Error deleting contact:', error);
        res.redirect('/contacts?error=' + encodeURIComponent('Failed to delete contact.'));
    }
});

// API: Get all contacts
router.get('/api', isAuthenticatedOrApiKey, async (req, res) => {
    try {
        const userId = getEffectiveUserId(req);
        const contacts = await getAllContacts(userId);
        res.json(contacts);
    } catch (error) {
        console.error('Error fetching contacts API:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update tags
router.post('/tags/:id', isAuthenticated, async (req, res) => {
    try {
        await updateTags(req.user.id, req.params.id, req.body.tags || '');
        res.redirect('/contacts?success=' + encodeURIComponent('Tags updated.'));
    } catch (error) {
        console.error('Error updating tags:', error);
        res.redirect('/contacts?error=' + encodeURIComponent('Failed to update tags.'));
    }
});

export default router;