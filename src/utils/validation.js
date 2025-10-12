/**
 * Validation schemas and functions
 */

/**
 * Validate message sending request
 */
function validateSendMessageRequest(body) {
    const { to, message } = body;
    const errors = [];

    if (!to || typeof to !== 'string' || to.trim().length === 0) {
        errors.push('Field "to" is required and must be a non-empty string');
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
        errors.push('Field "message" is required and must be a non-empty string');
    }

    if (message && message.length > 4096) {
        errors.push('Message length cannot exceed 4096 characters');
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Validate bulk message request
 */
function validateBulkMessageRequest(body) {
    const { numbers, message } = body;
    const errors = [];

    if (!numbers || typeof numbers !== 'string' || numbers.trim().length === 0) {
        errors.push('Field "numbers" is required and must be a non-empty string');
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
        errors.push('Field "message" is required and must be a non-empty string');
    }

    if (message && message.length > 4096) {
        errors.push('Message length cannot exceed 4096 characters');
    }

    if (numbers) {
        const numberList = numbers.split('\n').map(n => n.trim()).filter(Boolean);
        if (numberList.length === 0) {
            errors.push('At least one phone number is required');
        }
        if (numberList.length > 100) {
            errors.push('Cannot send to more than 100 numbers at once');
        }
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Validate contact data
 */
function validateContactData(body) {
    const { name, phone } = body;
    const errors = [];

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        errors.push('Field "name" is required and must be a non-empty string');
    }

    if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
        errors.push('Field "phone" is required and must be a non-empty string');
    }

    if (name && name.length > 100) {
        errors.push('Name length cannot exceed 100 characters');
    }

    if (phone && phone.length > 20) {
        errors.push('Phone length cannot exceed 20 characters');
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Validate auto-reply rule data
 */
function validateAutoReplyData(body) {
    const { keyword, reply } = body;
    const errors = [];

    if (!keyword || typeof keyword !== 'string' || keyword.trim().length === 0) {
        errors.push('Field "keyword" is required and must be a non-empty string');
    }

    if (!reply || typeof reply !== 'string' || reply.trim().length === 0) {
        errors.push('Field "reply" is required and must be a non-empty string');
    }

    if (keyword && keyword.length > 100) {
        errors.push('Keyword length cannot exceed 100 characters');
    }

    if (reply && reply.length > 1000) {
        errors.push('Reply length cannot exceed 1000 characters');
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Validate user registration data
 */
function validateRegistrationData(body) {
    const { name, email, password, confirmPassword } = body;
    const errors = [];

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        errors.push('Name is required');
    }

    if (!email || typeof email !== 'string' || email.trim().length === 0) {
        errors.push('Email is required');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push('Invalid email format');
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
        errors.push('Password must be at least 6 characters long');
    }

    if (password !== confirmPassword) {
        errors.push('Passwords do not match');
    }

    if (name && name.length > 100) {
        errors.push('Name length cannot exceed 100 characters');
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Validate login data
 */
function validateLoginData(body) {
    const { email, password } = body;
    const errors = [];

    if (!email || typeof email !== 'string' || email.trim().length === 0) {
        errors.push('Email is required');
    }

    if (!password || typeof password !== 'string' || password.trim().length === 0) {
        errors.push('Password is required');
    }

    return {
        isValid: errors.length === 0,
        errors
    };
}

export {
    validateSendMessageRequest,
    validateBulkMessageRequest,
    validateContactData,
    validateAutoReplyData,
    validateRegistrationData,
    validateLoginData
};