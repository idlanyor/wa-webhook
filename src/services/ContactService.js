import vcf from 'vcf';
const { parse } = vcf;
import csv from 'csv-parser';
import { Readable } from 'stream';
import { config } from '../config/index.js';
import Contact from '../models/Contact.js';

class ContactService {
    /**
     * Get paginated contacts for a user
     */
    static async getContacts(userId, page = 1) {
        try {
            const pageSize = config.pagination.defaultPageSize;
            const skip = (page - 1) * pageSize;

            const total = await Contact.countDocuments({ userId });
            const contacts = await Contact.find({ userId })
                .sort({ name: 1 })
                .skip(skip)
                .limit(pageSize);

            return {
                contacts: contacts || [],
                totalPages: Math.ceil(total / pageSize),
                currentPage: page,
                total: total
            };
        } catch (error) {
            console.error('Error fetching contacts:', error);
            throw error;
        }
    }

    /**
     * Add a single contact
     */
    static async addContact(userId, name, phone, tags = '') {
        try {
            const contact = new Contact({
                userId,
                name,
                phone,
                tags: tags || ''
            });
            await contact.save();
            return contact;
        } catch (error) {
            console.error('Error adding contact:', error);
            throw error;
        }
    }

    /**
     * Delete a contact
     */
    static async deleteContact(userId, contactId) {
        try {
            await Contact.findOneAndDelete({ _id: contactId, userId });
            return true;
        } catch (error) {
            console.error('Error deleting contact:', error);
            throw error;
        }
    }

    static async updateTags(userId, contactId, tags) {
        try {
            await Contact.findOneAndUpdate(
                { _id: contactId, userId },
                { tags: tags || '' }
            );
            return true;
        } catch (error) {
            console.error('Error updating tags:', error);
            throw error;
        }
    }

    /**
     * Import contacts from VCF file
     */
    static async importFromVCF(userId, fileBuffer) {
        try {
            const vcfContent = fileBuffer.toString('utf8');
            const cards = parse(vcfContent);

            if (!cards || cards.length === 0) {
                throw new Error('VCF file is empty or invalid');
            }

            const parsedContacts = cards.map(card => {
                const name = card.data.fn;
                const phoneProp = card.data.tel?.[0];
                const phone = phoneProp ? phoneProp.valueOf().replace(/\D/g, '') : null;
                
                if (!name || !phone) return null;
                
                return { 
                    userId: userId, 
                    name: name.valueOf(), 
                    phone: phone 
                };
            }).filter(Boolean);

            return await ContactService.insertUniqueContacts(userId, parsedContacts);
        } catch (error) {
            console.error('Error importing VCF:', error);
            throw error;
        }
    }

    /**
     * Import contacts from CSV file
     */
    static async importFromCSV(userId, fileBuffer) {
        return new Promise((resolve, reject) => {
            const parsedContacts = [];
            const stream = Readable.from(fileBuffer.toString());

            stream.pipe(csv({ mapHeaders: ({ header }) => header.trim() }))
                .on('data', (row) => {
                    const firstName = row['First Name'] || '';
                    const middleName = row['Middle Name'] || '';
                    const lastName = row['Last Name'] || '';
                    
                    let name = `${firstName} ${middleName} ${lastName}`
                        .replace(/\s+/g, ' ')
                        .trim();
                    
                    if (!name) {
                        name = row['File As'] || row['Nickname'];
                    }
                    
                    const phone = row['Phone 1 - Value'];
                    
                    if (name && phone) {
                        parsedContacts.push({
                            userId: userId,
                            name: name,
                            phone: phone.replace(/\D/g, '')
                        });
                    }
                })
                .on('end', async () => {
                    try {
                        if (parsedContacts.length === 0) {
                            throw new Error('No valid contacts found in the CSV file');
                        }
                        
                        const result = await ContactService.insertUniqueContacts(userId, parsedContacts);
                        resolve(result);
                    } catch (error) {
                        reject(error);
                    }
                })
                .on('error', reject);
        });
    }

    /**
     * Insert contacts, avoiding duplicates
     */
    static async insertUniqueContacts(userId, contacts) {
        try {
            // Get existing contacts' phones
            const existingContacts = await Contact.find({ userId }, 'phone');
            const existingPhones = new Set(existingContacts.map(c => c.phone));
            
            const uniqueNewContacts = [];
            const phonesInThisBatch = new Set();

            for (const contact of contacts) {
                if (!existingPhones.has(contact.phone) && !phonesInThisBatch.has(contact.phone)) {
                    uniqueNewContacts.push(contact);
                    phonesInThisBatch.add(contact.phone);
                }
            }

            const duplicateCount = contacts.length - uniqueNewContacts.length;

            if (uniqueNewContacts.length > 0) {
                await Contact.insertMany(uniqueNewContacts);
            }

            return {
                imported: uniqueNewContacts.length,
                duplicates: duplicateCount,
                total: contacts.length
            };
        } catch (error) {
            console.error('Error inserting unique contacts:', error);
            throw error;
        }
    }

    /**
     * Get all contacts for API response
     */
    static async getAllContacts(userId) {
        try {
            const contacts = await Contact.find({ userId }).sort({ name: 1 });
            return contacts;
        } catch (error) {
            console.error('Error fetching all contacts:', error);
            throw error;
        }
    }
}

export default ContactService;

export const getContacts = ContactService.getContacts;
export const importFromVCF = ContactService.importFromVCF;
export const importFromCSV = ContactService.importFromCSV;
export const deleteContact = ContactService.deleteContact;
export const getAllContacts = ContactService.getAllContacts;
export const updateTags = ContactService.updateTags;
export const addContact = ContactService.addContact;