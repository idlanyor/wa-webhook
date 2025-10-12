/**
 * Utility functions for common operations
 */

/**
 * Format phone number to WhatsApp JID format
 */
function formatPhoneToJid(phone) {
    if (phone.includes('@')) {
        return phone;
    }
    return `${phone}@s.whatsapp.net`;
}

/**
 * Generate random delay for bulk operations
 */
function getRandomDelay(min = 2000, max = 7000) {
    return Math.floor(Math.random() * (max - min)) + min;
}

/**
 * Validate phone number format
 */
function isValidPhoneNumber(phone) {
    // Basic validation - should contain only digits, +, spaces, hyphens
    const phoneRegex = /^[\+]?[0-9\s\-()]+$/;
    return phoneRegex.test(phone);
}

/**
 * Clean phone number (remove non-digits except +)
 */
function cleanPhoneNumber(phone) {
    return phone.replace(/[^\d+]/g, '');
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp) {
    return new Date(timestamp).toLocaleString();
}

/**
 * Truncate text to specified length
 */
function truncateText(text, maxLength = 50) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
}

/**
 * Validate file extension
 */
function isValidFileExtension(filename, allowedExtensions) {
    const ext = filename.toLowerCase().split('.').pop();
    return allowedExtensions.includes(`.${ext}`);
}

/**
 * Create error response object
 */
function createErrorResponse(message, code = 'GENERIC_ERROR', statusCode = 500) {
    return {
        success: false,
        error: {
            code,
            message,
            statusCode
        }
    };
}

/**
 * Create success response object
 */
function createSuccessResponse(data, message = 'Success') {
    return {
        success: true,
        message,
        data
    };
}

/**
 * Sanitize user input
 */
function sanitizeInput(input) {
    if (typeof input !== 'string') return input;
    return input.trim().replace(/[<>]/g, '');
}

/**
 * Check if string is empty or whitespace only
 */
function isEmpty(str) {
    return !str || str.trim().length === 0;
}

export {
    formatPhoneToJid,
    getRandomDelay,
    isValidPhoneNumber,
    cleanPhoneNumber,
    formatTimestamp,
    truncateText,
    isValidFileExtension,
    createErrorResponse,
    createSuccessResponse,
    sanitizeInput,
    isEmpty
};