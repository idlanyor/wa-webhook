import vcf from 'vcf';
const { parse } = vcf;
import csv from 'csv-parser';
import { Readable } from 'stream';
import { config } from '../config/index.js';
import { and, eq, asc, count } from 'drizzle-orm';
import { db, schema } from '../db/index.js';

const { contacts: contactsTable } = schema;

class ContactService {
    /**
     * Get paginated contacts for a user
     */
    static async getContacts(userId, page = 1) {
        try {
            const pageSize = config.pagination.defaultPageSize;
            const offset = (page - 1) * pageSize;
            const owner = eq(contactsTable.userId, String(userId));

            const total = db.select({ n: count() }).from(contactsTable).where(owner).get().n;
            const contacts = db.select().from(contactsTable)
                .where(owner)
                .orderBy(asc(contactsTable.name))
                .limit(pageSize)
                .offset(offset)
                .all();

            return {
                contacts,
                totalPages: Math.ceil(total / pageSize),
                currentPage: page,
                total
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
            const [contact] = db.insert(contactsTable)
                .values({ userId: String(userId), name, phone, tags: tags || '' })
                .returning()
                .all();
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
            db.delete(contactsTable)
                .where(and(eq(contactsTable.id, String(contactId)), eq(contactsTable.userId, String(userId))))
                .run();
            return true;
        } catch (error) {
            console.error('Error deleting contact:', error);
            throw error;
        }
    }

    static async updateTags(userId, contactId, tags) {
        try {
            db.update(contactsTable)
                .set({ tags: tags || '' })
                .where(and(eq(contactsTable.id, String(contactId)), eq(contactsTable.userId, String(userId))))
                .run();
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
            const owner = String(userId);
            const existingPhones = new Set(
                db.select({ phone: contactsTable.phone }).from(contactsTable)
                    .where(eq(contactsTable.userId, owner)).all().map(c => c.phone)
            );

            const uniqueNewContacts = [];
            const phonesInThisBatch = new Set();

            for (const contact of contacts) {
                if (!existingPhones.has(contact.phone) && !phonesInThisBatch.has(contact.phone)) {
                    uniqueNewContacts.push({ userId: owner, name: contact.name, phone: contact.phone, tags: contact.tags || '' });
                    phonesInThisBatch.add(contact.phone);
                }
            }

            const duplicateCount = contacts.length - uniqueNewContacts.length;

            if (uniqueNewContacts.length > 0) {
                // Chunk to stay well under SQLite's bound-parameter limit
                db.transaction((tx) => {
                    for (let i = 0; i < uniqueNewContacts.length; i += 500) {
                        tx.insert(contactsTable).values(uniqueNewContacts.slice(i, i + 500)).run();
                    }
                });
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
            return db.select().from(contactsTable)
                .where(eq(contactsTable.userId, String(userId)))
                .orderBy(asc(contactsTable.name))
                .all();
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