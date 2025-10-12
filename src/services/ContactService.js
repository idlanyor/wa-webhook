const vCard = require('vcf');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { getDatabase } = require('../config/database');
const { config } = require('../config');

class ContactService {
    /**
     * Get paginated contacts for a user
     */
    static async getContacts(userId, page = 1, supabaseClient = null) {
        try {
            const supabase = supabaseClient || getDatabase();
            const pageSize = config.pagination.defaultPageSize;
            const offset = (page - 1) * pageSize;

            // Get total count
            const { count, error: countError } = await supabase
                .from('contacts')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', userId);

            if (countError) throw countError;

            // Get contacts for current page
            const { data, error } = await supabase
                .from('contacts')
                .select('*')
                .eq('user_id', userId)
                .order('name', { ascending: true })
                .range(offset, offset + pageSize - 1);

            if (error) throw error;

            return {
                contacts: data || [],
                totalPages: Math.ceil(count / pageSize),
                currentPage: page,
                total: count
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
            const supabase = getDatabase();
            const { data, error } = await supabase
                .rpc('insert_contact_secure', { p_user: userId, p_name: name, p_phone: phone, p_tags: tags || '' });

            if (error) throw error;
            return data;
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
            const supabase = getDatabase();
            const { error } = await supabase
                .from('contacts')
                .delete()
                .match({ id: contactId, user_id: userId });

            if (error) throw error;
            return true;
        } catch (error) {
            console.error('Error deleting contact:', error);
            throw error;
        }
    }

    static async updateTags(userId, contactId, tags) {
            const supabase = getDatabase();
            const { error } = await supabase
                .rpc('update_contact_tags_secure', { p_user: userId, p_id: contactId, p_tags: tags || '' });
        if (error) throw error;
        return true;
    }

    /**
     * Import contacts from VCF file
     */
    static async importFromVCF(userId, fileBuffer) {
        try {
            const vcfContent = fileBuffer.toString('utf8');
            const cards = vCard.parse(vcfContent);

            if (!cards || cards.length === 0) {
                throw new Error('VCF file is empty or invalid');
            }

            const parsedContacts = cards.map(card => {
                const name = card.data.fn;
                const phoneProp = card.data.tel?.[0];
                const phone = phoneProp ? phoneProp.valueOf().replace(/\D/g, '') : null;
                
                if (!name || !phone) return null;
                
                return { 
                    user_id: userId, 
                    name: name.valueOf(), 
                    phone: phone 
                };
            }).filter(Boolean);

            return await this.insertUniqueContacts(userId, parsedContacts);
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
                            user_id: userId,
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
                        
                        const result = await this.insertUniqueContacts(userId, parsedContacts);
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
            const supabase = getDatabase();
            
            // Get existing contacts
            const { data: existingContacts, error: fetchError } = await supabase
                .from('contacts')
                .select('phone')
                .eq('user_id', userId);

            if (fetchError) throw fetchError;

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
                const { error } = await supabase
                    .from('contacts')
                    .insert(uniqueNewContacts);
                    
                if (error) throw error;
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
    static async getAllContacts(userId, supabaseClient = null) {
        try {
            const supabase = supabaseClient || getDatabase();
            const { data, error } = await supabase
                .from('contacts')
                .select('*')
                .eq('user_id', userId)
                .order('name', { ascending: true });

            if (error) throw error;
            return data;
        } catch (error) {
            console.error('Error fetching all contacts:', error);
            throw error;
        }
    }
}

module.exports = ContactService;
