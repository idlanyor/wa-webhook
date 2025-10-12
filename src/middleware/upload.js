import multer, { memoryStorage } from 'multer';
import { extname } from 'path';
import { config } from '../config/index.js';

// Configure multer for file uploads
const upload = multer({
    storage: memoryStorage(),
    fileFilter: (req, file, cb) => {
        const fileExt = extname(file.originalname).toLowerCase();
        const { allowedExtensions, allowedMimeTypes } = config.upload;
        
        const isValidExtension = allowedExtensions.includes(fileExt);
        const isValidMimeType = allowedMimeTypes.includes(file.mimetype);
        
        if (isValidExtension || isValidMimeType) {
            cb(null, true);
        } else {
            cb(new Error('Only .vcf and .csv files are allowed!'), false);
        }
    }
});

export { upload };